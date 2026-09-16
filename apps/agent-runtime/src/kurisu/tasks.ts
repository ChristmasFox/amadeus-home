import { argumentsHash, newRunId, type TrustedExecutionContext } from './contracts.js';
import { KurisuStore, type RunRecord, type RunStatus, type TaskStepRecord } from './storage.js';

export interface TaskStep {
  key: string;
  action: Record<string, unknown>;
  execute(context: TrustedExecutionContext): Promise<TaskStepOutcome>;
  reconcile?(context: TrustedExecutionContext, previous: TaskStepRecord): Promise<TaskStepOutcome>;
}

export type TaskStepOutcome =
  | { status: 'succeeded'; result: unknown; externalId?: string }
  | { status: 'waiting_job'; result: unknown; externalId: string }
  | { status: 'waiting_input'; result: unknown }
  | { status: 'waiting_approval'; result: unknown }
  | { status: 'unknown'; result: unknown; externalId?: string }
  | { status: 'blocked'; result: unknown };

export interface TaskEngineOptions {
  owner?: string;
  now?: () => string;
  faultAfterIntent?: (step: TaskStep) => void | Promise<void>;
}

export class TaskEngine {
  private readonly owner: string;
  private readonly now: () => string;
  private readonly faultAfterIntent: ((step: TaskStep) => void | Promise<void>) | undefined;

  constructor(private readonly store: KurisuStore, options: TaskEngineOptions = {}) {
    this.owner = options.owner ?? `worker_${newRunId('task')}`;
    this.now = options.now ?? (() => new Date().toISOString());
    this.faultAfterIntent = options.faultAfterIntent;
  }

  createRun(sessionKey: string): RunRecord {
    return this.store.createRun(sessionKey, newRunId(), this.now());
  }

  async execute(runId: string, context: TrustedExecutionContext, steps: readonly TaskStep[]): Promise<RunRecord> {
    const claimed = this.store.claimRun(runId, this.owner, 30_000, new Date(this.now()));
    if (!claimed) throw new Error(`run is not claimable: ${runId}`);
    let current = claimed;
    try {
      for (const step of steps) {
        current = this.store.getRun(runId) ?? current;
        if (current.status === 'cancelled') return current;
        const prior = this.store.getTaskStep(runId, step.key);
        if (prior?.status === 'succeeded') continue;
        let outcome: TaskStepOutcome;
        if (prior?.status === 'unknown' || prior?.status === 'running') {
          if (!step.reconcile) {
            current = this.store.transitionRun(runId, 'blocked', { lastObservation: `step ${step.key} requires reconciliation`, nextStep: step.key }, this.now());
            return current;
          }
          current = this.store.transitionRun(runId, 'reconciling', { lastObservation: `reconciling step ${step.key}`, nextStep: step.key }, this.now());
          outcome = await step.reconcile(context, prior);
        } else {
          current = this.store.transitionRun(runId, 'running', { nextStep: step.key }, this.now());
          this.store.beginTaskStep(runId, step.key, { action: step.action, argumentsHash: argumentsHash(step.action) }, this.now());
          if (this.faultAfterIntent) await this.faultAfterIntent(step);
          outcome = await step.execute(context);
        }
        current = this.applyOutcome(runId, step.key, outcome);
        if (['waiting_job', 'waiting_input', 'waiting_approval', 'blocked', 'reconciling'].includes(current.status)) return current;
      }
      return this.store.transitionRun(runId, 'succeeded', { nextStep: null, lastObservation: 'all task steps completed' }, this.now());
    } finally {
      this.store.releaseLease(runId, this.owner, this.now());
    }
  }

  cancel(runId: string): RunRecord {
    return this.store.cancelRun(runId, this.now());
  }

  recover(runId: string, context: TrustedExecutionContext, steps: readonly TaskStep[]): Promise<RunRecord> {
    return this.execute(runId, context, steps);
  }

  private applyOutcome(runId: string, stepKey: string, outcome: TaskStepOutcome): RunRecord {
    const now = this.now();
    const statusMap: Record<TaskStepOutcome['status'], TaskStepRecord['status']> = {
      succeeded: 'succeeded', waiting_job: 'waiting_job', waiting_input: 'blocked', waiting_approval: 'blocked', unknown: 'unknown', blocked: 'blocked',
    };
    const stepStatus = statusMap[outcome.status];
    this.store.completeTaskStep(runId, stepKey, stepStatus, outcome.result, 'externalId' in outcome ? outcome.externalId ?? null : null, now);
    const runStatus: RunStatus = outcome.status === 'succeeded'
      ? 'running'
      : outcome.status === 'waiting_job'
        ? 'waiting_job'
        : outcome.status === 'waiting_input'
          ? 'waiting_input'
          : outcome.status === 'waiting_approval'
            ? 'waiting_approval'
            : outcome.status === 'unknown'
              ? 'reconciling'
              : 'blocked';
    return this.store.transitionRun(runId, runStatus, { nextStep: stepKey, lastObservation: `step ${stepKey}: ${outcome.status}`, ...(outcome.status === 'waiting_job' && 'externalId' in outcome ? { externalJobId: outcome.externalId } : {}) }, now);
  }
}

export function taskContextFromRun(run: RunRecord, context: TrustedExecutionContext): TrustedExecutionContext {
  return { ...context, runId: run.id };
}
