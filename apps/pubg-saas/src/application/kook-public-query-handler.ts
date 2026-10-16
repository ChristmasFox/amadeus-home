import { createHash } from 'node:crypto';
import { tool, type LanguageModel, type ModelMessage } from 'ai';
import { z } from 'zod';
import {
  PubgDomainService,
  DEFAULT_TIMEZONE,
  emptyContext,
  type Metric,
  type ToolEnvelope,
} from '@agent/pubg-domain/core';
import { buildPubgToolPresentation, type PubgSourceRange, type PubgToolName } from '@agent/presentation';
import type { AccountClaimService } from './account-claim-service.js';
import type { KookIngressJob, KookRequestHandler } from './kook-ingress-queue.js';
import type { KookTextPayload } from './kook-message-queue.js';
import { normalizeQueryPlanForMessage, QueryPlanSchema, type QueryPlan } from './nl-query-planner.js';
import { QueryPlanExecutor } from './query-plan-executor.js';
import { runPublicKookAgent } from './kook-conversation-agent.js';
import { buildGateWorkingContext } from './gate-context-builder.js';
import type { KookNaturalWriteIntent, KookNaturalWriteResult } from './kook-group-binding-handler.js';
import type {
  AuthorizedPublicQuery,
  PublicQueryAuthorizer,
  PublicQueryTeamSelection,
} from './public-query-authorizer.js';
import { parseTeamLeaderboardMetric, type TeamLeaderboardMetric } from '../contracts/team-preferences.js';
import { MAX_TEAM_ROSTER_SIZE } from '../contracts/team-roster.js';
import { sanitizeKookMentionMarkup } from '../channels/kook/trusted-group-event.js';
import { buildPublicAgentFacts } from './public-agent-facts.js';
import type { MemoryObservation } from '@agent/memory';
import type { GateMemoryPlugin } from './gate-memory-plugin.js';

type PublicQueryIntent =
  | { kind: 'team_stats'; period: 'today' | 'yesterday' }
  | { kind: 'my_stats'; period: 'today' | 'yesterday' }
  | { kind: 'leaderboard'; period: 'today' | 'yesterday'; metric: TeamLeaderboardMetric | null }
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
  agent?: { model: Exclude<LanguageModel, string>; provider: string; modelId: string } | null;
  executeNaturalWrite?: (job: KookIngressJob, intent: KookNaturalWriteIntent, signal: AbortSignal) => Promise<KookNaturalWriteResult>;
  onAgentDiagnostic?: (event: KookAgentDiagnostic) => void;
  memoryPlugin?: GateMemoryPlugin;
  executor?: QueryPlanExecutor;
  now?: () => Date;
}

export interface KookAgentDiagnostic {
  event: 'kook_agent_error' | 'kook_agent_tool_trace';
  stage: 'model' | 'tool' | 'authorization' | 'persistence';
  reason: string;
  requestKey: string;
  channelId?: string;
  count: number;
}

function message(content: string): KookTextPayload { return { type: 'text', content }; }

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
    // Public transcripts and per-user query context follow the private
    // assistant's persistent session behavior; the DB scope is still rechecked
    // against the current trusted KOOK event on every query.
    expiresAt: '9999-12-31T23:59:59.999Z',
  });
}

function rosterPlayerId(query: AuthorizedPublicQuery, name: string | null): string | null {
  if (!name) return null;
  const normalized = name.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  const matches = query.teamContext.team.players.filter(player =>
    [player.id, player.name, ...player.aliases].some(candidate => candidate.normalize('NFKC').trim().toLocaleLowerCase('en-US') === normalized));
  return matches.length === 1 ? matches[0]!.id : null;
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

function parseMetric(token: string | undefined): TeamLeaderboardMetric | null {
  return token ? parseTeamLeaderboardMetric(token) : null;
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
    const metric = firstMetric;
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

function presentationSourceRange(queryResolved: Record<string, unknown>): PubgSourceRange | undefined {
  const asRange = (value: unknown): { from: string | null; to: string | null } | null => {
    const row = object(value);
    if (!row) return null;
    const from = typeof row.start === 'string' ? row.start : typeof row.from === 'string' ? row.from : null;
    const to = typeof row.end === 'string' ? row.end : typeof row.to === 'string' ? row.to : null;
    return from || to ? { from, to } : null;
  };
  const primary = asRange(queryResolved.sourceRange ?? queryResolved.resolvedSelector ?? queryResolved.selector);
  const resolvedSegments = Array.isArray(queryResolved.resolvedSegments) ? queryResolved.resolvedSegments : queryResolved.segments;
  const segments = Array.isArray(resolvedSegments) ? resolvedSegments.flatMap((value) => {
    const segment = object(value);
    const range = asRange(segment?.resolvedSelector ?? segment?.selector);
    return segment && range ? [{ label: String(segment.label ?? '区间'), ...range }] : [];
  }) : [];
  if (!primary && !segments.length) return undefined;
  return { from: primary?.from ?? null, to: primary?.to ?? null, ...(segments.length ? { segments } : {}) };
}

function presentationInput(envelope: ToolEnvelope, toolName: PubgToolName, teamDamage?: { aggregateByActor?: boolean; actorPlayerId?: string; victimPlayerId?: string }) {
  const coverage = envelope.coverage;
  const sourceRange = presentationSourceRange(envelope.queryResolved);
  return {
    presentationStyle: 'public_agent' as const,
    status: envelope.status,
    data: envelope.data,
    dataUpdatedAt: envelope.asOf,
    ...(sourceRange ? { sourceRange } : {}),
    queryResolved: envelope.queryResolved,
    evidenceRefs: {
      matchIds: [...envelope.evidenceRefs.matchIds],
      playerIds: [...envelope.evidenceRefs.playerIds],
      fields: [...envelope.evidenceRefs.fields],
    },
    coverage: {
      status: coverage.status,
      complete: coverage.complete,
      freshness: coverage.freshness,
      checkedAt: coverage.checkedAt ?? null,
      coverageStart: coverage.coverageStart ?? null,
      coverageEnd: coverage.coverageEnd ?? null,
      sourceUnavailable: coverage.sourceUnavailable,
    },
    ...(teamDamage ? { teamDamage } : {}),
  };
}

function renderEnvelope(
  envelope: ToolEnvelope,
  toolName: PubgToolName,
  now: Date,
  teamDamage?: { aggregateByActor?: boolean; actorPlayerId?: string; victimPlayerId?: string },
): string {
  return buildPubgToolPresentation(toolName, presentationInput(envelope, toolName, teamDamage), {
    timezone: DEFAULT_TIMEZONE, now, includeCoverage: true, localizedMetrics: true,
  }).displayText;
}

async function statsReply(services: KookPublicQueryServices, query: AuthorizedPublicQuery, period: 'today' | 'yesterday', signal: AbortSignal, playerIds?: string[], selfDeclared = false): Promise<KookTextPayload> {
  const state = await query.repository.getSyncState(`team:${query.teamContext.team.id}`);
  if (!state || state.source.syncInvoked !== true) return message('PUBG 数据同步状态未知；当前不会把空缓存当作 0 场或 0 伤害。');
  const now = services.now?.() ?? new Date();
  const domain = new PubgDomainService({ teamContext: query.teamContext, repository: query.repository, now: () => now });
  const envelope = await domain.queryStats({
    sessionId: query.conversation.sessionId, selector: { type: 'relative_period', value: period },
    metrics: [
      'matches', 'kills', 'dbnos', 'assists', 'revives', 'wins', 'top10', 'headshot_kills',
      'longest_kill', 'survival_time', 'damage', 'kd', 'deaths', 'rank',
    ], operation: 'report', groupBy: 'player',
    orderBy: { metric: 'damage', direction: 'desc' }, limit: playerIds ? 1 : MAX_TEAM_ROSTER_SIZE,
    refresh: true, signal, ...(playerIds ? { playerIds } : {}),
  });
  const warning = selfDeclared ? '本人账号为自我声明，所有权未经验证。\n' : '';
  return message(warning + renderEnvelope(envelope, 'pubg_query_stats', now));
}

function selectionPrompt(choices: Array<{ tenantId: string; teamId: string; label: string }>, commandText: string): KookTextPayload {
  const lines = choices.slice(0, 20).map(choice => `/pubg select ${choice.tenantId} ${choice.teamId} ${commandText} — ${safeLabel(choice.label)}`);
  return message(`请明确选择有权限查询的队伍：\n${lines.join('\n')}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function naturalMessage(job: KookIngressJob): string {
  if (job.request.kind === 'direct') return sanitizeKookMentionMarkup(job.request.event.content).trim();
  if (job.request.kind !== 'group') return '';
  const content = job.request.event.content;
  const bot = escapeRegExp(job.botAccountId);
  return sanitizeKookMentionMarkup(content.replace(new RegExp(`^\\s*(?:<@!?${bot}>|\\(met\\)${bot}\\(met\\)|@${bot})\\s*`, 'u'), '')).trim();
}

function directObservation(job: KookIngressJob): MemoryObservation | null {
  if (job.request.kind !== 'direct') return null;
  const observedAt = new Date(job.request.event.timestamp).toISOString();
  return {
    content: job.request.event.content,
    observedAt,
    evidence: [{ id: job.eventId, observedAt, source: 'conversation' }],
  };
}

async function observeDirectMessage(services: KookPublicQueryServices, job: KookIngressJob): Promise<void> {
  const observation = directObservation(job);
  if (observation) await services.memoryPlugin?.observe(job, observation).catch(() => undefined);
}

async function naturalLanguageReply(
  services: KookPublicQueryServices,
  job: KookIngressJob,
  signal: AbortSignal,
): Promise<KookTextPayload> {
  const currentMessage = naturalMessage(job);
  const configured = services.agent;
  const fallbackText = '我这边刚遇到一点技术问题，暂时没能给出可靠回复。你可以稍后再问一次。';
  const requestKey = createHash('sha256').update(`${job.botAccountId}\0${job.eventId}`).digest('hex').slice(0, 16);
  const channelId = job.request.kind === 'group' ? job.request.event.channelId : undefined;
  if (!configured) {
    await observeDirectMessage(services, job);
    await services.authorizer.recordAgentRun(job, {
      modelId: null, outcome: 'model_unconfigured', failureCode: 'agent_model_unconfigured',
      inputTokens: null, outputTokens: null, totalTokens: null,
    }).catch(() => undefined);
    services.onAgentDiagnostic?.({ event: 'kook_agent_error', stage: 'model', reason: 'agent_model_unconfigured', requestKey, ...(channelId ? { channelId } : {}), count: 1 });
    return message('我这边的公共助手还没连上模型，暂时无法正常接话。稍后再试一下。');
  }

  if (services.memoryPlugin) {
    const memoryReply = await services.memoryPlugin.handleExplicitMessage(job, signal).catch(() => undefined);
    if (memoryReply) return memoryReply;
  }
  // Explicit remember/correct/forget commands are handled above and are not
  // re-learned as ordinary conversation. Natural DM messages are admitted
  // automatically unless the user explicitly disabled Light/REM.
  await observeDirectMessage(services, job);

  let toolDegraded = false;
  let toolFailureCode = 'agent_tool_degraded';
  let authorizationDenied = false;
  let authorizationFailureCode: string | null = null;
  let writeAttempted = false;
  const executedPubgQueries = new Set<string>();
  const completedPubgQueries = new Map<string, unknown>();
  const reportToolFailure = (reason: string) => {
    toolDegraded = true;
    services.onAgentDiagnostic?.({ event: 'kook_agent_error', stage: 'tool', reason, requestKey, ...(channelId ? { channelId } : {}), count: 1 });
  };
  const reportToolTrace = (reason: string) => services.onAgentDiagnostic?.({
    event: 'kook_agent_tool_trace', stage: 'tool', reason, requestKey, ...(channelId ? { channelId } : {}), count: 1,
  });
  const reportAuthorizationUnavailable = (reason: string) => {
    toolDegraded = true;
    toolFailureCode = reason;
    services.onAgentDiagnostic?.({ event: 'kook_agent_error', stage: 'authorization', reason, requestKey, ...(channelId ? { channelId } : {}), count: 1 });
  };

  const executeAuthorized = async (): Promise<
    | { kind: 'authorized'; query: AuthorizedPublicQuery }
    | { kind: 'unbound' }
    | { kind: 'selection_required' }
    | { kind: 'denied' }
    | { kind: 'authorization_unavailable' }
  > => {
    if (job.request.kind === 'group' && !job.boundTeam) return { kind: 'unbound' };
    try {
      const authorization = await services.authorizer.authorize(job);
      if (authorization.kind === 'team_selection_required') return { kind: 'selection_required' };
      return { kind: 'authorized', query: authorization.query };
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'public_query_access_denied' || code === 'public_query_binding_changed') {
        authorizationDenied = true;
        authorizationFailureCode = 'public_query_access_denied';
        services.onAgentDiagnostic?.({ event: 'kook_agent_error', stage: 'authorization', reason: 'public_query_access_denied', requestKey, ...(channelId ? { channelId } : {}), count: 1 });
        return { kind: 'denied' };
      }
      if (code === 'kook_permission_check_unavailable') {
        reportAuthorizationUnavailable(code);
        return { kind: 'authorization_unavailable' };
      }
      throw error;
    }
  };

  const queryTool = tool({
    description: '按当前可信 KOOK 频道和发言者查询已授权小队的真实 PUBG Domain 数据。用于战绩、玩家统计、友伤、拳击/踢击、排名、历史比赛、比较和复盘。一般友伤查询不要传 meleeKind；只有当前原文明确提到踢/脚才传 KICK，明确提到拳才传 PUNCH；OTHER 只用于明确要求踢和拳以外的近战，绝不表示默认的其他伤害。不确定时传 null。姓名槽里的 none/self 等占位词视为未指定。参数仅是查询槽位。结果保留完整 Domain envelope data、共享 presentation、displayText、覆盖、新鲜度、规范时间范围和实际过滤条件；只移除内部标识、调试字段和私人数据。相同参数不得重复查询，应直接使用已有结果回答。',
    inputSchema: QueryPlanSchema,
    execute: async planInput => {
      const parsedPlan = QueryPlanSchema.safeParse(planInput);
      if (!parsedPlan.success || parsedPlan.data.intent === 'unsupported') {
        return { status: 'clarification', message: '我还没弄清要查的内容，请补充队员、指标或时间范围。' };
      }
      const normalizedPlan = normalizeQueryPlanForMessage(parsedPlan.data, currentMessage);
      const queryKey = JSON.stringify(normalizedPlan);
      if (executedPubgQueries.has(queryKey)) {
        reportToolTrace('pubg_query_repeated_arguments');
        return completedPubgQueries.get(queryKey)
          ?? { status: 'duplicate_suppressed', message: '相同参数的查询已在本轮执行；请直接使用之前的工具结果回答，不要重复查询。' };
      }
      executedPubgQueries.add(queryKey);
      try {
        const authorized = await executeAuthorized();
        if (authorized.kind === 'unbound') return { status: 'no_team', message: '当前服务器还没有绑定 PUBG 小队。只有需要 PUBG 数据时才需要创建/绑定队伍；可以在服务器先发送 /pubg create。' };
        if (authorized.kind === 'selection_required') return { status: 'selection_required', message: '当前用户有多支已授权队伍，需要在目标队伍频道查询。' };
        if (authorized.kind === 'denied') return { status: 'access_denied', message: '当前发言者没有这支队伍的查询权限，或频道绑定已变化。不要尝试其他队伍。' };
        if (authorized.kind === 'authorization_unavailable') return { status: 'authorization_unavailable', message: 'KOOK 权限校验当前不可用；不要查询 PUBG 数据或推断用户权限。请稍后重试。' };
        const query = authorized.query;
        const now = services.now?.() ?? new Date();
        const context = await query.repository.getContext(query.conversation.sessionId, now);
        const previousPlan = previousPlanFromContext(context?.references);
        let selfPlayerId: string | undefined;
        let selfWarning = '';
        if (normalizedPlan.intent === 'my_stats' || normalizedPlan.subject === 'self') {
          const claim = await services.claims.getClaimForActor(query.conversation.botAccountId, query.conversation.userId);
          if (!claim) return { status: 'clarification', message: '这位成员尚未绑定 PUBG 账号。可在群里说“我的 PUBG 账号是 游戏名”进行验证绑定。' };
          if (claim.pubgShard !== query.teamContext.team.platform) return { status: 'clarification', message: '已声明的平台与当前队伍平台不一致，无法查询本人战绩。' };
          if (!query.teamContext.team.players.some(player => player.id === claim.pubgAccountId)) return { status: 'clarification', message: '本人账号不在当前队伍 roster 中。' };
          selfPlayerId = claim.pubgAccountId;
          if (claim.claimStatus !== 'verified') selfWarning = '本人账号为自我声明，所有权未经验证。\n';
        }
        const effectivePlan = normalizedPlan.intent === 'leaderboard' && normalizedPlan.metric === null
          ? { ...normalizedPlan, metric: await query.repository.getLeaderboardMetricPreference() ?? 'damage' }
          : normalizedPlan;
        const execution = await (services.executor ?? new QueryPlanExecutor()).execute({
          authorizedQuery: query,
          plan: effectivePlan,
          ...(previousPlan ? { previousPlan } : {}),
          sourceMessage: currentMessage,
          ...(selfPlayerId ? { selfPlayerId } : {}),
          signal,
        });
        if (execution.kind !== 'executed') {
          if (execution.kind === 'unavailable') reportToolFailure('pubg_domain_data_unavailable');
          const unavailable = { status: execution.kind, reason: execution.code,
            message: queryResultMessages[execution.code] ?? '当前无法安全执行这条查询，请补充条件后再试。' };
          completedPubgQueries.set(queryKey, unavailable);
          return unavailable;
        }
        await persistQueryPlan(query, execution.plan, now);
        const toolName: PubgToolName = execution.plan.intent === 'team_damage' ? 'pubg_query_team_damage'
          : execution.plan.intent === 'match_review' ? 'pubg_get_period_review'
            : execution.plan.intent === 'comparison' ? 'pubg_compare_stats' : 'pubg_query_stats';
        const actorPlayerId = execution.plan.intent === 'team_damage'
          ? rosterPlayerId(query, execution.plan.actorName ?? execution.plan.playerName) : null;
        const victimPlayerId = execution.plan.intent === 'team_damage'
          ? rosterPlayerId(query, execution.plan.victimName) : null;
        const teamDamage = execution.plan.intent === 'team_damage'
          ? {
            aggregateByActor: !actorPlayerId && !victimPlayerId,
            ...(actorPlayerId ? { actorPlayerId } : {}),
            ...(victimPlayerId ? { victimPlayerId } : {}),
          }
          : undefined;
        const presented = buildPubgToolPresentation(toolName, presentationInput(execution.envelope, toolName, teamDamage), {
          timezone: DEFAULT_TIMEZONE, now, includeCoverage: true, localizedMetrics: true,
        });
        const queryResolved = execution.envelope.queryResolved;
        const facts = buildPublicAgentFacts({
          status: execution.envelope.status,
          data: execution.envelope.data,
          coverage: execution.envelope.coverage,
          asOf: execution.envelope.asOf,
          ...(execution.envelope.metricVersion ? { metricVersion: execution.envelope.metricVersion } : {}),
          queryResolved,
          evidenceRefs: execution.envelope.evidenceRefs,
          ...(execution.envelope.error ? { error: execution.envelope.error } : {}),
          presentation: presented.presentation,
          displayText: presented.displayText,
          roster: query.teamContext.team.players,
          now,
        });
        const factsRange = object(facts.sourceRangeLocal);
        const teamDamageFilters = execution.plan.intent === 'team_damage' ? {
          sourceRange: factsRange,
          direction: execution.plan.actorName && execution.plan.victimName
            ? `${safeLabel(execution.plan.actorName)} → ${safeLabel(execution.plan.victimName)}` : 'all directions',
          source: ['MELEE', 'GUN', 'VEHICLE', 'EXPLOSIVE'].includes(String(queryResolved.source)) ? queryResolved.source : 'ALL',
          meleeKind: ['KICK', 'PUNCH', 'OTHER'].includes(String(queryResolved.meleeKind)) ? queryResolved.meleeKind : 'ALL',
        } : undefined;
        const toolResult = {
          ...facts,
          status: execution.envelope.status,
          ...(selfWarning ? { identityWarning: selfWarning.trim() } : {}),
          ...(teamDamageFilters ? { filtersApplied: teamDamageFilters } : {}),
        };
        const resultStatus = ['ok', 'partial', 'no_matches', 'error'].includes(toolResult.status)
          ? toolResult.status : 'other';
        reportToolTrace(`pubg_query_result_${resultStatus}`);
        if (execution.plan.intent === 'team_damage') {
          const resolvedDirection = queryResolved.direction ? 'pair' : 'all';
          const resolvedSource = ['MELEE', 'GUN', 'VEHICLE', 'EXPLOSIVE'].includes(String(queryResolved.source))
            ? String(queryResolved.source).toLocaleLowerCase('en-US') : 'all';
          const resolvedMeleeKind = ['KICK', 'PUNCH', 'OTHER'].includes(String(queryResolved.meleeKind))
            ? String(queryResolved.meleeKind).toLocaleLowerCase('en-US') : 'all';
          reportToolTrace(`pubg_team_damage_filters_period_${execution.plan.period ?? 'unspecified'}_direction_${resolvedDirection}_source_${resolvedSource}_melee_${resolvedMeleeKind}`);
        }
        completedPubgQueries.set(queryKey, toolResult);
        return toolResult;
      } catch (error) {
        reportToolFailure('pubg_query_tool_failed');
        const safe = error instanceof Error ? safeErrors[error.message] : undefined;
        const unavailable = { status: 'unavailable', message: safe ?? 'PUBG 数据工具暂时不可用；不要猜测统计结果。' };
        completedPubgQueries.set(queryKey, unavailable);
        return unavailable;
      }
    },
  });

  const teamInfoTool = tool({
    description: '查询当前发言者有权访问的当前 KOOK 频道小队信息和 roster。',
    inputSchema: z.object({ includeRoster: z.boolean() }).strict(),
    execute: async ({ includeRoster }) => {
      try {
        const authorized = await executeAuthorized();
        if (authorized.kind === 'unbound') return { status: 'no_team', message: '当前服务器还没有 PUBG 小队，可以继续普通聊天；需要数据时再创建或绑定。' };
        if (authorized.kind === 'selection_required') return { status: 'selection_required', message: '有多支已授权队伍，请在目标队伍频道查看。' };
        if (authorized.kind === 'denied') return { status: 'access_denied', message: '当前发言者没有本队信息访问权限。' };
        if (authorized.kind === 'authorization_unavailable') return { status: 'authorization_unavailable', message: 'KOOK 权限校验当前不可用；暂时无法安全读取队伍信息。请稍后重试。' };
        return {
          status: 'ok', team: authorized.query.teamContext.team.label,
          platform: authorized.query.teamContext.team.platform,
          roster: includeRoster ? authorized.query.teamContext.team.players.map(player => player.name) : undefined,
        };
      } catch {
        reportToolFailure('team_info_tool_failed');
        return { status: 'unavailable', message: '当前无法读取队伍信息。' };
      }
    },
  });

  const tools = {
    pubg_query: queryTool,
    team_info: teamInfoTool,
    ...(job.request.kind === 'group' && services.executeNaturalWrite ? {
      declare_pubg_account: tool({
        description: '仅当当前消息明确要求自绑 PUBG 账号，或管理员明确要求为唯一被 @ 成员代绑时调用。游戏名必须逐字出现在当前消息；不要传任何 KOOK ID。',
        inputSchema: z.object({ target: z.enum(['self', 'mentioned_member']), pubgName: z.string().trim().min(1).max(100) }).strict(),
        execute: async input => {
          if (writeAttempted) return { outcome: 'rejected', message: '这条消息里已经处理过一次绑定请求。' };
          writeAttempted = true;
          const result = await services.executeNaturalWrite!(job, { kind: 'declare_pubg_account', ...input }, signal);
          if (result.failure?.kind === 'authorization_denied') {
            authorizationDenied = true;
            authorizationFailureCode = result.failure.code;
            services.onAgentDiagnostic?.({ event: 'kook_agent_error', stage: 'authorization', reason: result.failure.code, requestKey, ...(channelId ? { channelId } : {}), count: 1 });
          } else if (result.failure?.kind === 'authorization_unavailable') {
            reportAuthorizationUnavailable(result.failure.code);
          }
          return { outcome: result.outcome, message: result.message };
        },
      }),
      rename_team: tool({
        description: '仅当当前消息明确要求修改本队队名时调用；队名必须逐字出现在当前消息。',
        inputSchema: z.object({ teamName: z.string().trim().min(1).max(80) }).strict(),
        execute: async input => {
          if (writeAttempted) return { outcome: 'rejected', message: '这条消息里已经处理过一次队伍修改。' };
          writeAttempted = true;
          const result = await services.executeNaturalWrite!(job, { kind: 'rename_team', ...input }, signal);
          if (result.failure?.kind === 'authorization_denied') {
            authorizationDenied = true;
            authorizationFailureCode = result.failure.code;
            services.onAgentDiagnostic?.({ event: 'kook_agent_error', stage: 'authorization', reason: result.failure.code, requestKey, ...(channelId ? { channelId } : {}), count: 1 });
          } else if (result.failure?.kind === 'authorization_unavailable') {
            reportAuthorizationUnavailable(result.failure.code);
          }
          return { outcome: result.outcome, message: result.message };
        },
      }),
    } : {}),
  };

  try {
    const [window, memoryResult] = await Promise.all([
      services.authorizer.loadAgentConversation(job),
      services.memoryPlugin
        ? services.memoryPlugin.recall(job, { query: currentMessage }).catch(() => null)
        : Promise.resolve(null),
    ]);
    const context = buildGateWorkingContext(window, currentMessage, undefined, memoryResult?.context ?? null);
    const currentContext = context.currentQuoteContext ? `${context.currentQuoteContext}\n` : '';
    const messages: ModelMessage[] = [
      ...(context.longTermMemoryContext
        ? [{ role: 'user', content: context.longTermMemoryContext } as ModelMessage] : []),
      ...(context.episodicSummaryContext
        ? [{ role: 'user', content: context.episodicSummaryContext } as ModelMessage] : []),
      ...context.turns.map(turn => ({ role: turn.role, content: turn.content }) as ModelMessage),
      { role: 'user', content: `${window.currentSpeakerLabel}说：${currentContext}${context.currentMessage}` },
    ];
    const result = await runPublicKookAgent({ model: configured.model, tools, messages, signal, currentMessage });
    if (!result.recoveryCode && context.longTermMemoryContext
      && memoryResult?.candidates.length && services.memoryPlugin) {
      const presented = memoryResult.candidates.filter(candidate =>
        context.longTermMemoryContext?.includes(JSON.stringify(candidate.key))
        && context.longTermMemoryContext?.includes(JSON.stringify(candidate.content)));
      await services.memoryPlugin.recordUsed(job, currentMessage, presented).catch(() => undefined);
    }
    const outcome = toolDegraded ? 'tool_degraded' : authorizationDenied ? 'authorization_denied' : 'replied';
    if (result.recoveryCode) {
      services.onAgentDiagnostic?.({ event: 'kook_agent_error', stage: 'model', reason: result.recoveryCode, requestKey, ...(channelId ? { channelId } : {}), count: 1 });
    }
    await services.authorizer.recordAgentRun(job, {
      modelId: configured.modelId, outcome,
      failureCode: toolDegraded ? toolFailureCode : authorizationDenied ? authorizationFailureCode ?? 'public_query_access_denied' : result.recoveryCode,
      inputTokens: result.inputTokens, outputTokens: result.outputTokens, totalTokens: result.totalTokens,
    }).catch(() => services.onAgentDiagnostic?.({ event: 'kook_agent_error', stage: 'persistence', reason: 'agent_run_record_failed', requestKey, ...(channelId ? { channelId } : {}), count: 1 }));
    return message(result.text);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
      ? String((error as { code: string }).code) : '';
    const failureCode = [
      'public_agent_empty_response', 'public_agent_output_truncated', 'public_agent_timeout',
    ].includes(code) ? code : 'agent_provider_error';
    services.onAgentDiagnostic?.({ event: 'kook_agent_error', stage: 'model', reason: failureCode, requestKey, ...(channelId ? { channelId } : {}), count: 1 });
    await services.authorizer.recordAgentRun(job, {
      modelId: configured.modelId, outcome: 'provider_fallback', failureCode,
      inputTokens: null, outputTokens: null, totalTokens: null,
    }).catch(() => undefined);
    return message(fallbackText);
  }
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
    if (!parsed) return naturalLanguageReply(services, job, signal);
    try {
      const authorization = await services.authorizer.authorize(job, parsed.selection);
      if (authorization.kind === 'team_selection_required') {
        return selectionPrompt(authorization.choices, parsed.commandText);
      }
      const query = authorization.query;
      if (parsed.intent.kind === 'my_stats') {
        const claim = await services.claims.getClaimForActor(query.conversation.botAccountId, query.conversation.userId);
        if (!claim) return message('你还没有绑定 PUBG 账号。请在队伍群聊发送 /pubg me <游戏名>，默认平台为 Steam。');
        if (claim.pubgShard !== query.teamContext.team.platform) return message('你声明的 PUBG 平台与当前队伍不同，无法从这支队伍查询本人数据。');
        if (!query.teamContext.team.players.some(player => player.id === claim.pubgAccountId)) return message('你声明的 PUBG 账号不在当前队伍名单中。');
        return statsReply(services, query, parsed.intent.period, signal, [claim.pubgAccountId], claim.claimStatus !== 'verified');
      }
      if (parsed.intent.kind === 'team_stats') return statsReply(services, query, parsed.intent.period, signal);
      const state = await query.repository.getSyncState(`team:${query.teamContext.team.id}`);
      if (!state || state.source.syncInvoked !== true) return message('PUBG 数据同步状态未知；当前不会把空缓存当作 0 场或 0 伤害。');
      const now = services.now?.() ?? new Date();
      const domain = new PubgDomainService({ teamContext: query.teamContext, repository: query.repository, now: () => now });
      if (parsed.intent.kind === 'leaderboard') {
        const metric = parsed.intent.metric ?? await query.repository.getLeaderboardMetricPreference() ?? 'damage';
        const envelope = await domain.queryStats({
          sessionId: query.conversation.sessionId, selector: { type: 'relative_period', value: parsed.intent.period },
          metrics: [metric as Metric], operation: 'rank', groupBy: 'player', orderBy: { metric, direction: 'desc' },
          limit: MAX_TEAM_ROSTER_SIZE, refresh: true, signal,
        });
        return message(renderEnvelope(envelope, 'pubg_query_stats', now));
      }
      if (parsed.intent.kind === 'team_damage') {
        const envelope = await domain.queryTeamDamage({ sessionId: query.conversation.sessionId, selector: { type: 'relative_period', value: parsed.intent.period }, refresh: true, signal });
        return message(renderEnvelope(envelope, 'pubg_query_team_damage', now, { aggregateByActor: true }));
      }
      const search = await domain.searchMatches({ sessionId: query.conversation.sessionId,
        selector: { type: 'relative_period', value: parsed.intent.period }, page: 0, pageSize: 50, refresh: true, signal });
      if (!search.resultSetId) return message(renderEnvelope(search, 'pubg_search_matches', now));
      const envelope = await domain.getPeriodReview({ sessionId: query.conversation.sessionId, searchResultSetId: search.resultSetId, signal });
      return message(renderEnvelope(envelope, 'pubg_get_period_review', now));
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
  ...handlers: Array<(job: KookIngressJob, signal: AbortSignal) => Promise<KookTextPayload | null | undefined>>
): KookRequestHandler {
  return async (job, signal) => {
    for (const handler of handlers) {
      const reply = await handler(job, signal);
      if (reply !== undefined) return reply;
    }
    return null;
  };
}
