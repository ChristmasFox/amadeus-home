import { readFile } from 'node:fs/promises';
import type { NotificationChannel, NotificationMessage } from '../../core/notification/ports.js';

export interface LangBotChannelOptions {
  id: string;
  baseUrl: string;
  botId: string;
  recipient: string;
  apiToken?: string;
  apiHeaderName?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class LangBotNotificationChannel implements NotificationChannel {
  readonly id: string;
  readonly recipient: string;
  private readonly baseUrl: string;
  private readonly botId: string;
  private readonly apiToken: string;
  private readonly apiHeaderName: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LangBotChannelOptions) {
    this.id = options.id;
    this.baseUrl = options.baseUrl.replace(/\/$/u, '');
    this.botId = options.botId;
    this.recipient = options.recipient;
    this.apiToken = options.apiToken ?? '';
    this.apiHeaderName = options.apiHeaderName?.trim() || 'Authorization';
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(message: NotificationMessage): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
      if (this.apiToken) headers.set(this.apiHeaderName, this.apiHeaderName.toLowerCase() === 'authorization' ? `Bearer ${this.apiToken}` : this.apiToken);
      const response = await this.fetchImpl(`${this.baseUrl}/api/v1/platform/bots/${encodeURIComponent(this.botId)}/send_message`, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          // LangBot's existing platform API accepts only a person target here;
          // no inbound chat or group id is ever used as a recipient.
          target_type: 'person',
          target_id: this.recipient,
          message_chain: [{ type: 'Plain', text: message.text }],
        }),
      });
      let body: unknown;
      try { body = await response.json(); } catch { body = undefined; }
      if (!response.ok) throw new Error(`LangBot ${this.id} notification failed with HTTP ${response.status}`);
      if (body && typeof body === 'object') {
        const value = body as Record<string, unknown>;
        if (value.error || value.success === false || (typeof value.code === 'number' && value.code !== 0) || (value.data && typeof value.data === 'object' && (value.data as Record<string, unknown>).sent === false)) {
          throw new Error(`LangBot ${this.id} notification was rejected`);
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function readOptionalToken(filePath: string | undefined, envValue: string | undefined): Promise<string | undefined> {
  if (envValue?.trim()) return envValue.trim();
  if (!filePath?.trim()) return undefined;
  try {
    const value = await readFile(filePath.trim(), 'utf8');
    return value.trim() || undefined;
  } catch {
    return undefined;
  }
}
