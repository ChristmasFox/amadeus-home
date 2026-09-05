import type { BotResponse, BotResponseMessage, PlatformSender } from '../core/contracts.js';

export interface WhatsAppGraphApiOptions {
  accessToken: string;
  phoneNumberId: string;
  apiVersion?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface WhatsAppSendTarget {
  phoneNumber: string;
}

export interface WhatsAppGraphApiResponse {
  messaging_product?: string;
  contacts?: Array<{ input?: string; wa_id?: string }>;
  messages?: Array<{ id?: string; message_status?: string }>;
  [key: string]: unknown;
}

export const WHATSAPP_MAX_TEXT_LENGTH = 4096;

function required(value: string, name: string): string {
  const result = String(value ?? '').trim();
  if (!result) throw new Error(`whatsapp ${name} is required`);
  return result;
}

function normalizeTarget(target: string | WhatsAppSendTarget): string {
  const value = typeof target === 'string' ? target : target.phoneNumber;
  return required(value, 'recipient phone number');
}

export function splitWhatsAppText(value: string): string[] {
  const text = required(value, 'outbound text');
  const characters = [...text];
  const chunks: string[] = [];
  for (let offset = 0; offset < characters.length; offset += WHATSAPP_MAX_TEXT_LENGTH) {
    chunks.push(characters.slice(offset, offset + WHATSAPP_MAX_TEXT_LENGTH).join(''));
  }
  return chunks;
}

function replyContext(replyTo: string | null): { message_id: string } | undefined {
  return replyTo ? { message_id: replyTo } : undefined;
}

/** Build the text-only Cloud API request used in phase one. */
export function whatsappTextPayload(to: string | WhatsAppSendTarget, message: BotResponseMessage, replyTo: string | null = null): Record<string, unknown> {
  if (message.type !== 'text') throw new Error(`whatsapp phase one only supports text outbound, got ${message.type}`);
  if (message.buttons?.length) throw new Error('whatsapp phase one does not support buttons');
  const text = required(message.text ?? '', 'outbound text');
  if ([...text].length > WHATSAPP_MAX_TEXT_LENGTH) {
    throw new Error(`whatsapp outbound text exceeds ${WHATSAPP_MAX_TEXT_LENGTH} characters`);
  }
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizeTarget(to),
    type: 'text',
    text: { preview_url: false, body: text },
    ...(replyContext(replyTo) ? { context: replyContext(replyTo) } : {}),
  };
}

export class WhatsAppCloudApiClient implements PlatformSender<string | WhatsAppSendTarget> {
  private readonly accessToken: string;
  private readonly phoneNumberId: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: WhatsAppGraphApiOptions);
  constructor(accessToken: string, phoneNumberId: string, options?: Omit<WhatsAppGraphApiOptions, 'accessToken' | 'phoneNumberId'>);
  constructor(
    optionsOrToken: WhatsAppGraphApiOptions | string,
    phoneNumberId?: string,
    extra: Omit<WhatsAppGraphApiOptions, 'accessToken' | 'phoneNumberId'> = {},
  ) {
    const options: WhatsAppGraphApiOptions = typeof optionsOrToken === 'string'
      ? { ...extra, accessToken: optionsOrToken, phoneNumberId: phoneNumberId ?? '' }
      : optionsOrToken;
    this.accessToken = required(options.accessToken, 'access token');
    this.phoneNumberId = required(options.phoneNumberId, 'phone number id');
    const baseUrl = String(options.baseUrl ?? 'https://graph.facebook.com').replace(/\/+$/u, '');
    const apiVersion = String(options.apiVersion ?? 'v23.0').replace(/^\/+|\/+$/gu, '');
    if (!apiVersion) throw new Error('whatsapp graph api version is required');
    this.endpoint = `${baseUrl}/${apiVersion}/${encodeURIComponent(this.phoneNumberId)}/messages`;
    this.fetchImpl = options.fetch ?? fetch;
    const timeoutMs = Number(options.timeoutMs ?? 30_000);
    this.timeoutMs = Number.isFinite(timeoutMs) ? Math.max(1, timeoutMs) : 30_000;
  }

  async send(target: string | WhatsAppSendTarget, response: BotResponse): Promise<void> {
    let isFirstMessage = true;
    for (const message of response.messages) {
      if (message.type !== 'text') {
        await this.sendMessage(target, message, isFirstMessage ? response.replyTo : null);
        isFirstMessage = false;
        continue;
      }
      for (const text of splitWhatsAppText(message.text ?? '')) {
        await this.sendMessage(
          target,
          { ...message, text },
          isFirstMessage ? response.replyTo : null,
        );
        isFirstMessage = false;
      }
    }
  }

  async sendMessage(target: string | WhatsAppSendTarget, message: BotResponseMessage, replyTo: string | null = null): Promise<WhatsAppGraphApiResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(whatsappTextPayload(target, message, replyTo)),
        signal: controller.signal,
      });
      const bodyText = await response.text();
      let body: unknown = {};
      if (bodyText) {
        try { body = JSON.parse(bodyText); } catch { body = { raw: bodyText.slice(0, 500) }; }
      }
      if (!response.ok) {
        const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
        const error = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : {};
        throw new Error(`whatsapp graph api ${response.status}: ${String(error.message ?? record.raw ?? 'request failed')}`);
      }
      return body && typeof body === 'object' ? body as WhatsAppGraphApiResponse : {};
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class WhatsAppCloudApiSender extends WhatsAppCloudApiClient {}
export class WhatsAppSender extends WhatsAppCloudApiClient {}
