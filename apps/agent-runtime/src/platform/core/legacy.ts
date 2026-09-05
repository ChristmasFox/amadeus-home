import { randomUUID } from 'node:crypto';
import type { RuntimeRequest } from '../../runtime/types.js';
import { normalizeChatType, normalizePlatform, NormalizedBotMessageSchema, type NormalizedBotMessage } from './contracts.js';

export function legacyRequestToMessage(request: RuntimeRequest): NormalizedBotMessage {
  const platform = normalizePlatform(request.platform ?? 'kook');
  const senderId = String(request.senderId ?? 'unknown');
  const chatId = String(request.launcherId ?? 'unknown');
  const messageId = String(request.messageId ?? request.queryId ?? `msg_${randomUUID()}`);
  const timestamp = request.now ?? new Date().toISOString();
  return NormalizedBotMessageSchema.parse({
    version: 1,
    platform,
    botId: request.botId ?? `${platform}-bot`,
    user: {
      platform,
      platformUserId: senderId,
      internalUserId: null,
      displayName: null,
    },
    chat: {
      type: normalizeChatType(request.launcherType),
      id: chatId,
      name: null,
    },
    message: {
      id: messageId,
      text: request.callbackData ? '' : request.text,
      replyToMessageId: request.replyToMessageId ?? null,
    },
    mentions: [],
    attachments: [],
    timestamp,
    ...(request.callbackData ? { callback: { id: request.callbackId ?? null, data: request.callbackData } } : {}),
  });
}

export function normalizeRuntimeMessage(request: RuntimeRequest): NormalizedBotMessage {
  if (request.message) {
    const parsed = NormalizedBotMessageSchema.parse(request.message);
    const { raw: _raw, ...safeMessage } = parsed;
    return {
      ...safeMessage,
      user: {
        ...safeMessage.user,
        // Internal identity is resolved from the server-side mapping only.
        internalUserId: null,
      },
    };
  }
  return legacyRequestToMessage(request);
}
