import { NormalizedBotMessageSchema, normalizeChatType, type NormalizedBotMessage, type PlatformAdapter } from '../core/contracts.js';

export interface TelegramUser {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number | string;
  type: 'private' | 'group' | 'supergroup' | 'channel' | string;
  title?: string;
}

export interface TelegramMessage {
  message_id: number | string;
  date?: number;
  text?: string;
  from?: TelegramUser;
  chat: TelegramChat;
  reply_to_message?: { message_id?: number | string };
}

export interface TelegramUpdate {
  update_id?: number | string;
  message?: TelegramMessage;
  callback_query?: {
    id?: string;
    data?: string;
    from?: TelegramUser;
    message?: TelegramMessage;
  };
}

function displayName(user: TelegramUser): string | null {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return name || user.username || null;
}

export class TelegramAdapter implements PlatformAdapter<TelegramUpdate> {
  readonly platform = 'telegram' as const;

  constructor(private readonly botId = 'telegram-bot') {}

  normalize(update: TelegramUpdate): NormalizedBotMessage {
    const callback = update.callback_query;
    const message = update.message ?? callback?.message;
    // In a callback update `message.from` is the bot that authored the picker;
    // the clicking member is `callback_query.from`.
    const sender = callback?.from ?? message?.from;
    if (!message || !message.chat || !sender) throw new Error('invalid telegram message event');
    const userName = displayName(sender);
    return NormalizedBotMessageSchema.parse({
      version: 1,
      platform: 'telegram',
      botId: this.botId,
      user: {
        platform: 'telegram',
        platformUserId: String(sender.id),
        internalUserId: null,
        displayName: userName,
      },
      chat: {
        type: normalizeChatType(message.chat.type),
        id: String(message.chat.id),
        name: message.chat.title ?? userName,
      },
      message: {
        id: String(message.message_id),
        text: String(message.text ?? ''),
        replyToMessageId: message.reply_to_message?.message_id === undefined ? null : String(message.reply_to_message.message_id),
      },
      mentions: [],
      attachments: [],
      timestamp: new Date((message.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      ...(callback?.data ? { callback: { id: callback.id ?? null, data: callback.data } } : {}),
    });
  }
}
