-- Content-free, durable idempotency records for one scheduled Dreaming run per
-- Bot and local calendar date. Failed runs are not retried until the next date.
CREATE TABLE gate_memory_dreaming_runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_account_id TEXT NOT NULL CHECK (length(bot_account_id) BETWEEN 1 AND 128),
  timezone TEXT NOT NULL CHECK (length(timezone) BETWEEN 1 AND 128),
  scheduled_date DATE NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error_code TEXT,
  UNIQUE (bot_account_id,timezone,scheduled_date),
  CHECK (
    (status='running' AND completed_at IS NULL AND error_code IS NULL)
    OR (status='succeeded' AND completed_at IS NOT NULL AND error_code IS NULL)
    OR (status='failed' AND completed_at IS NOT NULL AND error_code='dreaming_run_failed')
  )
);
