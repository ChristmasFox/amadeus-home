import {
  PubgDomainService,
  resolvePreviousPeriodSelector,
  type Selector,
  type Metric,
} from '@agent/pubg-domain/core';
import type {
  GetPeriodReviewInput,
  SearchMatchesInput,
  StatsToolInput,
  TeamDamageQueryInput,
  ToolEnvelope,
} from '@agent/pubg-domain/core';
import type { AuthorizedPublicQuery } from './public-query-authorizer.js';
import {
  normalizePreviousQueryPlan,
  normalizeQueryPlanForMessage,
  QueryPlanSchema,
  type QueryPlan,
} from './nl-query-planner.js';
import { MAX_TEAM_ROSTER_SIZE } from '../contracts/team-roster.js';

const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const DEFAULT_BUSINESS_DAY_START = '06:00';
const DEFAULT_STATS_METRICS: Metric[] = ['matches', 'kills', 'assists', 'damage', 'kd'];
const DOMAIN_METRICS = new Set<Metric>([
  'matches', 'kills', 'assists', 'damage', 'avg_damage', 'kd', 'deaths', 'wins', 'top10', 'rank',
  'dbnos', 'revives', 'headshot_kills', 'survival_time', 'longest_kill', 'performance_score', 'chicken_index',
]);

export type QueryPlanDomainPort = Pick<PubgDomainService,
  'queryStats' | 'compareStats' | 'queryTeamDamage' | 'searchMatches' | 'getPeriodReview'>;

export interface QueryPlanExecutorOptions {
  /** Tests may supply a fake; production defaults to the shared deterministic Domain. */
  createDomain?: (authorizedQuery: AuthorizedPublicQuery) => QueryPlanDomainPort;
  now?: () => Date;
  timezone?: string;
  businessDayStart?: string;
}

export interface ExecuteQueryPlanInput {
  /** Must come from PublicQueryAuthorizer for the current ingress event. */
  authorizedQuery: AuthorizedPublicQuery;
  /** Revalidated here even though the caller should pass a planner-validated plan. */
  plan: QueryPlan;
  previousPlan?: QueryPlan | null;
  /** Raw text for this request; only explicit melee words can enable a kind filter. */
  sourceMessage?: string;
  /** Only an account claim/identity check performed by the handler may supply this. */
  selfPlayerId?: string;
  signal?: AbortSignal;
}

export type QueryPlanExecutionResult =
  | { kind: 'executed'; plan: QueryPlan; envelope: ToolEnvelope }
  | { kind: 'clarification'; code: string }
  | { kind: 'unavailable'; code: string };

type PeriodValue = NonNullable<QueryPlan['period']>;
type DateSelector = Extract<StatsToolInput['selector'], { type: 'time_range' | 'relative_period' | 'recent_days' }>;
type MatchSelector = Extract<StatsToolInput['selector'], { type: 'last_n_matches' }>;

type PeriodSelection =
  | { kind: 'time_period'; selector: DateSelector }
  | { kind: 'last_n_matches'; selector: MatchSelector }
  | { kind: 'recent_matches'; count: number };

type StatsSelector = DateSelector | MatchSelector;

function statsSelector(period: PeriodSelection): StatsSelector {
  return period.kind === 'recent_matches'
    ? { type: 'last_n_matches', count: period.count, offset: 0 }
    : period.selector;
}

function canonicalSelector(period: PeriodSelection): Selector {
  if (period.kind === 'recent_matches') return { type: 'last_n_matches', count: period.count, offset: 0 };
  const selector = period.selector;
  if (selector.type === 'last_n_matches') return {
    type: 'last_n_matches', count: selector.count, offset: selector.offset ?? 0,
  };
  if (selector.type === 'relative_period') return { type: 'relative_period', value: selector.value, ...(selector.label ? { label: selector.label } : {}) };
  if (selector.type === 'recent_days') return { type: 'recent_days', count: selector.count, ...(selector.label ? { label: selector.label } : {}) };
  return {
    type: 'time_range', start: selector.from, end: selector.to,
    timezone: selector.timezone ?? DEFAULT_TIMEZONE,
    businessDayStart: selector.businessDayStart ?? DEFAULT_BUSINESS_DAY_START,
  };
}

function hasValue(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeAlias(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
}

function resolveRosterPlayer(
  query: AuthorizedPublicQuery,
  playerName: string,
): { kind: 'found'; id: string } | { kind: 'ambiguous' } | { kind: 'missing' } {
  const target = normalizeAlias(playerName);
  const matches = query.teamContext.team.players.filter((player) =>
    [player.id, player.name, ...player.aliases].some((candidate) => normalizeAlias(candidate) === target));
  if (matches.length > 1) return { kind: 'ambiguous' };
  if (matches.length === 0) return { kind: 'missing' };
  return { kind: 'found', id: matches[0]!.id };
}

function resolvePlayerIds(
  plan: QueryPlan,
  previousPlan: QueryPlan | null,
  query: AuthorizedPublicQuery,
  selfPlayerId: string | undefined,
): { kind: 'team' } | { kind: 'player'; id: string } | { kind: 'clarification'; code: string } | { kind: 'unavailable'; code: string } {
  if (plan.intent === 'my_stats' || plan.subject === 'self') {
    if (!hasValue(selfPlayerId)) return { kind: 'unavailable', code: 'self_identity_not_prevalidated' };
    const isAuthorizedMember = query.teamContext.team.players.some((player) => player.id === selfPlayerId);
    if (!isAuthorizedMember) return { kind: 'unavailable', code: 'self_player_not_in_authorized_roster' };
    return { kind: 'player', id: selfPlayerId };
  }

  if (plan.subject === 'team' || plan.subject === 'unspecified') {
    if (plan.playerName !== null) return { kind: 'clarification', code: 'player_name_scope_mismatch' };
    return { kind: 'team' };
  }

  if (plan.subject !== 'player' && plan.subject !== 'previous_player') {
    return { kind: 'clarification', code: 'unsupported_subject' };
  }

  let playerName = plan.playerName;
  if (!playerName && plan.subject === 'previous_player' && previousPlan?.subject === 'player') {
    playerName = previousPlan.playerName;
  }
  if (!playerName) return { kind: 'clarification', code: 'player_name_required' };
  const resolved = resolveRosterPlayer(query, playerName);
  if (resolved.kind === 'ambiguous') return { kind: 'clarification', code: 'player_alias_ambiguous' };
  if (resolved.kind === 'missing') return { kind: 'clarification', code: 'player_not_in_authorized_roster' };
  return { kind: 'player', id: resolved.id };
}

function selectorForPeriod(period: PeriodValue | null | undefined, matchCount: number | null, dayCount: number | null | undefined): PeriodSelection | null {
  if (!period || period === 'previous_period') return null;
  if (period === 'last_match') return { kind: 'last_n_matches', selector: { type: 'last_n_matches', count: 1, offset: 0 } };
  if (period === 'recent_matches') return matchCount ? { kind: 'recent_matches', count: matchCount } : null;
  if (period === 'recent_days') return dayCount ? { kind: 'time_period', selector: { type: 'recent_days', count: dayCount } } : null;
  return { kind: 'time_period', selector: { type: 'relative_period', value: period } };
}

function selectionForSelector(selector: Selector): PeriodSelection | null {
  if (selector.type === 'last_n_matches') return { kind: 'last_n_matches', selector: {
    type: 'last_n_matches', count: selector.count, offset: selector.offset ?? 0,
    ...(selector.label === undefined ? {} : { label: selector.label }),
  } };
  if (selector.type === 'relative_period') return { kind: 'time_period', selector: {
    type: 'relative_period', value: selector.value,
    ...(selector.label === undefined ? {} : { label: selector.label }),
  } };
  if (selector.type === 'recent_days') return { kind: 'time_period', selector: {
    type: 'recent_days', count: selector.count,
    ...(selector.label === undefined ? {} : { label: selector.label }),
  } };
  if (selector.type === 'time_range') return { kind: 'time_period', selector: {
    type: 'time_range', from: selector.start, to: selector.end,
    timezone: selector.timezone ?? DEFAULT_TIMEZONE,
    businessDayStart: selector.businessDayStart ?? DEFAULT_BUSINESS_DAY_START,
  } };
  return null;
}

function periodSelection(
  period: PeriodValue | null,
  matchCount: number | null,
  dayCount: number | null | undefined,
  previousBasePeriod: PeriodValue | null | undefined,
  previousBaseDayCount: number | null | undefined,
  now: Date,
  timezone: string,
  businessDayStart: string,
): PeriodSelection | null {
  if (!period) return null;
  if (period === 'previous_period') {
    const base = selectorForPeriod(previousBasePeriod, matchCount, previousBaseDayCount);
    if (!base) return null;
    const previous = resolvePreviousPeriodSelector(canonicalSelector(base), {
      now,
      timezone,
      businessDayStart,
    });
    return previous ? selectionForSelector(previous) : null;
  }
  return selectorForPeriod(period, matchCount, dayCount);
}

function periodLabel(period: PeriodValue | null, dayCount?: number | null): string | null {
  if (!period) return null;
  const labels: Record<PeriodValue, string> = {
    today: '今天', yesterday: '昨天', last_night: '昨晚', recent_days: `最近${dayCount ?? ''}天`, last_7_days: '最近七天',
    previous_7_days: '此前七天', this_week: '本周', last_week: '上周', last_match: '最近一场',
    recent_matches: '最近多场', previous_period: '上一周期',
  };
  return labels[period];
}

function domainMetric(metric: QueryPlan['metric']): Metric | null {
  return metric && DOMAIN_METRICS.has(metric as Metric) ? metric as Metric : null;
}

function resolveFollowUp(plan: QueryPlan, previousPlan: QueryPlan | null): QueryPlan | null {
  const needsPrevious = plan.intent === 'follow_up' || plan.subject === 'previous_player' || plan.period === 'previous_period';
  if (!previousPlan) return needsPrevious ? null : plan;
  if (previousPlan.needsClarification || previousPlan.intent === 'unsupported' || previousPlan.intent === 'follow_up') {
    return needsPrevious ? null : plan;
  }
  return {
    ...previousPlan,
    ...plan,
    intent: plan.intent === 'follow_up' ? previousPlan.intent : plan.intent,
    subject: plan.subject === 'previous_player'
      ? (plan.intent === 'team_damage' || previousPlan.intent === 'team_damage' ? 'team' : previousPlan.subject)
      : plan.subject === 'unspecified' && plan.intent === 'follow_up'
        ? previousPlan.subject
        : plan.subject,
    playerName: plan.playerName ?? (plan.subject === 'previous_player' || plan.intent === 'follow_up' ? previousPlan.playerName : null),
    actorName: plan.actorName ?? (plan.subject === 'previous_player' || plan.intent === 'follow_up'
      ? previousPlan.actorName ?? previousPlan.playerName : null),
    victimName: plan.victimName ?? (plan.intent === 'follow_up' ? previousPlan.victimName : null),
    metric: plan.metric ?? previousPlan.metric,
    period: plan.period === 'previous_period' || plan.period === null ? previousPlan.period : plan.period,
    comparePeriod: plan.comparePeriod ?? previousPlan.comparePeriod,
    matchCount: plan.matchCount ?? previousPlan.matchCount,
    dayCount: plan.dayCount ?? previousPlan.dayCount,
    meleeKind: plan.meleeKind ?? (needsPrevious ? previousPlan.meleeKind : null),
    needsClarification: plan.needsClarification,
  };
}

function execution(
  kind: 'clarification' | 'unavailable',
  code: string,
): QueryPlanExecutionResult {
  return { kind, code };
}

export class QueryPlanExecutor {
  private readonly now: () => Date;
  private readonly timezone: string;
  private readonly businessDayStart: string;
  private readonly createDomain: (query: AuthorizedPublicQuery) => QueryPlanDomainPort;

  constructor(options: QueryPlanExecutorOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.timezone = options.timezone ?? DEFAULT_TIMEZONE;
    this.businessDayStart = options.businessDayStart ?? DEFAULT_BUSINESS_DAY_START;
    this.createDomain = options.createDomain ?? ((query) => new PubgDomainService({
      teamContext: query.teamContext,
      repository: query.repository,
      now: this.now,
      timezone: this.timezone,
      businessDayStart: this.businessDayStart,
    }));
  }

  async execute(input: ExecuteQueryPlanInput): Promise<QueryPlanExecutionResult> {
    const parsedPlan = QueryPlanSchema.safeParse(input.plan);
    if (!parsedPlan.success) return execution('clarification', 'invalid_query_plan');
    const currentPlan = normalizeQueryPlanForMessage(parsedPlan.data, input.sourceMessage ?? '');
    if (currentPlan.intent === 'team_damage' && currentPlan.subject === 'self' && !hasValue(input.selfPlayerId)) {
      return execution('unavailable', 'self_identity_not_prevalidated');
    }
    const parsedPrevious = input.previousPlan == null ? null : QueryPlanSchema.safeParse(input.previousPlan);
    const previousPlan = parsedPrevious?.success ? normalizePreviousQueryPlan(parsedPrevious.data) : null;
    if (currentPlan.intent === 'team_damage' && currentPlan.subject === 'previous_player'
      && !currentPlan.actorName && !currentPlan.playerName && !previousPlan?.actorName && !previousPlan?.playerName) {
      return execution('clarification', 'follow_up_context_required');
    }
    const incomingPlan = currentPlan.intent === 'team_damage'
      ? {
        ...currentPlan,
        subject: 'team' as const,
        playerName: null,
        actorName: currentPlan.actorName ?? (currentPlan.subject === 'self'
          ? input.selfPlayerId ?? null
          : currentPlan.subject === 'previous_player'
            ? previousPlan?.actorName ?? previousPlan?.playerName ?? null
            : currentPlan.playerName),
      }
      : currentPlan;
    const plan = resolveFollowUp(incomingPlan, previousPlan);
    if (!plan) return execution('clarification', 'follow_up_context_required');
    if (plan.needsClarification || plan.intent === 'unsupported') return execution('clarification', 'query_needs_clarification');
    if (plan.intent === 'teammate_kills') return execution('unavailable', 'teammate_kill_facts_unavailable');

    const playerSelection = resolvePlayerIds(plan, previousPlan, input.authorizedQuery, input.selfPlayerId);
    if (playerSelection.kind === 'clarification' || playerSelection.kind === 'unavailable') {
      return execution(playerSelection.kind, playerSelection.code);
    }

    if (plan.intent === 'team_damage' && (playerSelection.kind !== 'team' || plan.playerName !== null)) {
      return execution('clarification', 'team_damage_requires_directional_player_pair');
    }
    const damagePlayer = (name: string | null): { kind: 'none' } | { kind: 'found'; id: string } | { kind: 'clarification'; code: string } => {
      if (name === null) return { kind: 'none' };
      const resolved = resolveRosterPlayer(input.authorizedQuery, name);
      if (resolved.kind === 'ambiguous') return { kind: 'clarification', code: 'player_alias_ambiguous' };
      if (resolved.kind === 'missing') return { kind: 'clarification', code: 'player_not_in_authorized_roster' };
      return { kind: 'found', id: resolved.id };
    };
    const damageActor = plan.intent === 'team_damage' ? damagePlayer(plan.actorName) : { kind: 'none' as const };
    const damageVictim = plan.intent === 'team_damage' ? damagePlayer(plan.victimName) : { kind: 'none' as const };
    if (damageActor.kind === 'clarification') return execution('clarification', damageActor.code);
    if (damageVictim.kind === 'clarification') return execution('clarification', damageVictim.code);
    if (damageActor.kind === 'found' && damageVictim.kind === 'found' && damageActor.id === damageVictim.id) {
      return execution('clarification', 'team_damage_same_player');
    }

    const currentPeriod = periodSelection(
      plan.period,
      plan.matchCount,
      plan.dayCount,
      previousPlan?.period,
      previousPlan?.dayCount,
      this.now(),
      this.timezone,
      this.businessDayStart,
    );
    if (!currentPeriod) return execution('clarification', plan.period ? 'period_not_supported' : 'period_required');

    if ((plan.intent === 'team_damage' || plan.intent === 'match_review') && currentPeriod.kind !== 'time_period') {
      if (plan.intent === 'match_review' && currentPeriod.kind === 'recent_matches' && currentPeriod.count <= 4) {
        // Recent match review has a separately bounded path below.
      } else {
        return execution('clarification', 'period_not_supported_for_intent');
      }
    }

    const syncState = await input.authorizedQuery.repository.getSyncState(`team:${input.authorizedQuery.teamContext.team.id}`);
    if (!syncState || syncState.source.syncInvoked !== true) return execution('unavailable', 'sync_state_unknown');

    const domain = this.createDomain(input.authorizedQuery);
    const sessionId = input.authorizedQuery.conversation.sessionId;
    const signal = input.signal;

    if (plan.intent === 'team_stats' || plan.intent === 'my_stats' || plan.intent === 'player_stats' || plan.intent === 'leaderboard') {
      if (plan.intent === 'leaderboard') {
        if (playerSelection.kind !== 'team') return execution('clarification', 'leaderboard_requires_team_subject');
        const metric = domainMetric(plan.metric);
        if (!metric) return execution('clarification', 'leaderboard_metric_required_or_unsupported');
        const envelope = await domain.queryStats({
          sessionId,
          selector: statsSelector(currentPeriod),
          metrics: [metric],
          operation: 'rank',
          groupBy: 'player',
          orderBy: { metric, direction: 'desc' },
          limit: MAX_TEAM_ROSTER_SIZE,
          refresh: false,
          ...(signal ? { signal } : {}),
        });
        return { kind: 'executed', plan, envelope };
      }

      if (plan.intent === 'team_stats' && playerSelection.kind !== 'team') return execution('clarification', 'team_stats_subject_mismatch');
      if ((plan.intent === 'my_stats' || plan.intent === 'player_stats') && playerSelection.kind !== 'player') {
        return execution('clarification', 'player_subject_required');
      }
      const requestedMetric = plan.metric === null ? null : domainMetric(plan.metric);
      if (plan.metric !== null && !requestedMetric) return execution('clarification', 'metric_not_supported_for_stats');
      const metrics = requestedMetric ? [requestedMetric] : DEFAULT_STATS_METRICS;
      const envelope = await domain.queryStats({
        sessionId,
        selector: statsSelector(currentPeriod),
        metrics,
        operation: 'report',
        groupBy: 'player',
        orderBy: { metric: metrics[0]!, direction: 'desc' },
        limit: playerSelection.kind === 'player' ? 1 : MAX_TEAM_ROSTER_SIZE,
        refresh: false,
        ...(playerSelection.kind === 'player' ? { playerIds: [playerSelection.id] } : {}),
        ...(signal ? { signal } : {}),
      });
      return { kind: 'executed', plan, envelope };
    }

    if (plan.intent === 'team_damage') {
      if (currentPeriod.kind !== 'time_period') return execution('clarification', 'period_not_supported_for_intent');
      const envelope = await domain.queryTeamDamage({
        sessionId,
        selector: currentPeriod.selector,
        refresh: false,
        ...(damageActor.kind === 'found' && damageVictim.kind === 'found'
          ? { actorPlayer: damageActor.id, victimPlayer: damageVictim.id }
          : {}),
        ...(plan.meleeKind ? { meleeKind: plan.meleeKind } : {}),
        ...(signal ? { signal } : {}),
      });
      return {
        kind: 'executed',
        plan: {
          ...plan,
          actorName: damageActor.kind === 'found'
            ? input.authorizedQuery.teamContext.team.players.find(player => player.id === damageActor.id)?.name ?? null
            : null,
          victimName: damageVictim.kind === 'found'
            ? input.authorizedQuery.teamContext.team.players.find(player => player.id === damageVictim.id)?.name ?? null
            : null,
        },
        envelope,
      };
    }

    if (plan.intent === 'comparison') {
      const comparePeriod = periodSelection(
        plan.comparePeriod,
        plan.matchCount,
        plan.dayCount,
        plan.period,
        plan.dayCount,
        this.now(),
        this.timezone,
        this.businessDayStart,
      );
      if (!comparePeriod) return execution('clarification', plan.comparePeriod ? 'comparison_period_not_supported' : 'comparison_period_required');
      const metric = plan.metric === null ? null : domainMetric(plan.metric);
      if (plan.metric !== null && !metric) return execution('clarification', 'comparison_metric_not_supported');
      const metrics = metric ? [metric] : DEFAULT_STATS_METRICS;
      const playerIds = playerSelection.kind === 'player' ? [playerSelection.id] : undefined;
      const envelope = await domain.compareStats({
        sessionId,
        segments: [
          { label: periodLabel(plan.period, plan.dayCount) ?? statsSelector(currentPeriod).type, selector: statsSelector(currentPeriod) },
          { label: periodLabel(plan.comparePeriod, plan.dayCount) ?? statsSelector(comparePeriod).type, selector: statsSelector(comparePeriod) },
        ],
        metrics,
        groupBy: 'player',
        orderBy: { metric: metrics[0]!, direction: 'desc' },
        limit: playerIds ? 1 : MAX_TEAM_ROSTER_SIZE,
        refresh: false,
        ...(playerIds ? { playerIds } : {}),
        ...(signal ? { signal } : {}),
      });
      return { kind: 'executed', plan, envelope };
    }

    if (plan.intent === 'match_review') {
      if (currentPeriod.kind === 'last_n_matches') return execution('clarification', 'review_match_offset_not_supported');
      const playerIds = playerSelection.kind === 'player' ? [playerSelection.id] : undefined;
      const searchInput: SearchMatchesInput = {
        sessionId,
        page: 0,
        pageSize: 4,
        sort: 'desc',
        refresh: false,
        ...(playerIds ? { playerIds } : {}),
        ...(signal ? { signal } : {}),
        ...(currentPeriod.kind === 'time_period'
          ? { selector: currentPeriod.selector }
          : { recentN: currentPeriod.count }),
      };
      const search = await domain.searchMatches(searchInput);
      if (!search.resultSetId) return execution('unavailable', 'review_result_set_unavailable');
      const reviewInput: GetPeriodReviewInput = {
        sessionId,
        searchResultSetId: search.resultSetId,
        ...(playerIds ? { playerIds } : {}),
        ...(signal ? { signal } : {}),
      };
      const envelope = await domain.getPeriodReview(reviewInput);
      return { kind: 'executed', plan, envelope };
    }

    return execution('clarification', 'intent_not_supported');
  }
}
