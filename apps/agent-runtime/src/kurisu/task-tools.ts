import { z } from 'zod';

import type { TrustedExecutionContext } from './contracts.js';
import { KurisuStore } from './storage.js';
import { evidence, failure, ok, type ToolDefinition, ToolRegistry } from './tools.js';

export const taskStatusInputSchema = z.object({
  runId: z.string().trim().min(1).max(256),
}).strict();

/** Register the read-only task view used to resume a conversation after a restart. */
export function registerTaskStatusTool(registry: ToolRegistry, store: KurisuStore): void {
  const definition: ToolDefinition = {
    name: 'kurisu.task.status',
    version: '1.0.0',
    description: 'Read the current durable task, steps, and external job state for this conversation.',
    risk: 'read',
    timeoutMs: 5_000,
    idempotency: 'optional',
    reconciliation: 'not_applicable',
    inputSchema: taskStatusInputSchema,
    jsonSchema: z.toJSONSchema(taskStatusInputSchema),
    handler: async (input, context) => taskStatus(input, context, store),
  };
  registry.register(definition);
}

async function taskStatus(input: unknown, context: TrustedExecutionContext, store: KurisuStore) {
  const parsed = taskStatusInputSchema.parse(input);
  const run = store.getRun(parsed.runId);
  if (!run || run.sessionKey !== context.sessionKey) return failure('TASK_NOT_FOUND', 'task is not available in this conversation', false);
  return ok({
    run: {
      id: run.id,
      status: run.status,
      externalJobId: run.externalJobId,
      lastObservation: run.lastObservation,
      nextStep: run.nextStep,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    },
    steps: store.listTaskSteps(run.id),
    jobs: store.listJobs(run.id),
  }, [evidence('kurisu.task-store', 'durable task state was read for the current session', run.id)]);
}
