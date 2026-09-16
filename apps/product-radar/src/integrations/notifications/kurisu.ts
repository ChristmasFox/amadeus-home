import type { NotificationChannel, NotificationMessage } from '../../core/notification/ports.js';

export interface KurisuNotificationChannelOptions {
  endpoint: string;
  secret: string;
  principalKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Product Radar's local notification_outbox uses this channel only when the
 * central owner is explicitly enabled. The payload contains event facts and
 * rendered text, never a platform recipient; Runtime owns target selection.
 */
export class KurisuNotificationChannel implements NotificationChannel {
  readonly id = 'kurisu-central';
  readonly recipient: string;
  private readonly endpoint: string;
  private readonly secret: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: KurisuNotificationChannelOptions) {
    this.endpoint = options.endpoint.trim();
    this.secret = options.secret.trim();
    this.recipient = options.principalKey.trim();
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    if (!this.endpoint) throw new Error('Kurisu notification endpoint is required');
    if (!this.secret) throw new Error('Kurisu notification secret is required');
    if (!this.recipient) throw new Error('Kurisu notification principal key is required');
  }

  async send(message: NotificationMessage): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-kurisu-notification-secret': this.secret,
        },
        signal: controller.signal,
        body: JSON.stringify({
          eventType: `radar.${message.event.type}`,
          eventKey: message.event.eventKey,
          source: message.event.source,
          resultType: 'info',
          occurredAt: message.event.occurredAt,
          payload: {
            summary: message.text.slice(0, 8_000),
            radarEventId: message.event.id,
            watchId: message.event.watchId,
            radarEventType: message.event.type,
          },
        }),
      });
      if (!response.ok) throw new Error(`Kurisu notification handoff failed with HTTP ${response.status}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
