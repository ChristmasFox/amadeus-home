-- Gate long-term memory is independent of Lab/OpenClaw.
-- Built-in PostgreSQL types only: current postgres:18 image does not add
-- pgvector. Embedding infrastructure belongs to a later reviewed phase.
-- No old KOOK transcripts are silently promoted.
CREATE TABLE gate_memory_entries (
  memory_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_account_id TEXT NOT NULL CHECK (length(bot_account_id) BETWEEN 1 AND 128),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('dm','channel')),
  actor_id TEXT NOT NULL DEFAULT '',
  channel_id TEXT NOT NULL DEFAULT '',
  tenant_id TEXT NOT NULL DEFAULT '',
  team_id TEXT NOT NULL DEFAULT '',
  binding_revision BIGINT NOT NULL DEFAULT 0 CHECK (binding_revision >= 0),
  memory_key TEXT NOT NULL CHECK (length(memory_key) BETWEEN 1 AND 96),
  content TEXT NOT NULL CHECK (length(content) <= 800),
  source_event_id TEXT NOT NULL CHECK (length(source_event_id) BETWEEN 1 AND 256),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gate_memory_scope_shape CHECK (
    (scope_kind='dm' AND length(actor_id)>0 AND channel_id='' AND
      tenant_id='' AND team_id='' AND binding_revision=0)
    OR (scope_kind='channel' AND actor_id='' AND length(channel_id)>0 AND
      length(tenant_id)>0 AND length(team_id)>0 AND binding_revision>0)
  ),
  CONSTRAINT gate_memory_revoked_blank CHECK (revoked_at IS NULL OR content=''),
  UNIQUE (bot_account_id,scope_kind,actor_id,channel_id,tenant_id,team_id,binding_revision,memory_key)
);
CREATE INDEX idx_gate_memory_scope_recent ON gate_memory_entries (
  bot_account_id,scope_kind,actor_id,channel_id,tenant_id,team_id,binding_revision,
  updated_at DESC,memory_id
) WHERE revoked_at IS NULL;
