-- Retrieval needs explicit freshness, supersession and source trust metadata.
-- Existing rows came from the trusted ingress-gated GateMemoryStore boundary.
ALTER TABLE gate_memory_entries
  ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'trusted_ingress'
    CHECK (source_kind IN ('trusted_ingress','user_confirmed','system_verified','unknown')),
  ADD COLUMN source_reliability SMALLINT NOT NULL DEFAULT 80
    CHECK (source_reliability BETWEEN 0 AND 100),
  ADD COLUMN valid_until TIMESTAMPTZ,
  ADD COLUMN superseded_at TIMESTAMPTZ;

CREATE INDEX idx_gate_memory_active_scope
  ON gate_memory_entries(
    bot_account_id,scope_kind,actor_id,channel_id,tenant_id,team_id,binding_revision,
    memory_key,updated_at DESC,memory_id
  )
  WHERE revoked_at IS NULL AND superseded_at IS NULL AND source_kind <> 'unknown';
