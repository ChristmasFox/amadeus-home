import { z } from 'zod';
import { existsSync } from 'node:fs';

import type { CallbackReference, ToolResponse, TrustedExecutionContext } from './contracts.js';
import { parseCallback } from './contracts.js';
import { ApprovalService } from './approvals.js';
import { MediaPathPolicy } from './media.js';
import { approvalArgumentsHash, KurisuStore, type RunRecord, type TaskStepRecord } from './storage.js';
import { TaskEngine, type TaskStep, type TaskStepOutcome } from './tasks.js';
import type { NotificationTarget, NotificationWorker } from './notifications.js';
import { accepted, evidence, failure, ok, unknownResult, type ToolDefinition, ToolRegistry } from './tools.js';

const homeHubServiceIds = [
  'langbot', 'telegram-adapter', 'kook-adapter', 'mastra-pubg-runtime', 'n8n', 'postgres', 'redis', 'emby',
  'jellyfin', 'qbittorrent', 'aria2', 'glances', 'cloudflared', 'media-organizer-adapter',
] as const;

export const homehubActionInputSchema = z.object({
  serviceId: z.enum(homeHubServiceIds),
  action: z.enum(['start', 'restart', 'stop']),
  reason: z.string().trim().min(1).max(500),
}).strict();

export const radarMutationInputSchema = z.object({
  watchId: z.string().trim().min(1).max(256),
  action: z.enum(['pause', 'resume', 'delete']),
  reason: z.string().trim().min(1).max(500),
}).strict();

export const radarCreateInputSchema = z.object({
  source: z.string().trim().min(1).max(128),
  type: z.string().trim().min(1).max(128),
  target: z.record(z.string(), z.unknown()),
  rules: z.record(z.string(), z.unknown()).default({}),
  reason: z.string().trim().min(1).max(500),
}).strict();

export const mediaMoveInputSchema = z.object({
  source: z.string().trim().min(1).max(2048),
  target: z.string().trim().min(1).max(2048),
  reason: z.string().trim().min(1).max(500),
}).strict();

export const taskCancelInputSchema = z.object({
  runId: z.string().trim().min(1).max(256),
  reason: z.string().trim().min(1).max(500),
}).strict();

export type HomeHubActionInput = z.infer<typeof homehubActionInputSchema>;
export type RadarMutationInput = z.infer<typeof radarMutationInputSchema>;
export type RadarCreateInput = z.infer<typeof radarCreateInputSchema>;
export type MediaMoveInput = z.infer<typeof mediaMoveInputSchema>;
export type TaskCancelInput = z.infer<typeof taskCancelInputSchema>;

export interface StructuredWriteHandler {
  execute(input: unknown, context: TrustedExecutionContext): Promise<TaskStepOutcome>;
  reconcile?(input: unknown, context: TrustedExecutionContext, previous: TaskStepRecord): Promise<TaskStepOutcome>;
}

export interface WriteOperationDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  handler: StructuredWriteHandler;
}

export interface WriteOperationHandlers {
  homehubAction?: StructuredWriteHandler;
  radarMutation?: StructuredWriteHandler;
  radarCreate?: StructuredWriteHandler;
  mediaMove?: StructuredWriteHandler;
  taskCancel?: StructuredWriteHandler;
}

export interface StructuredHomeHubWriter {
  executeStructuredAction(input: HomeHubActionInput, context: TrustedExecutionContext): Promise<TaskStepOutcome>;
  reconcileStructuredAction?(input: HomeHubActionInput, context: TrustedExecutionContext, previous: TaskStepRecord): Promise<TaskStepOutcome>;
}

export interface WriteCoordinatorOptions {
  owner?: string;
  now?: () => string;
  notificationWorker?: NotificationWorker;
  notificationTargets?: readonly NotificationTarget[];
}

/**
 * Server-side write lifecycle. A model can request a write, but only the
 * coordinator can create an approval, start a durable task, or resume it.
 */
export class WriteCoordinator {
  private readonly approval: ApprovalService;
  private readonly taskEngine: TaskEngine;
  private readonly now: () => string;
  private readonly notificationWorker: NotificationWorker | undefined;
  private readonly notificationTargets: readonly NotificationTarget[];
  private readonly operations = new Map<string, WriteOperationDefinition>();

  constructor(private readonly store: KurisuStore, options: WriteCoordinatorOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.approval = new ApprovalService(store, this.now);
    this.taskEngine = new TaskEngine(store, { ...(options.owner ? { owner: options.owner } : {}), now: this.now });
    this.notificationWorker = options.notificationWorker;
    this.notificationTargets = options.notificationTargets ?? [];
  }

  register(operation: WriteOperationDefinition): void {
    if (this.operations.has(operation.name)) throw new Error(`duplicate Kurisu write operation: ${operation.name}`);
    this.operations.set(operation.name, operation);
  }

  registerMany(operations: readonly WriteOperationDefinition[]): void {
    for (const operation of operations) this.register(operation);
  }

  request(name: string, input: unknown, context: TrustedExecutionContext): Promise<ToolResponse> {
    const operation = this.operations.get(name);
    if (!operation) return Promise.resolve(failure('WRITE_NOT_FOUND', `write operation ${name} is not registered`, false));
    const parsed = operation.inputSchema.safeParse(input);
    if (!parsed.success) return Promise.resolve(failure('WRITE_INPUT_INVALID', 'write arguments do not match the declared schema', false));

    // Exact server-granted capability can skip the confirmation prompt. A
    // broad risk grant such as "write" still follows the approval path.
    if (!context.authorization.allowedActions.includes(name)) {
      const challenge = this.approval.request(context, { action: name, arguments: parsed.data });
      const callback = parseCallback(challenge.callback);
      return Promise.resolve({
        contractVersion: 'kurisu.v1',
        status: 'needs_input',
        data: {
          runId: context.runId,
          approvalId: challenge.approval.id,
          action: challenge.approval.action,
          argumentsHash: challenge.approval.argumentsHash,
          expiresAt: challenge.approval.expiresAt,
          request: parsed.data,
          callback: challenge.callback,
        },
        evidence: [evidence('kurisu.approval', 'write is paused until the server-bound approval is consumed', challenge.approval.id)],
        entityRefs: [],
        ...(callback ? { callbackReferences: [callback] } : {}),
      });
    }
    return this.start(operation, parsed.data, context);
  }

  async approveCallback(context: TrustedExecutionContext, callback: CallbackReference | string): Promise<ToolResponse> {
    const parsed = typeof callback === 'string' ? parseCallback(callback) : callback;
    if (!parsed || parsed.kind !== 'approval' || parsed.action !== 'approve') return failure('CALLBACK_INVALID', 'approval callback is invalid', false);
    const approval = this.store.getApproval(parsed.id);
    if (!approval || approval.runId !== context.runId) return failure('APPROVAL_INVALID', 'approval is missing or bound to another run', false);
    const consumed = this.approval.consumeBound(context, parsed.id);
    if (consumed.status !== 'accepted') return consumed;
    const operation = this.operations.get(approval.action);
    if (!operation) return failure('WRITE_NOT_FOUND', `write operation ${approval.action} is not registered`, false);
    return this.start(operation, approval.arguments, context);
  }

  async recover(runId: string, context: TrustedExecutionContext): Promise<ToolResponse> {
    const run = this.store.getRun(runId);
    const step = run ? this.store.getTaskStep(runId, `write:${run.nextStep?.replace(/^write:/u, '') ?? ''}`) : null;
    if (!run || !step) return failure('TASK_NOT_FOUND', 'durable write task is not available for recovery', false);
    const action = step.intent.action && typeof step.intent.action === 'object' ? step.intent.action as Record<string, unknown> : {};
    const operationName = String(action.toolName ?? run.nextStep ?? '').replace(/^write:/u, '');
    const operation = this.operations.get(operationName);
    if (!operation) return failure('WRITE_NOT_FOUND', `write operation ${operationName} is not registered`, false);
    const input = action.input;
    return this.start(operation, input, { ...context, runId });
  }

  private async start(operation: WriteOperationDefinition, input: unknown, context: TrustedExecutionContext): Promise<ToolResponse> {
    const run = this.store.getRun(context.runId);
    if (!run) return failure('RUN_NOT_FOUND', 'write run does not exist', false);
    if (['succeeded', 'failed', 'cancelled'].includes(run.status)) return this.responseForRun(run, operation.name);
    const idempotencyKey = writeIdempotencyKey(context.runId, operation.name, input);
    const step: TaskStep = {
      key: `write:${operation.name}`,
      action: { toolName: operation.name, input, idempotencyKey },
      execute: (stepContext) => operation.handler.execute(input, stepContext),
    };
    if (operation.handler.reconcile) {
      step.reconcile = (stepContext, previous) => operation.handler.reconcile!(input, stepContext, previous);
    }
    let completed: RunRecord;
    try {
      completed = await this.taskEngine.execute(context.runId, context, [step]);
    } catch (error) {
      return unknownResult('TASK_EXECUTION_UNCERTAIN', error instanceof Error ? error.message : 'write task state is uncertain', true);
    }
    this.emitTaskNotification(operation.name, input, context, completed);
    return this.responseForRun(completed, operation.name);
  }

  private emitTaskNotification(operationName: string, input: unknown, context: TrustedExecutionContext, run: RunRecord): void {
    if (!this.notificationWorker) return;
    const source = operationName.startsWith('kurisu.homehub.') ? 'homehub'
      : operationName.startsWith('kurisu.radar.') ? 'radar'
        : operationName.startsWith('kurisu.media.') ? 'media'
          : 'kurisu';
    const resultType = run.status === 'succeeded' ? 'success'
      : ['failed', 'cancelled'].includes(run.status) ? 'failure'
        : ['reconciling', 'blocked'].includes(run.status) ? 'unknown'
          : 'info';
    const step = this.store.getTaskStep(run.id, `write:${operationName}`);
    this.notificationWorker.ingest({
      eventType: `${source}.task.${resultType}`,
      eventKey: `task:${run.id}:${operationName}:${run.status}`,
      principalKey: context.principalKey,
      source,
      resultType,
      taskId: run.id,
      runId: run.id,
      payload: {
        summary: `${operationName} ${run.status}`,
        operation: operationName,
        inputKeys: input && typeof input === 'object' && !Array.isArray(input) ? Object.keys(input as Record<string, unknown>) : [],
        stepStatus: step?.status ?? 'unknown',
      },
      occurredAt: this.now(),
    }, this.notificationTargets, this.now());
  }

  private responseForRun(run: RunRecord, operationName: string): ToolResponse {
    const step = this.store.getTaskStep(run.id, `write:${operationName}`);
    if (run.status === 'succeeded' && step?.status === 'succeeded') {
      return ok({ runId: run.id, status: run.status, step: { status: step.status, result: step.result, externalId: step.externalId } }, [evidence('kurisu.task', 'durable write task completed and recorded', run.id)]);
    }
    if (run.status === 'waiting_job') {
      return accepted(run.externalJobId ?? run.id, [evidence('kurisu.task', 'write accepted and is waiting for an external job', run.id)]);
    }
    if (run.status === 'reconciling' || step?.status === 'unknown') {
      return unknownResult('TASK_RECONCILING', 'external write result is uncertain; no automatic repeat was issued', true);
    }
    if (run.status === 'waiting_approval') return failure('APPROVAL_REQUIRED', 'write still requires approval', false);
    if (run.status === 'cancelled') return failure('TASK_CANCELLED', 'write task was cancelled; no later step was run', false);
    if (run.status === 'blocked' || step?.status === 'blocked') return failure('TASK_BLOCKED', 'write task is blocked pending reconciliation or input', false);
    return failure('TASK_FAILED', `write task ${operationName} did not complete`, true);
  }
}

/** Register only the configured write handlers; production defaults can keep this list empty. */
export function registerWriteTools(registry: ToolRegistry, coordinator: WriteCoordinator, handlers: WriteOperationHandlers): void {
  const operations: WriteOperationDefinition[] = [];
  if (handlers.homehubAction) operations.push({ name: 'kurisu.homehub.action', description: 'Request a confirmed HomeHub service action.', inputSchema: homehubActionInputSchema, handler: handlers.homehubAction });
  if (handlers.radarMutation) operations.push({ name: 'kurisu.radar.mutate', description: 'Request a confirmed Product Radar watch pause, resume, or deletion.', inputSchema: radarMutationInputSchema, handler: handlers.radarMutation });
  if (handlers.radarCreate) operations.push({ name: 'kurisu.radar.create', description: 'Request a confirmed Product Radar watch creation from an explicit target.', inputSchema: radarCreateInputSchema, handler: handlers.radarCreate });
  if (handlers.mediaMove) operations.push({ name: 'kurisu.media.move', description: 'Request a confirmed allowlisted media move.', inputSchema: mediaMoveInputSchema, handler: handlers.mediaMove });
  if (handlers.taskCancel) operations.push({ name: 'kurisu.task.cancel', description: 'Request cancellation of a durable task in the current conversation.', inputSchema: taskCancelInputSchema, handler: handlers.taskCancel });
  coordinator.registerMany(operations);
  registry.registerMany(operations.map((operation) => writeDefinition(operation, coordinator)));
}

function writeDefinition(operation: WriteOperationDefinition, coordinator: WriteCoordinator): ToolDefinition {
  return {
    name: operation.name,
    version: '1.0.0',
    description: operation.description,
    risk: 'write',
    timeoutMs: 120_000,
    idempotency: 'required',
    reconciliation: 'required',
    inputSchema: operation.inputSchema,
    jsonSchema: z.toJSONSchema(operation.inputSchema),
    handler: (input, context) => coordinator.request(operation.name, input, context),
  };
}

/** Adapt the existing path policy to the durable task boundary. */
export function mediaMoveHandler(policy: MediaPathPolicy): StructuredWriteHandler {
  return {
    async execute(input) {
      const value = mediaMoveInputSchema.parse(input);
      const plan = policy.plan(value.source, value.target, value.reason);
      policy.execute(plan, true);
      return { status: 'succeeded', result: { plan } };
    },
    async reconcile(input) {
      const value = mediaMoveInputSchema.parse(input);
      const sourceExists = (() => { try { policy.validateSource(value.source); return true; } catch { return false; } })();
      const targetExists = (() => { try { return existsSync(policy.validateTarget(value.target)); } catch { return false; } })();
      if (!sourceExists && targetExists) return { status: 'succeeded', result: { source: value.source, target: value.target, reconciled: true } };
      return { status: 'unknown', result: { source: value.source, target: value.target, reconciled: false } };
    },
  };
}

/** Cancel only a task owned by the current conversation; later steps observe the cancelled state. */
export function taskCancelHandler(store: KurisuStore): StructuredWriteHandler {
  return {
    async execute(input, context) {
      const value = taskCancelInputSchema.parse(input);
      const target = store.getRun(value.runId);
      if (!target || target.sessionKey !== context.sessionKey) return { status: 'blocked', result: { code: 'TASK_NOT_FOUND' } };
      const cancelled = store.cancelRun(target.id);
      return { status: 'succeeded', result: { runId: cancelled.id, status: cancelled.status, reason: value.reason }, externalId: cancelled.id };
    },
    async reconcile(input, context, previous) {
      const value = taskCancelInputSchema.parse(input);
      const target = store.getRun(value.runId);
      if (!target || target.sessionKey !== context.sessionKey) return { status: 'blocked', result: { code: 'TASK_NOT_FOUND' } };
      if (target.status === 'cancelled') return { status: 'succeeded', result: { runId: target.id, status: target.status, reconciled: true }, externalId: target.id };
      return { status: 'unknown', result: { code: 'TASK_CANCEL_UNCERTAIN', runId: target.id, previous: previous.result } };
    },
  };
}

/** Adapt HomeHub's allowlisted action engine without exposing text parsing here. */
export function homeHubActionHandler(runtime: StructuredHomeHubWriter): StructuredWriteHandler {
  return {
    execute: (input, context) => runtime.executeStructuredAction(homehubActionInputSchema.parse(input), context),
    ...(runtime.reconcileStructuredAction
      ? { reconcile: (input, context, previous) => runtime.reconcileStructuredAction!(homehubActionInputSchema.parse(input), context, previous) }
      : {}),
  };
}

export interface RadarWriteClientOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** HTTP write adapter with bounded responses and no retry after an uncertain mutation. */
export function radarWriteHandlers(options: RadarWriteClientOptions): Pick<WriteOperationHandlers, 'radarMutation' | 'radarCreate'> {
  return {
    radarMutation: {
      async execute(input, context) {
        const value = radarMutationInputSchema.parse(input);
        const method = value.action === 'delete' ? 'DELETE' : 'POST';
        const path = `/api/watches/${encodeURIComponent(value.watchId)}${value.action === 'delete' ? '' : `/${value.action}`}`;
        return radarMutationRequest(options, method, path, undefined, context.idempotencyKey);
      },
      async reconcile(input, _context, previous) {
        const value = radarMutationInputSchema.parse(input);
        return reconcileRadarMutation(options, value, previous);
      },
    },
    radarCreate: {
      async execute(input, context) {
        const value = radarCreateInputSchema.parse(input);
        return radarMutationRequest(options, 'POST', '/api/watches', { source: value.source, type: value.type, target: value.target, rules: value.rules }, context.idempotencyKey);
      },
      async reconcile(_input, _context, previous) {
        const externalId = previous.externalId;
        if (!externalId) return { status: 'unknown', result: { code: 'RADAR_CREATE_NOT_RECONCILABLE', previous: previous.result } };
        const probe = await radarProbe(options, `/api/watches/${encodeURIComponent(externalId)}`);
        if (probe.kind === 'found') return { status: 'succeeded', result: { reconciled: true, watchId: externalId, watch: probe.body }, externalId };
        return { status: 'unknown', result: { reconciled: false, watchId: externalId, probe: probe.kind } };
      },
    },
  };
}

async function radarMutationRequest(options: RadarWriteClientOptions, method: 'POST' | 'DELETE', path: string, body: unknown, idempotencyKey?: string): Promise<TaskStepOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(Math.max(options.timeoutMs ?? 30_000, 1_000), 120_000));
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (options.apiKey) headers['x-product-radar-key'] = options.apiKey;
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    const response = await (options.fetchImpl ?? fetch)(`${options.baseUrl.trim().replace(/\/$/u, '')}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > 512 * 1024) return { status: 'unknown', result: { code: 'RADAR_RESPONSE_TOO_LARGE' } };
    let value: unknown = null;
    try { value = raw ? JSON.parse(raw) : null; } catch { return { status: 'unknown', result: { code: 'RADAR_INVALID_JSON' } }; }
    if (!response.ok) {
      return response.status >= 500 || response.status === 429
        ? { status: 'unknown', result: { code: `RADAR_HTTP_${response.status}`, response: value } }
        : { status: 'blocked', result: { code: `RADAR_HTTP_${response.status}`, response: value } };
    }
    const externalId = radarId(value);
    return { status: 'succeeded', result: value, ...(externalId ? { externalId } : {}) };
  } catch (error) {
    return { status: 'unknown', result: { code: error && typeof error === 'object' && 'name' in error && String((error as { name?: unknown }).name) === 'AbortError' ? 'RADAR_TIMEOUT' : 'RADAR_UNAVAILABLE' } };
  } finally {
    clearTimeout(timer);
  }
}

async function reconcileRadarMutation(
  options: RadarWriteClientOptions,
  input: RadarMutationInput,
  previous: TaskStepRecord,
): Promise<TaskStepOutcome> {
  const path = `/api/watches/${encodeURIComponent(input.watchId)}`;
  if (input.action !== 'delete') {
    const probe = await radarProbe(options, `${path}/status`);
    if (probe.kind !== 'found') return { status: 'unknown', result: { watchId: input.watchId, action: input.action, probe: probe.kind, previous: previous.result } };
    const enabled = radarEnabled(probe.body);
    const expected = input.action === 'resume';
    if (enabled === expected) return { status: 'succeeded', result: { reconciled: true, watchId: input.watchId, action: input.action, status: probe.body } };
    return { status: 'unknown', result: { reconciled: false, watchId: input.watchId, action: input.action, status: probe.body, previous: previous.result } };
  }
  const probe = await radarProbe(options, path);
  if (probe.kind === 'missing') return { status: 'succeeded', result: { reconciled: true, watchId: input.watchId, action: input.action } };
  return { status: 'unknown', result: { reconciled: false, watchId: input.watchId, action: input.action, probe: probe.kind, previous: previous.result } };
}

async function radarProbe(options: RadarWriteClientOptions, path: string): Promise<{ kind: 'found' | 'missing' | 'unknown'; body?: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(Math.max(options.timeoutMs ?? 30_000, 1_000), 120_000));
  try {
    const response = await (options.fetchImpl ?? fetch)(`${options.baseUrl.trim().replace(/\/$/u, '')}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json', ...(options.apiKey ? { 'x-product-radar-key': options.apiKey } : {}) },
      signal: controller.signal,
    });
    if (response.status === 404) return { kind: 'missing' };
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > 512 * 1024 || !response.ok) return { kind: 'unknown' };
    try { return { kind: 'found', body: raw ? JSON.parse(raw) : null }; } catch { return { kind: 'unknown' }; }
  } catch {
    return { kind: 'unknown' };
  } finally {
    clearTimeout(timer);
  }
}

function radarId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const watch = record.watch;
  if (typeof record.id === 'string') return record.id;
  if (watch && typeof watch === 'object' && !Array.isArray(watch) && typeof (watch as Record<string, unknown>).id === 'string') {
    return String((watch as Record<string, unknown>).id);
  }
  return undefined;
}

function radarEnabled(value: unknown): boolean | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.enabled === 'boolean') return record.enabled;
  if (record.watch && typeof record.watch === 'object' && !Array.isArray(record.watch) && typeof (record.watch as Record<string, unknown>).enabled === 'boolean') {
    return (record.watch as Record<string, unknown>).enabled as boolean;
  }
  return null;
}

function writeIdempotencyKey(runId: string, operation: string, input: unknown): string {
  return `kurisu:${runId}:${approvalArgumentsHash(operation, input).slice(0, 32)}`;
}
