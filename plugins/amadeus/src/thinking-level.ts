import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { getSessionEntry, patchSessionEntry } from 'openclaw/plugin-sdk/session-store-runtime';
import { isOwnerDirectSession, ownerDigits } from './dm-digest.js';

/**
 * THE one place that sets the thinking level of every chat session (WhatsApp groups and direct chats, Telegram, KOOK,
 * the main session), old and new alike. To change it, change this constant and release; nothing else sets a level.
 *
 * OpenClaw keeps the level per session, and it only reaches the model because arthur-combo declares
 * compat.supportsReasoningEffort. OpenClaw rejects xhigh/max for a model that does not list them, so arthur-combo also
 * declares supportedReasoningEfforts and thinkingLevelMap (integrations/openclaw/openclaw.json.example; scripts/
 * openclaw_prepare.py ensure_arthur_combo_thinking_levels keeps the live config in step). 9Router then clamps max to the
 * highest level each route accepts (Gemini: high), so the wire value is never invalid. The hook below writes this level into
 * a session at its start and again before each turn whenever it differs, so existing sessions follow a change too
 * (a /think chosen in chat lasts until the next turn). Cron, release-check and other internal sessions keep their own.
 */
export const CHAT_THINKING_LEVEL = 'xhigh';
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
export async function ensureThinkingLevel(store: ThinkingStore, sessionKey: unknown, agentId?: string, level = CHAT_THINKING_LEVEL): Promise<boolean> {
  if (!isChatSessionKey(sessionKey)) return false;
  if (store.read(sessionKey, agentId)?.thinkingLevel === level) return false;
  await store.patch(sessionKey, agentId, level);
  return true;
}

export function registerThinkingLevel(api: OpenClawPluginApi, store: ThinkingStore = sdkStore, resolveOwner: () => Promise<string | undefined> = () => ownerDigits(api)): void {
  const ensure = async (sessionKey: unknown, agentId?: string): Promise<void> => {
    try {
      const level = isOwnerWhatsAppDm(sessionKey, await resolveOwner()) ? OWNER_DM_THINKING_LEVEL : CHAT_THINKING_LEVEL;
      if (await ensureThinkingLevel(store, sessionKey, agentId, level)) api.logger.info(`amadeus chat thinking set to ${level}`);
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
