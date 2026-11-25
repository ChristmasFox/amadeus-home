import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import type { AddressingRecord } from '@agent/identity';
import { configFor } from './config.js';
import { groupAddressing } from './identity.js';
import { GROUP_VOICE_ANCHOR } from './voice-anchor.js';

/**
 * Group roster: the reviewed forms of address of a group's members, injected into every turn of that group's
 * session. They live in the identity store (seeded from the external presets file), so a session reset or a
 * compaction never takes them away, and they never reach another conversation.
 */
const WHATSAPP_GROUP = /:group:([^:\s]+@g\.us)(?::|$)/u;
const GROUP_CURRENT_TURN_EVIDENCE_RULE = `群聊事实核验（硬规则）：本轮回答身份问题前，必须调用 identity_resolve 并查看本轮结果；本轮回答击杀或战绩前，必须调用适用的 PUBG 工具并查看本轮结果，涉及人名或自称时还必须先调用 identity_resolve。不得根据上下文、旧轮次结果或记忆猜测谁是谁、身份、击杀或战绩；缺少本轮工具结果时先调用工具。普通闲聊不受此规则影响。`;

export function groupIdFromSessionKey(sessionKey: unknown): string | undefined {
  return typeof sessionKey === 'string' ? WHATSAPP_GROUP.exec(sessionKey)?.[1] : undefined;
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/** Render only identity aliases that were reviewed or confirmed in the identity store. */
export function renderGroupRoster(records: AddressingRecord[]): string | undefined {
  if (!records.length) return undefined;
  const lines = records.map((record) => {
    const avoidKeys = new Set(record.avoid.map(normalizedName));
    const addressKey = normalizedName(record.addressAs);
    const names = [...record.aliases, record.displayName]
      .map((name) => name.trim())
      .filter(Boolean)
      .filter((name, index, all) => all.findIndex((candidate) => normalizedName(candidate) === normalizedName(name)) === index)
      .filter((name) => !avoidKeys.has(normalizedName(name)) && normalizedName(name) !== addressKey);
    const pushNames = names.length ? names.join(' / ') : '未配置';
    const pubgAccount = record.externalAccounts.find((account) => account.provider === 'pubg')?.externalId;
    const avoid = record.avoid.length ? `；不要叫：${record.avoid.join('、')}` : '';
    const note = record.note ? `；${record.note}` : '';
    return `- WhatsApp 推送名 / 自称「${pushNames}」 = 称呼「${record.addressAs}」 = PUBG 账号「${pubgAccount ?? '未绑定'}」${avoid}${note}`;
  });
  return `## 本群名册\n${lines.join('\n')}`;
}

export { GROUP_VOICE_ANCHOR };

export function registerGroupRoster(api: OpenClawPluginApi): void {
  api.on('before_prompt_build', (_event, context) => {
    const groupId = groupIdFromSessionKey(context.sessionKey);
    if (!groupId) return;
    try {
      const roster = renderGroupRoster(groupAddressing(configFor(api), groupId));
      return {
        appendSystemContext: [GROUP_CURRENT_TURN_EVIDENCE_RULE, roster, GROUP_VOICE_ANCHOR].filter(Boolean).join('\n\n'),
      };
    } catch {
      // A roster problem must never block the reply; the turn simply has no roster.
      api.logger.warn('amadeus group roster unavailable');
      return { appendSystemContext: `${GROUP_CURRENT_TURN_EVIDENCE_RULE}\n\n${GROUP_VOICE_ANCHOR}` };
    }
  });
}
