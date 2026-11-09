/**
 * "Last N matches" as a first-class request. The squad's recent matches are a count, never a date range:
 * a model that reads "近5场战绩" as a 战绩 (record) request tends to fill the period selector with today,
 * which is empty before the squad has played and answers "no matches". These helpers make the count win.
 */

const DIGITS: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function chineseNumber(text: string): number | null {
  if (/^\d+$/u.test(text)) return Number(text);
  if (text === '十') return 10;
  const tens = /^([一二两三四五六七八九])?十([一二三四五六七八九])?$/u.exec(text);
  if (tens) return (tens[1] ? DIGITS[tens[1]]! : 1) * 10 + (tens[2] ? DIGITS[tens[2]]! : 0);
  if (text.length === 1 && text in DIGITS) return DIGITS[text]!;
  return null;
}

// 近5场 / 最近10场 / 最近三局 / 前5把 / 过去 5 场 — the unit (场/局/把/盘) is required, so 近5天 and 近一周 never match.
const RECENT_MATCHES = /(?:最近|近|前|过去|最后|上)\s*([0-9]{1,3}|[零〇一二两三四五六七八九十]{1,3})\s*(?:场|局|把|盘)/u;

/** The N in a "last N matches" request, or null. Bounded to the tool's 1..100 range. */
export function parseRecentMatchCount(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const match = RECENT_MATCHES.exec(text);
  if (!match) return null;
  const count = chineseNumber(match[1]!);
  return count !== null && count >= 1 && count <= 100 ? count : null;
}

export interface RecentMatchesSelector { type: 'last_n_matches'; count: number }

/** The selector for a statistics call: an explicit recentMatches count always beats whatever date range came with it. */
export function statsSelector(selector: unknown, recentMatches: unknown): unknown {
  if (typeof recentMatches === 'number' && Number.isInteger(recentMatches) && recentMatches >= 1 && recentMatches <= 100) {
    return { type: 'last_n_matches', count: recentMatches } satisfies RecentMatchesSelector;
  }
  if (selector === undefined || selector === null) throw new Error('pubg_query_stats needs either selector or recentMatches');
  return selector;
}

/** before_tool_call rewrite: this turn asked for the last N matches, so the call must not carry a date range instead. */
export function enforceRecentMatches(params: unknown, count: number): Record<string, unknown> | null {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
  const input = params as Record<string, unknown>;
  const selector = input.selector as { type?: unknown; count?: unknown; offset?: unknown } | undefined;
  if (input.selector === undefined && input.recentMatches === count) return null;
  if (input.recentMatches === undefined && selector?.type === 'last_n_matches' && selector.count === count) return null;
  const { selector: _dropped, ...rest } = input;
  return { ...rest, recentMatches: count };
}
