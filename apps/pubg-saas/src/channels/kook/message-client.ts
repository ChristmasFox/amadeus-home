import type { KookGroupMessageSender, KookTextPayload } from '../../application/kook-message-queue.js';

interface KookApiEnvelope {
  code: number;
  data?: unknown;
}

export interface KookMessageApiClientOptions {
  token: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

function requiredText(value: string, key: string, maxLength = 256): string {
  if (typeof value !== 'string') throw new Error(`kook_${key}_invalid`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`kook_${key}_invalid`);
  return normalized;
}

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function parseEnvelope(value: unknown): KookApiEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw codedError('kook_message_response_invalid');
  const candidate = value as Record<string, unknown>;
  if (candidate.code !== 0) throw codedError('kook_message_api_rejected');
  return { code: 0, ...(candidate.data !== undefined ? { data: candidate.data } : {}) };
}

/** Fixed official KOOK group-message endpoint. The caller supplies the
 * destination from the durable, trusted inbox row; payloads cannot choose it. */
export class KookMessageApiClient implements KookGroupMessageSender {
  private readonly token: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly endpoint = 'https://www.kookapp.cn/api/v3/message/create';

  constructor(options: KookMessageApiClientOptions) {
    this.token = requiredText(options.token, 'token', 4096);
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) throw new Error('kook_message_timeout_invalid');
  }

  async send(channelIdInput: string, payload: KookTextPayload, nonceInput: string, replyToMessageId?: string | null): Promise<void> {
    const channelId = requiredText(channelIdInput, 'channel_id', 128);
    const nonce = requiredText(nonceInput, 'nonce', 64);
    if (!payload || (payload.type !== 'text' && payload.type !== 'kmarkdown')
      || typeof payload.content !== 'string' || !payload.content.trim() || payload.content.length > 8000) {
      throw codedError('kook_message_payload_invalid');
    }
    const body = new URLSearchParams({
      target_id: channelId,
      type: payload.type === 'text' ? '1' : '9',
      content: payload.content,
      nonce,
    });
    if (replyToMessageId) body.set('reply_msg_id', requiredText(replyToMessageId, 'reply_message_id', 256));
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${this.token}`,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw codedError('kook_message_api_unavailable');
    }
    if (!response.ok) throw codedError(`kook_message_api_http_${response.status}`);
    let result: unknown;
    try { result = await response.json(); } catch { throw codedError('kook_message_response_invalid'); }
    parseEnvelope(result);
  }
}
