import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { getSessionEntry, patchSessionEntry } from 'openclaw/plugin-sdk/session-store-runtime';
import { isOwnerDirectSession, ownerDigits } from './dm-digest.js';

/** Only the verified owner's WhatsApp DM pins its thinking level. Other chats inherit OpenClaw's global default. */
export const OWNER_DM_THINKING_LEVEL = 'low';
export const OWNER_DM_MODEL = 'kurisu-private-combo';

export function isOwnerWhatsAppDm(key: unknown, owner: string | undefined): boolean {
  return typeof key === 'string' && /^agent:[^:]+:whatsapp:/u.test(key) && isOwnerDirectSession(key, owner);
}

const CHAT_SESSION = /^agent:[^:]+:(?:whatsapp|telegram|kook):|^agent:[^:]+:main$/u;

export function isChatSessionKey(sessionKey: unknown): sessionKey is string {
  return typeof sessionKey === 'string' && CHAT_SESSION.test(sessionKey);
}

export type ThinkingStore = {
  read(sessionKey: string, agentId?: string): { thinkingLevel?: string | undefined } | undefined;
  patch(sessionKey: string, agentId: string | undefined, level: string): Promise<unknown>;
};

export const sdkStore: ThinkingStore = {
  read: (sessionKey, agentId) => getSessionEntry({ sessionKey, ...(agentId ? { agentId } : {}) }),
  patch: (sessionKey, agentId, level) => patchSessionEntry({
    sessionKey, ...(agentId ? { agentId } : {}), preserveActivity: true,
    update: (entry) => (entry.thinkingLevel === level ? null : { thinkingLevel: level }),
  }),
};

/** Brings one session to CHAT_THINKING_LEVEL; resolves true when it had to change it. */
export async function ensureThinkingLevel(store: ThinkingStore, sessionKey: unknown, agentId?: string, level = OWNER_DM_THINKING_LEVEL): Promise<boolean> {
  if (!isChatSessionKey(sessionKey)) return false;
  if (store.read(sessionKey, agentId)?.thinkingLevel === level) return false;
  await store.patch(sessionKey, agentId, level);
  return true;
}

export function registerThinkingLevel(api: OpenClawPluginApi, store: ThinkingStore = sdkStore, resolveOwner: () => Promise<string | undefined> = () => ownerDigits(api)): void {
  const ensure = async (sessionKey: unknown, agentId?: string): Promise<void> => {
    try {
      if (!isOwnerWhatsAppDm(sessionKey, await resolveOwner())) return;
      if (await ensureThinkingLevel(store, sessionKey, agentId, OWNER_DM_THINKING_LEVEL)) api.logger.info('amadeus owner dm thinking set to low');
    } catch {
      // Never block a turn on this; the next turn tries again.
      api.logger.warn('amadeus chat thinking not set');
    }
  };
  api.on('before_model_resolve', async (_event, context) => {
    if (isOwnerWhatsAppDm(context.sessionKey, await resolveOwner())) {
      return { providerOverride: 'nine_router', modelOverride: OWNER_DM_MODEL };
    }
    return undefined;
  });
  api.on('session_start', (_event, context) => ensure(context.sessionKey, context.agentId));
  api.on('agent_turn_prepare', (_event, context) => ensure(context.sessionKey, context.agentId));
}
