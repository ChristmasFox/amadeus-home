-- Telemetry review facts are derived from a particular team's roster and
-- aliases. Keep them separate even when two teams share a public match.
-- Older shared rows have no trustworthy owner or team-config version, so do
-- not copy them into an arbitrary team's scope.
TRUNCATE TABLE telemetry_features, telemetry_prefetch_attempts;

CREATE TABLE telemetry_team_features (
  tenant_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  team_config_hash TEXT NOT NULL,
  shard TEXT NOT NULL,
  match_id TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  facts_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, team_id, team_config_hash, shard, match_id, parser_version, feature_version),
  FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, team_id) ON DELETE CASCADE,
  FOREIGN KEY (shard, match_id) REFERENCES matches(shard, match_id) ON DELETE CASCADE
);

CREATE TABLE telemetry_team_prefetch_attempts (
  tenant_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  team_config_hash TEXT NOT NULL,
  shard TEXT NOT NULL,
  match_id TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'FETCHED', 'HIT', 'UNAVAILABLE')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempted_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  error TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, team_id, team_config_hash, shard, match_id, parser_version, feature_version),
  FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, team_id) ON DELETE CASCADE,
  FOREIGN KEY (shard, match_id) REFERENCES matches(shard, match_id) ON DELETE CASCADE
);
CREATE INDEX telemetry_team_attempts_due
  ON telemetry_team_prefetch_attempts(tenant_id, team_id, team_config_hash, parser_version, feature_version, status, next_retry_at);
