/**
 * Short public labels for well-known Steam games, keyed by appid (never by a possibly localised name).
 * Unknown titles are reduced to a short base name so card and notification rows stay readable on phones.
 */
export const GAME_ALIASES: Readonly<Record<string, string>> = {
  '578080': 'PUBG',
  '271590': 'GTA5',
  '730': 'CS2',
  '570': '刀塔',
  '1245620': '老头环',
  '1086940': '博德之门3',
  '2358720': '黑神话',
  '553850': '绝地潜兵2',
  '1551360': '地平5',
  '1293830': '地平4',
  '2483190': '地平6',
  '761600': '鬼武者1',
  '3046600': '鬼武者2',
  '2638890': '鬼武者·刀剑',
  '431960': 'WE',
};

const MAX_GRAPHEMES = 10;
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
const EDITION_SUFFIX = /\s+(?:[-–—]\s*)?(?:digital\s+deluxe|deluxe|ultimate|premium|standard|definitive|complete|enhanced|remastered|remake|game\s+of\s+the\s+year|demo|playtest|beta|soundtrack|dedicated\s+server|public\s+test\s+server|test\s+server)(?:\s+edition)?\s*$/iu;
const BRACKETED_SUFFIX = /\s*[([（【]\s*(?:demo|playtest|beta|soundtrack|dedicated\s+server|test\s+server|public\s+test\s+server)[^\])）】]*[)\]）】]\s*$/iu;

function graphemes(value: string): string[] {
  return [...segmenter.segment(value)].map((part) => part.segment);
}

function shortUnknownName(name: string): string {
  const original = name.replace(/[™®©]/gu, '').replace(/\s+/gu, ' ').trim();
  let short = original;
  while (EDITION_SUFFIX.test(short)) short = short.replace(EDITION_SUFFIX, '').trim();
  while (BRACKETED_SUFFIX.test(short)) short = short.replace(BRACKETED_SUFFIX, '').trim();
  short = (short.split(/\s*(?::|：|\||—|–)\s*/u, 1)[0] ?? '').trim().replace(/[\s\-–—:：|]+$/u, '');
  if (!short) short = original;
  const parts = graphemes(short);
  return parts.length > MAX_GRAPHEMES ? `${parts.slice(0, MAX_GRAPHEMES - 1).join('').trimEnd()}…` : short;
}

/** A short public label; undefined when the source did not provide a game name. */
export function gameLabel(appId: string | undefined, name: string | undefined): string | undefined {
  if (!name) return undefined;
  const alias = appId ? GAME_ALIASES[appId] : undefined;
  return alias ?? shortUnknownName(name);
}
