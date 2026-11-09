import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { getSessionEntry, patchSessionEntry } from 'openclaw/plugin-sdk/session-store-runtime';
import { groupIdFromSessionKey } from './group-roster.js';

/**
 * OpenClaw has no per-channel thinking default (`thinkingDefault` is agent-wide and would change DMs too), and a fresh
 * session carries no level, so group turns fell back to the agent default (medium). This gives every WhatsApp group
 * session an explicit `low` the first time it is seen, at session start and again on its next turn (which also covers
 * sessions that already existed without one). Only an unset level is filled: a level someone chose with /think stays,
 * and direct chats are never touched.
 */
export const GROUP_THINKING_LEVEL = 'low';

export type ThinkingStore = {
  read(sessionKey: string, agentId?: string): { thinkingLevel?: string | undefined } | undefined;
  patch(sessionKey: string, agentId: string | undefined, level: string): Promise<unknown>;
};

const sdkStore: ThinkingStore = {
  read: (sessionKey, agentId) => getSessionEntry({ sessionKey, ...(agentId ? { agentId } : {}) }),
  patch: (sessionKey, agentId, level) => patchSessionEntry({
    sessionKey, ...(agentId ? { agentId } : {}), preserveActivity: true,
    update: (entry) => (entry.thinkingLevel ? null : { thinkingLevel: level }),
  }),
};

export function registerGroupThinking(api: OpenClawPluginApi, store: ThinkingStore = sdkStore): void {
  const settled = new Set<string>();
  const ensure = async (sessionKey: unknown, agentId?: string, sessionId?: string): Promise<void> => {
    if (typeof sessionKey !== 'string' || !groupIdFromSessionKey(sessionKey)) return;
    // Keyed by session id too: a reset keeps the key but starts a new session that may have lost its level.
    const seen = `${sessionKey}|${sessionId ?? ''}`;
    if (settled.has(seen)) return;
    try {
      if (store.read(sessionKey, agentId)?.thinkingLevel) { settled.add(seen); return; }
      await store.patch(sessionKey, agentId, GROUP_THINKING_LEVEL);
      settled.add(seen);
      api.logger.info(`amadeus group thinking set to ${GROUP_THINKING_LEVEL}`);
    } catch {
      // Never block a turn on this; the next turn tries again.
      api.logger.warn('amadeus group thinking not set');
    }
  };
  api.on('session_start', (_event, context) => ensure(context.sessionKey, context.agentId, context.sessionId));
  api.on('agent_turn_prepare', (_event, context) => ensure(context.sessionKey, context.agentId, context.sessionId));
}
