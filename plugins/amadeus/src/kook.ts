import type { OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import type { AmadeusConfig } from './config.js';
import { readRequiredFile } from './config.js';
import { requestJson } from './http.js';

function dataOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error('KOOK API returned invalid data');
  const item = value as Record<string, unknown>;
  if (Number(item.code) !== 0 || !item.data || typeof item.data !== 'object') throw new Error(`KOOK API request failed: ${String(item.message ?? 'unknown error')}`);
  return item.data as Record<string, unknown>;
}

export async function kookGroupMembers(config: AmadeusConfig, context: OpenClawPluginToolContext, maxMembers: number, signal?: AbortSignal): Promise<unknown> {
  if (context.messageChannel !== 'kook' || !context.nativeChannelId?.trim()) throw new Error('KOOK member lookup requires an active KOOK group/channel context');
  const token = await readRequiredFile(config.kookTokenFile ?? '/run/secrets/kook_bot_token', 'KOOK bot token');
  const headers = { Authorization: `Bot ${token}` };
  const get = async (endpoint: string, params: Record<string, string>): Promise<Record<string, unknown>> => {
    const query = new URLSearchParams(params).toString();
    return dataOf(await requestJson(`${config.kookApiBaseUrl}/${endpoint}?${query}`, { headers, ...(signal ? { signal } : {}), timeoutMs: 12_000 }));
  };
  const channel = await get('channel/view', { channel_id: context.nativeChannelId.trim() });
  const guildId = String(channel.guild_id ?? '').trim();
  if (!guildId) throw new Error('KOOK channel did not include guild_id');
  const guild = await get('guild/view', { guild_id: guildId });
  const members = await get('guild/user-list', { guild_id: guildId, limit: String(Math.min(Math.max(maxMembers, 1), 500)), offset: '0' });
  const rows = Array.isArray(members.items) ? members.items : [];
  const meta = members.meta && typeof members.meta === 'object' ? members.meta as Record<string, unknown> : undefined;
  const total = members.user_count ?? meta?.total ?? rows.length;
  const lines = [
    `服务器：${String(guild.name ?? guildId)}`,
    `当前频道：${String(channel.name ?? context.nativeChannelId)}`,
    `成员总数：${String(total)}`,
  ];
  for (const [index, item] of rows.slice(0, Math.min(maxMembers, 500)).entries()) {
    if (!item || typeof item !== 'object') continue;
    const member = item as Record<string, unknown>;
    const id = String(member.id ?? '未知');
    const name = String(member.nickname ?? member.username ?? id);
    const status = member.online ? '在线' : '离线';
    lines.push(`${index + 1}. ${name}（ID：${id}，${status}${member.bot ? '，机器人' : ''}）`);
  }
  if (rows.length > maxMembers) lines.push(`已限制显示前 ${maxMembers} 名成员。`);
  return { text: lines.join('\n'), guildId, channelId: context.nativeChannelId, count: rows.length };
}
