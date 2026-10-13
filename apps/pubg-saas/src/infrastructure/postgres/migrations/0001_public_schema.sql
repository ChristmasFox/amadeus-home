CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenants (
  tenant_id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform = 'kook'),
  bot_account_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, bot_account_id, guild_id)
);

CREATE TABLE IF NOT EXISTS channel_identities (
  platform TEXT NOT NULL CHECK (platform = 'kook'),
  bot_account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, bot_account_id, user_id)
);

CREATE TABLE IF NOT EXISTS tenant_users (
  tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  bot_account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, platform, bot_account_id, user_id),
  FOREIGN KEY (platform, bot_account_id, user_id)
    REFERENCES channel_identities(platform, bot_account_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS teams (
  tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  label TEXT NOT NULL,
  pubg_shard TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, team_id)
);

CREATE TABLE IF NOT EXISTS channel_bindings (
  tenant_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform = 'kook'),
  bot_account_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  bound_by_user_id TEXT NOT NULL,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, platform, bot_account_id, channel_id),
  UNIQUE (platform, bot_account_id, channel_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, team_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_channel_bindings_team ON channel_bindings(tenant_id, team_id);

CREATE TABLE IF NOT EXISTS team_members (
  tenant_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  pubg_account_id TEXT NOT NULL,
  added_by_user_id TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, team_id, pubg_account_id),
  FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, team_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_team_members_account ON team_members(pubg_account_id, tenant_id, team_id);

CREATE TABLE IF NOT EXISTS team_user_access (
  tenant_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform = 'kook'),
  bot_account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('requester', 'member', 'admin')),
  granted_by_user_id TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, team_id, platform, bot_account_id, user_id),
  FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, team_id) ON DELETE CASCADE,
  FOREIGN KEY (platform, bot_account_id, user_id)
    REFERENCES channel_identities(platform, bot_account_id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_team_user_access_actor
  ON team_user_access(platform, bot_account_id, user_id, tenant_id, team_id);

-- No team FK: a disband confirmation is consumed in the same transaction that
-- deletes its team; confirmTeamAction also checks the team still exists.
CREATE TABLE IF NOT EXISTS pending_team_actions (
  confirmation_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform = 'kook'),
  bot_account_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('add_members','replace_roster','unbind_channel','disband_team')),
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pending_team_actions_expiry
  ON pending_team_actions(expires_at) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS account_claims (
  platform TEXT NOT NULL CHECK (platform = 'kook'),
  bot_account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  pubg_shard TEXT NOT NULL,
  pubg_account_id TEXT NOT NULL,
  claim_status TEXT NOT NULL CHECK (claim_status IN ('self_declared', 'verified')),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, bot_account_id, user_id),
  UNIQUE (platform, bot_account_id, pubg_shard, pubg_account_id),
  FOREIGN KEY (platform, bot_account_id, user_id)
    REFERENCES channel_identities(platform, bot_account_id, user_id) ON DELETE CASCADE
);

-- Pending claims do not create channel identities until the user confirms.
CREATE TABLE IF NOT EXISTS pending_account_claims (
  confirmation_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform = 'kook'),
  bot_account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('claim','unclaim')),
  pubg_shard TEXT,
  pubg_account_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CHECK (pubg_shard IS NOT NULL AND pubg_account_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_pending_account_claims_expiry
  ON pending_account_claims(expires_at) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS team_aliases (
  tenant_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  alias_key TEXT NOT NULL,
  pubg_account_id TEXT NOT NULL,
  display_alias TEXT NOT NULL,
  PRIMARY KEY (tenant_id, team_id, alias_key),
  FOREIGN KEY (tenant_id, team_id, pubg_account_id)
    REFERENCES team_members(tenant_id, team_id, pubg_account_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS team_preferences (
  tenant_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  preference_key TEXT NOT NULL,
  preference_json JSONB NOT NULL,
  updated_by_user_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, team_id, preference_key),
  FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, team_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS matches (
  match_id TEXT PRIMARY KEY,
  shard TEXT NOT NULL,
  created_at TEXT,
  timestamp_ms BIGINT NOT NULL,
  match_type TEXT NOT NULL,
  game_mode TEXT NOT NULL,
  is_competitive BOOLEAN NOT NULL,
  map_name TEXT NOT NULL,
  duration DOUBLE PRECISION NOT NULL,
  patch_version TEXT NOT NULL,
  telemetry_url TEXT,
  schema_version INTEGER NOT NULL,
  parser_version TEXT,
  fetched_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  checked_player_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_json JSONB
);
CREATE INDEX IF NOT EXISTS idx_matches_timestamp ON matches(timestamp_ms, match_id);
CREATE INDEX IF NOT EXISTS idx_matches_mode_map ON matches(game_mode, map_name);
CREATE INDEX IF NOT EXISTS idx_matches_shard_id ON matches(shard, match_id);

CREATE TABLE IF NOT EXISTS match_players (
  match_id TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  rank DOUBLE PRECISION,
  kills DOUBLE PRECISION NOT NULL,
  assists DOUBLE PRECISION NOT NULL,
  damage DOUBLE PRECISION NOT NULL,
  dbnos DOUBLE PRECISION NOT NULL,
  revives DOUBLE PRECISION NOT NULL,
  headshot_kills DOUBLE PRECISION NOT NULL,
  survival_time DOUBLE PRECISION NOT NULL,
  longest_kill DOUBLE PRECISION NOT NULL,
  deaths DOUBLE PRECISION,
  death_semantics TEXT NOT NULL,
  PRIMARY KEY (match_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_match_players_account_match ON match_players(account_id, match_id);

CREATE TABLE IF NOT EXISTS sync_state (
  tenant_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  state_key TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL,
  state_json JSONB NOT NULL,
  PRIMARY KEY (tenant_id, team_id, state_key)
);

CREATE TABLE IF NOT EXISTS telemetry_features (
  match_id TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  facts_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (match_id, parser_version, feature_version)
);

CREATE TABLE IF NOT EXISTS telemetry_prefetch_attempts (
  match_id TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'FETCHED', 'HIT', 'UNAVAILABLE')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempted_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  error TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (match_id, parser_version, feature_version)
);
CREATE INDEX IF NOT EXISTS idx_telemetry_prefetch_due
  ON telemetry_prefetch_attempts(parser_version, feature_version, status, next_retry_at);

CREATE TABLE IF NOT EXISTS telemetry_prefetch_runs (
  tenant_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  report_date TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  trigger TEXT NOT NULL,
  discovered_match_count INTEGER NOT NULL,
  new_match_count INTEGER NOT NULL,
  candidate_match_count INTEGER NOT NULL,
  fetched_count INTEGER NOT NULL,
  cache_hit_count INTEGER NOT NULL,
  unavailable_count INTEGER NOT NULL,
  pending_count INTEGER NOT NULL,
  failed_match_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (tenant_id, team_id, run_id)
);
CREATE INDEX IF NOT EXISTS idx_telemetry_prefetch_runs_date
  ON telemetry_prefetch_runs(tenant_id, team_id, report_date, started_at);

CREATE TABLE IF NOT EXISTS result_sets (
  tenant_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  bot_account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  result_set_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  result_json JSONB NOT NULL,
  PRIMARY KEY (tenant_id, team_id, platform, bot_account_id, user_id, channel_id, session_id, result_set_id)
);
CREATE INDEX IF NOT EXISTS idx_result_sets_expiry ON result_sets(tenant_id, team_id, expires_at);

CREATE TABLE IF NOT EXISTS session_contexts (
  tenant_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  bot_account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  context_json JSONB NOT NULL,
  PRIMARY KEY (tenant_id, team_id, platform, bot_account_id, user_id, channel_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_session_contexts_expiry ON session_contexts(tenant_id, team_id, expires_at);

CREATE TABLE IF NOT EXISTS message_inbox (
  platform TEXT NOT NULL,
  bot_account_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  tenant_id TEXT,
  team_id TEXT,
  channel_id TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'received',
  PRIMARY KEY (platform, bot_account_id, source_event_id)
);

CREATE TABLE IF NOT EXISTS kook_gateway_state (
  bot_account_id TEXT PRIMARY KEY,
  session_id TEXT,
  last_sn BIGINT NOT NULL DEFAULT 0 CHECK (last_sn >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_outbox (
  outbox_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL,
  bot_account_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  source_event_id TEXT,
  payload_json JSONB NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  lease_token TEXT,
  lease_until TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_message_outbox_due ON message_outbox(status, next_attempt_at, lease_until, created_at);

CREATE TABLE IF NOT EXISTS usage_records (
  usage_id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  bot_account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  provider TEXT,
  model_id TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_usage_records_tenant_date ON usage_records(tenant_id, recorded_at);
