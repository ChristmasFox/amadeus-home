-- Optional, high-risk vector-generation schema. This file is intentionally
-- excluded from migratePublicDatabase and requires a separately approved
-- operator to install the vector extension before applying it.
DO $gate_vector_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='vector') THEN
    RAISE EXCEPTION 'gate_memory_vector_extension_required';
  END IF;
END
$gate_vector_check$;

CREATE TABLE gate_memory_embeddings (
  memory_id UUID NOT NULL REFERENCES gate_memory_entries(memory_id) ON DELETE CASCADE,
  bot_account_id TEXT NOT NULL CHECK (length(bot_account_id) BETWEEN 1 AND 128),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('dm','channel')),
  actor_id TEXT NOT NULL DEFAULT '',
  channel_id TEXT NOT NULL DEFAULT '',
  tenant_id TEXT NOT NULL DEFAULT '',
  team_id TEXT NOT NULL DEFAULT '',
  binding_revision BIGINT NOT NULL CHECK (binding_revision >= 0),
  source_revision BIGINT NOT NULL CHECK (source_revision > 0),
  provider_id TEXT NOT NULL CHECK (length(provider_id) BETWEEN 1 AND 96),
  model_id TEXT NOT NULL CHECK (length(model_id) BETWEEN 1 AND 200),
  dimensions INTEGER NOT NULL CHECK (dimensions BETWEEN 1 AND 16000),
  normalization TEXT NOT NULL CHECK (normalization='l2_unit'),
  index_version INTEGER NOT NULL CHECK (index_version > 0),
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  embedding vector NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (memory_id,provider_id,model_id,index_version),
  CHECK (vector_dims(embedding)=dimensions),
  CHECK (
    (scope_kind='dm' AND length(actor_id)>0 AND channel_id='' AND tenant_id='' AND team_id='' AND binding_revision=0)
    OR (scope_kind='channel' AND actor_id='' AND length(channel_id)>0 AND length(tenant_id)>0
      AND length(team_id)>0 AND binding_revision>0)
  )
);

-- Scope-first B-tree for exact filtered cosine scans. No global HNSW/ANN index
-- is created: an approximate index would need separate filter-recall study.
CREATE INDEX idx_gate_memory_embeddings_scope
  ON gate_memory_embeddings(
    bot_account_id,scope_kind,actor_id,channel_id,tenant_id,team_id,binding_revision,
    provider_id,model_id,dimensions,index_version,memory_id
  );
