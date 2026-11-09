import { KURISU_VOICE_ANCHOR } from '@rine-kit/pubg-reply';
import { nineRouterCompleter, type Completer } from '../dm-digest.js';
import type { EventKind } from './domain.js';
import type { AnnouncementFacts, AnnouncementPerson } from './poller.js';

const MAX_TEXT = 220;

/** The fact each event type states, with the game name when there is one; wording is the model's job. */
const EVENT_FACT: Record<EventKind, (person: AnnouncementPerson) => string> = {
  came_online: ({ game }) => (game ? `刚上线，正在玩 ${game}` : '刚上线'),
  started_playing: ({ game }) => (game ? `本来就在线，刚开始玩 ${game}` : '本来就在线，刚开始玩游戏'),
  switched_game: ({ game }) => (game ? `刚换了游戏，现在玩的是 ${game}` : '刚换了游戏'),
  back_from_away: ({ game }) => (game ? `离开了一阵后回来了，正在玩 ${game}` : '离开了一阵后回来了'),
  achievement_unlocked: ({ game, achievements = [] }) => {
    const shown = achievements.slice(0, 3).map((item) => `「${item.name}」${item.globalPercent !== undefined ? `（全球解锁率 ${item.globalPercent}%）` : ''}`).join('、');
    const more = achievements.length > 3 ? `，等共 ${achievements.length} 个` : '';
    return `${game ? `在 ${game} 里` : ''}刚解锁了成就 ${shown}${more}`;
  },
};

/** The facts are decided by code; the model only words them. No fixed template exists as a fallback. */
export function buildAnnouncementPrompt(facts: AnnouncementFacts): string {
  const lines = facts.people.map((person) => `- ${person.name}${person.steamName ? `（Steam 账号昵称：${person.steamName}，同一个人有多个账号，需要时可带上昵称区分）` : ''}，${EVENT_FACT[person.kind](person)}`);
  return [
    KURISU_VOICE_ANCHOR,
    '',
    '【任务】群里有成员刚刚在 Steam 上有了新动静（上线 / 开始玩 / 换游戏 / 离开后回来 / 解锁成就）。按每个人事实里写的那种情况来说，用你自己的口吻，在群里自然地说一两句话告诉大家。',
    '只依据下面的事实：名字原样使用，成就名和解锁率原样引用，不要编造他们在做什么、玩多久或游戏之外的信息，不要 @ 任何人，不要加链接，不超过 60 个字。每个名字都要提到。只输出要发到群里的那句话本身。',
    '',
    '【事实】',
    ...lines,
  ].join('\n');
}

/** Accepted only when it is short plain text that names every person; anything else is a failed compose. */
export function validateAnnouncement(text: string, facts: AnnouncementFacts): string | undefined {
  const cleaned = text.trim().replace(/^["“”']+|["“”']+$/gu, '').trim();
  if (!cleaned || cleaned.length > MAX_TEXT || /https?:\/\//iu.test(cleaned) || /@\S/u.test(cleaned)) return undefined;
  return facts.people.every((person) => cleaned.includes(person.name)) ? cleaned : undefined;
}

export function kurisuComposer(complete: Completer, timeoutMs = 20_000): (facts: AnnouncementFacts) => Promise<string> {
  return async (facts) => {
    const signal = AbortSignal.timeout(timeoutMs);
    const output = await complete(buildAnnouncementPrompt(facts), signal);
    const valid = validateAnnouncement(output, facts);
    if (!valid) throw new Error('announcement_invalid');
    return valid;
  };
}

export function nineRouterComposer(config: unknown): (facts: AnnouncementFacts) => Promise<string> {
  return kurisuComposer(nineRouterCompleter(config, fetch, { temperature: 0.8, maxTokens: 200 }));
}
