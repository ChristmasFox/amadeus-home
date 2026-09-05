import { NormalizedBotMessageSchema, normalizeChatType, type NormalizedBotMessage, type PlatformAdapter } from '../core/contracts.js';

export interface KookEvent {
  channel_type?: string;
  target_id?: string;
  author_id?: string;
  msg_id?: string;
  message_id?: string;
  content?: string;
  text_message?: string;
  timestamp?: string | number;
  extra?: { name?: string; code?: string };
  reply_msg_id?: string;
  reply_to_message_id?: string;
}
function timestamp(value: KookEvent['timestamp']): string {
  if (typeof value === 'number') return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

export class KookAdapter implements PlatformAdapter<KookEvent> {
  readonly platform = 'kook' as const;

  constructor(private readonly botId = 'kook-bot') {}

  normalize(event: KookEvent): NormalizedBotMessage {
    return NormalizedBotMessageSchema.parse({
      version: 1,
      platform: 'kook',
      botId: this.botId,
      user: {
        platform: 'kook',
        platformUserId: String(event.author_id ?? 'unknown'),
        internalUserId: null,
        displayName: null,
      },
      chat: {
        type: normalizeChatType(event.channel_type),
        id: String(event.target_id ?? event.author_id ?? 'unknown'),
        name: event.extra?.name ?? null,
      },
      message: {
        id: String(event.msg_id ?? event.message_id ?? 'unknown-message'),
        text: String(event.text_message ?? event.content ?? ''),
        replyToMessageId: event.reply_msg_id ?? event.reply_to_message_id ?? null,
      },
      mentions: [],
      attachments: [],
      timestamp: timestamp(event.timestamp),
    });
  }
}
