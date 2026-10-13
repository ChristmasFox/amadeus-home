const verifiedGroupEvent = Symbol('verified-kook-group-event');

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
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

/** Parses only KOOK's documented group message event shape. Role IDs in the
 * event are deliberately discarded; management actions recheck via HTTP. */
export function parseTrustedKookGroupMessage(value: unknown, botAccountIdInput: string): TrustedKookGroupMessage | null {
  const botAccountId = text(botAccountIdInput);
  if (!botAccountId || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (envelope.s !== 0 || !envelope.d || typeof envelope.d !== 'object' || Array.isArray(envelope.d)) return null;
  const data = envelope.d as Record<string, unknown>;
  if (data.channel_type !== 'GROUP' || (data.type !== 1 && data.type !== 9)) return null;
  const extra = data.extra;
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return null;
  const metadata = extra as Record<string, unknown>;
  if (metadata.channel_type !== 1) return null;
  const author = metadata.author;
  if (!author || typeof author !== 'object' || Array.isArray(author)) return null;
  const authorInfo = author as Record<string, unknown>;
  if (authorInfo.bot === true) return null;
  const userId = text(data.author_id);
  if (!userId || text(authorInfo.id) !== userId) return null;
  const guildId = text(metadata.guild_id);
  const channelId = text(data.target_id);
  const messageId = text(data.msg_id);
  const content = typeof data.content === 'string' ? data.content : null;
  const timestamp = data.msg_timestamp;
  if (!guildId || !channelId || !messageId || content === null || content.length > 8192) return null;
  if (typeof timestamp !== 'number' || !Number.isSafeInteger(timestamp) || timestamp <= 0) return null;
  return {
    [verifiedGroupEvent]: true,
    platform: 'kook',
    botAccountId,
    guildId,
    channelId,
    userId,
    messageId,
    timestamp,
    content,
  };
}
