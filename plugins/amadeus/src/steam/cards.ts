import { gameLabel } from './game-aliases.js';
import { BRAND, namesForTitle, renderLayout, SIGN_OFF, whenForTitle, type CardFact } from './layout.js';

/**
 * Deterministic Amadeus cards for Steam answers (play time, who is playing). The tool returns the finished text as
 * `displayText`; the model only decides which tool to call and hands the card over unchanged, so the wording, the
 * layout and the time it takes to write the reply no longer depend on the model.
 */
const fact = (label: string, value: string): CardFact => ({ label, value });

export const CARD_REPLY_GUIDE = '把 displayText 原样作为回复发给用户，不要改写、缩写或补充；用户追问时才另外说明。';

export interface PlaytimeCard {
  /** Who it is about (display name). */
  name: string;
  /** Window label from the tool, e.g. 今天（2026-11-09 06:00 → 次日 06:00）. */
  label: string;
  games: Array<{ appId?: string; name: string; text: string; minutes?: number }>;
  totalText: string;
  totalMinutes?: number;
  known?: boolean;
  reason?: string;
  trackingSince?: string;
  coverageText?: string;
  /** Set when the record starts inside the window. */
  partialSince?: string;
}

function durationMinutes(text: string): number {
  const hours = Number(text.match(/(\d+)\s*小时/u)?.[1] ?? 0);
  const minutes = Number(text.match(/(\d+)\s*分钟/u)?.[1] ?? 0);
  return hours * 60 + minutes;
}

function orderedGames<T extends { text: string; minutes?: number }>(games: T[]): T[] {
  return [...games].sort((left, right) => (right.minutes ?? durationMinutes(right.text)) - (left.minutes ?? durationMinutes(left.text)));
}

function playtimeLayout(headline: string, details: string[], body: string[]): string {
  const lines = [`${BRAND} · ${headline} ⏱️`, '', ...details, '', ...body, '', SIGN_OFF];
  return lines.join('\n');
}

export function renderPlaytimeCard(card: PlaytimeCard, _now: Date = new Date()): string {
  const details = [
    `时段：${card.label}`,
    ...((card.trackingSince ?? card.partialSince) ? [`记录起点：${card.trackingSince ?? card.partialSince}`] : []),
    ...(card.coverageText ? [`覆盖说明：${card.coverageText}`] : []),
  ];
  const body: string[] = [];
  if (card.known === false) {
    body.push(`${card.name}  ${card.reason === 'before_tracking' ? '统计区间早于采样开始，没有可用记录' : '没有可用的记录'}`);
  } else if (!card.games.length) {
    body.push(`${card.name}  没有记录到游戏时长`);
  } else {
    body.push(`${card.name}  ${card.totalText}`);
    for (const game of orderedGames(card.games)) body.push(`└ ${gameLabel(game.appId, game.name) ?? game.name}  ${game.text}`);
  }
  return playtimeLayout(`${card.name} ${whenForTitle(card.label)}游戏时长`, details, body);
}

export interface PlayingCard {
  friends: Array<{ name: string; steamId: string; state: 'in_game' | 'online' | 'offline'; game: string | null; appId?: string }>;
  note?: string;
}

const STATE: Record<string, string> = { in_game: '游戏中', online: '在线', offline: '离线' };

export function renderPlayingCard(card: PlayingCard, _now: Date = new Date()): string {
  const facts = card.friends.map((friend) => fact(friend.name, friend.game ? `${gameLabel(friend.appId, friend.game) ?? friend.game}（${STATE[friend.state]}）` : STATE[friend.state] ?? friend.state));
  return renderLayout('👥', card.friends.length ? `Steam 在线情况 · ${card.friends.length} 位` : 'Steam 当前没有观测到符合条件的人', facts);
}

export interface PlaytimeGroupCard {
  label: string;
  members: Array<{
    name: string;
    games: Array<{ appId?: string; name: string; text: string; minutes?: number }>;
    totalText?: string;
    totalMinutes?: number;
    known: boolean;
    reason?: string;
    trackingSince?: string;
    partial?: boolean;
  }>;
  /** Set when the record starts inside the window. */
  partialSince?: string;
  trackingSince?: string;
  coverageText?: string;
}

/** One card for several people: each person's games and total, delivered once. */
export function renderPlaytimeGroupCard(card: PlaytimeGroupCard, _now: Date = new Date()): string {
  const ordered = [...card.members].sort((left, right) => {
    const total = (member: typeof left): number => member.known ? member.totalMinutes ?? durationMinutes(member.totalText ?? '0分钟') : -1;
    return total(right) - total(left);
  });
  const details = [
    `时段：${card.label}`,
    ...((card.trackingSince ?? card.partialSince) ? [`记录起点：${card.trackingSince ?? card.partialSince}`] : []),
    ...(card.coverageText ? [`覆盖说明：${card.coverageText}`] : []),
  ];
  const body: string[] = [];
  for (const member of ordered) {
    if (!member.known) {
      const reason = member.reason === 'before_tracking' ? '统计区间早于采样开始' : '没有可用记录';
      body.push(`${member.name}  ${reason}${member.trackingSince ? `（采样起点 ${member.trackingSince}）` : ''}`);
      continue;
    }
    if (!member.games.length) {
      body.push(`${member.name}  没有记录到游戏时长`);
      continue;
    }
    body.push(`${member.name}  ${member.totalText ?? '0分钟'}`);
    for (const game of orderedGames(member.games)) body.push(`└ ${gameLabel(game.appId, game.name) ?? game.name}  ${game.text}`);
  }
  return playtimeLayout(`${namesForTitle(ordered.map((member) => member.name))} ${whenForTitle(card.label)}游戏时长`, details, body);
}
