-- P4 records mutation idempotency without retaining candidate text or credentials.
CREATE TABLE gate_memory_write_receipts (
  idempotency_key CHAR(64) PRIMARY KEY CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
  bot_account_id TEXT NOT NULL CHECK (length(bot_account_id) BETWEEN 1 AND 128),
  scope_kind TEXT NOT NULL CHECK (scope_kind='dm'),
  actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 256),
  source_event_id TEXT NOT NULL CHECK (length(source_event_id) BETWEEN 1 AND 256),
  intent TEXT NOT NULL CHECK (intent IN ('remember','correct','forget')),
  memory_key TEXT NOT NULL CHECK (length(memory_key) BETWEEN 1 AND 96),
  outcome TEXT NOT NULL CHECK (outcome IN ('created','revised','forgotten','already_present','not_found')),
  memory_revision BIGINT CHECK (memory_revision IS NULL OR memory_revision>=1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bot_account_id,scope_kind,actor_id,source_event_id)
);

CREATE INDEX idx_gate_memory_write_receipts_scope_recent
  ON gate_memory_write_receipts(bot_account_id,scope_kind,actor_id,created_at DESC);
