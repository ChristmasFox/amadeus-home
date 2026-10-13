CREATE TABLE channel_binding_versions (
  bot_account_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision>=0),
  PRIMARY KEY (bot_account_id,channel_id)
);
INSERT INTO channel_binding_versions(bot_account_id,channel_id,revision)
  SELECT bot_account_id,channel_id,1 FROM channel_bindings;

CREATE TABLE pending_squad_setups (
  token_hash TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform='kook'),
  bot_account_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','bind')),
  team_id TEXT NOT NULL,
  expected_channel_revision BIGINT NOT NULL,
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_event_id TEXT,
  result_tenant_id TEXT
);
CREATE INDEX idx_pending_squad_setups_actor
  ON pending_squad_setups(bot_account_id,guild_id,actor_user_id,expires_at);

-- One shared public credential/quota pool. No key/token value is stored.
CREATE TABLE pubg_api_admission (
  quota_scope TEXT PRIMARY KEY,
  next_request_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reserved_at TIMESTAMPTZ,
  blocked_until TIMESTAMPTZ,
  observed_limit INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
