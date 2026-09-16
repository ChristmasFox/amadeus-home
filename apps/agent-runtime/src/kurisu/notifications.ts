import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

import { stableJson } from './contracts.js';
import type { NotificationEventRecord, DeliveryRecord, KurisuStore, CodexJobRecord } from './storage.js';
import { kurisuNotificationLabels } from './persona.js';

export const notificationSourceSchema = z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_.-]*$/u);
export const notificationResultTypeSchema = z.enum(['success', 'failure', 'unknown', 'info']);
export const notificationChannelSchema = z.enum(['telegram', 'kook', 'codex']);

export const notificationEventInputSchema = z.object({
  eventType: z.string().trim().min(1).max(128),
  eventKey: z.string().trim().min(1).max(512),
  principalKey: z.string().trim().min(1).max(256),
  source: notificationSourceSchema,
  resultType: notificationResultTypeSchema,
  payload: z.unknown(),
  taskId: z.string().trim().max(256).optional(),
  runId: z.string().trim().max(256).optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
}).strict();

export const notificationTargetSchema = z.object({
  channel: notificationChannelSchema,
  recipient: z.string().trim().min(1).max(256),
}).strict();

export type NotificationEventInput = z.infer<typeof notificationEventInputSchema>;
export type NotificationTarget = z.infer<typeof notificationTargetSchema>;
export type NotificationResultType = z.infer<typeof notificationResultTypeSchema>;

export interface NotificationSendContext {
  event: NotificationEventRecord;
  delivery: DeliveryRecord;
  text: string;
}

export type NotificationSendResult =
  | { status: 'sent'; platformMessageId?: string }
  | { status: 'retryable_failed'; reason: string; retryAfterMs?: number }
  | { status: 'unknown'; reason: string }
  | { status: 'dead'; reason: string };

export interface NotificationChannel {
  readonly channel: NotificationTarget['channel'];
  readonly recipient: string;
  send(context: NotificationSendContext): Promise<NotificationSendResult>;
}

export interface NotificationPreferenceRule {
  source: string | 'all';
  resultType: NotificationResultType | 'all';
  channel: NotificationTarget['channel'] | 'all';
  action: 'mute' | 'allow';
  until: string | null;
  timezone: string;
  provenance: {
    source: 'user';
    principalKey: string;
    recordedAt: string;
    reference: string;
  };
  updatedAt: string;
}

export interface NotificationPreferenceSelector {
  source?: string | 'all';
  resultType?: NotificationResultType | 'all';
  channel?: NotificationTarget['channel'] | 'all';
}

type NotificationPreferenceInput = Pick<NotificationPreferenceRule, 'source' | 'resultType' | 'channel' | 'action' | 'timezone'> & {
  until?: string | null;
  reference?: string;
};

interface StoredNotificationPreferences {
  version: 1;
  rules: NotificationPreferenceRule[];
}

const preferenceKey = 'notifications.policy.v1';

/** Durable, principal-scoped user preferences. No session/chat label is used as identity. */
export class NotificationPreferenceStore {
  constructor(private readonly store: KurisuStore, private readonly now: () => string = () => new Date().toISOString()) {}

  list(principalKey: string, now = this.now()): NotificationPreferenceRule[] {
    const stored = this.read(principalKey);
    return stored.rules.filter((rule) => !rule.until || rule.until > now);
  }

  setRule(
    principalKey: string,
    rule: NotificationPreferenceInput,
    now = this.now(),
  ): NotificationPreferenceRule {
    const parsed = preferenceRuleShape.parse(rule);
    const next: NotificationPreferenceRule = {
      source: parsed.source,
      resultType: parsed.resultType,
      channel: parsed.channel,
      action: parsed.action,
      until: parsed.until ?? null,
      timezone: parsed.timezone,
      provenance: {
        source: 'user',
        principalKey,
        recordedAt: now,
        reference: parsed.reference?.slice(0, 256) || 'structured-user-preference',
      },
      updatedAt: now,
    };
    const stored = this.read(principalKey);
    const rules = stored.rules.filter((candidate) => !samePreferenceKey(candidate, next));
    rules.push(next);
    this.write(principalKey, { version: 1, rules }, now);
    return next;
  }

  forget(principalKey: string, selector: NotificationPreferenceSelector, now = this.now()): number {
    const stored = this.read(principalKey);
    const retained = stored.rules.filter((rule) => !matchesPreference(rule, selector));
    const removed = stored.rules.length - retained.length;
    if (removed > 0) this.write(principalKey, { version: 1, rules: retained }, now);
    return removed;
  }

  shouldDeliver(principalKey: string, source: string, resultType: NotificationResultType, channel: NotificationTarget['channel'], now = this.now()): boolean {
    const matching = this.list(principalKey, now)
      .filter((rule) => (rule.source === 'all' || rule.source === source) && (rule.resultType === 'all' || rule.resultType === resultType) && (rule.channel === 'all' || rule.channel === channel))
      .sort((left, right) => preferenceSpecificity(right) - preferenceSpecificity(left) || right.updatedAt.localeCompare(left.updatedAt));
    return matching[0]?.action !== 'mute';
  }

  private read(principalKey: string): StoredNotificationPreferences {
    const value = this.store.getPreference(preferenceScope(principalKey), preferenceKey, this.now());
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { version: 1, rules: [] };
    const record = value as Record<string, unknown>;
    const rules = Array.isArray(record.rules) ? record.rules.filter(isPreferenceRule) : [];
    return { version: 1, rules };
  }

  private write(principalKey: string, value: StoredNotificationPreferences, now: string): void {
    this.store.setPreference(preferenceScope(principalKey), preferenceKey, value, null, now);
  }
}

const preferenceRuleShape = z.object({
  source: z.union([notificationSourceSchema, z.literal('all')]),
  resultType: z.union([notificationResultTypeSchema, z.literal('all')]),
  channel: z.union([notificationChannelSchema, z.literal('all')]),
  action: z.enum(['mute', 'allow']),
  until: z.string().datetime({ offset: true }).nullable().optional(),
  timezone: z.string().trim().min(1).max(64).default('Asia/Shanghai'),
  reference: z.string().trim().max(256).optional(),
}).strict();

function preferenceScope(principalKey: string): string {
  return `principal:${principalKey}`;
}

function samePreferenceKey(left: NotificationPreferenceRule, right: NotificationPreferenceRule): boolean {
  return left.source === right.source && left.resultType === right.resultType && left.channel === right.channel;
}

function matchesPreference(rule: NotificationPreferenceRule, selector: NotificationPreferenceSelector): boolean {
  return (selector.source === undefined || selector.source === rule.source)
    && (selector.resultType === undefined || selector.resultType === rule.resultType)
    && (selector.channel === undefined || selector.channel === rule.channel);
}

function preferenceSpecificity(rule: NotificationPreferenceRule): number {
  return (rule.source === 'all' ? 0 : 4) + (rule.resultType === 'all' ? 0 : 2) + (rule.channel === 'all' ? 0 : 1);
}

function isPreferenceRule(value: unknown): value is NotificationPreferenceRule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.source === 'string'
    && typeof record.resultType === 'string'
    && typeof record.channel === 'string'
    && (record.action === 'mute' || record.action === 'allow')
    && (record.until === null || typeof record.until === 'string')
    && typeof record.timezone === 'string'
    && typeof record.updatedAt === 'string'
    && Boolean(record.provenance) && typeof record.provenance === 'object';
}

export interface NotificationWorkerOptions {
  channels?: readonly NotificationChannel[];
  preferences?: NotificationPreferenceStore;
  now?: () => string;
  retryBaseMs?: number;
  maxAttempts?: number;
  leaseMs?: number;
  owner?: string;
  render?: (event: NotificationEventRecord) => string;
}

export interface NotificationIngestResult {
  eventId: string;
  inserted: boolean;
  deliveries: Array<{ id: string; channel: string; recipient: string; inserted: boolean; muted: boolean }>;
}

export interface NotificationDrainResult {
  scanned: number;
  sent: number;
  retryableFailed: number;
  unknown: number;
  dead: number;
}

/** Central event/delivery outbox. It never calls a platform sender before the event is durable. */
export class NotificationWorker {
  private readonly now: () => string;
  private readonly channels: Map<string, NotificationChannel>;
  private readonly preferences: NotificationPreferenceStore;
  private readonly retryBaseMs: number;
  private readonly maxAttempts: number;
  private readonly leaseMs: number;
  private readonly owner: string;
  private readonly render: (event: NotificationEventRecord) => string;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly store: KurisuStore, options: NotificationWorkerOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.channels = new Map((options.channels ?? []).map((channel) => [`${channel.channel}:${channel.recipient}`, channel]));
    this.preferences = options.preferences ?? new NotificationPreferenceStore(store, this.now);
    this.retryBaseMs = Math.min(Math.max(Math.trunc(options.retryBaseMs ?? 5_000), 100), 24 * 60 * 60_000);
    this.maxAttempts = Math.min(Math.max(Math.trunc(options.maxAttempts ?? 5), 1), 20);
    this.leaseMs = Math.min(Math.max(Math.trunc(options.leaseMs ?? 30_000), 1_000), 10 * 60_000);
    this.owner = options.owner ?? `notification-worker-${randomUUID().slice(0, 12)}`;
    this.render = options.render ?? renderNotification;
  }

  get preferenceStore(): NotificationPreferenceStore {
    return this.preferences;
  }

  retryDelivery(deliveryId: string, principalKey: string, now = this.now()): DeliveryRecord | null {
    return this.store.retryDelivery(deliveryId, principalKey, now);
  }

  ingest(input: NotificationEventInput, targets: readonly NotificationTarget[] = [], now = this.now()): NotificationIngestResult {
    const parsed = notificationEventInputSchema.parse(input);
    const payload = normalizePayload(parsed);
    return this.store.transaction(() => {
      const event = this.store.createEvent(parsed.eventType, parsed.eventKey, payload, undefined, now);
      const deliveries = targets.map((target) => {
        const muted = !this.preferences.shouldDeliver(parsed.principalKey, parsed.source, parsed.resultType, target.channel, now);
        if (muted) {
          const existing = this.findDelivery(event.id, target);
          return { id: existing?.id ?? `muted:${event.id}:${target.channel}:${target.recipient}`, channel: target.channel, recipient: target.recipient, inserted: false, muted: true };
        }
        const delivery = this.store.enqueueDelivery(event.id, target.channel, target.recipient, undefined, now);
        return { id: delivery.id, channel: target.channel, recipient: target.recipient, inserted: delivery.inserted, muted: false };
      });
      return { eventId: event.id, inserted: event.inserted, deliveries };
    });
  }

  ingestLegacyCodex(
    input: { threadId: string; turnId: string; cwd: string; projectName?: string; lastAssistantMessage?: string; timestamp?: string },
    targets: readonly NotificationTarget[],
    principalKey = 'codex:external',
    now = this.now(),
  ): NotificationIngestResult {
    const threadId = input.threadId.trim();
    const turnId = input.turnId.trim();
    return this.ingest({
      eventType: 'codex.agent_turn_complete',
      eventKey: `codex:legacy:${threadId}:${turnId}`,
      principalKey,
      source: 'codex',
      resultType: 'unknown',
      payload: {
        evidenceState: 'no_durable_task_evidence',
        threadId,
        turnId,
        cwd: input.cwd.slice(0, 4096),
        projectName: (input.projectName ?? 'unknown-project').slice(0, 80),
        lastAssistantMessage: (input.lastAssistantMessage ?? '').slice(0, 8_000),
        timestamp: input.timestamp ?? now,
        summary: kurisuNotificationLabels.legacyCodexUnknown,
      },
      occurredAt: input.timestamp,
    }, targets, now);
  }

  ingestCodexJobEvent(
    job: CodexJobRecord,
    eventType: string,
    summary: string,
    targets: readonly NotificationTarget[] = [],
    ref?: string,
    now = this.now(),
  ): NotificationIngestResult {
    const resultType: NotificationResultType = job.status === 'succeeded' ? 'success' : ['failed', 'cancelled'].includes(job.status) ? 'failure' : job.status === 'unknown' ? 'unknown' : 'info';
    return this.ingest({
      eventType,
      eventKey: `codex:${job.jobId}:${eventType}:${hashForEvent({ status: job.status, ref, summary })}`,
      principalKey: job.principalKey,
      source: 'codex',
      resultType,
      taskId: job.jobId,
      runId: job.runId,
      payload: {
        taskId: job.jobId,
        runId: job.runId,
        projectId: job.projectId,
        workspaceRef: job.workspaceRef,
        threadId: job.threadId,
        turnId: job.turnId,
        status: job.status,
        summary: summary.slice(0, 1_000),
        ...(ref ? { ref } : {}),
      },
      occurredAt: now,
    }, targets, now);
  }

  async deliverDue(now = this.now(), limit = 50): Promise<NotificationDrainResult> {
    const due = this.store.listDueDeliveries(now, limit);
    const result: NotificationDrainResult = { scanned: due.length, sent: 0, retryableFailed: 0, unknown: 0, dead: 0 };
    for (const candidate of due) {
      const claimed = this.store.claimDelivery(candidate.id, this.owner, new Date(now), this.leaseMs);
      if (!claimed) continue;
      const event = this.store.getNotificationEvent(claimed.eventId);
      const channel = this.channels.get(`${claimed.channel}:${claimed.recipient}`);
      if (!event || !channel) {
        this.store.markDelivery(claimed.id, 'dead', { lastError: event ? 'notification channel is not configured' : 'notification event is missing' }, now);
        result.dead += 1;
        continue;
      }
      try {
        const outcome = await channel.send({ event, delivery: claimed, text: this.render(event) });
        if (outcome.status === 'sent') {
          const update: { platformMessageId?: string } = {};
          if (outcome.platformMessageId !== undefined) update.platformMessageId = outcome.platformMessageId;
          this.store.markDelivery(claimed.id, 'sent', update, now);
          result.sent += 1;
        } else if (outcome.status === 'retryable_failed') {
          const attempts = claimed.attempts + 1;
          if (attempts >= this.maxAttempts) {
            this.store.markDelivery(claimed.id, 'dead', { lastError: outcome.reason }, now);
            result.dead += 1;
          } else {
            const delay = Math.max(100, Math.min(outcome.retryAfterMs ?? this.retryBaseMs * 2 ** Math.max(0, attempts - 1), 24 * 60 * 60_000));
            this.store.markDelivery(claimed.id, 'retryable_failed', { lastError: outcome.reason, nextAttemptAt: new Date(new Date(now).getTime() + delay).toISOString() }, now);
            result.retryableFailed += 1;
          }
        } else if (outcome.status === 'unknown') {
          this.store.markDelivery(claimed.id, 'unknown', { lastError: outcome.reason }, now);
          result.unknown += 1;
        } else {
          this.store.markDelivery(claimed.id, 'dead', { lastError: outcome.reason }, now);
          result.dead += 1;
        }
      } catch (error) {
        const attempts = claimed.attempts + 1;
        const reason = error instanceof Error ? error.message.slice(0, 500) : 'notification channel failed';
        if (attempts >= this.maxAttempts) {
          this.store.markDelivery(claimed.id, 'dead', { lastError: reason }, now);
          result.dead += 1;
        } else {
          const delay = Math.min(this.retryBaseMs * 2 ** Math.max(0, attempts - 1), 24 * 60 * 60_000);
          this.store.markDelivery(claimed.id, 'retryable_failed', { lastError: reason, nextAttemptAt: new Date(new Date(now).getTime() + delay).toISOString() }, now);
          result.retryableFailed += 1;
        }
      }
    }
    return result;
  }

  start(intervalMs = 5_000): void {
    if (this.timer) return;
    const bounded = Math.min(Math.max(Math.trunc(intervalMs), 100), 10 * 60_000);
    this.timer = setInterval(() => { void this.deliverDue().catch(() => undefined); }, bounded);
    this.timer.unref?.();
    void this.deliverDue().catch(() => undefined);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private findDelivery(eventId: string, target: NotificationTarget): DeliveryRecord | null {
    return this.store.listDeliveries(eventId).find((delivery) => delivery.channel === target.channel && delivery.recipient === target.recipient) ?? null;
  }
}

export interface LangBotNotificationChannelOptions {
  channel: NotificationTarget['channel'];
  baseUrl: string;
  botId: string;
  recipient: string;
  targetType?: 'person' | 'group';
  apiToken?: string;
  apiHeaderName?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Runtime-owned LangBot sender. Recipient and bot are server configuration, never event payload. */
export class LangBotNotificationChannel implements NotificationChannel {
  readonly channel: NotificationTarget['channel'];
  readonly recipient: string;
  private readonly targetType: 'person' | 'group';
  private readonly baseUrl: string;
  private readonly botId: string;
  private readonly apiToken: string;
  private readonly apiHeaderName: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LangBotNotificationChannelOptions) {
    this.channel = options.channel;
    this.recipient = options.recipient;
    this.targetType = options.targetType === 'group' ? 'group' : 'person';
    this.baseUrl = options.baseUrl.trim().replace(/\/$/u, '');
    this.botId = options.botId;
    this.apiToken = options.apiToken?.trim() ?? '';
    this.apiHeaderName = options.apiHeaderName?.trim() || 'Authorization';
    this.timeoutMs = Math.min(Math.max(Math.trunc(options.timeoutMs ?? 15_000), 1_000), 60_000);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(context: NotificationSendContext): Promise<NotificationSendResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = new Headers({ 'content-type': 'application/json', accept: 'application/json' });
      if (this.apiToken) headers.set(this.apiHeaderName, this.apiHeaderName.toLowerCase() === 'authorization' ? `Bearer ${this.apiToken}` : this.apiToken);
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}/api/v1/platform/bots/${encodeURIComponent(this.botId)}/send_message`, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({ target_type: this.targetType, target_id: this.recipient, message_chain: [{ type: 'Plain', text: context.text }] }),
        });
      } catch (error) {
        return { status: 'unknown', reason: error instanceof Error && error.name === 'AbortError' ? 'platform response timed out after the request may have been accepted' : 'platform is unavailable' };
      }
      let body: unknown = null;
      try { body = await response.json(); } catch { /* response body is optional */ }
      if (response.status === 429 || response.status >= 500) return { status: 'retryable_failed', reason: `LangBot returned HTTP ${response.status}` };
      if (!response.ok) return { status: 'dead', reason: `LangBot returned HTTP ${response.status}` };
      if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : {};
        if (record.error || record.success === false || record.code === -1 || data.sent === false) return { status: 'dead', reason: 'LangBot rejected the notification' };
        const messageId = [data.messageId, data.message_id, record.messageId, record.message_id].find((value): value is string => typeof value === 'string' && value.length > 0);
        return { status: 'sent', ...(messageId ? { platformMessageId: messageId } : {}) };
      }
      return { status: 'sent' };
    } finally {
      clearTimeout(timer);
    }
  }
}

function normalizePayload(input: NotificationEventInput): Record<string, unknown> {
  const base = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
    ? { ...(input.payload as Record<string, unknown>) }
    : { value: input.payload };
  return {
    ...base,
    principalKey: input.principalKey,
    source: input.source,
    resultType: input.resultType,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
  };
}

export function renderNotification(event: NotificationEventRecord): string {
  const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload as Record<string, unknown> : {};
  const resultType = notificationResultTypeSchema.safeParse(payload.resultType).success
    ? payload.resultType as NotificationResultType
    : 'unknown';
  const source = typeof payload.source === 'string' ? payload.source : 'notification';
  if (payload.evidenceState === 'no_durable_task_evidence') {
    const detail = typeof payload.lastAssistantMessage === 'string' ? payload.lastAssistantMessage.trim().slice(0, 8_000) : '';
    return detail ? `${kurisuNotificationLabels.legacyCodexUnknown}\n\n${detail}` : kurisuNotificationLabels.legacyCodexUnknown;
  }
  const summary = typeof payload.summary === 'string' ? payload.summary.trim().slice(0, 8_000) : `${source} ${event.eventType}`;
  const severity = payload.severity === 'critical' || resultType === 'failure' && payload.serious === true;
  if (severity) return `${kurisuNotificationLabels.serious}${summary}`;
  if (resultType === 'success') return `${kurisuNotificationLabels.success}${summary}`;
  if (resultType === 'failure') return `${kurisuNotificationLabels.failure}${summary}`;
  if (resultType === 'unknown') return `${kurisuNotificationLabels.unknown}${summary}`;
  return summary;
}

function hashForEvent(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex').slice(0, 16);
}
