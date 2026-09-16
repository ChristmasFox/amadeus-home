import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import {
  normalizeInbound,
  newRunId,
  trustedContextFromInbound,
  type InboundMessageInput,
  type ToolResponse,
  type TrustedAuthorization,
} from './contracts.js';
import { InMemoryContextStore } from './context.js';
import { registerDomainTools, type DomainBackends } from './domain-tools.js';
import { KurisuGateway, type GatewayResult, type HostDecision, RolloutRegistry } from './gateway.js';
import { publicReadAuthorization, authorizeTool } from './policy.js';
import { createNotificationBackend } from './read-only.js';
import { registerNotificationPreferenceTools } from './notification-tools.js';
import { NotificationWorker, type NotificationChannel, type NotificationTarget } from './notifications.js';
import { KurisuStore } from './storage.js';
import { ToolRegistry, unknownResult } from './tools.js';
import { registerWriteTools, taskCancelHandler, WriteCoordinator, type WriteOperationHandlers } from './write-tools.js';
import { registerTaskStatusTool } from './task-tools.js';
import { registerCodexTools } from './codex-tools.js';
import { CodexAppServerExecutor, type CodexExecutorOptions, type CodexWorkspaceRegistry } from './codex.js';

const hostContextSchema = z.object({
  platform: z.enum(['telegram', 'kook', 'whatsapp', 'test']),
  platformUserId: z.string().trim().min(1).max(256),
  conversation: z.object({
    kind: z.enum(['private', 'group']),
    chatId: z.string().trim().min(1).max(256),
    threadId: z.string().trim().max(256).optional(),
    topicId: z.string().trim().max(256).optional(),
  }).strict(),
  botId: z.string().trim().min(1).max(256),
  queryId: z.string().trim().min(1).max(256),
}).strict();

const toolCallRequestSchema = z.object({
  toolName: z.string().trim().regex(/^kurisu\.[a-z0-9_.-]+$/u).max(96),
  input: z.record(z.string(), z.unknown()),
  callId: z.string().trim().min(1).max(256).optional(),
  hostContext: hostContextSchema,
}).strict();

const hostDecisionSchema = z.object({
  runId: z.string().trim().min(1).max(256).optional(),
  toolCalls: z.array(z.object({
    id: z.string().trim().min(1).max(256),
    name: z.string().trim().min(1).max(96),
    arguments: z.unknown(),
  }).strict()).max(32),
  finalText: z.string().max(32_000).optional(),
  callbackReferences: z.array(z.object({
    namespace: z.literal('ku1'),
    kind: z.enum(['approval', 'task', 'selection', 'preference']),
    action: z.string().trim().min(1).max(16),
    id: z.string().trim().min(1).max(36),
  }).strict()).max(16).optional(),
}).strict();

export interface KurisuServiceOptions {
  stateFile?: string;
  backends?: DomainBackends;
  authorization?: (inbound: ReturnType<typeof normalizeInbound>) => TrustedAuthorization;
  now?: () => string;
  writeHandlers?: WriteOperationHandlers;
  codexExecutor?: CodexAppServerExecutor;
  codexProjects?: CodexWorkspaceRegistry;
  codexOptions?: CodexExecutorOptions;
  notificationWorker?: NotificationWorker;
  notificationChannels?: readonly NotificationChannel[];
  notificationTargets?: readonly NotificationTarget[];
  notificationPollMs?: number;
}

/**
 * Runtime-owned Kurisu boundary. LangBot supplies only a structured tool name,
 * input, and host-derived identity; policy and persistence stay server-side.
 */
export class KurisuService {
  readonly store: KurisuStore;
  readonly rollout: RolloutRegistry;
  readonly gateway: KurisuGateway;
  readonly registry: ToolRegistry;
  readonly writeCoordinator: WriteCoordinator | null;
  readonly codexExecutor: CodexAppServerExecutor | null;
  readonly notifications: NotificationWorker;

  private readonly now: () => string;
  private readonly authorization: (inbound: ReturnType<typeof normalizeInbound>) => TrustedAuthorization;

  constructor(options: KurisuServiceOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.authorization = options.authorization ?? (() => publicReadAuthorization());
    this.store = new KurisuStore(options.stateFile ?? ':memory:');
    const notificationOptions = { now: this.now, ...(options.notificationChannels ? { channels: options.notificationChannels } : {}) };
    this.notifications = options.notificationWorker ?? new NotificationWorker(this.store, notificationOptions);
    this.rollout = new RolloutRegistry();
    const context = new InMemoryContextStore();
    this.registry = new ToolRegistry({
      authorize: authorizeTool,
      now: this.now,
      observer: async (observation, response) => {
        const run = this.store.getRun(observation.runId);
        if (!run) return;
        this.store.recordToolExecution(observation, response);
      },
    });
    registerDomainTools(this.registry, {
      ...(options.backends ?? {}),
      notifications: options.backends?.notifications ?? createNotificationBackend(this.store),
    });
    registerNotificationPreferenceTools(this.registry, this.notifications.preferenceStore, this.notifications);
    registerTaskStatusTool(this.registry, this.store);
    const writeHandlers = options.writeHandlers
      ? { ...options.writeHandlers, taskCancel: options.writeHandlers.taskCancel ?? taskCancelHandler(this.store) }
      : undefined;
    this.writeCoordinator = writeHandlers ? new WriteCoordinator(this.store, {
      now: this.now,
      notificationWorker: this.notifications,
      notificationTargets: options.notificationTargets ?? [],
    }) : null;
    if (this.writeCoordinator && writeHandlers) registerWriteTools(this.registry, this.writeCoordinator, writeHandlers);
    this.codexExecutor = options.codexExecutor ?? (options.codexProjects ? new CodexAppServerExecutor(this.store, options.codexProjects, {
      ...(options.codexOptions ?? {}),
      notificationWorker: this.notifications,
      notificationTargets: options.notificationTargets ?? [],
    }) : null);
    if (this.codexExecutor) registerCodexTools(this.registry, this.codexExecutor);
    if (options.notificationPollMs !== undefined) this.notifications.start(options.notificationPollMs);
    this.gateway = new KurisuGateway({
      registry: this.registry,
      rollout: this.rollout,
      context,
      authorization: this.authorization,
      callbackStore: this.store,
      now: this.now,
    });
  }

  close(): void {
    this.notifications.stop();
    void this.codexExecutor?.close();
    this.store.close();
  }

  tools(): ReturnType<ToolRegistry['catalog']> {
    return this.registry.catalog();
  }

  async receiveInbound(input: unknown, decisionInput?: unknown): Promise<GatewayResult> {
    const inbound = normalizeInbound(input, this.now());
    const claimed = this.store.claimInbound(inbound);
    if (!claimed.claimed && isGatewayResult(claimed.result)) {
      return {
        ...claimed.result,
        status: 'duplicate',
        trace: [...claimed.result.trace, { event: 'duplicate_inbound_persistent', at: this.now(), details: { idempotencyKey: inbound.idempotencyKey } }],
      };
    }
    if (!claimed.claimed) return inFlightGatewayResult(inbound, this.rollout.decide(inbound.sessionKey).migrated, this.now());

    const parsedDecision = decisionInput === undefined ? undefined : hostDecisionSchema.parse(decisionInput);
    const rollout = this.rollout.decide(inbound.sessionKey);
    const runId = rollout.migrated ? (parsedDecision?.runId ?? newRunId()) : null;
    if (runId) {
      this.store.createRun(inbound.sessionKey, runId, this.now());
      this.store.linkMessageToRun(inbound, runId, 'primary', this.now());
      this.store.transitionRun(runId, 'running', { nextStep: 'host_turn' }, this.now());
    }
    const decision: HostDecision | undefined = rollout.migrated
      ? {
          toolCalls: parsedDecision?.toolCalls ?? [],
          runId: runId!,
          ...(parsedDecision?.finalText !== undefined ? { finalText: parsedDecision.finalText } : {}),
          ...(parsedDecision?.callbackReferences ? { callbackReferences: parsedDecision.callbackReferences } : {}),
        }
      : undefined;
    const result = await this.gateway.receive(inbound, decision);
    if (result.runId) this.finishRun(result.runId, result.status, result.toolResults.map(({ response }) => response));
    this.store.saveInboundResult(inbound.idempotencyKey, result);
    return result;
  }

  async receiveCallback(input: unknown): Promise<GatewayResult> {
    const inbound = normalizeInbound(input, this.now());
    const claimed = this.store.claimInbound(inbound);
    if (!claimed.claimed && isGatewayResult(claimed.result)) {
      return {
        ...claimed.result,
        status: 'duplicate',
        trace: [...claimed.result.trace, { event: 'duplicate_callback_persistent', at: this.now(), details: { idempotencyKey: inbound.idempotencyKey } }],
      };
    }
    if (!claimed.claimed) return inFlightGatewayResult(inbound, true, this.now());
    const result = await this.gateway.handleCallback(inbound);
    if (result.status === 'accepted' && result.callback?.kind === 'approval' && result.runId) {
      const context = trustedContextFromInbound(inbound, this.authorization(inbound), {
        runId: result.runId,
        requestId: `approval_${inbound.updateId}`,
        source: 'runtime',
      });
      if (this.codexExecutor && this.codexExecutor.handlesCallback(context, result.callback)) {
        result.approvalResponse = await this.codexExecutor.approveCallback(context, result.callback);
      } else if (this.writeCoordinator) {
        result.approvalResponse = await this.writeCoordinator.approveCallback(context, result.callback);
      }
      if (result.approvalResponse) this.finishRun(result.runId, result.approvalResponse.status, [result.approvalResponse]);
    }
    if (result.runId && this.store.getRun(result.runId)) this.store.linkMessageToRun(inbound, result.runId, 'callback', this.now());
    this.store.saveInboundResult(inbound.idempotencyKey, result);
    return result;
  }

  async executeHostTool(input: unknown): Promise<ToolResponse> {
    const request = toolCallRequestSchema.parse(input);
    const host = request.hostContext;
    const callId = request.callId ?? `call_${randomUUID()}`;
    const inbound = normalizeInbound({
      updateId: `${host.queryId}:${callId}`,
      messageId: `${host.queryId}:${callId}`,
      botId: host.botId,
      identity: { platform: host.platform, platformUserId: host.platformUserId },
      conversation: host.conversation,
      text: '',
      attachments: [],
      receivedAt: this.now(),
    } satisfies InboundMessageInput, this.now());
    const claimed = this.store.claimInbound(inbound);
    if (!claimed.claimed && isToolResponse(claimed.result)) return claimed.result;
    if (!claimed.claimed) {
      const recovered = this.recoverToolResponse(inbound, callId);
      if (recovered) {
        this.store.saveInboundResult(inbound.idempotencyKey, recovered);
        return recovered;
      }
      return unknownResult('INBOUND_IN_FLIGHT', 'another worker owns this request; external execution was not repeated', true);
    }
    const runId = newRunId();
    this.store.createRun(inbound.sessionKey, runId, this.now());
    this.store.linkMessageToRun(inbound, runId, 'tool-call', this.now());
    this.store.transitionRun(runId, 'running', { nextStep: request.toolName }, this.now());
    const context = trustedContextFromInbound(inbound, this.authorizationFor(inbound), {
      runId,
      requestId: `req_${randomUUID()}`,
      source: 'langbot-native-agent',
    });
    const response = await this.registry.execute({ id: callId, name: request.toolName, arguments: request.input }, context);
    for (const reference of response.callbackReferences ?? []) this.gateway.registerCallback(reference, context);
    this.finishRun(runId, response.status, [response]);
    this.store.saveInboundResult(inbound.idempotencyKey, response);
    return response;
  }

  private authorizationFor(inbound: ReturnType<typeof normalizeInbound>): TrustedAuthorization {
    // The callback is supplied by the runtime process, never by the host/model
    // payload. The default is intentionally read-only until an operator wires
    // an identity-backed policy.
    return this.authorization(inbound);
  }

  private recoverToolResponse(inbound: ReturnType<typeof normalizeInbound>, callId: string): ToolResponse | null {
    const linkedRuns = this.store.listRunsForMessage(inbound.sessionKey, inbound.updateId);
    for (const run of linkedRuns.reverse()) {
      const execution = this.store.getToolExecution(run.id, callId);
      if (execution && isToolResponse(execution.response)) return execution.response;
    }
    return null;
  }

  private finishRun(runId: string, status: GatewayResult['status'] | ToolResponse['status'], responses: ToolResponse[]): void {
    const run = this.store.getRun(runId);
    if (!run || ['succeeded', 'failed', 'cancelled'].includes(run.status)) return;
    const hasUnknown = responses.some((response) => response.status === 'unknown');
    const hasFailure = responses.some((response) => ['error', 'denied', 'unsupported'].includes(response.status));
    const target = hasUnknown
      ? 'reconciling'
      : hasFailure || status === 'error'
        ? 'failed'
        : status === 'needs_input'
          ? responses.some((response) => response.status === 'needs_input' && isApprovalChallenge(response)) ? 'waiting_approval' : 'waiting_input'
          : status === 'accepted'
            ? 'waiting_job'
            : 'succeeded';
    this.store.transitionRun(runId, target, { lastObservation: `kurisu result: ${status}` }, this.now());
  }
}

function isApprovalChallenge(response: ToolResponse): boolean {
  if (!response.data || typeof response.data !== 'object' || Array.isArray(response.data)) return false;
  return typeof (response.data as Record<string, unknown>).approvalId === 'string';
}

function isGatewayResult(value: unknown): value is GatewayResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (candidate.mode === 'kurisu' || candidate.mode === 'legacy') && typeof candidate.status === 'string' && Array.isArray(candidate.trace);
}

function isToolResponse(value: unknown): value is ToolResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate.contractVersion === 'kurisu.v1' && typeof candidate.status === 'string' && Array.isArray(candidate.evidence);
}

function inFlightGatewayResult(
  inbound: ReturnType<typeof normalizeInbound>,
  migrated: boolean,
  at: string,
): GatewayResult {
  return {
    mode: migrated ? 'kurisu' : 'legacy',
    status: 'accepted',
    runId: null,
    inbound,
    toolResults: [],
    finalText: null,
    callback: null,
    trace: [{ event: 'inbound_claim_in_flight', at, details: { idempotencyKey: inbound.idempotencyKey } }],
  };
}
