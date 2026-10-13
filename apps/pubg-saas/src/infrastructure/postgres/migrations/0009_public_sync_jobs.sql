CREATE TABLE IF NOT EXISTS public_sync_jobs (
  tenant_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token TEXT,
  lease_until TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code TEXT CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{1,64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,team_id),
  FOREIGN KEY (tenant_id,team_id) REFERENCES teams(tenant_id,team_id) ON DELETE CASCADE,
  CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_public_sync_jobs_due
  ON public_sync_jobs(next_attempt_at,tenant_id,team_id);
