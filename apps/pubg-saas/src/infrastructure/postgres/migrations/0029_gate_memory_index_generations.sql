-- Version the transactional embedding outbox so a shadow reindex can run
-- alongside the active generation without replacing vectors in place.
ALTER TABLE gate_memory_embedding_jobs
  ADD COLUMN index_version INTEGER NOT NULL DEFAULT 1 CHECK (index_version > 0);

ALTER TABLE gate_memory_embedding_jobs
  DROP CONSTRAINT gate_memory_embedding_jobs_memory_id_source_revision_key;

ALTER TABLE gate_memory_embedding_jobs
  ADD CONSTRAINT gate_memory_embedding_jobs_memory_revision_version_key
    UNIQUE (memory_id,source_revision,index_version);

CREATE TABLE gate_memory_index_generation_state (
  bot_account_id TEXT PRIMARY KEY CHECK (length(bot_account_id) BETWEEN 1 AND 128),
  active_provider_id TEXT NOT NULL CHECK (length(active_provider_id) BETWEEN 1 AND 96),
  active_model_id TEXT NOT NULL CHECK (length(active_model_id) BETWEEN 1 AND 200),
  active_dimensions INTEGER NOT NULL CHECK (active_dimensions BETWEEN 1 AND 16000),
  active_index_version INTEGER NOT NULL CHECK (active_index_version > 0),
  latest_index_version INTEGER NOT NULL DEFAULT 1 CHECK (latest_index_version > 0),
  building_provider_id TEXT CHECK (building_provider_id IS NULL OR length(building_provider_id) BETWEEN 1 AND 96),
  building_model_id TEXT CHECK (building_model_id IS NULL OR length(building_model_id) BETWEEN 1 AND 200),
  building_dimensions INTEGER CHECK (building_dimensions IS NULL OR building_dimensions BETWEEN 1 AND 16000),
  building_index_version INTEGER CHECK (building_index_version IS NULL OR building_index_version > 0),
  reindex_status TEXT NOT NULL DEFAULT 'idle' CHECK (reindex_status IN ('idle','building','paused','failed')),
  scan_cursor_memory_id UUID,
  scan_complete BOOLEAN NOT NULL DEFAULT FALSE,
  last_error_code TEXT CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{1,64}$'),
  started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((building_index_version IS NULL) = (building_provider_id IS NULL)),
  CHECK ((building_index_version IS NULL) = (building_model_id IS NULL)),
  CHECK ((building_index_version IS NULL) = (building_dimensions IS NULL)),
  CHECK (active_index_version<=latest_index_version),
  CHECK ((reindex_status='idle') = (building_index_version IS NULL))
);

-- Mutations enqueue the active index and any in-progress shadow index. If the
-- per-bot state has not yet been bootstrapped, the legacy generation is v1.
CREATE FUNCTION gate_memory_index_job_versions(target_bot_account_id TEXT)
RETURNS TABLE(index_version INTEGER)
LANGUAGE SQL STABLE
AS $gate_memory_index_job_versions$
  SELECT COALESCE(state.active_index_version, 1) AS index_version
  FROM (SELECT 1) seed
  LEFT JOIN gate_memory_index_generation_state state
    ON state.bot_account_id=target_bot_account_id
  UNION
  SELECT state.building_index_version
  FROM gate_memory_index_generation_state state
  WHERE state.bot_account_id=target_bot_account_id
    AND state.building_index_version IS NOT NULL
$gate_memory_index_job_versions$;
