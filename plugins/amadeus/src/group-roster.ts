import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import type { AddressingRecord } from '@agent/identity';
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

export function renderGroupRoster(entries: readonly AddressingRecord[]): string | undefined {
  if (!entries.length) return undefined;
  const lines = entries.map((entry) => {
    const accounts = entry.externalAccounts.filter((account) => account.provider === 'pubg').map((account) => account.externalId);
    const who = accounts.length ? `${entry.displayName}（PUBG ${accounts.join('、')}）` : entry.displayName;
    return `- ${who}：称呼「${entry.addressAs}」${entry.avoid.length ? `；不要叫：${entry.avoid.join('、')}` : ''}${entry.note ? `；${entry.note}` : ''}`;
  });
  return [
    '本群成员的称呼（成员约定、Arthur 审核过的长期设定；与聊天记录里的旧叫法冲突时以这里为准）：',
    ...lines,
    '称呼成员时用这里的叫法。查询战绩、确认身份仍按身份与 PUBG 工具，不要从称呼推断账号。',
  ].join('\n');
}

export function registerGroupRoster(api: OpenClawPluginApi): void {
  api.on('before_prompt_build', (_event, context) => {
    const groupId = groupIdFromSessionKey(context.sessionKey);
    if (!groupId) return;
    try {
      const roster = renderGroupRoster(groupAddressing(configFor(api), groupId));
      return roster ? { appendSystemContext: roster } : undefined;
    } catch {
      // A roster problem must never block the reply; the turn simply has no roster.
      api.logger.warn('amadeus group roster unavailable');
      return undefined;
    }
  });
}
