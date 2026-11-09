import { aggregatePlay, businessDayLabel, durationText } from './tools.js';
import type { SteamStore } from './store.js';

/** Where the daily squad review (09:30, pubg plugin) finds extra sections; both plugins share the process. */
export const DAILY_REVIEW_SECTIONS_GLOBAL = '__amadeusDailyReviewSections20261109';
export type DailyReviewSection = (window: { startMs: number; endMs: number }) => Promise<string | undefined>;

const singaporeTime = (at: number): string => new Date(at + 8 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');

/**
 * The 游戏时长 block of the daily review: for the business day that just ended (06:00 → 06:00), each recorded member's
 * time per game and in total, accounts of one person merged. Honest about missing data: nothing before tracking began
 * is invented, and members with no recorded play are named briefly instead of being left out silently.
 */
export function steamPlaytimeSection(store: SteamStore, window: { startMs: number; endMs: number }, now: number, nameOf: (personId: string | undefined, fallback: string) => string): string | undefined {
  const links = store.trackedLinks();
  if (!links.length) return undefined;
  const trackingSince = store.playTrackingStartedAt();
  const title = `🎮 Steam 游戏时长（业务日 ${businessDayLabel(window.startMs)}，新加坡时间 06:00 → 次日 06:00）`;
  if (window.endMs <= trackingSince) return `${title}\n游戏时长是从 ${singaporeTime(trackingSince)} 才开始记录的，这一天没有数据。`;
  const people = new Map<string, { name: string; ids: string[] }>();
  for (const link of links) {
    const key = link.personId ?? link.senderKey;
    const entry = people.get(key) ?? { name: nameOf(link.personId, link.personaName), ids: [] };
    entry.ids.push(link.steamId);
    people.set(key, entry);
  }
  const lines: string[] = [];
  const idle: string[] = [];
  for (const { name, ids } of people.values()) {
    const { games, totalMinutes } = aggregatePlay(store.playSessions(ids, window.startMs, window.endMs, now), window.startMs, window.endMs);
    if (!totalMinutes) { idle.push(name); continue; }
    lines.push(`- ${name}：${games.map((game) => `${game.name} ${game.text}`).join('、')}（合计 ${durationText(totalMinutes)}）`);
  }
  const out = [title];
  if (lines.length) out.push(...lines);
  if (idle.length) out.push(lines.length ? `没有记录到游戏时长：${idle.join('、')}` : `这一天没有记录到任何人的游戏时长（${idle.join('、')}）。`);
  if (window.startMs < trackingSince) out.push(`（记录从 ${singaporeTime(trackingSince)} 起，之前的部分没有数据。）`);
  return out.join('\n');
}
