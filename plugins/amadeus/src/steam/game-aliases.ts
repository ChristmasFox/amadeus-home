/**
 * Community nicknames for well-known games, keyed by Steam appid (never by name, which Steam can change or localise).
 * A game without an entry is shown exactly as Steam names it; the alias is only ever appended in full-width brackets.
 */
export const GAME_ALIASES: Readonly<Record<string, string>> = {
  '578080': '吃鸡',
  '271590': 'GTA5',
  '730': 'CS2',
  '570': '刀塔',
  '1245620': '老头环',
  '1086940': '博德之门3',
  '2358720': '黑神话',
  '553850': '绝地潜兵2',
};

/** `name（别名）` for a game with a known alias, otherwise the name unchanged; undefined when there is no name. */
export function gameLabel(appId: string | undefined, name: string | undefined): string | undefined {
  if (!name) return undefined;
  const alias = appId ? GAME_ALIASES[appId] : undefined;
  return alias && !name.includes(alias) ? `${name}（${alias}）` : name;
}
