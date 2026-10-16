-- Rebuildable, bounded extractive checkpoints for older working context.
-- Transcript rows remain the source of truth; this is never semantic memory.
CREATE TABLE kook_conversation_checkpoints (
  bot_account_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  scope_digest TEXT NOT NULL CHECK (scope_digest ~ '^[a-f0-9]{64}$'),
  context_scope_kind TEXT NOT NULL CHECK (context_scope_kind IN ('direct','group')),
  context_tenant_id TEXT,
  context_team_id TEXT,
  context_binding_revision BIGINT,
  generation BIGINT NOT NULL CHECK (generation > 0),
  coverage_from TIMESTAMPTZ NOT NULL,
  coverage_through TIMESTAMPTZ NOT NULL,
  covered_message_count INTEGER NOT NULL CHECK (covered_message_count BETWEEN 1 AND 100),
  source_event_ids TEXT[] NOT NULL CHECK (cardinality(source_event_ids) <= 48),
  checkpoint_text TEXT NOT NULL CHECK (length(checkpoint_text) <= 16000),
  source_digest TEXT NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  rebuildable BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_account_id,channel_id,scope_digest),
  CHECK ((context_tenant_id IS NULL) = (context_team_id IS NULL)),
  CHECK (
    (context_scope_kind='direct' AND context_tenant_id IS NULL
      AND context_team_id IS NULL AND context_binding_revision IS NULL)
    OR (context_scope_kind='group' AND context_binding_revision IS NOT NULL
      AND context_binding_revision >= 0)
  ),
  CHECK (coverage_through >= coverage_from)
);

CREATE INDEX idx_kook_conversation_checkpoints_scope
  ON kook_conversation_checkpoints(
    bot_account_id,channel_id,context_scope_kind,context_tenant_id,context_team_id,
    context_binding_revision,generation DESC
  );
