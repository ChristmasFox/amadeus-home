import { randomUUID } from 'node:crypto';
import { makeCallback, normalizeInbound, parseCallback, trustedContextFromInbound, type CallbackReference, type InboundMessageInput, type NormalizedInbound, type ToolCall, type ToolResponse, type TrustedAuthorization, type TrustedExecutionContext } from './contracts.js';
import { InMemoryContextStore } from './context.js';
import { ToolRegistry } from './tools.js';

export interface HostDecision {
  runId?: string;
  toolCalls: ToolCall[];
  finalText?: string;
  callbackReferences?: CallbackReference[];
}

export interface GatewayResult {
  mode: 'kurisu' | 'legacy';
  status: 'accepted' | 'duplicate' | 'completed' | 'needs_input' | 'error';
  runId: string | null;
  inbound: NormalizedInbound;
  toolResults: Array<{ call: ToolCall; response: ToolResponse }>;
  finalText: string | null;
  callback?: CallbackReference | null;
  trace: Array<{ event: string; at: string; details: Record<string, unknown> }>;
}

export interface RolloutDecision {
  migrated: boolean;
  revision: string;
  reason: string;
}

export class RolloutRegistry {
  private readonly migrated = new Map<string, string>();

  enable(sessionKey: string, revision = 'local'): void {
    this.migrated.set(sessionKey, revision);
  }

  disable(sessionKey: string): void {
    this.migrated.delete(sessionKey);
  }

  decide(sessionKey: string): RolloutDecision {
    const revision = this.migrated.get(sessionKey);
    return revision
      ? { migrated: true, revision, reason: 'session_rollout_enabled' }
      : { migrated: false, revision: 'legacy', reason: 'default_legacy_boundary' };
  }
}

export class LegacyListenerGuard {
  constructor(private readonly rollout: RolloutRegistry) {}

  shouldConsume(inbound: NormalizedInbound): boolean {
    return !this.rollout.decide(inbound.sessionKey).migrated;
  }
}

export interface GatewayOptions {
  registry: ToolRegistry;
  rollout?: RolloutRegistry;
  context?: InMemoryContextStore;
  authorization?: (inbound: NormalizedInbound) => TrustedAuthorization;
  now?: () => string;
}

export class KurisuGateway {
  readonly rollout: RolloutRegistry;
  readonly legacyGuard: LegacyListenerGuard;
  readonly context: InMemoryContextStore;
  private readonly registry: ToolRegistry;
  private readonly authorization: (inbound: NormalizedInbound) => TrustedAuthorization;
  private readonly now: () => string;
  private readonly seen = new Map<string, GatewayResult>();
  private readonly callbacks = new Map<string, {
    principalKey: string;
    sessionKey: string;
    runId: string;
    reference: CallbackReference;
  }>();

  constructor(options: GatewayOptions) {
    this.registry = options.registry;
    this.rollout = options.rollout ?? new RolloutRegistry();
    this.legacyGuard = new LegacyListenerGuard(this.rollout);
    this.context = options.context ?? new InMemoryContextStore();
    this.authorization = options.authorization ?? (() => ({ role: 'PUBLIC', allowedActions: ['read'], approvalRequiredActions: ['write', 'high'] }));
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async receive(input: InboundMessageInput | unknown, decision?: HostDecision): Promise<GatewayResult> {
    const inbound = this.normalize(input);
    const previous = this.seen.get(inbound.idempotencyKey);
    if (previous) return { ...previous, status: 'duplicate', trace: [...previous.trace, this.trace('duplicate_inbound', { idempotencyKey: inbound.idempotencyKey })] };

    const rollout = this.rollout.decide(inbound.sessionKey);
    const baseTrace = [
      this.trace('inbound_received', { idempotencyKey: inbound.idempotencyKey, sessionKey: inbound.sessionKey }),
      this.trace('rollout_decided', { ...rollout }),
    ];
    this.context.ensure(inbound);
    if (!rollout.migrated) {
      const legacyResult: GatewayResult = {
        mode: 'legacy',
        status: 'accepted',
        runId: null,
        inbound,
        toolResults: [],
        finalText: null,
        callback: null,
        trace: baseTrace,
      };
      this.seen.set(inbound.idempotencyKey, legacyResult);
      return legacyResult;
    }

    const runId = decision?.runId ?? `run_${randomUUID()}`;
    const context = trustedContextFromInbound(inbound, this.authorization(inbound), {
      runId,
      requestId: `req_${randomUUID()}`,
      source: 'langbot-native-agent',
    });
    const toolResults: GatewayResult['toolResults'] = [];
    for (const call of decision?.toolCalls ?? []) {
      const response = await this.registry.execute(call, context);
      toolResults.push({ call, response });
    }
    const hasError = toolResults.some(({ response }) => ['error', 'unknown', 'denied'].includes(response.status));
    const result: GatewayResult = {
      mode: 'kurisu',
      status: hasError ? 'error' : decision?.finalText ? 'completed' : 'needs_input',
      runId,
      inbound,
      toolResults,
      finalText: decision?.finalText ?? null,
      callback: null,
      trace: [
        ...baseTrace,
        this.trace('trusted_context_created', { runId, principalKey: context.principalKey }),
        ...toolResults.map(({ call, response }) => this.trace('tool_result', { callId: call.id, tool: call.name, status: response.status })),
        this.trace('host_turn_finished', { status: hasError ? 'error' : resultStatus(decision?.finalText) }),
      ],
    };
    for (const reference of decision?.callbackReferences ?? []) this.registerCallback(reference, context);
    result.callback = decision?.callbackReferences?.[0] ? decision.callbackReferences[0] : null;
    this.seen.set(inbound.idempotencyKey, result);
    return result;
  }

  async handleCallback(input: InboundMessageInput | unknown): Promise<GatewayResult> {
    const inbound = this.normalize(input);
    const callback = parseCallback(inbound.callbackData);
    const rollout = this.rollout.decide(inbound.sessionKey);
    const baseTrace = [
      this.trace('callback_received', { idempotencyKey: inbound.idempotencyKey, sessionKey: inbound.sessionKey }),
      this.trace('rollout_decided', { ...rollout }),
    ];
    this.context.ensure(inbound);
    const rejected = (reason: string, runId: string | null = null): GatewayResult => {
      const result: GatewayResult = {
        mode: 'kurisu',
        status: 'error',
        runId,
        inbound,
        toolResults: [],
        finalText: null,
        callback,
        trace: [...baseTrace, this.trace('callback_rejected', { reason })],
      };
      this.seen.set(inbound.idempotencyKey, result);
      return result;
    };
    const previous = this.seen.get(inbound.idempotencyKey);
    if (previous) return { ...previous, status: 'duplicate', trace: [...previous.trace, this.trace('duplicate_callback', { idempotencyKey: inbound.idempotencyKey })] };
    if (!callback) return rejected('invalid_namespace');
    if (!rollout.migrated) return rejected('rollout_not_enabled');
    const binding = this.callbacks.get(inbound.callbackData ?? '');
    if (!binding) return rejected('binding_missing');
    if (binding.principalKey !== inbound.principalKey || binding.sessionKey !== inbound.sessionKey) {
      return rejected('binding_mismatch', binding.runId);
    }
    this.callbacks.delete(inbound.callbackData ?? '');
    const result: GatewayResult = {
      mode: 'kurisu',
      status: 'accepted',
      runId: binding.runId,
      inbound,
      toolResults: [],
      finalText: null,
      callback,
      trace: [...baseTrace, this.trace('callback_accepted', { kind: callback.kind, action: callback.action, runId: binding.runId })],
    };
    this.seen.set(inbound.idempotencyKey, result);
    return result;
  }

  /** Bind a server-generated callback to the exact principal and session. */
  registerCallback(reference: CallbackReference | string, context: Pick<TrustedExecutionContext, 'principalKey' | 'sessionKey' | 'runId'>): string {
    const value = typeof reference === 'string' ? reference : makeCallback(reference);
    const parsed = parseCallback(value);
    if (!parsed) throw new Error('invalid Kurisu callback reference');
    this.callbacks.set(value, {
      principalKey: context.principalKey,
      sessionKey: context.sessionKey,
      runId: context.runId,
      reference: parsed,
    });
    return value;
  }

  private normalize(input: InboundMessageInput | unknown): NormalizedInbound {
    // This is the only place where untrusted platform payloads become typed
    // messages before any rollout or tool decision is made.
    return normalizeInbound(input, this.now());
  }

  private trace(event: string, details: Record<string, unknown>): GatewayResult['trace'][number] {
    return { event, at: this.now(), details };
  }
}

function resultStatus(finalText: string | undefined): string {
  return finalText ? 'completed' : 'needs_input';
}
