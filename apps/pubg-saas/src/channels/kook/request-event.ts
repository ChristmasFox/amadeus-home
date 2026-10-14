import { parseTrustedKookButtonClick, type TrustedKookButtonClick } from './trusted-button-event.js';
import { parseTrustedKookDirectMessage, inspectTrustedKookGroupMessage, type TrustedKookDirectMessage, type TrustedKookGroupMessage } from './trusted-group-event.js';
import { parseTrustedKookGuildJoin, type TrustedKookGuildJoin } from './guild-welcome.js';

export type KookRequestEvent = {
  kind: 'group';
  event: TrustedKookGroupMessage;
} | {
  kind: 'direct';
  event: TrustedKookDirectMessage;
} | {
  kind: 'button';
  event: TrustedKookButtonClick;
} | {
  kind: 'guild_join';
  event: TrustedKookGuildJoin;
};

export interface ParsedKookRequest {
  request: KookRequestEvent;
  eventId: string;
  userId: string;
  guildId: string | null;
  channelId: string | null;
  targetKind: 'channel' | 'direct';
  targetId: string;
  replyToMessageId: string | null;
  timestamp: number;
  /** Minimal protocol envelope, excluding names, roles, attachments and tokens. */
  envelope: Record<string, unknown>;
}

export type KookRequestInspection =
  | { kind: 'accepted'; parsed: ParsedKookRequest }
  | { kind: 'dropped'; stage: 'trusted_group'; reason: string; channelId?: string }
  | { kind: 'ignored' };

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeChannelId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[0-9]{1,40}$/u.test(value) ? value : undefined;
}

function accepted(parsed: ParsedKookRequest): KookRequestInspection {
  return { kind: 'accepted', parsed };
}

/** Inspect one KOOK event without retaining or logging its message content. */
export function inspectKookRequest(data: unknown, botAccountId: string): KookRequestInspection {
  const envelope = { s: 0, d: data };
  const joined = parseTrustedKookGuildJoin(data, botAccountId);
  if (joined) return accepted({
    request: { kind: 'guild_join', event: joined }, eventId: joined.messageId, userId: botAccountId,
    guildId: joined.guildId, channelId: null, targetKind: 'direct', targetId: botAccountId,
    replyToMessageId: null, timestamp: joined.timestamp,
    envelope: { s: 0, d: { type: 255, channel_type: 'PERSON', target_id: botAccountId, author_id: '1', msg_id: joined.messageId,
      msg_timestamp: joined.timestamp, extra: { type: 'self_joined_guild', body: { guild_id: joined.guildId } } } },
  });

  const dataRecord = objectRecord(data);
  if (dataRecord?.channel_type === 'GROUP' && (dataRecord.type === 1 || dataRecord.type === 9)) {
    const inspection = inspectTrustedKookGroupMessage(envelope, botAccountId);
    if (!('event' in inspection)) {
      const channelId = safeChannelId(dataRecord.target_id);
      return { kind: 'dropped', stage: 'trusted_group', reason: inspection.reason, ...(channelId ? { channelId } : {}) };
    }
    const group = inspection.event;
    const extra = objectRecord(dataRecord.extra) ?? {};
    const rawMentions = Array.isArray(extra.mention) ? extra.mention : [];
    const mentionsBot = rawMentions.includes(botAccountId);
    return accepted({
      request: { kind: 'group', event: group }, eventId: group.messageId,
      userId: group.userId, guildId: group.guildId, channelId: group.channelId,
      targetKind: 'channel', targetId: group.channelId, replyToMessageId: group.messageId,
      timestamp: group.timestamp,
      envelope: {
        s: 0, d: {
          type: dataRecord.type, channel_type: 'GROUP', target_id: group.channelId, author_id: group.userId,
          content: group.content, msg_id: group.messageId, msg_timestamp: group.timestamp,
          extra: {
            guild_id: group.guildId,
            channel_type: 1,
            author: { id: group.userId, bot: false },
            mention: [...group.mentionedUserIds, ...(mentionsBot ? [botAccountId] : [])],
          },
        }
      },
    });
  }

  const direct = parseTrustedKookDirectMessage(envelope, botAccountId);
  if (direct) return accepted({
    request: { kind: 'direct', event: direct }, eventId: direct.messageId,
    userId: direct.userId, guildId: null, channelId: null,
    targetKind: 'direct', targetId: direct.userId, replyToMessageId: direct.messageId,
    timestamp: direct.timestamp,
    envelope: { s: 0, d: { type: 1, channel_type: 'PERSON', target_id: botAccountId, author_id: direct.userId,
      content: direct.content, msg_id: direct.messageId, msg_timestamp: direct.timestamp,
      extra: { author: { id: direct.userId, bot: false } } } },
  });

  const button = parseTrustedKookButtonClick(envelope, botAccountId);
  if (!button || !dataRecord) return { kind: 'ignored' };
  const eventId = dataRecord.msg_id;
  if (typeof eventId !== 'string' || !eventId.trim() || eventId.length > 256) return { kind: 'ignored' };
  return accepted({
    request: { kind: 'button', event: button }, eventId,
    userId: button.userId, guildId: null, channelId: button.sourceTargetId,
    // Button acknowledgements are private to the actor, including after unbind.
    targetKind: 'direct', targetId: button.userId, replyToMessageId: null,
    timestamp: button.timestamp,
    envelope: { s: 0, d: { type: 255, channel_type: 'PERSON', msg_id: eventId, msg_timestamp: button.timestamp,
      extra: { type: 'message_btn_click', body: { msg_id: button.sourceMessageId, user_id: button.userId,
        value: button.value, target_id: button.sourceTargetId ?? '' } } } },
  });
}

/** Every bounded, trusted, non-bot text group message enters durable admission.
 * Intent selection happens later in the constrained model classifier. */
export function parseKookRequest(data: unknown, botAccountId: string): ParsedKookRequest | null {
  const inspection = inspectKookRequest(data, botAccountId);
  return inspection.kind === 'accepted' ? inspection.parsed : null;
}
