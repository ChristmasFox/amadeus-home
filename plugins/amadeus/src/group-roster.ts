import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import type { AddressingRecord } from '@agent/identity';
import { KURISU_VOICE_ANCHOR as GROUP_VOICE_ANCHOR, renderGroupRoster } from '@rine-kit/pubg-reply';
import { configFor } from './config.js';
import { groupAddressing } from './identity.js';

/**
 * Group roster: the reviewed forms of address of a group's members, injected into every turn of that group's
 * session. They live in the identity store (seeded from the external presets file), so a session reset or a
 * compaction never takes them away, and they never reach another conversation.
 */
const WHATSAPP_GROUP = /:group:([^:\s]+@g\.us)(?::|$)/u;

export function groupIdFromSessionKey(sessionKey: unknown): string | undefined {
  return typeof sessionKey === 'string' ? WHATSAPP_GROUP.exec(sessionKey)?.[1] : undefined;
}

// The roster wording and the Kurisu group voice are shared (moved unchanged to @rine-kit/pubg-reply); Lab keeps its
// own names for them and its default authority wording.
export { renderGroupRoster, GROUP_VOICE_ANCHOR };

export function registerGroupRoster(api: OpenClawPluginApi): void {
  api.on('before_prompt_build', (_event, context) => {
    const groupId = groupIdFromSessionKey(context.sessionKey);
    if (!groupId) return;
    try {
      const roster = renderGroupRoster(groupAddressing(configFor(api), groupId));
      return { appendSystemContext: roster ? `${roster}\n\n${GROUP_VOICE_ANCHOR}` : GROUP_VOICE_ANCHOR };
    } catch {
      // A roster problem must never block the reply; the turn simply has no roster.
      api.logger.warn('amadeus group roster unavailable');
      return { appendSystemContext: GROUP_VOICE_ANCHOR };
    }
  });
}
