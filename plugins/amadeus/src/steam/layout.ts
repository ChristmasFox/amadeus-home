/**
 * The one layout every Steam message shares (notices, cards, the morning report): the first line says who and what
 * (Amadeus + name + action, then the kind emoji at the end, so a push preview says who and what), then the fact lines and the sign-off.
 */
export const BRAND = 'Amadeus';
export const SIGN_OFF = 'El Psy Kongroo.';

export interface CardFact { label: string; value: string }

export function renderLayout(emoji: string, headline: string, facts: CardFact[]): string {
  const lines = [`${BRAND} · ${headline} ${emoji}`];
  if (facts.length) lines.push('', ...facts.map((item) => `- ${item.label}：${item.value}`));
  lines.push('', SIGN_OFF);
  return lines.join('\n');
}

/** Names for a title: up to three listed, more become 「前两位 等N人」. */
export function namesForTitle(names: string[]): string {
  const unique = [...new Set(names)];
  return unique.length > 3 ? `${unique.slice(0, 2).join('、')} 等${unique.length}人` : unique.join('、');
}

/** 2小时05分 / 35分钟, the short form used in titles. */
export function titleDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}分钟`;
  return rest ? `${hours}小时${String(rest).padStart(2, '0')}分` : `${hours}小时`;
}

/** 今天 → 今日, 昨天 → 昨日 for titles; anything else is kept as the tool labelled it. */
export function whenForTitle(label: string): string {
  const when = label.split('（')[0] ?? label;
  return when === '今天' ? '今日' : when === '昨天' ? '昨日' : when;
}
