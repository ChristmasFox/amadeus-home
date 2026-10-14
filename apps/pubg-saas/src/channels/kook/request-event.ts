import { parseTrustedKookButtonClick, type TrustedKookButtonClick } from './trusted-button-event.js';
import { parseTrustedKookDirectMessage, parseTrustedKookGroupMessage, type TrustedKookDirectMessage, type TrustedKookGroupMessage } from './trusted-group-event.js';
import {parseTrustedKookGuildJoin,type TrustedKookGuildJoin} from './guild-welcome.js';
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
  kind:'guild_join';
  event:TrustedKookGuildJoin;
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
/** GatewayClient passes frame.d. Ordinary group chat is excluded unless the
 * user mentions this bot, starts an explicit command, or uses a narrow binding
 * phrase prefilter. */
export function parseKookRequest(data: unknown, botAccountId: string): ParsedKookRequest | null {
  const envelope = { s: 0, d: data };
  const joined=parseTrustedKookGuildJoin(data,botAccountId);
  if(joined)return {
    request:{kind:'guild_join',event:joined},eventId:joined.messageId,userId:botAccountId,
    guildId:joined.guildId,channelId:null,targetKind:'direct',targetId:botAccountId,replyToMessageId:null,timestamp:joined.timestamp,
    envelope:{s:0,d:{type:255,channel_type:'PERSON',target_id:botAccountId,author_id:'1',msg_id:joined.messageId,msg_timestamp:joined.timestamp,extra:{type:'self_joined_guild',body:{guild_id:joined.guildId}}}},
  };
  const group = parseTrustedKookGroupMessage(envelope, botAccountId);
  if (group) {
    const extra = (data as {
      extra: Record<string, unknown>;
    }).extra;
    const rawMentions = Array.isArray(extra.mention) ? extra.mention : [];
    const mentionsBot = rawMentions.includes(botAccountId);
    const explicitCommand = /^(?:\/|!)pubg(?:\s|$)/iu.test(group.content.trim());
    const bindingPhrase = /(?:我的|他的|她的|本人|我).{0,24}(?:PUBG|绝地求生).{0,12}(?:账号|帐号)|(?:PUBG|绝地求生).{0,12}(?:账号|帐号).{0,24}(?:是|叫)|(?:我们的|本队|我们).{0,8}队名/iu.test(group.content);
    if (!mentionsBot && !explicitCommand && !bindingPhrase)
      return null;
    return {
      request: { kind: 'group', event: group }, eventId: group.messageId,
      userId: group.userId, guildId: group.guildId, channelId: group.channelId,
      targetKind: 'channel', targetId: group.channelId, replyToMessageId: group.messageId,
      timestamp: group.timestamp,
      envelope: {
        s: 0, d: {
          type: 1, channel_type: 'GROUP', target_id: group.channelId, author_id: group.userId,
          content: group.content, msg_id: group.messageId, msg_timestamp: group.timestamp,
          extra: {
            guild_id: group.guildId,
            channel_type: 1,
            author: { id: group.userId, bot: false },
            mention: [...group.mentionedUserIds, ...(mentionsBot ? [botAccountId] : [])],
          },
        }
      },
    };
  }
  const direct = parseTrustedKookDirectMessage(envelope, botAccountId);
  if (direct)
    return {
      request: { kind: 'direct', event: direct }, eventId: direct.messageId,
      userId: direct.userId, guildId: null, channelId: null,
      targetKind: 'direct', targetId: direct.userId, replyToMessageId: direct.messageId,
      timestamp: direct.timestamp,
      envelope: {
        s: 0, d: {
          type: 1, channel_type: 'PERSON', target_id: botAccountId, author_id: direct.userId,
          content: direct.content, msg_id: direct.messageId, msg_timestamp: direct.timestamp,
          extra: { author: { id: direct.userId, bot: false } },
        }
      },
    };
  const button = parseTrustedKookButtonClick(envelope, botAccountId);
  if (!button || !data || typeof data !== 'object')
    return null;
  const eventId = (data as Record<string, unknown>).msg_id;
  if (typeof eventId !== 'string' || !eventId.trim() || eventId.length > 256)
    return null;
  return {
    request: { kind: 'button', event: button }, eventId,
    userId: button.userId, guildId: null, channelId: button.sourceTargetId,
    // Button acknowledgements are private to the actor, including after unbind.
    targetKind: 'direct', targetId: button.userId, replyToMessageId: null,
    timestamp: button.timestamp,
    envelope: {
      s: 0, d: {
        type: 255, channel_type: 'PERSON', msg_id: eventId, msg_timestamp: button.timestamp,
        extra: {
          type: 'message_btn_click', body: {
            msg_id: button.sourceMessageId, user_id: button.userId, value: button.value,
            target_id: button.sourceTargetId ?? '',
          }
        },
      }
    },
  };
}
