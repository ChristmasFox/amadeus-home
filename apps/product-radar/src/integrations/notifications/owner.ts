import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NotificationChannel, NotificationMessage } from '../../core/notification/ports.js';

export interface OwnerNotificationEvent {
  version: 1;
  type: 'owner_notification';
  eventType: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  eventKey: string;
  source: string;
  headline: string;
  facts: [];
  summary: string;
  occurredAt: string;
}

type OwnerNotificationInput = Pick<OwnerNotificationEvent, 'eventKey' | 'source' | 'headline' | 'summary' | 'occurredAt'> & {
  eventType?: string;
  severity?: OwnerNotificationEvent['severity'];
};

function fileId(eventKey: string): string {
  return createHash('sha256').update(eventKey).digest('hex').slice(0, 40);
}

function bounded(value: string, max: number): string {
  return value.replace(/[\u0000\r]/gu, '').trim().slice(0, max);
}

export async function enqueueOwnerNotification(
  event: OwnerNotificationInput,
  outboxDir: string,
): Promise<string> {
  const normalized: OwnerNotificationEvent = {
    version: 1,
    type: 'owner_notification',
    eventType: bounded(event.eventType ?? `product_radar_${event.source}`, 128),
    severity: event.severity ?? 'info',
    eventKey: bounded(event.eventKey, 256),
    source: bounded(event.source, 128),
    headline: bounded(event.headline, 200),
    facts: [],
    summary: bounded(event.summary, 16_000),
    occurredAt: bounded(event.occurredAt, 64),
  };
  if (!normalized.eventKey || !normalized.source || !normalized.summary) throw new Error('owner notification requires eventKey, source, and summary');
  await mkdir(outboxDir, { recursive: true, mode: 0o700 });
  const id = fileId(normalized.eventKey);
  const pending = join(outboxDir, `${id}.pending.json`);
  const sent = join(outboxDir, `${id}.sent.json`);
  try {
    await readFile(pending);
    return 'already-pending';
  } catch { /* first enqueue */ }
  try {
    await readFile(sent);
    return 'already-sent';
  } catch { /* not delivered yet */ }
  const temporary = join(outboxDir, `.${id}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(normalized)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    await rename(temporary, pending);
  } catch (error) {
    try { await readFile(pending); } catch { throw error; }
  }
  return 'queued';
}

export class OwnerNotificationChannel implements NotificationChannel {
  readonly id = 'owner-whatsapp';
  readonly recipient = 'owner';

  constructor(private readonly outboxDir: string) {}

  async send(message: NotificationMessage): Promise<void> {
    await enqueueOwnerNotification({
      eventType: `product_radar_${message.event.type}`,
      eventKey: message.event.eventKey,
      source: `product-radar:${message.event.type}`,
      headline: 'Product Radar',
      summary: message.text,
      occurredAt: message.event.occurredAt,
    }, this.outboxDir);
  }
}
