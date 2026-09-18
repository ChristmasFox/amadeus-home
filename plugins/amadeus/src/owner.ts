import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import type { OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import { readRequiredFile, type AmadeusConfig } from './config.js';

export interface OwnerEvent {
  version: 1;
  eventKey: string;
  source: string;
  title: string;
  message: string;
  occurredAt: string;
}

export function isTrustedOwnerContext(context: OpenClawPluginToolContext): boolean {
  const sessionKey = context.sessionKey?.trim() ?? '';
  return context.senderIsOwner === true || sessionKey.startsWith('cron:') || sessionKey.includes(':cron:');
}

function idFor(eventKey: string): string {
  return createHash('sha256').update(eventKey).digest('hex').slice(0, 40);
}

function clean(value: string, max: number): string {
  return value.replace(/[\u0000\r]/gu, '').trim().slice(0, max);
}

function normalize(value: unknown): OwnerEvent {
  if (!value || typeof value !== 'object') throw new Error('invalid owner notification');
  const item = value as Record<string, unknown>;
  const eventKey = clean(String(item.eventKey ?? ''), 256);
  const source = clean(String(item.source ?? ''), 128);
  const title = clean(String(item.title ?? ''), 200);
  const message = clean(String(item.message ?? ''), 16_000);
  const occurredAt = clean(String(item.occurredAt ?? new Date().toISOString()), 64);
  if (!eventKey || !source || !message) throw new Error('owner notification requires eventKey, source, and message');
  return { version: 1, eventKey, source, title, message, occurredAt };
}

export async function enqueueOwnerEvent(event: OwnerEvent, outboxDir: string): Promise<'queued' | 'already-pending' | 'already-sent'> {
  const normalized = normalize(event);
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

function notificationParts(event: OwnerEvent): OwnerEvent[] {
  const chunks = splitMessage(event.message);
  if (chunks.length === 1) return [event];
  return chunks.map((message, index) => ({
    ...event,
    eventKey: `${event.eventKey}:part:${index + 1}/${chunks.length}`,
    title: `${event.title || event.source} (${index + 1}/${chunks.length})`,
    message,
  }));
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
      message: event.title ? `${event.title}\n\n${event.message}` : event.message,
      idempotencyKey: event.eventKey,
    }, { timeoutMs: 20_000 });
  }

  async notify(event: OwnerEvent): Promise<{ status: 'sent' | 'queued'; detail?: string }> {
    const parts = notificationParts(normalize(event));
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
        const event = normalize(JSON.parse(await readFile(pending, 'utf8')) as unknown);
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

export function ownerEvent(input: { eventKey: string; source: string; title: string; message: string; occurredAt?: string }): OwnerEvent {
  return normalize({ version: 1, ...input, occurredAt: input.occurredAt ?? new Date().toISOString() });
}
