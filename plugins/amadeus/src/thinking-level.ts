import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { getSessionEntry, patchSessionEntry } from 'openclaw/plugin-sdk/session-store-runtime';

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
export const CHAT_THINKING_LEVEL = 'max';

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
export async function ensureThinkingLevel(store: ThinkingStore, sessionKey: unknown, agentId?: string): Promise<boolean> {
  if (!isChatSessionKey(sessionKey)) return false;
  if (store.read(sessionKey, agentId)?.thinkingLevel === CHAT_THINKING_LEVEL) return false;
  await store.patch(sessionKey, agentId, CHAT_THINKING_LEVEL);
  return true;
}

export function registerThinkingLevel(api: OpenClawPluginApi, store: ThinkingStore = sdkStore): void {
  const ensure = async (sessionKey: unknown, agentId?: string): Promise<void> => {
    try {
      if (await ensureThinkingLevel(store, sessionKey, agentId)) api.logger.info(`amadeus chat thinking set to ${CHAT_THINKING_LEVEL}`);
    } catch {
      // Never block a turn on this; the next turn tries again.
      api.logger.warn('amadeus chat thinking not set');
    }
  };
  api.on('session_start', (_event, context) => ensure(context.sessionKey, context.agentId));
  api.on('agent_turn_prepare', (_event, context) => ensure(context.sessionKey, context.agentId));
}
