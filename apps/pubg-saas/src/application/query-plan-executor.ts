import {
  PubgDomainService,
  resolveSelector,
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
import { QueryPlanSchema, type QueryPlan } from './nl-query-planner.js';

const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const DEFAULT_BUSINESS_DAY_START = '06:00';
const DAY_MS = 24 * 60 * 60 * 1000;
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
  /** Only an account claim/identity check performed by the handler may supply this. */
  selfPlayerId?: string;
  signal?: AbortSignal;
}

export type QueryPlanExecutionResult =
  | { kind: 'executed'; plan: QueryPlan; envelope: ToolEnvelope }
  | { kind: 'clarification'; code: string }
  | { kind: 'unavailable'; code: string };

type PeriodValue = NonNullable<QueryPlan['period']>;
type RangeSelector = Extract<StatsToolInput['selector'], { type: 'time_range' }>;
type MatchSelector = Extract<StatsToolInput['selector'], { type: 'last_n_matches' }>;

type PeriodSelection =
  | { kind: 'time_range'; selector: RangeSelector }
  | { kind: 'last_n_matches'; selector: MatchSelector }
  | { kind: 'recent_matches'; count: number };

type StatsSelector = RangeSelector | MatchSelector;

function statsSelector(period: PeriodSelection): StatsSelector {
  return period.kind === 'recent_matches'
    ? { type: 'last_n_matches', count: period.count, offset: 0 }
    : period.selector;
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

function timeRange(
  from: Date,
  to: Date,
  timezone: string,
  businessDayStart: string,
): RangeSelector {
  return {
    type: 'time_range',
    from: from.toISOString(),
    to: to.toISOString(),
    timezone,
    businessDayStart,
  };
}

function relativeRange(
  value: string,
  now: Date,
  timezone: string,
  businessDayStart: string,
): RangeSelector {
  // Call only with an explicit allowlisted selector. Domain's resolver defaults
  // unrecognized relative periods to today, so all callers validate first.
  const resolved = resolveSelector(
    { type: 'relative_period', value, label: value },
    { now, timezone, businessDayStart },
  );
  return {
    type: 'time_range',
    from: resolved.start,
    to: resolved.end,
    timezone,
    businessDayStart,
  };
}

function previousPeriodSelection(
  basePeriod: PeriodValue | null | undefined,
  matchCount: number | null,
  now: Date,
  timezone: string,
  businessDayStart: string,
): PeriodSelection | null {
  if (!basePeriod || basePeriod === 'previous_period') return null;
  switch (basePeriod) {
    case 'today': return { kind: 'time_range', selector: relativeRange('yesterday', now, timezone, businessDayStart) };
    case 'yesterday': return { kind: 'time_range', selector: relativeRange('day_before_yesterday', now, timezone, businessDayStart) };
    case 'this_week': return { kind: 'time_range', selector: relativeRange('last_week', now, timezone, businessDayStart) };
    case 'last_7_days': return { kind: 'time_range', selector: timeRange(new Date(now.getTime() - 14 * DAY_MS), new Date(now.getTime() - 7 * DAY_MS), timezone, businessDayStart) };
    case 'previous_7_days': return { kind: 'time_range', selector: timeRange(new Date(now.getTime() - 21 * DAY_MS), new Date(now.getTime() - 14 * DAY_MS), timezone, businessDayStart) };
    case 'last_match': return { kind: 'last_n_matches', selector: { type: 'last_n_matches', count: 1, offset: 1 } };
    case 'recent_matches':
      return matchCount
        ? { kind: 'last_n_matches', selector: { type: 'last_n_matches', count: matchCount, offset: matchCount } }
        : null;
    case 'last_night':
    case 'last_week':
      return null;
  }
}

function periodSelection(
  period: PeriodValue | null,
  matchCount: number | null,
  previousBasePeriod: PeriodValue | null | undefined,
  now: Date,
  timezone: string,
  businessDayStart: string,
): PeriodSelection | null {
  if (!period) return null;
  if (period === 'previous_period') {
    return previousPeriodSelection(previousBasePeriod, matchCount, now, timezone, businessDayStart);
  }
  if (period === 'last_match') return { kind: 'last_n_matches', selector: { type: 'last_n_matches', count: 1, offset: 0 } };
  if (period === 'recent_matches') {
    return matchCount ? { kind: 'recent_matches', count: matchCount } : null;
  }
  if (period === 'last_7_days') {
    return { kind: 'time_range', selector: timeRange(new Date(now.getTime() - 7 * DAY_MS), now, timezone, businessDayStart) };
  }
  if (period === 'previous_7_days') {
    return { kind: 'time_range', selector: timeRange(new Date(now.getTime() - 14 * DAY_MS), new Date(now.getTime() - 7 * DAY_MS), timezone, businessDayStart) };
  }
  if (period === 'today' || period === 'yesterday' || period === 'last_night' || period === 'this_week' || period === 'last_week') {
    return { kind: 'time_range', selector: relativeRange(period, now, timezone, businessDayStart) };
  }
  return null;
}

function periodLabel(period: PeriodValue | null): string | null {
  if (!period) return null;
  const labels: Record<PeriodValue, string> = {
    today: '今天', yesterday: '昨天', last_night: '昨晚', last_7_days: '最近七天',
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
    if (parsedPlan.data.intent === 'team_damage' && parsedPlan.data.subject === 'self' && !hasValue(input.selfPlayerId)) {
      return execution('unavailable', 'self_identity_not_prevalidated');
    }
    const parsedPrevious = input.previousPlan == null ? null : QueryPlanSchema.safeParse(input.previousPlan);
    const previousPlan = parsedPrevious?.success ? parsedPrevious.data : null;
    if (parsedPlan.data.intent === 'team_damage' && parsedPlan.data.subject === 'previous_player'
      && !parsedPlan.data.actorName && !parsedPlan.data.playerName && !previousPlan?.actorName && !previousPlan?.playerName) {
      return execution('clarification', 'follow_up_context_required');
    }
    const incomingPlan = parsedPlan.data.intent === 'team_damage'
      ? {
        ...parsedPlan.data,
        subject: 'team' as const,
        playerName: null,
        actorName: parsedPlan.data.actorName ?? (parsedPlan.data.subject === 'self'
          ? input.selfPlayerId ?? null
          : parsedPlan.data.subject === 'previous_player'
            ? previousPlan?.actorName ?? previousPlan?.playerName ?? null
            : parsedPlan.data.playerName),
      }
      : parsedPlan.data;
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
      previousPlan?.period,
      this.now(),
      this.timezone,
      this.businessDayStart,
    );
    if (!currentPeriod) return execution('clarification', plan.period ? 'period_not_supported' : 'period_required');

    if ((plan.intent === 'team_damage' || plan.intent === 'match_review') && currentPeriod.kind !== 'time_range') {
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
          limit: 4,
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
        limit: playerSelection.kind === 'player' ? 1 : 4,
        refresh: false,
        ...(playerSelection.kind === 'player' ? { playerIds: [playerSelection.id] } : {}),
        ...(signal ? { signal } : {}),
      });
      return { kind: 'executed', plan, envelope };
    }

    if (plan.intent === 'team_damage') {
      if (currentPeriod.kind !== 'time_range') return execution('clarification', 'period_not_supported_for_intent');
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
        plan.period,
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
          { label: periodLabel(plan.period) ?? statsSelector(currentPeriod).type, selector: statsSelector(currentPeriod) },
          { label: periodLabel(plan.comparePeriod) ?? statsSelector(comparePeriod).type, selector: statsSelector(comparePeriod) },
        ],
        metrics,
        groupBy: 'player',
        orderBy: { metric: metrics[0]!, direction: 'desc' },
        limit: playerIds ? 1 : 4,
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
        ...(currentPeriod.kind === 'time_range'
          ? { from: currentPeriod.selector.from, to: currentPeriod.selector.to }
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
