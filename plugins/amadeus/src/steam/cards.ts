import { gameLabel } from './game-aliases.js';
import { namesForTitle, renderLayout, whenForTitle, type CardFact } from './layout.js';

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
  games: Array<{ appId?: string; name: string; text: string }>;
  totalText: string;
  /** Set when the record starts inside the window. */
  partialSince?: string;
}

export function renderPlaytimeCard(card: PlaytimeCard, _now: Date = new Date()): string {
  const facts = [
    fact('时段', card.label),
    ...card.games.map((game) => fact('游戏', `${gameLabel(game.appId, game.name) ?? game.name}，${game.text}`)),
    ...(card.games.length > 1 ? [fact('合计', card.totalText)] : []),
    ...(card.partialSince ? [fact('记录起点', card.partialSince)] : []),
  ];
  if (!card.games.length) facts.push(fact('结果', '没有记录到游戏时长'));
  return renderLayout('⏱️', `${card.name} ${whenForTitle(card.label)}游戏时长`, facts);
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
  members: Array<{ name: string; games: Array<{ appId?: string; name: string; text: string }>; totalText?: string; known: boolean }>;
  /** Set when the record starts inside the window. */
  partialSince?: string;
}

/** One card for several people: each person's games and total, delivered once. */
export function renderPlaytimeGroupCard(card: PlaytimeGroupCard, _now: Date = new Date()): string {
  const facts: CardFact[] = [fact('时段', card.label)];
  for (const member of card.members) {
    if (!member.known || !member.games.length) { facts.push(fact(member.name, member.known ? '没有记录到游戏时长' : '没有可用的记录')); continue; }
    for (const game of member.games) facts.push(fact(`${member.name} · ${gameLabel(game.appId, game.name) ?? game.name}`, game.text));
    facts.push(fact(`${member.name} · 合计`, member.totalText ?? ''));
  }
  if (card.partialSince) facts.push(fact('记录起点', card.partialSince));
  return renderLayout('⏱️', `${namesForTitle(card.members.map((member) => member.name))} ${whenForTitle(card.label)}游戏时长`, facts);
}
