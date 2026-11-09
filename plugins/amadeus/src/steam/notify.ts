import { adaptWorldlineNotification, renderOwnerNotification, type PresentationFact } from '@rine-kit/presentation';
import type { EventKind } from './domain.js';
import type { AnnouncementFacts, AnnouncementPerson } from './poller.js';

/**
 * Steam group notices are deterministic Amadeus "world line" messages: no model writes them and nothing is invented.
 * A line only appears when its fact is known (no game name, no 游戏 line; no achievement rate, no 全球解锁率 line).
 * Members are shown by their display name; the Steam nickname only when it adds something (it differs from the name,
 * or the person has several accounts).
 */
export const MIN_STOP_MINUTES = 5;

const TITLES: Record<EventKind, string> = {
  came_online: 'Steam 上线',
  back_from_away: 'Steam 回归信号',
  started_playing: 'Steam 开局',
  switched_game: 'Steam 换台',
  achievement_unlocked: 'Steam 成就',
  stopped_playing: 'Steam 收束',
};
const ORDER: EventKind[] = ['came_online', 'back_from_away', 'started_playing', 'switched_game', 'achievement_unlocked', 'stopped_playing'];

export const minutesText = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} 分钟`;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
};

const fact = (label: string, value: string): PresentationFact => ({ label, value, evidenceRefs: [] });
const quoted = (person: AnnouncementPerson): string => (person.achievements ?? []).map((item) => `「${item.name}」`).join('、');

function sentence(person: AnnouncementPerson, detailed: boolean): string {
  const { name, game } = person;
  switch (person.kind) {
    case 'came_online': return game ? `${name} 上线了，正在玩 ${game}。` : `${name} 上线了。`;
    case 'back_from_away': return game ? `${name} 离开了一阵后又上线了，正在玩 ${game}。` : `${name} 离开了一阵后又上线了。`;
    case 'started_playing': return game ? `${name} 开始玩 ${game}。` : `${name} 开始玩游戏了。`;
    case 'switched_game': return game ? `${name} 换成了 ${game}。` : `${name} 换了个游戏。`;
    case 'achievement_unlocked': {
      const count = person.achievements?.length ?? 0;
      const where = game ? `在 ${game} 里` : '';
      const what = count > 1 ? `${count} 个成就` : '成就';
      return `${name} ${where}解锁了${what}${detailed && count ? `：${quoted(person)}` : ''}。`;
    }
    case 'stopped_playing': {
      const base = game ? `${name} 结束了 ${game}` : `${name} 结束了游戏`;
      return `${base}${detailed && person.durationMinutes !== undefined ? `（本局 ${minutesText(person.durationMinutes)}）` : ''}。`;
    }
  }
}

function singleFacts(person: AnnouncementPerson): PresentationFact[] {
  const facts: PresentationFact[] = [fact('成员', person.name)];
  if (person.steamName) facts.push(fact('Steam', person.steamName));
  const game = person.game ? [fact('游戏', person.game)] : [];
  switch (person.kind) {
    case 'came_online': return [...facts, ...game, fact('状态', person.game ? '游戏中' : '在线')];
    case 'back_from_away': return [...facts, ...game, fact('状态', person.game ? '游戏中' : '在线')];
    case 'started_playing': return [...facts, ...game, fact('状态', '游戏中')];
    case 'switched_game': return [...facts, ...game, fact('状态', '游戏中'), ...(person.previous ? [fact('上一局', `${person.previous.gameName ? `${person.previous.gameName}，` : ''}${minutesText(person.previous.minutes)}`)] : [])];
    case 'achievement_unlocked': {
      const items = person.achievements ?? [];
      const rates = items.filter((item) => item.globalPercent !== undefined);
      const rateText = items.length === 1 ? `${rates[0]?.globalPercent}%` : rates.map((item) => `「${item.name}」${item.globalPercent}%`).join('、');
      return [...facts, ...game, ...(items.length ? [fact('成就', quoted(person))] : []), ...(rates.length ? [fact('全球解锁率', rateText)] : [])];
    }
    case 'stopped_playing': return [...facts, ...game, ...(person.durationMinutes !== undefined ? [fact('本局时长', minutesText(person.durationMinutes))] : [])];
  }
}

/** One message per kind present in the batch; a lone event gets the full fact list, several share one message. */
export function renderSteamNotifications(facts: AnnouncementFacts, now: Date = new Date()): string[] {
  const messages: string[] = [];
  const occurredAt = now.toISOString();
  for (const kind of ORDER) {
    const people = facts.people.filter((person) => person.kind === kind);
    if (!people.length) continue;
    const single = people.length === 1;
    const notification = adaptWorldlineNotification({
      type: 'worldline_notification_intent',
      eventType: `steam.${kind}`,
      kind: 'steam_activity',
      severity: 'info',
      significance: 'minor',
      eventKey: `steam:${facts.groupId}:${kind}:${occurredAt}`,
      source: 'steam',
      headline: TITLES[kind],
      summary: people.map((person) => sentence(person, !single)).join('\n'),
      facts: single ? singleFacts(people[0]!) : [fact('成员', people.map((person) => person.name).join('、'))],
      occurredAt,
      worldLineClosing: true,
    });
    messages.push(renderOwnerNotification(notification, { now: occurredAt }));
  }
  return messages;
}
