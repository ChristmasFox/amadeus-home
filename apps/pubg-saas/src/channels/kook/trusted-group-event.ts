const verifiedGroupEvent = Symbol('verified-kook-group-event');
const verifiedDirectEvent = Symbol('verified-kook-direct-event');

export interface TrustedKookGroupMessage {
  readonly [verifiedGroupEvent]: true;
  platform: 'kook';
  botAccountId: string;
  guildId: string;
  channelId: string;
  userId: string;
  messageId: string;
  timestamp: number;
  content: string;
  /** ID from KOOK quote metadata; message content from the quote is never trusted. */
  quotedMessageId: string | null;
  /** User IDs taken only from KOOK's validated mention metadata. */
  mentionedUserIds: string[];
}

export interface TrustedKookDirectMessage {
  readonly [verifiedDirectEvent]: true;
  platform: 'kook';
  botAccountId: string;
  userId: string;
  messageId: string;
  timestamp: number;
  content: string;
}

export type TrustedKookGroupRejectReason =
  | 'bot_account_invalid'
  | 'envelope_invalid'
  | 'message_type_unsupported'
  | 'extra_invalid'
  | 'channel_not_text'
  | 'author_missing'
  | 'author_invalid'
  | 'author_is_bot'
  | 'actor_id_invalid'
  | 'actor_id_mismatch'
  | 'guild_id_invalid'
  | 'channel_id_invalid'
  | 'message_id_invalid'
  | 'content_invalid'
  | 'content_too_long'
  | 'timestamp_invalid';

export type TrustedKookGroupInspection =
  | { event: TrustedKookGroupMessage }
  | { reason: TrustedKookGroupRejectReason };

function text(value: unknown, maxLength = 256): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

/** Removes transport mention identifiers before chat text is sent to a public
 * model. Trusted mention IDs remain separately available to server tools. */
export function sanitizeKookMentionMarkup(content: string): string {
  return content
    .replace(/<@!?[^>]{1,128}>/gu, '@成员')
    .replace(/\(met\)[^()\s]{1,128}\(met\)/gu, '@成员');
}

/** Parses only KOOK's documented group message event shape. Role IDs in the
 * event are deliberately discarded; management actions recheck via HTTP. */
export function inspectTrustedKookGroupMessage(value: unknown, botAccountIdInput: string): TrustedKookGroupInspection {
  const botAccountId = text(botAccountIdInput, 128);
  if (!botAccountId) return { reason: 'bot_account_invalid' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { reason: 'envelope_invalid' };
  const envelope = value as Record<string, unknown>;
  if (envelope.s !== 0 || !envelope.d || typeof envelope.d !== 'object' || Array.isArray(envelope.d)) return { reason: 'envelope_invalid' };
  const data = envelope.d as Record<string, unknown>;
  if (data.channel_type !== 'GROUP' || (data.type !== 1 && data.type !== 9)) return { reason: 'message_type_unsupported' };
  const extra = data.extra;
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return { reason: 'extra_invalid' };
  const metadata = extra as Record<string, unknown>;
  if (metadata.channel_type !== 1) return { reason: 'channel_not_text' };
  const author = metadata.author;
  if (!author || typeof author !== 'object' || Array.isArray(author)) return { reason: 'author_missing' };
  const authorInfo = author as Record<string, unknown>;
  if (authorInfo.bot === true) return { reason: 'author_is_bot' };
  const userId = text(data.author_id, 128);
  if (!userId) return { reason: 'actor_id_invalid' };
  if (userId === botAccountId) return { reason: 'author_is_bot' };
  const authorId = text(authorInfo.id, 128);
  if (!authorId) return { reason: 'author_invalid' };
  if (authorId !== userId) return { reason: 'actor_id_mismatch' };
  const guildId = text(metadata.guild_id, 128);
  const channelId = text(data.target_id, 128);
  const messageId = text(data.msg_id, 256);
  const content = typeof data.content === 'string' ? data.content : null;
  const timestamp = data.msg_timestamp;
  if (!guildId) return { reason: 'guild_id_invalid' };
  if (!channelId) return { reason: 'channel_id_invalid' };
  if (!messageId) return { reason: 'message_id_invalid' };
  if (content === null || !content.trim()) return { reason: 'content_invalid' };
  if (content.length > 8192) return { reason: 'content_too_long' };
  if (typeof timestamp !== 'number' || !Number.isSafeInteger(timestamp) || timestamp <= 0) return { reason: 'timestamp_invalid' };
  const rawMentions = metadata.mention;
  const mentionedUserIds = Array.isArray(rawMentions) && rawMentions.length <= 32
    ? [...new Set(rawMentions.filter((item): item is string => typeof item === 'string' && Boolean(text(item, 128))
      && item.trim() !== botAccountId).map(item => item.trim()))].slice(0, 20)
    : [];
  const rawQuote = metadata.quote;
  const quote = rawQuote && typeof rawQuote === 'object' && !Array.isArray(rawQuote)
    ? rawQuote as Record<string, unknown> : null;
  const quotedMessageId = text(quote?.msg_id ?? quote?.id, 256);
  return { event: {
    [verifiedGroupEvent]: true,
    platform: 'kook',
    botAccountId,
    guildId,
    channelId,
    userId,
    messageId,
    timestamp,
    content,
    quotedMessageId,
    mentionedUserIds,
  } };
}

export function parseTrustedKookGroupMessage(value: unknown, botAccountIdInput: string): TrustedKookGroupMessage | null {
  const inspection = inspectTrustedKookGroupMessage(value, botAccountIdInput);
  return 'event' in inspection ? inspection.event : null;
}

/** Parses a direct user message addressed to this configured bot. KOOK's
 * PERSON events have no guild scope, so this context can only support actions
 * that are explicitly user-scoped, such as a self-declared account claim. */
export function parseTrustedKookDirectMessage(value: unknown, botAccountIdInput: string): TrustedKookDirectMessage | null {
  const botAccountId = text(botAccountIdInput, 128);
  if (!botAccountId || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (envelope.s !== 0 || !envelope.d || typeof envelope.d !== 'object' || Array.isArray(envelope.d)) return null;
  const data = envelope.d as Record<string, unknown>;
  if (data.channel_type !== 'PERSON' || (data.type !== 1 && data.type !== 9)) return null;
  const userId = text(data.author_id, 128);
  const targetId = text(data.target_id, 128);
  const messageId = text(data.msg_id, 256);
  const content = typeof data.content === 'string' ? data.content : null;
  const timestamp = data.msg_timestamp;
  if (!userId || userId === botAccountId || targetId !== botAccountId || !messageId || content === null || content.length > 8192) return null;
  if (typeof timestamp !== 'number' || !Number.isSafeInteger(timestamp) || timestamp <= 0) return null;
  if (data.extra !== undefined && (!data.extra || typeof data.extra !== 'object' || Array.isArray(data.extra))) return null;
  const extra = data.extra as Record<string, unknown> | undefined;
  if (extra?.author !== undefined) {
    if (!extra.author || typeof extra.author !== 'object' || Array.isArray(extra.author)) return null;
    const author = extra.author as Record<string, unknown>;
    if (author.bot === true || (author.id !== undefined && text(author.id, 128) !== userId)) return null;
  }
  return {
    [verifiedDirectEvent]: true,
    platform: 'kook',
    botAccountId,
    userId,
    messageId,
    timestamp,
    content,
  };
}
