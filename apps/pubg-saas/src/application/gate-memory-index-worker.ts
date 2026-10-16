import { createHash } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { estimateGateEmbeddingTokens, type GateMemoryEmbeddingClient } from './gate-memory-embedding.js';
import { reserveGateMemoryEmbeddingBudget, settleGateMemoryEmbeddingBudget } from './gate-memory-embedding-budget.js';
import { KOOK_CHANNEL_BINDING_JOIN, KOOK_CHANNEL_VERSION_JOIN } from './kook-channel-binding-sql.js';
import { GateMemoryIndexGenerationManager } from './gate-memory-index-generation.js';

export type GateMemoryIndexWorkerResult =
  | 'empty' | 'indexed' | 'deleted' | 'obsolete' | 'semantic_unconfigured' | 'budget_deferred' | 'retry' | 'dead';

interface ClaimedJob {
  job_id: string;
  memory_id: string;
  source_revision: string;
  index_version: number;
  operation: 'upsert' | 'delete';
  attempt_count: number;
  lease_token: string;
}

interface MemoryRow extends QueryResultRow {
  memory_id: string;
  bot_account_id: string;
  scope_kind: 'dm' | 'channel';
  actor_id: string;
  channel_id: string;
  tenant_id: string;
  team_id: string;
  binding_revision: string;
  memory_key: string;
  content: string;
  revision: string;
  revoked_at: unknown;
  scope_current: boolean;
}

function vectorLiteral(values: readonly number[]): string {
  return `[${values.map(value => {
    if (!Number.isFinite(value)) throw new Error('gate_memory_embedding_vector_invalid');
    return String(value);
  }).join(',')}]`;
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

export class GateMemoryIndexWorker {
  constructor(
    private readonly pool: Pool,
    private readonly provider: GateMemoryEmbeddingClient | null,
    private readonly maxAttempts = 6,
  ) {
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 12) {
      throw new Error('gate_memory_embedding_worker_limits_invalid');
    }
  }

  private async claim(): Promise<ClaimedJob | null> {
    const result = await this.pool.query<ClaimedJob>(
      `WITH candidate AS (
         SELECT job.job_id FROM gate_memory_embedding_jobs job
         WHERE ((job.status IN ('pending','retry') AND job.next_attempt_at<=now())
           OR (job.status='processing' AND job.lease_until<=now()))
           AND (job.operation='delete' OR $1::TEXT IS NULL OR (
             job.index_version=$4 AND (
               EXISTS (SELECT 1 FROM gate_memory_entries memory
                 JOIN gate_memory_index_generation_state state USING (bot_account_id)
                 WHERE memory.memory_id=job.memory_id AND state.active_index_version=job.index_version
                   AND state.active_provider_id=$1 AND state.active_model_id=$2 AND state.active_dimensions=$3)
               OR EXISTS (SELECT 1 FROM gate_memory_entries memory
                 JOIN gate_memory_index_generation_state state USING (bot_account_id)
                 WHERE memory.memory_id=job.memory_id AND state.reindex_status='building'
                   AND state.building_index_version=job.index_version
                   AND state.building_provider_id=$1 AND state.building_model_id=$2
                   AND state.building_dimensions=$3)
               OR (job.index_version=1 AND NOT EXISTS (SELECT 1 FROM gate_memory_entries memory
                   JOIN gate_memory_index_generation_state state USING (bot_account_id)
                   WHERE memory.memory_id=job.memory_id))
             )
           ))
         ORDER BY (job.operation='delete') DESC,job.next_attempt_at,job.created_at,job.job_id
         FOR UPDATE OF job SKIP LOCKED LIMIT 1
       )
       UPDATE gate_memory_embedding_jobs job SET status='processing',attempt_count=job.attempt_count+1,
         lease_token=gen_random_uuid(),lease_until=now()+interval '60 seconds',updated_at=now()
       FROM candidate WHERE job.job_id=candidate.job_id
       RETURNING job.job_id,job.memory_id,job.source_revision,job.index_version,job.operation,job.attempt_count,job.lease_token`,
      [this.provider?.contract.providerId ?? null, this.provider?.contract.modelId ?? null,
        this.provider?.contract.dimensions ?? null, this.provider?.contract.indexVersion ?? null],
    );
    return result.rows[0] ?? null;
  }

  private async availability(): Promise<{ extension: boolean; table: boolean }> {
    const result = await this.pool.query<{ extension: boolean; table: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector') AS extension,
              to_regclass('gate_memory_embeddings') IS NOT NULL AS table`,
    );
    return result.rows[0] ?? { extension: false, table: false };
  }

  private async releaseUnconfigured(job: ClaimedJob): Promise<void> {
    await this.pool.query(
      `UPDATE gate_memory_embedding_jobs SET status='retry',lease_token=NULL,lease_until=NULL,
         next_attempt_at=now()+interval '5 minutes',updated_at=now()
       WHERE job_id=$1 AND status='processing' AND lease_token=$2`,
      [job.job_id, job.lease_token],
    );
  }

  private async finish(job: ClaimedJob): Promise<void> {
    await this.pool.query(
      `UPDATE gate_memory_embedding_jobs SET status='done',lease_token=NULL,lease_until=NULL,
         last_error_code=NULL,finished_at=now(),updated_at=now()
       WHERE job_id=$1 AND status='processing' AND lease_token=$2`,
      [job.job_id, job.lease_token],
    );
  }

  private async failed(job: ClaimedJob, reason: string): Promise<GateMemoryIndexWorkerResult> {
    const dead = job.attempt_count >= this.maxAttempts;
    const delaySeconds = Math.min(3600, 5 * (2 ** Math.min(job.attempt_count, 10)));
    await this.pool.query(
      `UPDATE gate_memory_embedding_jobs SET status=$3,lease_token=NULL,lease_until=NULL,
         last_error_code=$4,next_attempt_at=now()+($5::INTEGER*interval '1 second'),
         finished_at=CASE WHEN $3='dead' THEN now() ELSE NULL END,updated_at=now()
       WHERE job_id=$1 AND status='processing' AND lease_token=$2`,
      [job.job_id, job.lease_token, dead ? 'dead' : 'retry', reason, delaySeconds],
    );
    return dead ? 'dead' : 'retry';
  }

  private async memory(job: ClaimedJob): Promise<MemoryRow | null> {
    const result = await this.pool.query<MemoryRow>(
      `SELECT memory.memory_id,memory.bot_account_id,memory.scope_kind,memory.actor_id,memory.channel_id,
         memory.tenant_id,memory.team_id,memory.binding_revision,memory.memory_key,memory.content,
         memory.revision,memory.revoked_at,
         (memory.scope_kind='dm' OR EXISTS (
           SELECT 1 FROM tenants tenant
           ${KOOK_CHANNEL_BINDING_JOIN}
           ${KOOK_CHANNEL_VERSION_JOIN}
           WHERE tenant.bot_account_id=memory.bot_account_id AND tenant.tenant_id=memory.tenant_id
             AND binding.channel_id=memory.channel_id AND binding.tenant_id=memory.tenant_id
             AND binding.team_id=memory.team_id AND version.revision=memory.binding_revision
         )) AS scope_current
       FROM gate_memory_entries memory WHERE memory.memory_id=$1`,
      [job.memory_id],
    );
    return result.rows[0] ?? null;
  }

  private async writeEmbedding(job: ClaimedJob, memory: MemoryRow, batch: Awaited<ReturnType<GateMemoryEmbeddingClient['embedMany']>>): Promise<boolean> {
    const vector = batch.vectors[0];
    const contentHash = batch.contentHashes[0];
    const norm = vector?.reduce((sum, value) => sum + value * value, 0) ?? 0;
    if (!this.provider || !vector || !contentHash || batch.vectors.length !== 1
      || batch.contract.modelId !== this.provider.contract.modelId
      || batch.contract.providerId !== this.provider.contract.providerId
      || batch.contract.dimensions !== this.provider.contract.dimensions
      || batch.contract.normalization !== 'l2_unit'
      || batch.contract.indexVersion !== this.provider.contract.indexVersion
      || batch.contract.indexVersion !== job.index_version
      || vector.length !== this.provider.contract.dimensions
      || vector.some(value => !Number.isFinite(value))
      || !Number.isFinite(norm) || Math.abs(Math.sqrt(norm) - 1) > 1e-3) {
      throw new Error('gate_memory_embedding_contract_invalid');
    }

    const currentTextHash = createHash('sha256').update(`${memory.memory_key}\n${memory.content}`).digest('hex');
    if (contentHash !== currentTextHash) throw new Error('gate_memory_embedding_content_hash_invalid');

    return transaction(this.pool, async client => {
      const current = await client.query<MemoryRow>(
        `SELECT memory.memory_id,memory.bot_account_id,memory.scope_kind,memory.actor_id,memory.channel_id,
           memory.tenant_id,memory.team_id,memory.binding_revision,memory.memory_key,memory.content,
           memory.revision,memory.revoked_at,
           (memory.scope_kind='dm' OR EXISTS (
             SELECT 1 FROM tenants tenant
             ${KOOK_CHANNEL_BINDING_JOIN}
             ${KOOK_CHANNEL_VERSION_JOIN}
             WHERE tenant.bot_account_id=memory.bot_account_id AND tenant.tenant_id=memory.tenant_id
               AND binding.channel_id=memory.channel_id AND binding.tenant_id=memory.tenant_id
               AND binding.team_id=memory.team_id AND version.revision=memory.binding_revision
           )) AS scope_current
         FROM gate_memory_entries memory WHERE memory.memory_id=$1 FOR UPDATE`,
        [job.memory_id],
      );
      const row = current.rows[0];
      if (!row || String(row.revision) !== job.source_revision || row.revoked_at !== null || !row.scope_current) {
        if (!row || row.revoked_at !== null || !row.scope_current) {
          await client.query('DELETE FROM gate_memory_embeddings WHERE memory_id=$1', [job.memory_id]);
        }
        await client.query(
          `UPDATE gate_memory_embedding_jobs SET status='done',lease_token=NULL,lease_until=NULL,
             finished_at=now(),updated_at=now() WHERE job_id=$1 AND status='processing' AND lease_token=$2`,
          [job.job_id, job.lease_token],
        );
        return false;
      }

      const generation = await client.query<{
        active_index_version: number; active_provider_id: string; active_model_id: string; active_dimensions: number;
        building_index_version: number | null; building_provider_id: string | null;
        building_model_id: string | null; building_dimensions: number | null; reindex_status: string;
      }>(
        `SELECT active_index_version,active_provider_id,active_model_id,active_dimensions,
           building_index_version,building_provider_id,building_model_id,building_dimensions,reindex_status
         FROM gate_memory_index_generation_state WHERE bot_account_id=$1 FOR SHARE`, [memory.bot_account_id],
      );
      const state = generation.rows[0];
      const generationAllowed = state
        ? (state.active_index_version === job.index_version
          && state.active_provider_id === batch.contract.providerId
          && state.active_model_id === batch.contract.modelId
          && state.active_dimensions === batch.contract.dimensions)
          || (state.reindex_status === 'building' && state.building_index_version === job.index_version
            && state.building_provider_id === batch.contract.providerId
            && state.building_model_id === batch.contract.modelId
            && state.building_dimensions === batch.contract.dimensions)
        : job.index_version === 1;
      if (!generationAllowed) {
        await client.query(
          `UPDATE gate_memory_embedding_jobs SET status='done',lease_token=NULL,lease_until=NULL,
             finished_at=now(),updated_at=now() WHERE job_id=$1 AND status='processing' AND lease_token=$2`,
          [job.job_id, job.lease_token],
        );
        return false;
      }

      await client.query(
        `INSERT INTO gate_memory_embeddings(
           memory_id,bot_account_id,scope_kind,actor_id,channel_id,tenant_id,team_id,binding_revision,
           source_revision,provider_id,model_id,dimensions,normalization,index_version,content_hash,embedding
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'l2_unit',$13,$14,$15::vector)
         ON CONFLICT (memory_id,provider_id,model_id,index_version) DO UPDATE SET
           bot_account_id=EXCLUDED.bot_account_id,scope_kind=EXCLUDED.scope_kind,actor_id=EXCLUDED.actor_id,
           channel_id=EXCLUDED.channel_id,tenant_id=EXCLUDED.tenant_id,team_id=EXCLUDED.team_id,
           binding_revision=EXCLUDED.binding_revision,source_revision=EXCLUDED.source_revision,
           dimensions=EXCLUDED.dimensions,normalization=EXCLUDED.normalization,
           content_hash=EXCLUDED.content_hash,embedding=EXCLUDED.embedding,created_at=now()`,
        [row.memory_id, row.bot_account_id, row.scope_kind, row.actor_id, row.channel_id,
          row.tenant_id, row.team_id, row.binding_revision, row.revision, batch.contract.providerId,
          batch.contract.modelId, batch.contract.dimensions, batch.contract.indexVersion,
          contentHash, vectorLiteral(vector)],
      );
      await client.query(
        `UPDATE gate_memory_embedding_jobs SET status='done',lease_token=NULL,lease_until=NULL,
           last_error_code=NULL,finished_at=now(),updated_at=now()
         WHERE job_id=$1 AND status='processing' AND lease_token=$2`,
        [job.job_id, job.lease_token],
      );
      return true;
    });
  }

  async processOne(signal?: AbortSignal): Promise<GateMemoryIndexWorkerResult> {
    const job = await this.claim();
    if (!job) return 'empty';
    if (job.operation === 'delete') {
      try {
        const availability = await this.availability();
        if (availability.table) await this.pool.query('DELETE FROM gate_memory_embeddings WHERE memory_id=$1', [job.memory_id]);
        await this.finish(job);
        return 'deleted';
      } catch {
        return this.failed(job, 'embedding_delete_failed');
      }
    }
    if (!this.provider) {
      await this.releaseUnconfigured(job);
      return 'semantic_unconfigured';
    }
    let reservedTokens = 0;
    let budgetDay: string | null = null;
    let settled = false;
    try {
      const availability = await this.availability();
      if (!availability.extension || !availability.table) {
        await this.releaseUnconfigured(job);
        return 'semantic_unconfigured';
      }
      const row = await this.memory(job);
      if (!row || row.revoked_at !== null || String(row.revision) !== job.source_revision || !row.scope_current) {
        if (!row || row.revoked_at !== null || !row.scope_current) {
          await this.pool.query('DELETE FROM gate_memory_embeddings WHERE memory_id=$1', [job.memory_id]);
        }
        await this.finish(job);
        return 'obsolete';
      }
      if (job.index_version === 1) {
        await new GateMemoryIndexGenerationManager(this.pool).initialize(row.bot_account_id, this.provider.contract);
      }
      const value = `${row.memory_key}\n${row.content}`;
      reservedTokens = estimateGateEmbeddingTokens([value]);
      budgetDay = await reserveGateMemoryEmbeddingBudget(this.pool, row.bot_account_id, reservedTokens, this.provider);
      if (!budgetDay) {
        await this.releaseUnconfigured(job);
        return 'budget_deferred';
      }
      const batch = await this.provider.embedMany([value], signal);
      await settleGateMemoryEmbeddingBudget(this.pool, row.bot_account_id, budgetDay, reservedTokens, batch.inputTokens);
      settled = true;
      const written = await this.writeEmbedding(job, row, batch);
      return written ? 'indexed' : 'obsolete';
    } catch (error) {
      if (budgetDay && !settled) {
        const row = await this.memory(job).catch(() => null);
        if (row) await settleGateMemoryEmbeddingBudget(this.pool, row.bot_account_id, budgetDay, reservedTokens, null).catch(() => undefined);
      }
      const reason = error instanceof Error && /^[a-z0-9_]{1,64}$/u.test(error.message)
        ? error.message : 'embedding_index_failed';
      return this.failed(job, reason);
    }
  }
}
