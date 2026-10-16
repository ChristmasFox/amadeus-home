-- Durable, additive embedding work and usage accounting; built-in PG18 types
-- only. This migration deliberately does not install pgvector or make it a
-- startup requirement.
CREATE TABLE gate_memory_embedding_jobs (
  job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL REFERENCES gate_memory_entries(memory_id) ON DELETE CASCADE,
  source_revision BIGINT NOT NULL CHECK (source_revision > 0),
  operation TEXT NOT NULL CHECK (operation IN ('upsert','delete')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','retry','done','dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  last_error_code TEXT CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{1,64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  UNIQUE (memory_id,source_revision),
  CHECK ((status='processing') = (lease_token IS NOT NULL AND lease_until IS NOT NULL))
);

CREATE INDEX idx_gate_memory_embedding_jobs_ready
  ON gate_memory_embedding_jobs(status,next_attempt_at,created_at,job_id)
  WHERE status IN ('pending','retry','processing');

CREATE TABLE gate_memory_embedding_usage_daily (
  bot_account_id TEXT NOT NULL CHECK (length(bot_account_id) BETWEEN 1 AND 128),
  budget_day DATE NOT NULL,
  actual_tokens BIGINT NOT NULL DEFAULT 0 CHECK (actual_tokens >= 0),
  reserved_tokens BIGINT NOT NULL DEFAULT 0 CHECK (reserved_tokens >= 0),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  reserved_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_account_id,budget_day)
);
