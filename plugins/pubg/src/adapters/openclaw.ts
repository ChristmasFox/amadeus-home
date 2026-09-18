import type { OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import type { IdentityContext } from '@agent/identity';
import type { PubgConversationAdapter, PubgConversationContext } from './types.js';

type OpenClawConversationSource = Pick<
  OpenClawPluginToolContext,
  | 'sessionId'
  | 'sessionKey'
  | 'messageChannel'
  | 'agentAccountId'
  | 'deliveryContext'
  | 'nativeChannelId'
  | 'requesterSenderId'
>;

function text(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return undefined;
}

function channelName(value: unknown): string {
  return firstText(value)?.toLowerCase() ?? 'unknown';
}

/**
 * OpenClaw's native channel adapter.
 *
 * OpenClaw already owns Telegram/WhatsApp transport and reply delivery. This
 * adapter only translates its trusted runtime context into the small,
 * platform-neutral context the PUBG plugin may need for session isolation and
 * future adapters.
 */
export const openClawConversationAdapter: PubgConversationAdapter<OpenClawConversationSource> = {
  id: 'openclaw',
  adapt(source, requestedSessionId): PubgConversationContext {
    const delivery = source.deliveryContext;
    const channel = channelName(source.messageChannel ?? delivery?.channel);
    const sessionId = firstText(
      source.sessionId,
      source.sessionKey,
      requestedSessionId,
      process.env.PUBG_DEFAULT_SESSION_ID,
    ) ?? 'openclaw:pubg:default';

    return {
      sessionId,
      channel,
      ...(firstText(delivery?.accountId, source.agentAccountId) ? { accountId: firstText(delivery?.accountId, source.agentAccountId) } : {}),
      ...(firstText(source.nativeChannelId, delivery?.to, delivery?.threadId) ? { conversationId: firstText(source.nativeChannelId, delivery?.to, delivery?.threadId) } : {}),
      ...(firstText(source.requesterSenderId) ? { senderId: firstText(source.requesterSenderId) } : {}),
      identityContext: identityContext(source, channel),
    };
  },
};

function identityContext(source: OpenClawConversationSource, channel: string): IdentityContext {
  const accountId = firstText(source.deliveryContext?.accountId, source.agentAccountId);
  const conversationId = firstText(source.nativeChannelId, source.deliveryContext?.to, source.deliveryContext?.threadId);
  const senderId = firstText(source.requesterSenderId);
  return {
    channel,
    ...(accountId ? { accountId } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(senderId ? { senderId } : {}),
  };
}
