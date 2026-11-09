import { KURISU_VOICE_ANCHOR } from '@rine-kit/pubg-reply';
import { nineRouterCompleter, type Completer } from '../dm-digest.js';
import type { AnnouncementFacts } from './poller.js';

const MAX_TEXT = 220;

/** The facts are decided by code; the model only words them. No fixed template exists as a fallback. */
export function buildAnnouncementPrompt(facts: AnnouncementFacts): string {
  const lines = facts.people.map((person) => `- ${person.name}${person.game ? `，正在玩 ${person.game}` : '，在线'}`);
  return [
    KURISU_VOICE_ANCHOR,
    '',
    '【任务】群里有成员刚刚在 Steam 上线了。用你自己的口吻，在群里自然地说一两句话告诉大家。',
    '只依据下面的事实：名字原样使用，不要编造他们在做什么、玩多久或游戏之外的信息，不要 @ 任何人，不要加链接，不超过 60 个字。每个名字都要提到。只输出要发到群里的那句话本身。',
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
