import { NormalizedBotMessageSchema, type NormalizedBotMessage, type PlatformAdapter } from '../core/contracts.js';

export const WHATSAPP_WEBHOOK_OBJECT = 'whatsapp_business_account' as const;

export interface WhatsAppContact {
  wa_id?: string;
  profile?: { name?: string };
}

export interface WhatsAppMetadata {
  display_phone_number?: string;
  phone_number_id?: string;
}

export interface WhatsAppWebhookText {
  body?: string;
}

export interface WhatsAppWebhookMessage {
  id?: string;
  from?: string;
  timestamp?: string | number;
  type?: string;
  text?: WhatsAppWebhookText;
  context?: { id?: string; from?: string };
}

export interface WhatsAppWebhookValue {
  messaging_product?: string;
  metadata?: WhatsAppMetadata;
  contacts?: WhatsAppContact[];
  messages?: WhatsAppWebhookMessage[];
}

export interface WhatsAppWebhookChange {
  field?: string;
  value?: WhatsAppWebhookValue;
}

export interface WhatsAppWebhookEntry {
  id?: string;
  changes?: WhatsAppWebhookChange[];
}

export interface WhatsAppWebhookPayload {
  object?: string;
  entry?: WhatsAppWebhookEntry[];
}

export interface WhatsAppAdapterOptions {
  botId?: string;
}

type MessageRecord = {
  message: WhatsAppWebhookMessage;
  value: WhatsAppWebhookValue;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function displayName(message: WhatsAppWebhookMessage, value: WhatsAppWebhookValue): string | null {
  const senderId = textOrNull(message.from);
  const contact = value.contacts?.find((candidate) => textOrNull(candidate.wa_id) === senderId);
  return textOrNull(contact?.profile?.name);
}

function timestamp(value: WhatsAppWebhookMessage['timestamp']): string {
  const numeric = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date((numeric > 10_000_000_000 ? numeric : numeric * 1000)).toISOString();
  }
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function recordsFromPayload(input: unknown): MessageRecord[] {
  const payload = asRecord(input);
  if (!payload) throw new Error('invalid whatsapp webhook payload');
  if (payload.object !== WHATSAPP_WEBHOOK_OBJECT) {
    throw new Error(`unsupported whatsapp webhook object: ${String(payload.object)}`);
  }
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  const records: MessageRecord[] = [];
  for (const rawEntry of entries) {
    const entry = asRecord(rawEntry);
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const rawChange of changes) {
      const change = asRecord(rawChange);
      const value = asRecord(change?.value);
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      for (const rawMessage of messages) {
        const message = asRecord(rawMessage) as WhatsAppWebhookMessage | null;
        if (message && String(message.type ?? '').toLowerCase() === 'text') {
          records.push({ message, value: value as WhatsAppWebhookValue });
        }
      }
    }
  }
  return records;
}

export class WhatsAppAdapter implements PlatformAdapter<WhatsAppWebhookPayload> {
  readonly platform = 'whatsapp' as const;
  private readonly configuredBotId: string | null;

  constructor(options: string | WhatsAppAdapterOptions = {}) {
    const botId = typeof options === 'string' ? options : options.botId;
    this.configuredBotId = textOrNull(botId);
  }

  normalizeAll(payload: WhatsAppWebhookPayload): NormalizedBotMessage[] {
    return recordsFromPayload(payload).map(({ message, value }) => {
      const senderId = textOrNull(message.from);
      const messageId = textOrNull(message.id);
      if (!senderId || !messageId) throw new Error('invalid whatsapp message: from and id are required');
      const name = displayName(message, value);
      const botId = this.configuredBotId ?? textOrNull(value.metadata?.phone_number_id) ?? 'whatsapp-cloud-api';
      return NormalizedBotMessageSchema.parse({
        version: 1,
        platform: 'whatsapp',
        botId,
        user: {
          platform: 'whatsapp',
          platformUserId: senderId,
          internalUserId: null,
          displayName: name,
        },
        chat: {
          type: 'private',
          id: senderId,
          name,
        },
        message: {
          id: messageId,
          text: String(message.text?.body ?? ''),
          replyToMessageId: textOrNull(message.context?.id),
        },
        mentions: [],
        attachments: [],
        timestamp: timestamp(message.timestamp),
      });
    });
  }

  normalize(payload: WhatsAppWebhookPayload): NormalizedBotMessage {
    const first = this.normalizeAll(payload)[0];
    if (!first) throw new Error('invalid whatsapp webhook message: no inbound messages');
    return first;
  }
}
