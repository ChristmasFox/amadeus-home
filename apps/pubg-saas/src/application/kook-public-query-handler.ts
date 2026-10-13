import {
  PubgDomainService,
  emptyContext,
  type Metric,
  type SyncState,
  type ToolEnvelope,
} from '@agent/pubg-domain';
import type { AccountClaimService } from './account-claim-service.js';
import type { KookIngressJob, KookRequestHandler } from './kook-ingress-queue.js';
import type { KookTextPayload } from './kook-message-queue.js';
import { NaturalLanguageQueryPlanner, QueryPlanSchema, type QueryPlan } from './nl-query-planner.js';
import { QueryPlanExecutor } from './query-plan-executor.js';
import type {
  AuthorizedPublicQuery,
  PublicQueryAuthorizer,
  PublicQueryTeamSelection,
} from './public-query-authorizer.js';

type LeaderboardMetric = 'damage' | 'kills' | 'kd' | 'matches' | 'avg_damage';

type PublicQueryIntent =
  | { kind: 'team_stats'; period: 'today' | 'yesterday' }
  | { kind: 'my_stats'; period: 'today' | 'yesterday' }
  | { kind: 'leaderboard'; period: 'today' | 'yesterday'; metric: LeaderboardMetric }
  | { kind: 'team_damage'; period: 'today' | 'yesterday' }
  | { kind: 'review'; period: 'today' | 'yesterday' };

interface ParsedPublicQuery {
  intent: PublicQueryIntent;
  selection?: PublicQueryTeamSelection;
  commandText: string;
}

export interface KookPublicQueryServices {
  authorizer: PublicQueryAuthorizer;
  claims: AccountClaimService;
  planner?: {
    planner: Pick<NaturalLanguageQueryPlanner, 'plan'>;
    provider: string;
    modelId: string;
  } | null;
  executor?: QueryPlanExecutor;
  now?: () => Date;
}

const metricLabels: Record<string, string> = {
  matches: '场次', kills: '击杀', assists: '助攻', damage: '伤害', avg_damage: '场均伤害',
  kd: 'KD', wins: '吃鸡', top10: '前十', revives: '救援',
};

function message(content: string): KookTextPayload { return { type: 'text', content: content.slice(0, 4000) }; }

const queryResultMessages: Record<string, string> = {
  follow_up_context_required: '这条追问没有可用的上一条查询，请补充要查询的队伍、队员或时间范围。',
  query_needs_clarification: '我还不能确定你要查的对象或时间范围，请换一种说法补充条件。',
  teammate_kill_facts_unavailable: '当前公开数据没有足够事实确认队友击杀归属，因此不会猜测或生成队友击杀统计。',
  sync_state_unknown: 'PUBG 数据同步状态未知；当前不会把空缓存当作 0 场或 0 伤害。',
  period_required: '请补充查询时间，例如今天、昨天或最近七天。',
  period_not_supported: '当前无法安全解析这个时间范围，请尝试今天、昨天、最近七天或上周。',
  comparison_period_required: '请补充用于比较的第二个时间范围。',
  comparison_period_not_supported: '当前无法安全解析比较时间范围，请明确说出两个时间段。',
  period_not_supported_for_intent: '这个查询类型暂不支持该时间范围，请换成具体日期区间或常用周期。',
  player_name_required: '请提供队员在当前队伍中的游戏名或已配置别名。',
  player_not_in_authorized_roster: '没有在当前已授权队伍名单中找到这名队员。',
  player_alias_ambiguous: '这个名字对应多名队员，请提供更明确的游戏名。',
  team_damage_same_player: '误伤查询需要选择两名不同的队员。',
  review_result_set_unavailable: '当前没有可用于复盘的已覆盖对局。',
  self_identity_not_prevalidated: '请先声明并确认自己的 PUBG 账号，再查询本人数据。',
  self_player_not_in_authorized_roster: '你声明的 PUBG 账号不在当前已授权队伍名单中。',
};

function previousPlanFromContext(value: unknown): QueryPlan | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const plan = (value as Record<string, unknown>).queryPlan;
  const parsed = QueryPlanSchema.safeParse(plan);
  return parsed.success ? parsed.data : null;
}

async function persistQueryPlan(query: AuthorizedPublicQuery, plan: QueryPlan, now: Date): Promise<void> {
  const existing = await query.repository.getContext(query.conversation.sessionId, now);
  const base = existing ?? emptyContext(query.conversation.sessionId, now);
  await query.repository.setContext({
    ...base,
    activeDomain: 'pubg',
    references: { ...base.references, queryPlan: plan },
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 12 * 60 * 60_000).toISOString(),
  });
}

function rosterPlayerId(query: AuthorizedPublicQuery, name: string | null): string | null {
  if (!name) return null;
  const normalized = name.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  const matches = query.teamContext.team.players.filter(player =>
    [player.id, player.name, ...player.aliases].some(candidate => candidate.normalize('NFKC').trim().toLocaleLowerCase('en-US') === normalized));
  return matches.length === 1 ? matches[0]!.id : null;
}

function teamDamagePlanText(envelope: ToolEnvelope, query: AuthorizedPublicQuery, plan: QueryPlan, period: string, freshness: string): string {
  const data = object(envelope.data), coverage = envelope.coverage;
  if (envelope.status === 'no_matches' && coverage.complete) return `${period}队友伤害：该时段没有已覆盖的队伍对局。\n${freshness}`;
  const actorId = rosterPlayerId(query, plan.actorName ?? plan.playerName);
  const victimId = rosterPlayerId(query, plan.victimName);
  const allDirections = Array.isArray(data?.directions) ? data.directions.map(object).filter((row): row is Record<string, unknown> => Boolean(row)) : [];
  const directions = allDirections
    .filter(row => (!actorId || object(row.actor)?.playerId === actorId) && (!victimId || object(row.victim)?.playerId === victimId))
    .sort((left, right) => Number(right.knownDamage ?? 0) - Number(left.knownDamage ?? 0));
  if (!directions.length) return `${coverage.complete ? '没有发现符合条件的队友伤害记录。' : '队友伤害资料覆盖不完整，无法确认结果；当前不会认定为 0。'}\n${freshness}`;
  const ranked: Array<Record<string, unknown>> = !actorId && !victimId
    ? [...directions.reduce((totals, row) => {
      const actor = object(row.actor) ?? {}, key = String(actor.playerId ?? '');
      const total = totals.get(key) ?? { name: safeLabel(actor.name), damage: 0, hitCount: 0 };
      total.damage += Number(row.knownDamage ?? 0);
      total.hitCount += Number(row.knownHitCount ?? 0);
      totals.set(key, total);
      return totals;
    }, new Map<string, { name: string; damage: number; hitCount: number }>()).values()]
      .sort((left, right) => right.damage - left.damage || left.name.localeCompare(right.name))
      .map(total => ({ actorName: total.name, knownDamage: total.damage, knownHitCount: total.hitCount }))
    : directions;
  const lines = ranked.slice(0, 4).map(row => {
    const complete = coverage.complete && row.complete !== false;
    const direction = typeof row.actorName === 'string'
      ? safeLabel(row.actorName)
      : `${safeLabel(object(row.actor)?.name)} → ${safeLabel(object(row.victim)?.name)}`;
    return `${direction}：${complete ? '' : '已知至少 '}${numberText(complete ? row.damage : row.knownDamage)} 伤害 / ${numberText(complete ? row.hitCount : row.knownHitCount)} 次`;
  });
  const qualifier = coverage.complete ? '按已覆盖资料排序' : '部分遥测，仅显示已知下限，排名可能变化';
  return `${period}${actorId || victimId ? '定向队友误伤' : '队伍误伤榜'}（${qualifier}）\n${lines.join('\n')}\n${freshness}`;
}

function comparisonText(envelope: ToolEnvelope, period: string, freshness: string): string {
  const data = object(envelope.data), segments = Array.isArray(data?.segments)
    ? data.segments.map(object).filter((segment): segment is Record<string, unknown> => Boolean(segment)) : [];
  if (segments.length < 2) return `比较结果资料不完整，无法给出可靠对比。\n${freshness}`;
  const sections = segments.slice(0, 2).map(segment => {
    const rows = Array.isArray(segment.rows) ? segment.rows.map(object).filter((row): row is Record<string, unknown> => Boolean(row)) : [];
    const lines = rows.slice(0, 4).map(row => {
      const metrics = object(row.metrics) ?? {};
      return `${safeLabel(row.label ?? row.key)}：击杀 ${numberText(metrics.kills)} · 伤害 ${numberText(metrics.damage)} · 场次 ${numberText(metrics.matches)}`;
    });
    return `${safeLabel(segment.label ?? period)}\n${lines.length ? lines.join('\n') : '该时段没有可展示的数据行。'}`;
  });
  const status = envelope.status === 'partial' || !envelope.coverage.complete ? '（部分覆盖）' : '';
  return `战绩对比${status}\n${sections.join('\n')}\n${freshness}`;
}

function periodDisplay(period: QueryPlan['period']): string {
  return ({
    today: '今天', yesterday: '昨天', last_night: '昨晚', last_7_days: '最近七天', previous_7_days: '此前七天',
    this_week: '本周', last_week: '上周', last_match: '最近一场', recent_matches: '最近多场', previous_period: '上一周期',
  } as const)[period ?? 'today'];
}

function safeLabel(value: unknown): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/@/gu, '＠')
    .replace(/[\[\]`*_~>|]/gu, character => ({ '[': '［', ']': '］', '`': '｀', '*': '＊', '_': '＿', '~': '～', '>': '＞', '|': '｜' })[character] ?? character)
    .trim().slice(0, 100);
}

function parsePeriod(token: string | undefined): 'today' | 'yesterday' | null {
  if (!token) return 'today';
  const normalized = token.toLowerCase();
  if (['today', '今天', '今日'].includes(normalized)) return 'today';
  if (['yesterday', '昨天', '昨日'].includes(normalized)) return 'yesterday';
  return null;
}

function parseMetric(token: string | undefined): LeaderboardMetric | null {
  if (!token) return 'damage';
  const normalized = token.toLowerCase();
  if (['damage', '伤害'].includes(normalized)) return 'damage';
  if (['kills', 'kill', '击杀'].includes(normalized)) return 'kills';
  if (['kd'].includes(normalized)) return 'kd';
  if (['matches', 'match', '场次'].includes(normalized)) return 'matches';
  if (['avg_damage', '场均伤害'].includes(normalized)) return 'avg_damage';
  return null;
}

/** A deliberately small deterministic command surface. Unrecognized text is
 * left for the management/help handler; it is never promoted to a guessed query. */
export function parseKookPublicQuery(content: string): ParsedPublicQuery | null {
  const prefix = /^(?:\/|!)pubg(?:\s+|$)([\s\S]*)$/iu.exec(content.trim());
  if (!prefix) return null;
  const tokens = prefix[1]!.trim().split(/\s+/u).filter(Boolean);
  if (!tokens.length) return null;
  let selection: PublicQueryTeamSelection | undefined;
  if (tokens[0]!.toLowerCase() === 'select') {
    if (tokens.length < 4 || !/^[A-Za-z0-9_-]{1,128}$/u.test(tokens[1]!) || !/^[A-Za-z0-9_-]{1,128}$/u.test(tokens[2]!)) return null;
    selection = { tenantId: tokens[1]!, teamId: tokens[2]! };
    tokens.splice(0, 3);
  }
  const commandText = tokens.join(' ');

  const first = tokens[0]!.toLowerCase();
  let intent: PublicQueryIntent | null = null;
  if (['today', '今天', '今日', 'yesterday', '昨天', '昨日'].includes(first)) {
    const period = parsePeriod(tokens[0]);
    if (tokens.length === 1 && period) intent = { kind: 'team_stats', period };
  } else if (first === 'me' || first === 'mine' || first === 'my' || first === '我的数据' || first === '我的战绩') {
    const args = first === 'my' && tokens[1]?.toLowerCase() === 'stats' ? tokens.slice(2) : tokens.slice(1);
    const period = parsePeriod(args[0]);
    if (args.length <= 1 && period) intent = { kind: 'my_stats', period };
  } else if (first === 'leaderboard' || first === 'rank' || first === '排行榜') {
    const args = tokens.slice(1), firstMetric = parseMetric(args[0]), firstPeriod = parsePeriod(args[0]);
    const metric = firstMetric ?? 'damage';
    const period = firstMetric ? parsePeriod(args[1]) : firstPeriod ?? parsePeriod(args[1]);
    const valid = args.length === 0 || args.length === 1 && Boolean(firstMetric || firstPeriod)
      || args.length === 2 && Boolean(firstMetric) && Boolean(parsePeriod(args[1]));
    if (period && valid) intent = { kind: 'leaderboard', period, metric };
  } else if ((first === 'team' && tokens[1]?.toLowerCase() === 'damage') || first === 'teamdamage' || first === '队伤' || first === '队友伤害') {
    const periodToken = first === 'team' ? tokens[2] : tokens[1];
    const period = parsePeriod(periodToken);
    const expectedCount = first === 'team' ? 3 : 2;
    if (tokens.length === expectedCount && period) intent = { kind: 'team_damage', period };
  } else if (first === 'review' || first === '复盘') {
    const period = parsePeriod(tokens[1]);
    if (tokens.length <= 2 && period) intent = { kind: 'review', period };
  }
  if (!intent) return null;
  return { intent, ...(selection ? { selection } : {}), commandText };
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numberText(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '未知';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function freshnessNote(state: SyncState, now: Date): string {
  const checked = Date.parse(state.checkedAt);
  if (!Number.isFinite(checked)) return '数据新鲜度未知。';
  const ageMs = now.getTime() - checked;
  if (ageMs < 0) return '同步时间异常，数据新鲜度未知。';
  const time = new Date(checked).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  if (state.coverage.freshness === 'stale' || ageMs > 5 * 60_000) return `使用缓存数据（上次同步：${time}，可能已过期）。`;
  if (state.coverage.freshness === 'unknown') return `数据新鲜度未知（上次检查：${time}）。`;
  return `上次同步：${time}。`;
}

async function statsReply(services: KookPublicQueryServices, query: AuthorizedPublicQuery, period: 'today' | 'yesterday', signal: AbortSignal, playerIds?: string[], selfDeclared = false): Promise<KookTextPayload> {
  const state = await query.repository.getSyncState(`team:${query.teamContext.team.id}`);
  if (!state || state.source.syncInvoked !== true) return message('PUBG 数据同步状态未知；当前不会把空缓存当作 0 场或 0 伤害。');
  const now = services.now?.() ?? new Date();
  const freshness = freshnessNote(state, now);
  const domain = new PubgDomainService({ teamContext: query.teamContext, repository: query.repository, now: () => now });
  const envelope = await domain.queryStats({
    sessionId: query.conversation.sessionId, selector: { type: 'relative_period', value: period },
    metrics: ['matches', 'kills', 'assists', 'damage', 'kd'], operation: 'report', groupBy: 'player',
    orderBy: { metric: 'damage', direction: 'desc' }, limit: playerIds ? 1 : 4,
    refresh: false, signal, ...(playerIds ? { playerIds } : {}),
  });
  const label = period === 'today' ? '今日' : '昨日';
  const warning = selfDeclared ? '本人账号为自我声明，所有权未经验证。\n' : '';
  return message(warning + statsText(envelope, label, freshness));
}

function statsText(envelope: ToolEnvelope, period: string, freshness: string, subjectLabel = '队伍'): string {
  const data = object(envelope.data), rows = Array.isArray(data?.rows) ? data.rows.map(object).filter((row): row is Record<string, unknown> => Boolean(row)) : [];
  const coverage = envelope.coverage;
  const heading = `${period}${subjectLabel}战绩`;
  if (envelope.status === 'no_matches' && coverage.complete) return `${heading}：该时段没有已覆盖的队伍对局。\n${freshness}`;
  if (!rows.length) return `${heading}：${coverage.complete ? '没有可展示的统计行。' : '数据覆盖不完整，无法确认是否没有对局。'}\n${freshness}`;
  const shown = rows.slice(0, 4).map(row => {
    const label = safeLabel(row.label ?? row.key);
    const metrics = object(row.metrics) ?? {};
    const values = ['matches', 'kills', 'assists', 'damage', 'kd'].map(key => `${metricLabels[key]} ${numberText(metrics[key])}`);
    return `${label}：${values.join(' · ')}`;
  });
  const status = envelope.status === 'partial' || !coverage.complete ? '部分覆盖' : '已覆盖';
  return `${heading}（${status}）\n${shown.join('\n')}\n${freshness}`;
}

function leaderboardText(envelope: ToolEnvelope, period: string, metric: string, freshness: string): string {
  const data = object(envelope.data), rows = Array.isArray(data?.rows) ? data.rows.map(object).filter((row): row is Record<string, unknown> => Boolean(row)) : [];
  const coverage = envelope.coverage;
  if (envelope.status === 'no_matches' && coverage.complete) return `${period}排行榜：该时段没有已覆盖的队伍对局。\n${freshness}`;
  if (!rows.length) return `排行榜数据覆盖不完整，当前无法可靠排序。\n${freshness}`;
  const valueKey = metric;
  const lines = rows.slice(0, 4).map((row, index) => {
    const metrics = object(row.metrics) ?? {};
    return `${index + 1}. ${safeLabel(row.label ?? row.key)} — ${metricLabels[metric] ?? metric} ${numberText(metrics[valueKey])}`;
  });
  const status = envelope.status === 'partial' || !coverage.complete ? '部分覆盖，名次可能变化' : '按已覆盖数据排序';
  return `${period}${metricLabels[metric] ?? metric}榜（${status}）\n${lines.join('\n')}\n${freshness}`;
}

function teamDamageText(envelope: ToolEnvelope, period: string, freshness: string): string {
  const data = object(envelope.data), coverage = envelope.coverage;
  if (envelope.status === 'no_matches' && coverage.complete) return `${period}队友伤害：该时段没有已覆盖的队伍对局。\n${freshness}`;
  const directions = Array.isArray(data?.directions) ? data.directions.map(object).filter((row): row is Record<string, unknown> => Boolean(row)) : [];
  if (!directions.length) return `队友伤害资料不可用或覆盖不完整，不能据此认定为 0。\n${freshness}`;
  const lines = directions.slice(0, 8).map(row => {
    const actor = safeLabel(object(row.actor)?.name), victim = safeLabel(object(row.victim)?.name);
    const complete = row.complete === true;
    const amount = complete ? row.damage : row.knownDamage;
    const count = complete ? row.hitCount : row.knownHitCount;
    return `${actor} → ${victim}：${complete ? '' : '已知至少 '}${numberText(amount)} 伤害 / ${numberText(count)} 次`;
  });
  return `${period}队友伤害${envelope.status === 'partial' ? '（资料不完整）' : ''}\n${lines.join('\n')}\n${freshness}`;
}

function reviewText(envelope: ToolEnvelope, period: string, freshness: string): string {
  const data = object(envelope.data);
  const matches = Array.isArray(data?.matches) ? data.matches.map(object).filter((row): row is Record<string, unknown> => Boolean(row)) : [];
  const reviews = Array.isArray(data?.reviews) ? data.reviews.map(object).filter((row): row is Record<string, unknown> => Boolean(row)) : [];
  if (envelope.status === 'no_matches') return `${period}复盘：没有已覆盖的队伍对局。\n${freshness}`;
  if (!matches.length) return `当前没有可用的复盘资料，或 PUBG 同步状态尚未确认。\n${freshness}`;
  const summaries = reviews.slice(0, 4).map((review, index) => {
    const match = object(review.match) ?? matches[index] ?? {};
    const reviewData = object(review.data) ?? {};
    const analysis = object(reviewData.derivedAnalysis) ?? {};
    const place = safeLabel(match.placement ?? '名次未知');
    const summary = review.status === 'ok' && typeof analysis.summary === 'string'
      ? safeLabel(analysis.summary)
      : '复盘遥测资料不完整，暂不生成结论';
    return `${index + 1}. ${safeLabel(match.mapName ?? '未知地图')} · 第 ${place} 名：${summary}`;
  });
  return `${period}复盘${envelope.status === 'partial' ? '（部分资料）' : ''}\n${summaries.join('\n')}\n${freshness}`;
}

function selectionPrompt(choices: Array<{ tenantId: string; teamId: string; label: string }>, commandText: string): KookTextPayload {
  const lines = choices.slice(0, 20).map(choice => `/pubg select ${choice.tenantId} ${choice.teamId} ${commandText} — ${safeLabel(choice.label)}`);
  return message(`请明确选择有权限查询的队伍：\n${lines.join('\n')}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function naturalMessage(job: KookIngressJob): string {
  if (job.request.kind === 'direct') return job.request.event.content.trim();
  if (job.request.kind !== 'group') return '';
  const content = job.request.event.content;
  const bot = escapeRegExp(job.botAccountId);
  return content.replace(new RegExp(`^\\s*(?:<@!?${bot}>|\\(met\\)${bot}\\(met\\)|@${bot})\\s*`, 'u'), '').trim();
}

async function naturalLanguageReply(
  services: KookPublicQueryServices,
  job: KookIngressJob,
  query: AuthorizedPublicQuery,
  signal: AbortSignal,
): Promise<KookTextPayload> {
  const configured = services.planner;
  if (!configured) return message('自然语言查询尚未配置公共模型。可以先用 /pubg today、/pubg leaderboard kills yesterday 或 /pubg team damage today 查询。');
  const now = services.now?.() ?? new Date();
  const context = await query.repository.getContext(query.conversation.sessionId, now);
  const previousPlan = previousPlanFromContext(context?.references);
  const result = await configured.planner.plan({
    authorizationContext: { scopeValidated: true },
    message: naturalMessage(job),
    ...(previousPlan ? { previousPlan } : {}),
  });
  if (result.usage.requestCount > 0) {
    await query.repository.recordModelUsage(query.conversation.sessionId, {
      requestId: query.requestId,
      provider: configured.provider,
      modelId: configured.modelId,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
  }
  if (result.source !== 'model') {
    if (result.failure === 'provider_error') return message('公共模型暂时不可用，请稍后重试；也可以使用 /pubg today 等固定查询命令。');
    if (result.failure === 'input_too_long') return message('这条问题太长，请缩短到 1200 字以内后重试。');
    return message('我还不能可靠理解这个查询，请明确写出队伍或队员以及时间范围。');
  }

  let selfPlayerId: string | undefined;
  let selfWarning = '';
  if (result.plan.intent === 'my_stats' || result.plan.subject === 'self') {
    const claim = await services.claims.getClaimForActor(query.conversation.botAccountId, query.conversation.userId);
    if (!claim) return message('你还没有声明关联 PUBG 账号。请先私信发送 /pubg claim <平台> <游戏名>，确认后可查询本人数据。');
    if (claim.pubgShard !== query.teamContext.team.platform) return message('你声明的 PUBG 平台与当前队伍不同，无法从这支队伍查询本人数据。');
    if (!query.teamContext.team.players.some(player => player.id === claim.pubgAccountId)) return message('你声明的 PUBG 账号不在当前队伍名单中。');
    selfPlayerId = claim.pubgAccountId;
    if (claim.claimStatus !== 'verified') selfWarning = '本人账号为自我声明，所有权未经验证。\n';
  }

  const execution = await (services.executor ?? new QueryPlanExecutor()).execute({
    authorizedQuery: query,
    plan: result.plan,
    ...(previousPlan ? { previousPlan } : {}),
    ...(selfPlayerId ? { selfPlayerId } : {}),
    signal,
  });
  if (execution.kind !== 'executed') return message(queryResultMessages[execution.code] ?? '当前无法安全执行这条查询，请补充条件后重试。');
  await persistQueryPlan(query, execution.plan, now);

  const state = await query.repository.getSyncState(`team:${query.teamContext.team.id}`);
  const freshness = state?.source.syncInvoked === true
    ? freshnessNote(state, now)
    : 'PUBG 数据同步状态未知；当前不会把空缓存当作 0。';
  const period = periodDisplay(execution.plan.period);
  let reply: string;
  if (execution.plan.intent === 'team_damage') {
    reply = teamDamagePlanText(execution.envelope, query, execution.plan, period, freshness);
  } else if (execution.plan.intent === 'match_review') {
    reply = reviewText(execution.envelope, period, freshness);
  } else if (execution.plan.intent === 'comparison') {
    reply = comparisonText(execution.envelope, period, freshness);
  } else if (execution.plan.intent === 'leaderboard') {
    const metric = (execution.plan.metric ?? 'damage') as LeaderboardMetric;
    reply = leaderboardText(execution.envelope, period, metric, freshness);
  } else {
    const subjectLabel = execution.plan.intent === 'my_stats' ? '本人'
      : execution.plan.intent === 'player_stats' ? '队员' : '队伍';
    reply = statsText(execution.envelope, period, freshness, subjectLabel);
  }
  return message(selfWarning + reply);
}

const safeErrors: Record<string, string> = {
  public_query_access_denied: '当前身份没有这支队伍的查询权限，或你已不在对应服务器。',
  public_query_binding_changed: '频道绑定已变化，请在当前已绑定频道重新查询。',
  public_query_request_scope_changed: '本次请求的队伍授权状态已变化，请重新发起查询。',
  public_query_roster_unavailable: '队伍名单当前不可用，请联系管理员检查配置。',
  public_query_explicit_team_required: '可查询队伍较多，请联系管理员确认授权范围。',
  public_query_group_selection_forbidden: '群聊只能查询当前频道绑定的队伍。',
};

/** Executes only server-authorized, fixed-shape statistics. No model output,
 * request field or cached binding can choose the tenant, roster or destination. */
export function createKookPublicQueryHandler(services: KookPublicQueryServices): (job: KookIngressJob, signal: AbortSignal) => Promise<KookTextPayload | undefined> {
  return async (job, signal) => {
    if (job.request.kind !== 'group' && job.request.kind !== 'direct') return undefined;
    const parsed = parseKookPublicQuery(job.request.event.content);
    const explicitCommand = /^(?:\/|!)pubg(?:\s|$)/iu.test(job.request.event.content.trim());
    if (!parsed && explicitCommand) return undefined;
    if (signal.aborted) throw new Error('kook_request_aborted');
    try {
      const authorization = await services.authorizer.authorize(job, parsed?.selection);
      if (authorization.kind === 'team_selection_required') {
        if (parsed) return selectionPrompt(authorization.choices, parsed.commandText);
        return message('你可查询多支队伍，请先用 /pubg select <租户ID> <队伍ID> today 选择队伍，再在该队伍频道重新提问。');
      }
      const query = authorization.query;
      if (!parsed) return await naturalLanguageReply(services, job, query, signal);
      if (parsed.intent.kind === 'my_stats') {
        const claim = await services.claims.getClaimForActor(query.conversation.botAccountId, query.conversation.userId);
        if (!claim) return message('你还没有声明关联 PUBG 账号。请先私信发送 /pubg claim <平台> <游戏名>，确认后可查询本人数据。');
        if (claim.pubgShard !== query.teamContext.team.platform) return message('你声明的 PUBG 平台与当前队伍不同，无法从这支队伍查询本人数据。');
        if (!query.teamContext.team.players.some(player => player.id === claim.pubgAccountId)) return message('你声明的 PUBG 账号不在当前队伍名单中。');
        return statsReply(services, query, parsed.intent.period, signal, [claim.pubgAccountId], claim.claimStatus !== 'verified');
      }
      if (parsed.intent.kind === 'team_stats') return statsReply(services, query, parsed.intent.period, signal);
      const state = await query.repository.getSyncState(`team:${query.teamContext.team.id}`);
      if (!state || state.source.syncInvoked !== true) return message('PUBG 数据同步状态未知；当前不会把空缓存当作 0 场或 0 伤害。');
      const now = services.now?.() ?? new Date();
      const freshness = freshnessNote(state, now);
      const domain = new PubgDomainService({ teamContext: query.teamContext, repository: query.repository, now: () => now });
      if (parsed.intent.kind === 'leaderboard') {
        const envelope = await domain.queryStats({
          sessionId: query.conversation.sessionId, selector: { type: 'relative_period', value: parsed.intent.period },
          metrics: [parsed.intent.metric as Metric], operation: 'rank', groupBy: 'player', orderBy: { metric: parsed.intent.metric, direction: 'desc' },
          limit: 4, refresh: false, signal,
        });
        return message(leaderboardText(envelope, parsed.intent.period, parsed.intent.metric, freshness));
      }
      if (parsed.intent.kind === 'team_damage') {
        const envelope = await domain.queryTeamDamage({ sessionId: query.conversation.sessionId, selector: { type: 'relative_period', value: parsed.intent.period }, refresh: false, signal });
        return message(teamDamageText(envelope, parsed.intent.period, freshness));
      }
      const search = await domain.searchMatches({ sessionId: query.conversation.sessionId,
        selector: { type: 'relative_period', value: parsed.intent.period }, page: 0, pageSize: 4, refresh: false, signal });
      if (!search.resultSetId) return message(`当前没有可用的复盘资料，数据状态：${search.status}。\n${freshness}`);
      const envelope = await domain.getPeriodReview({ sessionId: query.conversation.sessionId, searchResultSetId: search.resultSetId, signal });
      return message(reviewText(envelope, parsed.intent.period, freshness));
    } catch (error) {
      const safe = error instanceof Error ? safeErrors[error.message] : undefined;
      if (safe) return message(safe);
      throw error;
    }
  };
}

/** Query commands run before the management fallback; unknown text is left to
 * the existing deterministic onboarding/account handlers. */
export function composeKookRequestHandlers(
  queryHandler: (job: KookIngressJob, signal: AbortSignal) => Promise<KookTextPayload | undefined>,
  fallback: KookRequestHandler,
): KookRequestHandler {
  return async (job, signal) => (await queryHandler(job, signal)) ?? fallback(job, signal);
}
