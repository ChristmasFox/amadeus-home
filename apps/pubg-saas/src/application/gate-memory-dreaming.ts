import { Pool } from 'pg';
import { DEFAULT_TIMEZONE } from '@rine-kit/pubg-domain/core';
import { runMemoryDreamingScheduler, runMemoryDreamingStages } from '@rine-kit/agent-memory';
import type {
  DreamingReport,
  MemoryDreamingRunStore,
  MemoryDreamingStageWorker,
  MemoryDreamingWorkStatus,
} from '@rine-kit/agent-memory';
import type { GateMemoryConsolidationWorker } from './gate-memory-consolidation.js';

export interface GateMemoryDreamingRunIdentity {
  botAccountId: string;
  timezone: string;
  localDate: string;
  scheduledAt: Date;
}

export interface GateMemoryDreamingRunStore extends MemoryDreamingRunStore<GateMemoryDreamingRunIdentity> {}

export class PostgresGateMemoryDreamingRunStore implements GateMemoryDreamingRunStore {
  constructor(private readonly pool: Pool) {}

  async claim(identity: GateMemoryDreamingRunIdentity): Promise<string | null> {
    const result = await this.pool.query<{ run_id: string }>(
      `INSERT INTO gate_memory_dreaming_runs(bot_account_id,timezone,scheduled_date,scheduled_at)
       VALUES ($1,$2,$3::DATE,$4::TIMESTAMPTZ)
       ON CONFLICT (bot_account_id,timezone,scheduled_date) DO NOTHING
       RETURNING run_id::TEXT`,
      [identity.botAccountId, identity.timezone, identity.localDate, identity.scheduledAt],
    );
    return result.rows[0]?.run_id ?? null;
  }

  async finish(identity: GateMemoryDreamingRunIdentity, runId: string,
    status: 'succeeded' | 'failed'): Promise<void> {
    const result = await this.pool.query(
      `UPDATE gate_memory_dreaming_runs SET status=$5,completed_at=now(),
         error_code=CASE WHEN $5='failed' THEN 'dreaming_run_failed' ELSE NULL END
       WHERE bot_account_id=$1 AND timezone=$2 AND scheduled_date=$3::DATE
         AND run_id=$4::UUID AND status='running'`,
      [identity.botAccountId, identity.timezone, identity.localDate, runId, status],
    );
    if (result.rowCount !== 1) throw new Error('gate_memory_dreaming_run_state_lost');
  }
}

export interface GateMemoryDreamingSchedulerOptions {
  timezone?: string;
  now?: () => number;
  sleepUntil?: (timestamp: number, signal: AbortSignal) => Promise<void>;
}

export async function runGateMemoryDreamingPass(worker: GateMemoryConsolidationWorker, signal: AbortSignal,
  maxLightBatches = 8, maxRemBatches = 8): Promise<DreamingReport> {
  const stageWorker: MemoryDreamingStageWorker = {
    async processNext(stage, abortSignal): Promise<MemoryDreamingWorkStatus> {
      const result = await worker.processNext(stage, abortSignal);
      if (result.status === 'SKIPPED_NO_ELIGIBLE_CORPUS' || result.status === 'skipped') return 'skipped';
      return result.status === 'processed' ? 'processed' : result.status;
    },
    async processDeep(abortSignal) {
      if (abortSignal.aborted) throw new Error('gate_memory_dreaming_aborted');
      const result = await worker.processDeep();
      if (abortSignal.aborted) throw new Error('gate_memory_dreaming_aborted');
      return result.status === 'processed'
        ? { status: 'processed' as const, processed: result.inspected }
        : { status: 'skipped' as const, processed: 0 };
    },
  };
  return runMemoryDreamingStages(stageWorker, signal, { maxLightBatches, maxRemBatches });
}

/** Runs one durable, single-shot daily Light -> REM -> Deep schedule. */
export async function runMemoryLearningScheduler(
  runner: { runDreaming(signal?: AbortSignal): Promise<DreamingReport> },
  store: GateMemoryDreamingRunStore,
  botAccountId: string,
  signal: AbortSignal,
  onRun: (value: Record<string, unknown>) => void,
  options: GateMemoryDreamingSchedulerOptions = {},
): Promise<void> {
  return runMemoryDreamingScheduler(runner, store, signal, onRun, {
    ...options,
    fallbackTimezone: DEFAULT_TIMEZONE,
    identity: point => ({ botAccountId, ...point }),
  });
}
