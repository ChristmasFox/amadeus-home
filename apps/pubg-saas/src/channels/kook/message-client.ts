import { randomUUID } from 'node:crypto';
import { validateKookMessagePayload, type KookGroupMessageSender, type KookTextPayload } from '../../application/kook-message-queue.js';
import type { KookDailyMessageBudget } from '../../application/kook-daily-message-budget.js';
import { KookRateLimitGate } from './rate-limit-gate.js';

interface KookApiEnvelope {
  code: number;
  data?: unknown;
}

export interface KookMessageApiClientOptions {
  token: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  rateLimitGate?: KookRateLimitGate;
  dailyBudget?: KookDailyMessageBudget;
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

function rateLimitedError(retryAfterMs: number): Error & { code: string; retryAfterMs: number } {
  return Object.assign(new Error('kook_message_api_rate_limited'), {
    code: 'kook_message_api_rate_limited',
    retryAfterMs,
  });
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
  private readonly rateLimitGate: KookRateLimitGate;
  private readonly dailyBudget: KookDailyMessageBudget | undefined;

  constructor(options: KookMessageApiClientOptions) {
    this.token = requiredText(options.token, 'token', 4096);
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) throw new Error('kook_message_timeout_invalid');
    this.rateLimitGate = options.rateLimitGate ?? new KookRateLimitGate();
    this.dailyBudget = options.dailyBudget;
  }

  async send(channelIdInput: string, payload: KookTextPayload, nonceInput: string, replyToMessageId?: string | null): Promise<void> {
    return this.sendTo('message', channelIdInput, payload, nonceInput, replyToMessageId);
  }

  async sendDirect(userId: string, payload: KookTextPayload, nonce: string, replyToMessageId?: string | null): Promise<void> {
    return this.sendTo('direct-message', userId, payload, nonce, replyToMessageId);
  }

  async pruneDailyBudgetReservations(): Promise<void> {
    await this.dailyBudget?.prune();
  }

  private async sendTo(kind: 'message' | 'direct-message', targetIdInput: string, payloadInput: KookTextPayload, nonceInput: string, replyToMessageId?: string | null): Promise<void> {
    const route = `/api/v3/${kind}/create`;
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
    const localWait = this.rateLimitGate.waitMs(route);
    if (localWait > 0) throw rateLimitedError(localWait);
    const budgetReservationId = this.dailyBudget ? randomUUID() : null;
    if (budgetReservationId) await this.dailyBudget!.reserve(budgetReservationId);
    let response: Response;
    try {
      response = await this.fetcher(`https://www.kookapp.cn${route}`, {
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
      // A timeout can happen after KOOK accepted the send, so keep the
      // reservation until the quota window rolls over.
      throw codedError('kook_message_api_unavailable');
    }
    const retryAfterMs = this.rateLimitGate.observe(route, response.headers, response.status);
    if (response.status === 429) {
      if (budgetReservationId) await this.releaseKnownFailure(budgetReservationId);
      throw rateLimitedError(retryAfterMs ?? 60_000);
    }
    if (!response.ok) {
      if (response.status < 500 && budgetReservationId) await this.releaseKnownFailure(budgetReservationId);
      throw codedError(`kook_message_api_http_${response.status}`);
    }
    let result: unknown;
    try { result = await response.json(); } catch { throw codedError('kook_message_response_invalid'); }
    try { parseEnvelope(result); }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'kook_message_api_rejected')
        if (budgetReservationId) await this.releaseKnownFailure(budgetReservationId);
      throw error;
    }
    if (budgetReservationId) await this.dailyBudget!.markSent(budgetReservationId);
  }

  private async releaseKnownFailure(reservationId: string): Promise<void> {
    try { await this.dailyBudget?.release(reservationId); }
    catch { /* retain the reservation if its release cannot be recorded */ }
  }
}
