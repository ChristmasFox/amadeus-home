import { validateKookMessagePayload, type KookGroupMessageSender, type KookTextPayload } from '../../application/kook-message-queue.js';

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

/** Fixed official KOOK channel/direct-message endpoints. The caller supplies the
 * destination from the durable, trusted inbox row; payloads cannot choose it. */
export class KookMessageApiClient implements KookGroupMessageSender {
  private readonly token: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: KookMessageApiClientOptions) {
    this.token = requiredText(options.token, 'token', 4096);
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) throw new Error('kook_message_timeout_invalid');
  }

  async send(channelIdInput: string, payload: KookTextPayload, nonceInput: string, replyToMessageId?: string | null): Promise<void> {
    return this.sendTo('message', channelIdInput, payload, nonceInput, replyToMessageId);
  }

  async sendDirect(userId: string, payload: KookTextPayload, nonce: string, replyToMessageId?: string | null): Promise<void> {
    return this.sendTo('direct-message', userId, payload, nonce, replyToMessageId);
  }

  private async sendTo(kind: 'message' | 'direct-message', targetIdInput: string, payloadInput: KookTextPayload, nonceInput: string, replyToMessageId?: string | null): Promise<void> {
    const targetId = requiredText(targetIdInput, 'target_id', 128);
    const nonce = requiredText(nonceInput, 'nonce', 64);
    let payload: KookTextPayload;
    try { payload = validateKookMessagePayload(payloadInput); } catch { throw codedError('kook_message_payload_invalid'); }
    const body = new URLSearchParams({
      target_id: targetId,
      type: payload.type === 'text' ? '1' : payload.type === 'kmarkdown' ? '9' : '10',
      content: payload.content,
      nonce,
    });
    if (replyToMessageId) {
      const messageId = requiredText(replyToMessageId, 'reply_message_id', 256);
      body.set('quote', messageId);
      body.set('reply_msg_id', messageId);
    }
    let response: Response;
    try {
      response = await this.fetcher(`https://www.kookapp.cn/api/v3/${kind}/create`, {
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
