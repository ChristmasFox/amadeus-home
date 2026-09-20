import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OpenClawPluginApi, OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import type { OwnerNotificationPresentation } from '@agent/presentation';
import { assertValid, renderOwnerNotification, validateOwnerNotificationPresentation } from '@agent/presentation';
import { readRequiredFile, type AmadeusConfig } from './config.js';

export interface OwnerEvent extends OwnerNotificationPresentation {
  version: 1;
}

interface LegacyOwnerEvent {
  eventKey: string;
  source: string;
  title?: string;
  message: string;
  occurredAt?: string;
}

export function isTrustedOwnerContext(context: OpenClawPluginToolContext): boolean {
  const sessionKey = context.sessionKey?.trim() ?? '';
  return context.senderIsOwner === true || sessionKey.startsWith('cron:') || sessionKey.includes(':cron:');
}

function isManualCronContext(context: OpenClawPluginToolContext): boolean {
  return /(?:^|:)run:manual:/u.test(context.sessionKey?.trim() ?? '');
}

const scheduledReportEventKeys = [
  { prefix: 'vps-report', pattern: /^vps-report:\d{4}-\d{2}-\d{2}:(morning|evening)$/u },
  { prefix: 'market-indices', pattern: /^market-indices:\d{4}-\d{2}-\d{2}:(open|close)$/u },
] as const;

function idFor(eventKey: string): string {
  return createHash('sha256').update(eventKey).digest('hex').slice(0, 40);
}

function clean(value: string, max: number): string {
  return value.replace(/[\u0000\r]/gu, '').trim().slice(0, max);
}

function legacyPresentation(item: Record<string, unknown>): OwnerNotificationPresentation {
  const eventKey = clean(String(item.eventKey ?? ''), 256);
  const source = clean(String(item.source ?? ''), 128);
  const title = clean(String(item.title ?? ''), 200);
  const message = clean(String(item.message ?? ''), 16_000);
  const occurredAt = clean(String(item.occurredAt ?? new Date().toISOString()), 64);
  if (!eventKey || !source || !message) throw new Error('owner notification requires eventKey, source, and message');
  const hasClosing = /El Psy Kongroo\.\s*$/u.test(message);
  const summary = message.replace(/\s*El Psy Kongroo\.\s*$/u, '').trim();
  return assertValid(validateOwnerNotificationPresentation({
    type: 'owner_notification',
    eventType: source,
    severity: 'info',
    significance: 'notable',
    theme: 'worldline_observation',
    eventKey,
    source,
    headline: title || source,
    facts: [],
    ...(summary ? { summary } : {}),
    occurredAt,
    ...(hasClosing ? { worldLineClosing: true } : {}),
  }));
}

function normalizeStructured(value: unknown): OwnerEvent {
  if (!value || typeof value !== 'object') throw new Error('invalid owner notification');
  const item = value as Record<string, unknown>;
  const candidate = item.type === 'owner_notification'
    ? value
    : item.presentation && typeof item.presentation === 'object'
      ? item.presentation
      : undefined;
  if (candidate) {
    const presentation = assertValid(validateOwnerNotificationPresentation(candidate));
    return { version: 1, ...presentation };
  }
  throw new Error('invalid owner notification: structured presentation required');
}

function normalizePending(value: unknown): OwnerEvent {
  try {
    return normalizeStructured(value);
  } catch (error) {
    if (!value || typeof value !== 'object') throw error;
    return { version: 1, ...legacyPresentation(value as Record<string, unknown>) };
  }
}

export async function enqueueOwnerEvent(event: OwnerEvent, outboxDir: string): Promise<'queued' | 'already-pending' | 'already-sent'> {
  const normalized = normalizeStructured(event);
  await mkdir(outboxDir, { recursive: true, mode: 0o700 });
  const id = idFor(normalized.eventKey);
  const pending = join(outboxDir, `${id}.pending.json`);
  const sent = join(outboxDir, `${id}.sent.json`);
  for (const [path, result] of [[pending, 'already-pending'], [sent, 'already-sent']] as const) {
    try { await readFile(path); return result; } catch { /* continue */ }
  }
  const temporary = join(outboxDir, `.${id}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(normalized)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    await rename(temporary, pending);
  } catch (error) {
    try { await readFile(pending); } catch { throw error; }
  }
  return 'queued';
}

async function hasFile(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function markSent(event: OwnerEvent, outboxDir: string): Promise<void> {
  const id = idFor(event.eventKey);
  const target = join(outboxDir, `${id}.sent.json`);
  if (await hasFile(target)) return;
  const temporary = join(outboxDir, `.${id}.${process.pid}.${Date.now()}.sent.tmp`);
  await writeFile(temporary, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    await rename(temporary, target);
  } catch (error) {
    if (!(await hasFile(target))) throw error;
  }
}

function splitMessage(message: string, limit = 2_800): string[] {
  if (message.length <= limit) return [message];
  const chunks: string[] = [];
  let remaining = message;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf('\n', limit);
    if (cut < Math.floor(limit * 0.55)) cut = limit;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

type NotificationUnit =
  | { kind: 'summary'; value: string }
  | { kind: 'fact'; value: OwnerNotificationPresentation['facts'][number] };

function eventFromUnits(event: OwnerEvent, units: NotificationUnit[], index: number, total: number): OwnerEvent {
  const summary = units.filter((unit): unit is Extract<NotificationUnit, { kind: 'summary' }> => unit.kind === 'summary').map((unit) => unit.value).join('\n');
  const facts = units.filter((unit): unit is Extract<NotificationUnit, { kind: 'fact' }> => unit.kind === 'fact').map((unit) => unit.value);
  const part: OwnerNotificationPresentation = {
    type: 'owner_notification',
    eventType: event.eventType,
    severity: event.severity,
    significance: event.significance,
    theme: event.theme,
    eventKey: `${event.eventKey}:part:${index + 1}/${total}`,
    source: event.source,
    headline: `${event.headline} (${index + 1}/${total})`,
    facts,
    ...(index === total - 1 && event.links?.length ? { links: event.links } : {}),
    ...(summary ? { summary } : {}),
    ...(event.dataUpdatedAt ? { dataUpdatedAt: event.dataUpdatedAt } : {}),
    occurredAt: event.occurredAt,
    ...(index === total - 1 && event.worldLineClosing ? { worldLineClosing: true } : {}),
  };
  return { version: 1, ...assertValid(validateOwnerNotificationPresentation(part)) };
}

export function notificationParts(event: OwnerEvent): OwnerEvent[] {
  const rendered = renderOwnerNotification(event, { now: event.occurredAt });
  if (rendered.length <= 2_800) return [event];
  const units: NotificationUnit[] = [
    ...(event.summary ? splitMessage(event.summary, 2_000).map((value) => ({ kind: 'summary' as const, value })) : []),
    ...event.facts.map((value) => ({ kind: 'fact' as const, value })),
  ];
  if (!units.length) return [event];

  const groups: NotificationUnit[][] = [];
  let current: NotificationUnit[] = [];
  for (const unit of units) {
    const candidate = [...current, unit];
    const renderedCandidate = eventFromUnits(event, candidate, groups.length, units.length);
    if (current.length && renderOwnerNotification(renderedCandidate, { now: event.occurredAt }).length > 2_800) {
      groups.push(current);
      current = [unit];
    } else {
      current = candidate;
    }
  }
  if (current.length) groups.push(current);

  return groups.map((group, index) => eventFromUnits(event, group, index, groups.length));
}

interface GatewayRuntime {
  request(method: string, params: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export class OwnerNotifier {
  private targetPromise: Promise<string> | undefined;

  constructor(private readonly api: OpenClawPluginApi, private readonly config: AmadeusConfig) {}

  private async target(): Promise<string> {
    this.targetPromise ??= readRequiredFile(this.config.ownerTargetFile, 'WhatsApp owner target');
    const value = await this.targetPromise;
    if (!/^whatsapp:\+?[0-9A-Za-z._:@-]+$/u.test(value) && !/^\+?[0-9][0-9 .()-]{5,31}$/u.test(value)) {
      throw new Error('WhatsApp owner target has an invalid format');
    }
    return value;
  }

  private async send(event: OwnerEvent): Promise<unknown> {
    const target = await this.target();
    const runtime = this.api.runtime.gateway as unknown as GatewayRuntime;
    return runtime.request('send', {
      channel: 'whatsapp',
      to: target,
      accountId: this.config.ownerWhatsappAccountId,
      message: renderOwnerNotification(event, { now: event.occurredAt }),
      idempotencyKey: event.eventKey,
    }, { timeoutMs: 20_000 });
  }

  async notify(event: OwnerEvent): Promise<{ status: 'sent' | 'queued'; detail?: string }> {
    const parts = notificationParts(normalizeStructured(event));
    let queued = 0;
    let sent = 0;
    for (const part of parts) {
      const id = idFor(part.eventKey);
      if (await hasFile(join(this.config.notificationOutboxDir, `${id}.sent.json`))) continue;
      if (await hasFile(join(this.config.notificationOutboxDir, `${id}.pending.json`))) {
        queued += 1;
        continue;
      }
      try {
        await this.send(part);
        try { await markSent(part, this.config.notificationOutboxDir); } catch (error) {
          this.api.logger.warn(`amadeus owner sent marker failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        sent += 1;
      } catch {
        await enqueueOwnerEvent(part, this.config.notificationOutboxDir);
        queued += 1;
      }
    }
    return queued > 0
      ? { status: 'queued', detail: 'WhatsApp delivery will be retried by OpenClaw' }
      : { status: 'sent', ...(sent === 0 ? { detail: 'already delivered' } : {}) };
  }

  async drain(limit = 20): Promise<number> {
    await mkdir(this.config.notificationOutboxDir, { recursive: true, mode: 0o700 });
    const names = (await readdir(this.config.notificationOutboxDir)).filter((name) => name.endsWith('.pending.json')).sort().slice(0, limit);
    let sent = 0;
    for (const name of names) {
      const pending = join(this.config.notificationOutboxDir, name);
      try {
        const event = normalizePending(JSON.parse(await readFile(pending, 'utf8')) as unknown);
        const sentPath = join(this.config.notificationOutboxDir, name.replace(/\.pending\.json$/u, '.sent.json'));
        if (await hasFile(sentPath)) {
          await rename(pending, sentPath);
          continue;
        }
        await this.send(event);
        await rename(pending, sentPath);
        sent += 1;
      } catch (error) {
        this.api.logger.warn(`amadeus owner notification retry failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return sent;
  }
}

export function ownerEvent(input: OwnerNotificationPresentation): OwnerEvent {
  return normalizeStructured(input);
}

export function ownerEventForContext(
  input: OwnerNotificationPresentation,
  context: OpenClawPluginToolContext,
): OwnerEvent {
  const event = ownerEvent(input);
  if (!isManualCronContext(context)) return event;
  for (const scheduled of scheduledReportEventKeys) {
    const match = event.eventKey.match(scheduled.pattern);
    if (match) return { ...event, eventKey: `${scheduled.prefix}:manual:${event.occurredAt}:${match[1]}` };
  }
  return event;
}
