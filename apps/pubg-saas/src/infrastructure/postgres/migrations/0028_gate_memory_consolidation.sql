-- Consent-scoped source admissions for manually triggered Light/REM work.
-- No transcript text is copied into these authorization records.
CREATE TABLE gate_memory_consolidation_consents (
  bot_account_id TEXT NOT NULL CHECK (length(bot_account_id) BETWEEN 1 AND 128),
  actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 256),
  workflow TEXT NOT NULL CHECK (workflow IN ('light','rem')),
  enabled BOOLEAN NOT NULL,
  consent_version BIGINT NOT NULL CHECK (consent_version >= 1),
  changed_by_event_id TEXT NOT NULL CHECK (length(changed_by_event_id) BETWEEN 1 AND 256),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_account_id,actor_id,workflow)
);

CREATE TABLE gate_memory_consolidation_admissions (
  admission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_account_id TEXT NOT NULL CHECK (length(bot_account_id) BETWEEN 1 AND 128),
  actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 256),
  workflow TEXT NOT NULL CHECK (workflow IN ('light','rem')),
  channel_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL CHECK (length(source_event_id) BETWEEN 1 AND 256),
  message_id TEXT NOT NULL CHECK (length(message_id) BETWEEN 1 AND 256),
  consent_version BIGINT NOT NULL CHECK (consent_version >= 1),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','retry','done','skipped','dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  skip_reason TEXT CHECK (skip_reason IS NULL OR skip_reason IN (
    'consent_revoked','source_provenance_missing','source_expired','source_scope_invalid',
    'input_over_budget','system_work_unavailable'
  )),
  admitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now()+interval '7 days'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bot_account_id,actor_id,workflow,source_event_id),
  CHECK (channel_id='dm:' || bot_account_id || ':' || actor_id),
  CHECK ((status='processing') = (lease_token IS NOT NULL AND lease_until IS NOT NULL))
);

CREATE INDEX idx_gate_memory_consolidation_admissions_ready
  ON gate_memory_consolidation_admissions(bot_account_id,workflow,status,next_attempt_at,admitted_at)
  WHERE status IN ('pending','retry','processing');

CREATE TABLE gate_memory_consolidation_candidates (
  candidate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key CHAR(64) NOT NULL UNIQUE CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
  bot_account_id TEXT NOT NULL CHECK (length(bot_account_id) BETWEEN 1 AND 128),
  actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 256),
  workflow TEXT NOT NULL CHECK (workflow IN ('light','rem')),
  consent_version BIGINT NOT NULL CHECK (consent_version >= 1),
  memory_key TEXT NOT NULL CHECK (length(memory_key) BETWEEN 1 AND 96),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 800),
  candidate_kind TEXT NOT NULL CHECK (candidate_kind IN ('stable_preference','verifiable_fact','episodic_checkpoint')),
  valid_until TIMESTAMPTZ,
  source_event_ids TEXT[] NOT NULL CHECK (cardinality(source_event_ids) BETWEEN 0 AND 8),
  expected_revision BIGINT CHECK (expected_revision IS NULL OR expected_revision >= 1),
  status TEXT NOT NULL DEFAULT 'pending_confirmation'
    CHECK (status IN ('pending_confirmation','conflict','duplicate','promoted','rejected','expired')),
  result_reason TEXT CHECK (result_reason IS NULL OR result_reason IN (
    'existing_memory_conflict','already_present','consent_revoked','source_expired','cas_conflict'
  )),
  confirmed_by_event_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now()+interval '30 days'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((candidate_kind='stable_preference' AND valid_until IS NULL)
    OR (candidate_kind IN ('verifiable_fact','episodic_checkpoint') AND valid_until IS NOT NULL))
);

CREATE INDEX idx_gate_memory_consolidation_candidates_owner_recent
  ON gate_memory_consolidation_candidates(bot_account_id,actor_id,status,created_at DESC,candidate_id);
CREATE UNIQUE INDEX idx_gate_memory_consolidation_candidates_confirm_event
  ON gate_memory_consolidation_candidates(bot_account_id,confirmed_by_event_id)
  WHERE confirmed_by_event_id IS NOT NULL;

CREATE TABLE gate_memory_consolidation_checkpoints (
  bot_account_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  workflow TEXT NOT NULL CHECK (workflow IN ('light','rem')),
  consent_version BIGINT NOT NULL CHECK (consent_version >= 1),
  last_admitted_at TIMESTAMPTZ NOT NULL,
  last_event_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_account_id,actor_id,workflow,consent_version)
);
