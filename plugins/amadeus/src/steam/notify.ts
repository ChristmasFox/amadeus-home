import type { EventKind } from './domain.js';
import { namesForTitle, renderLayout, titleDuration, type CardFact } from './layout.js';
import type { AnnouncementFacts, AnnouncementPerson } from './poller.js';

/**
 * Steam group notices are deterministic Amadeus "world line" messages: no model writes them and nothing is invented.
 * A line only appears when its fact is known (no game name, no 游戏 line; no achievement rate, no 全球解锁率 line).
 * Members are shown by their display name; the Steam nickname only when it adds something (it differs from the name,
 * or the person has several accounts).
 */
export const MIN_STOP_MINUTES = 5;

const ORDER: EventKind[] = ['came_online', 'back_from_away', 'started_playing', 'switched_game', 'achievement_unlocked', 'stopped_playing'];

export const minutesText = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} 分钟`;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
};

const fact = (label: string, value: string): CardFact => ({ label, value });
const quoted = (person: AnnouncementPerson): string => (person.achievements ?? []).map((item) => `「${item.name}」`).join('、');

const EMOJI: Record<EventKind, string> = { came_online: '🟢', back_from_away: '🔄', started_playing: '🎮', switched_game: '🔀', achievement_unlocked: '🏆', stopped_playing: '🏁' };

/** Headline of a lone event: who + what, with the key object when it is short. */
function singleHeadline(person: AnnouncementPerson): string {
  const { name, game } = person;
    switch (person.kind) {
    case 'came_online': return `${name} 上线${game ? ` · 正在玩 ${game}` : ''}`;
    case 'back_from_away': return `${name} 回来了${game ? ` · 正在玩 ${game}` : ''}`;
    case 'started_playing': return `${name} ${game ? `开始玩 ${game}` : '开始玩游戏'}`;
    case 'switched_game': return `${name} 世界线变动${game ? ` · ${person.previous?.gameName ? `${person.previous.gameName} → ${game}` : `→ ${game}`}` : ''}`;
    case 'achievement_unlocked': return `${name} 解锁成就${game ? ` · ${game}` : ''}`;
    case 'stopped_playing': return `${name} 收束${game ? ` · ${game}` : ''}${person.durationMinutes !== undefined ? ` ${titleDuration(person.durationMinutes)}` : ''}`;
  }
}

const MULTI_ACTION: Record<EventKind, string> = { came_online: '上线', back_from_away: '回来了', started_playing: '开局', switched_game: '世界线变动', achievement_unlocked: '解锁成就', stopped_playing: '收束' };

/** One row per person when several share a message. */
function personRow(person: AnnouncementPerson): CardFact {
  const { game } = person;
  switch (person.kind) {
    case 'came_online': return fact(person.name, game ? `正在玩 ${game}` : '在线');
    case 'back_from_away': return fact(person.name, game ? `正在玩 ${game}` : '在线');
    case 'started_playing': return fact(person.name, game ?? '开始玩游戏');
    case 'switched_game': return fact(person.name, game ? (person.previous?.gameName ? `${person.previous.gameName} → ${game}` : `→ ${game}`) : '换了个游戏');
    case 'achievement_unlocked': return fact(person.name, `${game ? `${game} · ` : ''}${person.achievements?.length ? quoted(person) : '成就'}`);
    case 'stopped_playing': return fact(person.name, `${game ?? '游戏'}${person.durationMinutes !== undefined ? `，本局 ${minutesText(person.durationMinutes)}` : ''}`);
  }
}

function singleFacts(person: AnnouncementPerson): CardFact[] {
  const facts: CardFact[] = person.steamName ? [fact('Steam', person.steamName)] : [];
  const game = person.game ? [fact('游戏', person.game)] : [];
  switch (person.kind) {
    case 'came_online': return [...facts, ...game, fact('状态', person.game ? '游戏中' : '在线')];
    case 'back_from_away': return [...facts, ...game, fact('状态', person.game ? '游戏中' : '在线')];
    case 'started_playing': return [...facts, ...game, fact('状态', '游戏中')];
    case 'switched_game': return [...facts, ...game, fact('状态', '游戏中'), ...(person.previous?.minutes !== undefined ? [fact('上一局', `${person.previous.gameName ? `${person.previous.gameName}，` : ''}${minutesText(person.previous.minutes)}`)] : [])];
    case 'achievement_unlocked': {
      const items = person.achievements ?? [];
      const rates = items.filter((item) => item.globalPercent !== undefined);
      const rateText = items.length === 1 ? `${rates[0]?.globalPercent}%` : rates.map((item) => `「${item.name}」${item.globalPercent}%`).join('、');
      return [...facts, ...game, ...(items.length ? [fact('成就', quoted(person))] : []), ...(rates.length ? [fact('全球解锁率', rateText)] : [])];
    }
    case 'stopped_playing': return [...facts, ...game, ...(person.durationMinutes !== undefined ? [fact('本局时长', minutesText(person.durationMinutes))] : [])];
  }
}

/** One message per kind present in the batch; a lone event gets the full fact list, several share one message with a row each. */
export function renderSteamNotifications(facts: AnnouncementFacts, _now: Date = new Date()): string[] {
  const messages: string[] = [];
  for (const kind of ORDER) {
    const people = facts.people.filter((person) => person.kind === kind);
    if (!people.length) continue;
    if (people.length === 1) { messages.push(renderLayout(EMOJI[kind], singleHeadline(people[0]!), singleFacts(people[0]!))); continue; }
    messages.push(renderLayout(EMOJI[kind], `${namesForTitle(people.map((person) => person.name))} ${MULTI_ACTION[kind]}`, people.map(personRow)));
  }
  return messages;
}
