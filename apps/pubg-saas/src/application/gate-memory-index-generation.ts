import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { GateMemoryEmbeddingContract } from './gate-memory-embedding.js';
import { KOOK_CHANNEL_BINDING_JOIN, KOOK_CHANNEL_VERSION_JOIN } from './kook-channel-binding-sql.js';

export interface GateMemoryIndexGenerationState extends QueryResultRow {
  bot_account_id: string;
  active_provider_id: string;
  active_model_id: string;
  active_dimensions: number;
  active_index_version: number;
  latest_index_version: number;
  building_provider_id: string | null;
  building_model_id: string | null;
  building_dimensions: number | null;
  building_index_version: number | null;
  reindex_status: 'idle' | 'building' | 'paused' | 'failed';
  scan_cursor_memory_id: string | null;
  scan_complete: boolean;
  last_error_code: string | null;
}

export interface GateMemoryIndexScanResult {
  scanned: number;
  queued: number;
  complete: boolean;
  cursor: string | null;
}

function validContract(contract: GateMemoryEmbeddingContract): void {
  if (contract.providerId !== 'gate-openai-compatible'
    || typeof contract.modelId !== 'string' || contract.modelId.length < 1 || contract.modelId.length > 200
    || !Number.isSafeInteger(contract.dimensions) || contract.dimensions < 1 || contract.dimensions > 16_000
    || contract.normalization !== 'l2_unit'
    || !Number.isSafeInteger(contract.indexVersion) || contract.indexVersion < 1 || contract.indexVersion > 1_000_000) {
    throw new Error('gate_memory_index_contract_invalid');
  }
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export class GateMemoryIndexGenerationManager {
  constructor(private readonly pool: Pool) {}

  private async requireVectorSchema(client: Pool | PoolClient): Promise<void> {
    const result = await client.query<{ available: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector')
         AND to_regclass('gate_memory_embeddings') IS NOT NULL AS available`,
    );
    if (result.rows[0]?.available !== true) throw new Error('gate_memory_vector_index_unavailable');
  }

  /** Bootstrap is intentionally limited to the legacy v1 generation. */
  async initialize(botAccountId: string, contract: GateMemoryEmbeddingContract): Promise<GateMemoryIndexGenerationState> {
    validContract(contract);
    if (!botAccountId || botAccountId.length > 128 || contract.indexVersion !== 1) {
      throw new Error('gate_memory_index_initialization_invalid');
    }
    await this.pool.query(
      `INSERT INTO gate_memory_index_generation_state(
         bot_account_id,active_provider_id,active_model_id,active_dimensions,active_index_version
       ) VALUES ($1,$2,$3,$4,1) ON CONFLICT (bot_account_id) DO NOTHING`,
      [botAccountId, contract.providerId, contract.modelId, contract.dimensions],
    );
    const state = await this.status(botAccountId);
    if (!state) throw new Error('gate_memory_index_state_unavailable');
    return state;
  }

  async status(botAccountId: string): Promise<GateMemoryIndexGenerationState | null> {
    const result = await this.pool.query<GateMemoryIndexGenerationState>(
      'SELECT * FROM gate_memory_index_generation_state WHERE bot_account_id=$1', [botAccountId],
    );
    return result.rows[0] ?? null;
  }

  async beginShadowReindex(botAccountId: string, target: GateMemoryEmbeddingContract): Promise<void> {
    validContract(target);
    if (!botAccountId || botAccountId.length > 128) throw new Error('gate_memory_index_bot_invalid');
    await this.requireVectorSchema(this.pool);
    await transaction(this.pool, async client => {
      const result = await client.query<GateMemoryIndexGenerationState>(
        'SELECT * FROM gate_memory_index_generation_state WHERE bot_account_id=$1 FOR UPDATE', [botAccountId],
      );
      const state = result.rows[0];
      if (!state) throw new Error('gate_memory_index_state_unavailable');
      if (state.reindex_status !== 'idle' || state.building_index_version !== null) {
        throw new Error('gate_memory_index_generation_busy');
      }
      if (target.indexVersion <= state.latest_index_version) throw new Error('gate_memory_index_version_not_monotonic');
      await client.query(
        `UPDATE gate_memory_index_generation_state SET building_provider_id=$2,building_model_id=$3,
           building_dimensions=$4,building_index_version=$5,latest_index_version=$5,reindex_status='building',
           scan_cursor_memory_id=NULL,scan_complete=FALSE,last_error_code=NULL,
           started_at=now(),updated_at=now() WHERE bot_account_id=$1`,
        [botAccountId, target.providerId, target.modelId, target.dimensions, target.indexVersion],
      );
    });
  }

  async scanNextPage(botAccountId: string, limit = 50): Promise<GateMemoryIndexScanResult> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('gate_memory_index_scan_limit_invalid');
    return transaction(this.pool, async client => {
      const stateResult = await client.query<GateMemoryIndexGenerationState>(
        'SELECT * FROM gate_memory_index_generation_state WHERE bot_account_id=$1 FOR UPDATE', [botAccountId],
      );
      const state = stateResult.rows[0];
      if (!state || state.building_index_version === null) throw new Error('gate_memory_index_generation_missing');
      if (state.reindex_status === 'paused') throw new Error('gate_memory_index_generation_paused');
      if (state.reindex_status !== 'building') throw new Error('gate_memory_index_generation_not_building');
      if (state.scan_complete) return { scanned: 0, queued: 0, complete: true, cursor: state.scan_cursor_memory_id };

      const memories = await client.query<{ memory_id: string; revision: string }>(
        `SELECT memory.memory_id,memory.revision::TEXT AS revision
         FROM gate_memory_entries memory
         WHERE memory.bot_account_id=$1 AND memory.revoked_at IS NULL
           AND (memory.valid_until IS NULL OR memory.valid_until>now())
           AND ($2::UUID IS NULL OR memory.memory_id>$2::UUID)
           AND (memory.scope_kind='dm' OR EXISTS (
             SELECT 1 FROM tenants tenant
             ${KOOK_CHANNEL_BINDING_JOIN}
             ${KOOK_CHANNEL_VERSION_JOIN}
             WHERE tenant.bot_account_id=memory.bot_account_id AND tenant.tenant_id=memory.tenant_id
               AND binding.channel_id=memory.channel_id AND binding.tenant_id=memory.tenant_id
               AND binding.team_id=memory.team_id AND version.revision=memory.binding_revision
           ))
         ORDER BY memory.memory_id LIMIT $3`,
        [botAccountId, state.scan_cursor_memory_id, limit],
      );
      let queued = 0;
      for (const memory of memories.rows) {
        const inserted = await client.query(
          `INSERT INTO gate_memory_embedding_jobs(memory_id,source_revision,operation,index_version)
           VALUES ($1,$2,'upsert',$3) ON CONFLICT DO NOTHING`,
          [memory.memory_id, memory.revision, state.building_index_version],
        );
        queued += inserted.rowCount ?? 0;
      }
      const cursor = memories.rows.at(-1)?.memory_id ?? state.scan_cursor_memory_id;
      const complete = memories.rows.length < limit;
      await client.query(
        `UPDATE gate_memory_index_generation_state SET scan_cursor_memory_id=$2,
           scan_complete=$3,updated_at=now() WHERE bot_account_id=$1`,
        [botAccountId, cursor, complete],
      );
      return { scanned: memories.rows.length, queued, complete, cursor };
    });
  }

  async pause(botAccountId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE gate_memory_index_generation_state SET reindex_status='paused',updated_at=now()
       WHERE bot_account_id=$1 AND reindex_status='building' AND building_index_version IS NOT NULL`, [botAccountId],
    );
    if (result.rowCount !== 1) throw new Error('gate_memory_index_generation_not_building');
  }

  async markFailed(botAccountId: string, errorCode: string): Promise<void> {
    if (!/^[a-z0-9_]{1,64}$/u.test(errorCode)) throw new Error('gate_memory_index_error_code_invalid');
    const result = await this.pool.query(
      `UPDATE gate_memory_index_generation_state SET reindex_status='failed',last_error_code=$2,updated_at=now()
       WHERE bot_account_id=$1 AND building_index_version IS NOT NULL
         AND reindex_status IN ('building','paused')`, [botAccountId, errorCode],
    );
    if (result.rowCount !== 1) throw new Error('gate_memory_index_generation_not_active');
  }

  async resume(botAccountId: string): Promise<number> {
    await this.requireVectorSchema(this.pool);
    return transaction(this.pool, async client => {
      const result = await client.query<GateMemoryIndexGenerationState>(
        `UPDATE gate_memory_index_generation_state SET reindex_status='building',last_error_code=NULL,updated_at=now()
         WHERE bot_account_id=$1 AND reindex_status IN ('paused','failed') AND building_index_version IS NOT NULL
         RETURNING *`, [botAccountId],
      );
      const state = result.rows[0];
      if (!state || state.building_index_version === null) throw new Error('gate_memory_index_generation_not_paused');
      const queued = await client.query(
        `INSERT INTO gate_memory_embedding_jobs(memory_id,source_revision,operation,index_version)
         SELECT memory.memory_id,memory.revision,'upsert',$2
         FROM gate_memory_entries memory
         WHERE memory.bot_account_id=$1 AND memory.revoked_at IS NULL
           AND (memory.valid_until IS NULL OR memory.valid_until>now())
           AND (memory.scope_kind='dm' OR EXISTS (
             SELECT 1 FROM tenants tenant
             ${KOOK_CHANNEL_BINDING_JOIN}
             ${KOOK_CHANNEL_VERSION_JOIN}
             WHERE tenant.bot_account_id=memory.bot_account_id AND tenant.tenant_id=memory.tenant_id
               AND binding.channel_id=memory.channel_id AND binding.tenant_id=memory.tenant_id
               AND binding.team_id=memory.team_id AND version.revision=memory.binding_revision
           ))
           AND NOT EXISTS (
             SELECT 1 FROM gate_memory_embeddings embedded
             WHERE embedded.memory_id=memory.memory_id AND embedded.source_revision=memory.revision
               AND embedded.provider_id=$3 AND embedded.model_id=$4 AND embedded.dimensions=$5
               AND embedded.index_version=$2 AND embedded.normalization='l2_unit'
           )
         ON CONFLICT (memory_id,source_revision,index_version) DO UPDATE SET
           status='pending',attempt_count=0,next_attempt_at=now(),lease_token=NULL,lease_until=NULL,
           last_error_code=NULL,finished_at=NULL,updated_at=now()
         WHERE gate_memory_embedding_jobs.status IN ('done','dead')`,
        [botAccountId, state.building_index_version, state.building_provider_id,
          state.building_model_id, state.building_dimensions],
      );
      return queued.rowCount ?? 0;
    });
  }

  async cancel(botAccountId: string): Promise<boolean> {
    return transaction(this.pool, async client => {
      const result = await client.query<GateMemoryIndexGenerationState>(
        'SELECT * FROM gate_memory_index_generation_state WHERE bot_account_id=$1 FOR UPDATE', [botAccountId],
      );
      const state = result.rows[0];
      if (!state || state.building_index_version === null) return false;
      await client.query(
        `UPDATE gate_memory_embedding_jobs job SET status='done',lease_token=NULL,lease_until=NULL,
           last_error_code='index_generation_cancelled',finished_at=now(),updated_at=now()
         FROM gate_memory_entries memory
         WHERE memory.memory_id=job.memory_id AND memory.bot_account_id=$1
           AND job.index_version=$2 AND job.operation='upsert'
           AND job.status IN ('pending','retry','processing')`,
        [botAccountId, state.building_index_version],
      );
      await client.query(
        `UPDATE gate_memory_index_generation_state SET building_provider_id=NULL,building_model_id=NULL,
           building_dimensions=NULL,building_index_version=NULL,reindex_status='idle',scan_cursor_memory_id=NULL,
           scan_complete=FALSE,last_error_code=NULL,started_at=NULL,updated_at=now()
         WHERE bot_account_id=$1`, [botAccountId],
      );
      return true;
    });
  }

  async activate(botAccountId: string): Promise<void> {
    await this.requireVectorSchema(this.pool);
    await transaction(this.pool, async client => {
      const stateResult = await client.query<GateMemoryIndexGenerationState>(
        'SELECT * FROM gate_memory_index_generation_state WHERE bot_account_id=$1 FOR UPDATE', [botAccountId],
      );
      const state = stateResult.rows[0];
      if (!state || state.building_index_version === null) throw new Error('gate_memory_index_generation_missing');
      if (state.reindex_status !== 'building' || !state.scan_complete) {
        throw new Error('gate_memory_index_generation_incomplete');
      }
      const missing = await client.query(
        `SELECT 1 FROM gate_memory_entries memory
         WHERE memory.bot_account_id=$1 AND memory.revoked_at IS NULL
           AND (memory.valid_until IS NULL OR memory.valid_until>now())
           AND (memory.scope_kind='dm' OR EXISTS (
             SELECT 1 FROM tenants tenant
             ${KOOK_CHANNEL_BINDING_JOIN}
             ${KOOK_CHANNEL_VERSION_JOIN}
             WHERE tenant.bot_account_id=memory.bot_account_id AND tenant.tenant_id=memory.tenant_id
               AND binding.channel_id=memory.channel_id AND binding.tenant_id=memory.tenant_id
               AND binding.team_id=memory.team_id AND version.revision=memory.binding_revision
           ))
           AND NOT EXISTS (
             SELECT 1 FROM gate_memory_embeddings embedded
             WHERE embedded.memory_id=memory.memory_id AND embedded.source_revision=memory.revision
               AND embedded.provider_id=$2 AND embedded.model_id=$3 AND embedded.dimensions=$4
               AND embedded.index_version=$5 AND embedded.normalization='l2_unit'
           ) LIMIT 1`,
        [botAccountId, state.building_provider_id, state.building_model_id,
          state.building_dimensions, state.building_index_version],
      );
      if (missing.rowCount) throw new Error('gate_memory_index_generation_has_missing_vectors');
      await client.query(
        `UPDATE gate_memory_index_generation_state SET
           active_provider_id=building_provider_id,active_model_id=building_model_id,
           active_dimensions=building_dimensions,active_index_version=building_index_version,
           building_provider_id=NULL,building_model_id=NULL,building_dimensions=NULL,building_index_version=NULL,
           reindex_status='idle',scan_cursor_memory_id=NULL,scan_complete=FALSE,last_error_code=NULL,
           started_at=NULL,updated_at=now() WHERE bot_account_id=$1`, [botAccountId],
      );
    });
  }
}
