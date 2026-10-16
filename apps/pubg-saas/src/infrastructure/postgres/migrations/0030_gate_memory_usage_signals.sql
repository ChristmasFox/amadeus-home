-- Content-free recall/use evidence for future Dreaming promotion decisions.
-- Query text is never stored; fingerprints and event identifiers expire after 90 days.
CREATE TABLE gate_memory_usage_signals (
  signal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_account_id TEXT NOT NULL CHECK (length(bot_account_id) BETWEEN 1 AND 128),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('dm','channel')),
  actor_id TEXT NOT NULL DEFAULT '',
  channel_id TEXT NOT NULL DEFAULT '',
  tenant_id TEXT NOT NULL DEFAULT '',
  team_id TEXT NOT NULL DEFAULT '',
  binding_revision BIGINT NOT NULL DEFAULT 0 CHECK (binding_revision >= 0),
  memory_key TEXT NOT NULL CHECK (length(memory_key) BETWEEN 1 AND 96),
  memory_revision BIGINT NOT NULL CHECK (memory_revision >= 1),
  memory_source_event_id TEXT NOT NULL CHECK (length(memory_source_event_id) BETWEEN 1 AND 256),
  request_event_id TEXT NOT NULL CHECK (length(request_event_id) BETWEEN 1 AND 256),
  query_fingerprint CHAR(64) NOT NULL CHECK (query_fingerprint ~ '^[a-f0-9]{64}$'),
  signal_kind TEXT NOT NULL CHECK (signal_kind IN ('recalled','used')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now()+interval '90 days'),
  CHECK (
    (scope_kind='dm' AND length(actor_id)>0 AND channel_id='' AND tenant_id=''
      AND team_id='' AND binding_revision=0)
    OR
    (scope_kind='channel' AND actor_id='' AND length(channel_id)>0 AND length(tenant_id)>0
      AND length(team_id)>0 AND binding_revision>0)
  ),
  UNIQUE (bot_account_id,scope_kind,actor_id,channel_id,tenant_id,team_id,binding_revision,
    request_event_id,memory_key,memory_revision,signal_kind)
);

CREATE INDEX idx_gate_memory_usage_evidence
  ON gate_memory_usage_signals(bot_account_id,scope_kind,actor_id,channel_id,tenant_id,team_id,
    binding_revision,memory_key,memory_revision,signal_kind,created_at DESC);
CREATE INDEX idx_gate_memory_usage_expiry
  ON gate_memory_usage_signals(expires_at);
