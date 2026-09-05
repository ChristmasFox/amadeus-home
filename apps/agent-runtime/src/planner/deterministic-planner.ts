import { randomUUID } from 'node:crypto';
import type { TeamConfig } from '../config/team.js';
import { DEFAULT_TEAM, playerAliasMap } from '../config/team.js';
import type { CanonicalQuery, MatchSelector, Metric, Selector, Subject } from '../schema/query.js';
import { CanonicalQuerySchema } from '../schema/query.js';

export interface PlannerContextHint {
  activeDomain?: string | null;
  lastSelector?: Selector | null;
  lastResultSetId?: string | null;
  lastQuery?: CanonicalQuery | null;
  activeMatchId?: string | null;
  activeMatchOrdinal?: number | null;
  activeReviewResultSetId?: string | null;
  sourceMatchResultSetId?: string | null;
  pendingMatchSelection?: Record<string, unknown> | null;
}

export interface PlannerInput {
  text: string;
  queryId?: string;
  sessionId?: string;
  context?: PlannerContextHint;
  now?: Date;
}

const METRIC_ALIASES: Array<[Metric, RegExp]> = [
  ['avg_damage', /场均伤害|平均伤害/u],
  ['headshot_kills', /爆头|爆头击杀/u],
  ['survival_time', /生存时间|活多久/u],
  ['longest_kill', /最远击杀|最长击杀/u],
  ['assists', /助攻|辅助/u],
  ['dbnos', /倒地|击倒/u],
  ['revives', /救援|扶人/u],
  ['damage', /伤害|输出/u],
  ['kills', /击杀|杀人|人头/u],
  ['wins', /吃鸡|胜场|第一名/u],
  ['top10', /Top\s*10|前十|前10/u],
  ['rank', /排名|名次|名次最好/u],
  ['kd', /\bKD\b|K\/D|场均击杀|杀伤比/u],
  ['matches', /场次|几把|多少场|打了几把/u],
];

function has(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function explicitSelector(text: string): { selector: Selector; label: string } | null {
  const lastN = text.match(/最近\s*(\d+)\s*(?:场|把|局)/u);
  if (lastN) {
    const count = Math.max(1, Math.min(1000, Number(lastN[1])));
    return { selector: { type: 'last_n_matches', count, offset: 0, label: `最近${count}场` }, label: `最近${count}场` };
  }
  const recentDays = text.match(/(?:最近|过去)\s*(\d+)\s*天/u);
  if (recentDays) {
    const count = Math.max(1, Math.min(366, Number(recentDays[1])));
    return { selector: { type: 'recent_days', count, label: `最近${count}天` }, label: `最近${count}天` };
  }
  if (/(?:昨晚|昨天晚上|昨日晚上|晚上|晚间|凌晨|早上|下午|上午)\s*\d{1,2}(?::\d{1,2})?\s*(?:点|时)?\s*(?:以后|之后|开始|起)|\d{1,2}(?::\d{1,2})?\s*(?:点|时)以后/u.test(text)) {
    return { selector: { type: 'relative_period', value: text, label: '指定时段' }, label: '指定时段' };
  }
  if (/今天|今日/u.test(text)) return { selector: { type: 'relative_period', value: 'today', label: '今天' }, label: '今天' };
  if (/昨晚|昨天晚上/u.test(text)) return { selector: { type: 'relative_period', value: 'last_night', label: '昨晚' }, label: '昨晚' };
  if (/昨天|昨日/u.test(text)) return { selector: { type: 'relative_period', value: 'yesterday', label: '昨天' }, label: '昨天' };
  if (/前天|前日/u.test(text)) return { selector: { type: 'relative_period', value: 'day_before_yesterday', label: '前天' }, label: '前天' };
  if (/大前天|大前日/u.test(text)) return { selector: { type: 'relative_period', value: 'three_days_ago', label: '大前天' }, label: '大前天' };
  if (/(\d+)天前/u.test(text)) {
    const count = Number(text.match(/(\d+)天前/u)?.[1] ?? 1);
    return { selector: { type: 'relative_period', value: `${count}_days_ago`, label: `${count}天前` }, label: `${count}天前` };
  }
  if (/上周(?![一二三四五六日天0-6])/u.test(text)) return { selector: { type: 'relative_period', value: 'last_week', label: '上周' }, label: '上周' };
  if (/本周/u.test(text)) return { selector: { type: 'relative_period', value: 'this_week', label: '本周' }, label: '本周' };
  if (/上周[一二三四五六日天0-6]/u.test(text)) {
    const label = text.match(/上周[一二三四五六日天0-6]/u)?.[0] ?? '上周';
    return { selector: { type: 'relative_period', value: label, label }, label };
  }
  if (/(?:\d{4}\s*[年/-]\s*)?\d{1,2}\s*[月/-]\s*\d{1,2}\s*(?:日|号)?/u.test(text)) return { selector: { type: 'relative_period', value: text, label: '指定日期' }, label: '指定日期' };
  return null;
}

function extractMetric(text: string): Metric | null {
  for (const [metric, pattern] of METRIC_ALIASES) if (pattern.test(text)) return metric;
  return null;
}

export function isReviewIntent(text: string): boolean {
  return /复盘|分析(?:某一局|这把|这场|一局|一场)|看看(?:这把|这局|这场|这一局|最后一把)怎么打|这把怎么打|最后一把为什么输|对局复盘|整活|离谱|内鬼|打队友|撞人|闪光弹|有什么节目/u.test(text);
}

function reviewProfile(text: string, subjectExplicit: boolean): NonNullable<CanonicalQuery['presentation']['profile']> {
  if (/详细|细一点|完整一点/u.test(text)) return 'detailed';
  if (/搞笑|好玩|娱乐|整活|离谱|内鬼|打队友|撞人|闪光弹|拳击|队伤|队友伤害|乘车|旅游团|节目/u.test(text)) return 'fun';
  if (/火箭筒|Panzerfaust|重武器|军火/u.test(text)) return 'weapon';
  if (/开车|载具|驾驶|车辆/u.test(text)) return 'vehicle';
  if (/谁最C|谁最强|关键人物|团战|最后团|战斗|怎么打/u.test(text)) return 'combat';
  if (subjectExplicit) return 'personal';
  return 'default';
}

function ordinalValue(value: string): number | null {
  if (/^\d+$/u.test(value)) return Number(value);
  const digits: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (digits[value] !== undefined) return digits[value]!;
  if (value === '十') return 10;
  if (value.length === 2 && value[0] === '十' && digits[value[1]!] !== undefined) return 10 + digits[value[1]!]!;
  if (value.length === 2 && digits[value[0]!] !== undefined && value[1] === '十') return digits[value[0]!]! * 10;
  if (value.length === 3 && digits[value[0]!] !== undefined && value[1] === '十' && digits[value[2]!] !== undefined) return digits[value[0]!]! * 10 + digits[value[2]!]!;
  return null;
}

function pendingSelectionOrdinal(text: string): number | null {
  const normalized = text.trim();
  if (/^\d{1,3}$/u.test(normalized)) return Number(normalized);
  const symbol = '①②③④⑤⑥⑦⑧⑨⑩'.indexOf(normalized);
  if (symbol >= 0) return symbol + 1;
  const match = normalized.match(/^第\s*(\d{1,3}|[一二两三四五六七八九十]+)\s*(?:场|把|局)?$/u);
  return match ? ordinalValue(match[1]!) : null;
}

function reviewMatchSelector(text: string, context: PlannerContextHint | undefined, reviewOperation: boolean): MatchSelector | null {
  const boundedOrdinal = (value: number): number => Math.max(1, Math.min(1000, value));
  if (!reviewOperation) return null;
  const pendingOrdinal = pendingSelectionOrdinal(text);
  if (pendingOrdinal !== null && context?.pendingMatchSelection?.resultSetId) {
    return { type: 'ordinal', ordinal: boundedOrdinal(pendingOrdinal) };
  }
  const fromEnd = text.match(/倒数\s*第\s*(\d+|[一二两三四五六七八九十]+)\s*(?:把|场|局)/u);
  if (fromEnd) {
    return { type: 'ordinal_from_end', ordinal: boundedOrdinal(ordinalValue(fromEnd[1]!) ?? 1) };
  }
  const ordinalMatch = text.match(/第\s*(\d+|[一二两三四五六七八九十]+)\s*(?:把|场|局)/u);
  if (ordinalMatch) {
    return { type: 'ordinal', ordinal: boundedOrdinal(ordinalValue(ordinalMatch[1]!) ?? 1) };
  }
  if (/上一把|上一场|上一局/u.test(text)) return { type: 'previous' };
  if (/下一把|下一场|下一局/u.test(text)) return { type: 'next' };
  if (/最早一把|第一把|第一场|第一局/u.test(text)) return { type: 'earliest' };
  if (/刚才(?:那把|那场|那局)?/u.test(text)) return { type: 'latest', recent: true };
  if (/最后一把|最后一场|最后一局|最新一把|最近一把/u.test(text)) {
    return { type: 'latest', recent: /刚才|最近/u.test(text) };
  }
  if (/吃鸡(?:那把|的那把|那场|的那场)|第\s*1\s*(?:名|名那把)/u.test(text)) {
    return { type: 'filtered', filters: { placement: 1 } };
  }
  const rankedMetric = /伤害|输出/u.test(text)
    ? 'teamDamage'
    : /助攻/u.test(text)
      ? 'teamAssists'
      : /击杀|人头/u.test(text)
        ? 'teamKills'
        : null;
  if (rankedMetric && /最高|最多|最大|最好/u.test(text)) {
    return { type: 'ranked', metric: rankedMetric, direction: 'desc' };
  }
  if (context?.activeMatchId && /这把|这局|这场|该局|该场/u.test(text)) return { type: 'active_match' };
  if (context?.activeMatchId && reviewOperation && isContextualFollowUp(text)) return { type: 'active_match' };
  return null;
}

function extractSubject(text: string, team: TeamConfig): { subject: Subject; explicit: boolean } {
  const aliases = playerAliasMap(team);
  const normalized = text.toLowerCase();
  const players = team.players.filter((player) => [player.id, player.name, ...player.aliases].some((alias) => normalized.includes(alias.toLowerCase())));
  if (players.length === 1 && players[0]) {
    return { subject: { type: 'player', ids: [players[0].id], label: players[0].name }, explicit: true };
  }
  if (players.length > 1) {
    return { subject: { type: 'players', ids: players.map((player) => player.id), label: players.map((player) => player.name).join('、') }, explicit: true };
  }
  const matchedAlias = [...aliases.entries()].find(([alias]) => normalized.includes(alias));
  if (matchedAlias) return { subject: { type: 'player', ids: [matchedAlias[1].id], label: matchedAlias[1].name }, explicit: true };
  return { subject: { type: 'team', ids: [team.id], label: team.label }, explicit: false };
}

function isContextualFollowUp(text: string): boolean {
  const normalized = text.trim();
  return /^(?:那|这|他|他们|其中|刚才|上一|下一|前面)/u.test(normalized)
    || /详细|细一点|多说点|搞笑点|好玩一点/u.test(normalized)
    || /这把|这局|这场|上一把|下一把|火箭筒|重武器|开车|载具|整活|离谱|内鬼|打队友|撞人|闪光弹|拳击|队伤|队友伤害|乘车|旅游团|节目/u.test(normalized)
    || (/(?:呢|吗|吧)[？?！!。\.\s]*$/u.test(normalized) && normalized.length <= 24);
}

function inheritSubject(
  subjectResult: { subject: Subject; explicit: boolean },
  input: PlannerInput,
  text: string,
): { subject: Subject; explicit: boolean } {
  const previous = input.context?.lastQuery;
  if (subjectResult.explicit || !previous?.reference.subjectExplicit || !isContextualFollowUp(text)) return subjectResult;
  return { subject: previous.subject, explicit: true };
}

function selectorFromToken(token: string): Selector {
  const result = explicitSelector(token);
  return result?.selector ?? { type: 'relative_period', value: token, label: token };
}

function compareSegments(text: string, context?: PlannerContextHint): { segments: Array<{ label: string; selector: Selector }>; selector: Selector; fromContext: boolean } | null {
  const explicitYesterday = /昨天|昨日/u.test(text);
  const explicitDayBefore = /前天|前日/u.test(text);
  if (explicitYesterday && explicitDayBefore) {
    return {
      segments: [
        { label: '昨天', selector: selectorFromToken('昨天') },
        { label: '前天', selector: selectorFromToken('前天') },
      ],
      selector: selectorFromToken('昨天'),
      fromContext: false,
    };
  }
  const lastN = text.match(/最近\s*(\d+)\s*(?:场|把|局)/u);
  if (lastN && /之前|前\s*\d+|上一段/u.test(text)) {
    const count = Number(lastN[1]);
    return {
      segments: [
        { label: `最近${count}场`, selector: { type: 'last_n_matches', count, offset: 0, label: `最近${count}场` } },
        { label: `之前${count}场`, selector: { type: 'last_n_matches', count, offset: count, label: `之前${count}场` } },
      ],
      selector: { type: 'last_n_matches', count, offset: 0, label: `最近${count}场` },
      fromContext: false,
    };
  }
  if (/跟前天比|和前天比|与前天相比|对比前天/u.test(text)) {
    const second = selectorFromToken('前天');
    const first = context?.lastSelector ?? { type: 'relative_period', value: 'today', label: '今天' };
    return {
      segments: [
        { label: first.label ?? '上一周期', selector: first },
        { label: '前天', selector: second },
      ],
      selector: first,
      fromContext: !context?.lastSelector,
    };
  }
  return null;
}

function unsupportedCapability(text: string): string | null {
  if (/枪|武器|用什么枪|weapon/u.test(text)) return 'weapon';
  if (/telemetry|载具轨迹|射击轨迹|伤害明细/u.test(text)) return 'telemetry';
  if (/赛季|season/u.test(text)) return 'season_stats';
  if (/生涯|lifetime/u.test(text)) return 'lifetime_stats';
  return null;
}

export function buildDeterministicQuery(input: PlannerInput, team: TeamConfig = DEFAULT_TEAM): CanonicalQuery {
  const text = String(input.text ?? '').trim() || '今日战绩';
  const queryId = input.queryId ?? `q_${randomUUID()}`;
  const sessionId = input.sessionId ?? 'unknown-session';
  const subjectResult = inheritSubject(extractSubject(text, team), input, text);
  const selectorResult = explicitSelector(text);
  const compare = compareSegments(text, input.context);
  const metric = extractMetric(text);
  const previous = input.context?.lastQuery;
  const inheritedReview = Boolean(previous?.operation === 'review_match' && isContextualFollowUp(text));
  const pendingOrdinal = pendingSelectionOrdinal(text);
  const pendingMatchSelection = Boolean(
    pendingOrdinal !== null
      && input.context?.pendingMatchSelection?.resultSetId,
  );
  const reviewOperation = isReviewIntent(text) || inheritedReview || pendingMatchSelection;
  const unsupported = reviewOperation ? null : unsupportedCapability(text);
  const selectedMatchSelector = reviewMatchSelector(text, input.context, reviewOperation);
  const isMatchLevel = /哪一把|哪一局|哪一场|单局|那场|该场/u.test(text);
  const isTrend = /趋势|变好|变差|状态如何|状态是不是|最近几天表现/u.test(text);
  const isCompare = Boolean(compare) || /\bvs\b|相比|比较|对比|跟.+比/u.test(text);
  const isStrongest = /最强|最猛|发挥最好|状态最好|C了|表现最好/u.test(text);
  const isWeakest = /最菜|最拉|拉胯|拉完了|最坑|发挥最差|状态最差/u.test(text);
  const isList = /列出|有哪些比赛|比赛列表|每一把/u.test(text);
  const explicitSelectorFlag = Boolean(selectorResult || compare || pendingMatchSelection);
  const useResultSet = !reviewOperation && !explicitSelectorFlag && Boolean(input.context?.lastResultSetId) && /其中|刚才|上一组|这些比赛|哪一把|哪场|哪局|那场|那些比赛/u.test(text);
  let operation: CanonicalQuery['operation'] = 'report';
  let groupBy: CanonicalQuery['groupBy'] = 'player';
  let orderMetric: Metric = 'kd';
  let direction: 'asc' | 'desc' = 'desc';
  let limit: number | null = null;

  const explicitlyRequestsReport = /战绩|报告|总览|整体表现|小队表现/u.test(text);
  const canInheritOperation = Boolean(
    previous
      && isContextualFollowUp(text)
      && !explicitlyRequestsReport
      && !isTrend
      && !isCompare
      && !isMatchLevel
      && !isStrongest
      && !isWeakest
      && !isList
      && !metric,
  );

  if (reviewOperation) {
    operation = 'review_match';
    groupBy = 'match';
    orderMetric = 'damage';
  } else if (unsupported) {
    operation = 'report';
  } else if (isTrend) {
    operation = 'trend';
    groupBy = 'day';
    orderMetric = metric ?? 'kd';
  } else if (isCompare) {
    operation = 'compare';
    groupBy = 'player';
  } else if (isMatchLevel) {
    operation = 'rank';
    groupBy = 'match';
    orderMetric = metric ?? 'damage';
    limit = 1;
  } else if (isStrongest) {
    operation = 'strongest';
    groupBy = 'player';
    orderMetric = 'performance_score';
    limit = 1;
  } else if (isWeakest) {
    operation = 'weakest';
    groupBy = 'player';
    orderMetric = 'chicken_index';
    limit = 1;
  } else if (metric && (/谁|哪个人|队友|玩家|最高|最多|最低|最少/u.test(text))) {
    operation = 'rank';
    groupBy = 'player';
    orderMetric = metric;
    direction = /最低|最少|最好排名/u.test(text) ? 'asc' : 'desc';
    limit = 1;
  } else if (isList) {
    operation = 'list';
    groupBy = 'match';
    orderMetric = 'rank';
    limit = 20;
  } else if (/详情|详细|具体数据|那场比赛/u.test(text)) {
    operation = 'detail';
    groupBy = isMatchLevel ? 'match' : 'player';
  }

  if (canInheritOperation && previous && ['strongest', 'weakest', 'rank', 'detail', 'list', 'review_match'].includes(previous.operation)) {
    operation = previous.operation;
    groupBy = previous.groupBy;
    orderMetric = previous.orderBy.metric;
    direction = previous.orderBy.direction;
    limit = previous.limit;
  }

  let selector: Selector = selectorResult?.selector ?? { type: 'relative_period', value: 'today', label: '今天' };
  if (pendingMatchSelection && input.context?.pendingMatchSelection?.resultSetId) {
    selector = {
      type: 'result_set',
      resultSetId: String(input.context.pendingMatchSelection.resultSetId),
      label: '待选择复盘',
    };
  }
  if (useResultSet && input.context?.lastResultSetId) {
    selector = { type: 'result_set', resultSetId: input.context.lastResultSetId, label: '上一组比赛' };
  }
  if (compare) selector = compare.selector;

  const query: CanonicalQuery = {
    version: 3,
    queryId,
    domain: 'pubg',
    subject: subjectResult.subject,
    operation,
    selector,
    matchSelector: selectedMatchSelector,
    segments: compare?.segments ?? [],
    groupBy,
    metrics: [
      'matches', 'kills', 'assists', 'damage', 'avg_damage', 'kd', 'deaths', 'wins', 'top10', 'rank', 'dbnos', 'revives', 'headshot_kills', 'survival_time', 'longest_kill', 'performance_score', 'chicken_index',
    ],
    filters: { competitiveOnly: true },
    orderBy: { metric: orderMetric, direction },
    limit,
    reference: {
      selectorExplicit: explicitSelectorFlag,
      subjectExplicit: subjectResult.explicit,
      useResultSet,
      inheritedFromContext: false,
      ...(useResultSet && input.context?.lastResultSetId ? { resultSetId: input.context.lastResultSetId } : {}),
      ...(compare?.fromContext ? { compareFromContext: true } : {}),
      ...(unsupported ? { unsupportedCapability: unsupported } : {}),
      planner: 'deterministic_fallback',
    },
    presentation: { compact: false, ...(reviewOperation ? { profile: reviewProfile(text, subjectResult.explicit) } : {}) },
  };
  return CanonicalQuerySchema.parse(query);
}

export function isPubgText(text: string, context?: PlannerContextHint): boolean {
  // Keep planner-side legacy classification aligned with the domain router:
  // TimeRange tokens are parameters, not standalone PUBG intent.
  if (context?.activeDomain === 'pubg') return true;
  return /PUBG|绝地求生|吃鸡|战绩|KD|K\/D|击杀|助攻|伤害|倒地|救援|复盘|分析(?:这把|这局|这场|某一局|某一场|战绩|表现|数据)|火箭筒|排名|名次|场均|几把|多少场|最近\s*\d+\s*(?:场|把|局)|最强|最菜|拉完|发挥最好|状态最好|表现最好|整活|离谱|内鬼|打队友|撞人|闪光弹|拳击|队伤|队友伤害|乘车|旅游团|有什么节目/iu.test(text);
}
