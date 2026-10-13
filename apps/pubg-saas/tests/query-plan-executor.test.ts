import assert from 'node:assert/strict';
import test from 'node:test';
import { createTeamContext, type Coverage, type SyncState, type ToolEnvelope } from '@agent/pubg-domain';
import type { AuthorizedPublicQuery } from '../src/application/public-query-authorizer.js';
import {
  QueryPlanExecutor,
  type QueryPlanDomainPort,
} from '../src/application/query-plan-executor.js';
import type { QueryPlan } from '../src/application/nl-query-planner.js';

const NOW = new Date('2026-01-15T12:00:00.000Z');
const coverage: Coverage = {
  status: 'PARTIAL',
  complete: false,
  failedMatchIds: ['fixture-unavailable-match'],
  sourceUnavailable: false,
  freshness: 'unknown',
};

const partialEnvelope: ToolEnvelope = {
  status: 'partial',
  data: { rows: [{ playerId: 'player-1', kills: null }] },
  coverage,
  asOf: NOW.toISOString(),
  metricVersion: 'fixture-metrics-v1',
  queryResolved: { fixture: true },
  evidenceRefs: {
    matchIds: ['match-1'],
    playerIds: ['player-1'],
    fields: ['kills'],
    calculation: 'fixture',
  },
};

function makePlan(overrides: Partial<QueryPlan> = {}): QueryPlan {
  return {
    version: 1,
    intent: 'team_stats',
    subject: 'team',
    playerName: null,
    actorName: null,
    victimName: null,
    metric: null,
    period: 'today',
    comparePeriod: null,
    matchCount: null,
    needsClarification: false,
    ...overrides,
  };
}

function makeQuery(syncState: SyncState | null = {
  key: 'team:team-1',
  checkedAt: NOW.toISOString(),
  coverage,
  source: { syncInvoked: true, playerApiCalls: 0, matchApiCalls: 0, localMatchCount: 2 },
  discoveredMatchIds: ['match-1', 'match-2'],
  failedMatchIds: [],
}): AuthorizedPublicQuery {
  const teamContext = createTeamContext('tenant-1', {
    id: 'team-1',
    label: 'Fixture team',
    platform: 'steam',
    players: [
      { id: 'player-1', name: 'Alpha', aliases: ['阿尔法', 'a1'] },
      { id: 'player-2', name: 'Bravo', aliases: ['布拉沃'] },
      { id: 'player-3', name: 'Charlie', aliases: [] },
      { id: 'player-4', name: 'Delta', aliases: [] },
    ],
  });
  return {
    requestId: 'request-1',
    teamContext,
    conversation: {
      platform: 'kook',
      kind: 'direct_team',
      botAccountId: 'bot-1',
      userId: 'kook-user-1',
      channelId: 'dm:bot-1:kook-user-1',
      sessionId: 'session-1',
    },
    repository: {
      getSyncState: async (key: string) => key === 'team:team-1' ? syncState : null,
    } as unknown as AuthorizedPublicQuery['repository'],
  } as unknown as AuthorizedPublicQuery;
}

function setup(syncState?: SyncState | null) {
  const calls: Array<{ method: string; input: unknown }> = [];
  const domain: QueryPlanDomainPort = {
    queryStats: async (input) => {
      calls.push({ method: 'queryStats', input });
      return partialEnvelope;
    },
    compareStats: async (input) => {
      calls.push({ method: 'compareStats', input });
      return partialEnvelope;
    },
    queryTeamDamage: async (input) => {
      calls.push({ method: 'queryTeamDamage', input });
      return partialEnvelope;
    },
    searchMatches: async (input) => {
      calls.push({ method: 'searchMatches', input });
      return { ...partialEnvelope, resultSetId: 'review-set-1' };
    },
    getPeriodReview: async (input) => {
      calls.push({ method: 'getPeriodReview', input });
      return partialEnvelope;
    },
  };
  const query = syncState === undefined ? makeQuery() : makeQuery(syncState);
  const executor = new QueryPlanExecutor({ createDomain: () => domain, now: () => new Date(NOW) });
  return { calls, query, executor };
}

test('team stats uses the authorized session, bounded selector, no refresh, and preserves partial data', async () => {
  const { calls, query, executor } = setup();
  const result = await executor.execute({ authorizedQuery: query, plan: makePlan() });

  assert.equal(result.kind, 'executed');
  if (result.kind !== 'executed') return;
  assert.equal(result.envelope, partialEnvelope);
  assert.equal(result.envelope.status, 'partial');
  assert.deepEqual(result.envelope.coverage.failedMatchIds, ['fixture-unavailable-match']);
  assert.deepEqual(calls, [{
    method: 'queryStats',
    input: {
      sessionId: 'session-1',
      selector: {
        type: 'time_range',
        from: '2026-01-14T22:00:00.000Z',
        to: NOW.toISOString(),
        timezone: 'Asia/Shanghai',
        businessDayStart: '06:00',
      },
      metrics: ['matches', 'kills', 'assists', 'damage', 'kd'],
      operation: 'report',
      groupBy: 'player',
      orderBy: { metric: 'matches', direction: 'desc' },
      limit: 4,
      refresh: false,
    },
  }]);
});

test('player aliases resolve only within the authorized team roster', async () => {
  const { calls, query, executor } = setup();
  const allowed = await executor.execute({
    authorizedQuery: query,
    plan: makePlan({ intent: 'player_stats', subject: 'player', playerName: '阿尔法', metric: 'kills' }),
  });
  assert.equal(allowed.kind, 'executed');
  assert.equal(calls[0]?.method, 'queryStats');
  assert.deepEqual((calls[0]?.input as { playerIds?: string[] }).playerIds, ['player-1']);

  calls.length = 0;
  const outside = await executor.execute({
    authorizedQuery: query,
    plan: makePlan({ intent: 'player_stats', subject: 'player', playerName: 'Not on this team', metric: 'kills' }),
  });
  assert.deepEqual(outside, { kind: 'clarification', code: 'player_not_in_authorized_roster' });
  assert.equal(calls.length, 0);
});

test('self queries require a handler-prevalidated self player in the authorized roster', async () => {
  const { calls, query, executor } = setup();
  const missing = await executor.execute({
    authorizedQuery: query,
    plan: makePlan({ intent: 'my_stats', subject: 'self', metric: 'kills' }),
  });
  assert.deepEqual(missing, { kind: 'unavailable', code: 'self_identity_not_prevalidated' });
  assert.equal(calls.length, 0);

  const foreign = await executor.execute({
    authorizedQuery: query,
    selfPlayerId: 'another-team-player',
    plan: makePlan({ intent: 'my_stats', subject: 'self', metric: 'kills' }),
  });
  assert.deepEqual(foreign, { kind: 'unavailable', code: 'self_player_not_in_authorized_roster' });
  assert.equal(calls.length, 0);
});

test('last seven days passes an explicit half-open range to friendly damage query without refresh', async () => {
  const { calls, query, executor } = setup();
  const result = await executor.execute({
    authorizedQuery: query,
    plan: makePlan({ intent: 'team_damage', period: 'last_7_days' }),
  });

  assert.equal(result.kind, 'executed');
  assert.equal(calls[0]?.method, 'queryTeamDamage');
  assert.deepEqual(calls[0]?.input, {
    sessionId: 'session-1',
    selector: {
      type: 'time_range',
      from: '2026-01-08T12:00:00.000Z',
      to: NOW.toISOString(),
      timezone: 'Asia/Shanghai',
      businessDayStart: '06:00',
    },
    refresh: false,
  });
});

test('friendly fire resolves both named directions only inside the authorized roster', async () => {
  const { calls, query, executor } = setup();
  const pair = await executor.execute({
    authorizedQuery: query,
    plan: makePlan({ intent: 'team_damage', actorName: '阿尔法', victimName: 'Bravo', period: 'yesterday', metric: 'teammate_damage' }),
  });
  assert.equal(pair.kind, 'executed');
  assert.deepEqual(calls[0]?.input, {
    sessionId: 'session-1',
    selector: {
      type: 'time_range',
      from: '2026-01-13T22:00:00.000Z',
      to: '2026-01-14T22:00:00.000Z',
      timezone: 'Asia/Shanghai',
      businessDayStart: '06:00',
    },
    refresh: false,
    actorPlayer: 'player-1',
    victimPlayer: 'player-2',
  });

  calls.length = 0;
  const outside = await executor.execute({
    authorizedQuery: query,
    plan: makePlan({ intent: 'team_damage', actorName: 'Not on this team', victimName: 'Bravo', metric: 'teammate_damage' }),
  });
  assert.deepEqual(outside, { kind: 'clarification', code: 'player_not_in_authorized_roster' });
  assert.equal(calls.length, 0);
});

test('friendly fire can rank the authorized actor without asking Domain to trust model identity', async () => {
  const { calls, query, executor } = setup();
  const result = await executor.execute({
    authorizedQuery: query,
    plan: makePlan({ intent: 'team_damage', actorName: 'Alpha', victimName: null, metric: 'teammate_damage' }),
  });
  assert.equal(result.kind, 'executed');
  assert.deepEqual(calls[0]?.input, {
    sessionId: 'session-1',
    selector: {
      type: 'time_range',
      from: '2026-01-14T22:00:00.000Z',
      to: NOW.toISOString(),
      timezone: 'Asia/Shanghai',
      businessDayStart: '06:00',
    },
    refresh: false,
  });
});

test('friendly fire follow-up inherits the prior authorized player and period', async () => {
  const { calls, query, executor } = setup();
  const prior = makePlan({ intent: 'player_stats', subject: 'player', playerName: 'Alpha', period: 'yesterday', metric: 'kills' });
  const result = await executor.execute({
    authorizedQuery: query,
    previousPlan: prior,
    plan: makePlan({ intent: 'team_damage', subject: 'previous_player', actorName: null, victimName: null, playerName: null, metric: 'teammate_damage', period: null }),
  });
  assert.equal(result.kind, 'executed');
  if (result.kind !== 'executed') return;
  assert.equal(result.plan.period, 'yesterday');
  assert.equal(result.plan.actorName, 'Alpha');
  assert.deepEqual(calls[0]?.input, {
    sessionId: 'session-1',
    selector: {
      type: 'time_range',
      from: '2026-01-13T22:00:00.000Z',
      to: '2026-01-14T22:00:00.000Z',
      timezone: 'Asia/Shanghai',
      businessDayStart: '06:00',
    },
    refresh: false,
  });
});

test('unknown sync state and teammate kill intent do not fabricate results or invoke Domain', async () => {
  const unknown = setup(null);
  const unknownResult = await unknown.executor.execute({ authorizedQuery: unknown.query, plan: makePlan() });
  assert.deepEqual(unknownResult, { kind: 'unavailable', code: 'sync_state_unknown' });
  assert.equal(unknown.calls.length, 0);

  const teammateKills = setup();
  const teammateResult = await teammateKills.executor.execute({
    authorizedQuery: teammateKills.query,
    plan: makePlan({ intent: 'teammate_kills', metric: 'teammate_kills' }),
  });
  assert.deepEqual(teammateResult, { kind: 'unavailable', code: 'teammate_kill_facts_unavailable' });
  assert.equal(teammateKills.calls.length, 0);
});

test('comparison uses two explicit supported segments and deterministic metric ordering', async () => {
  const { calls, query, executor } = setup();
  const result = await executor.execute({
    authorizedQuery: query,
    plan: makePlan({ intent: 'comparison', metric: 'kills', period: 'today', comparePeriod: 'yesterday' }),
  });
  assert.equal(result.kind, 'executed');
  assert.equal(calls[0]?.method, 'compareStats');
  const input = calls[0]?.input as { sessionId: string; segments: Array<{ selector: { from: string; to: string } }>; refresh: boolean };
  assert.equal(input.sessionId, 'session-1');
  assert.equal(input.refresh, false);
  assert.deepEqual(input.segments.map((segment) => [segment.selector.from, segment.selector.to]), [
    ['2026-01-14T22:00:00.000Z', NOW.toISOString()],
    ['2026-01-13T22:00:00.000Z', '2026-01-14T22:00:00.000Z'],
  ]);
});

test('period review uses explicit from/to, refresh false, and the Domain result-set handle', async () => {
  const { calls, query, executor } = setup();
  const result = await executor.execute({
    authorizedQuery: query,
    plan: makePlan({ intent: 'match_review', period: 'yesterday' }),
  });
  assert.equal(result.kind, 'executed');
  assert.deepEqual(calls.map((call) => call.method), ['searchMatches', 'getPeriodReview']);
  assert.deepEqual(calls[0]?.input, {
    sessionId: 'session-1',
    page: 0,
    pageSize: 4,
    sort: 'desc',
    refresh: false,
    from: '2026-01-13T22:00:00.000Z',
    to: '2026-01-14T22:00:00.000Z',
  });
  assert.deepEqual(calls[1]?.input, { sessionId: 'session-1', searchResultSetId: 'review-set-1' });
  if (result.kind === 'executed') assert.equal(result.envelope.status, 'partial');
});

test('follow-up inherits only the prior validated plan and resolves its authorized player alias', async () => {
  const { calls, query, executor } = setup();
  const prior = makePlan({ intent: 'player_stats', subject: 'player', playerName: 'Bravo', metric: 'kills', period: 'yesterday' });
  const result = await executor.execute({
    authorizedQuery: query,
    previousPlan: prior,
    plan: makePlan({ intent: 'follow_up', subject: 'previous_player', playerName: null, metric: 'damage', period: null }),
  });
  assert.equal(result.kind, 'executed');
  const input = calls[0]?.input as { playerIds?: string[]; metrics: string[]; selector: { from: string; to: string } };
  assert.deepEqual(input.playerIds, ['player-2']);
  assert.deepEqual(input.metrics, ['damage']);
  assert.deepEqual([input.selector.from, input.selector.to], ['2026-01-13T22:00:00.000Z', '2026-01-14T22:00:00.000Z']);
});

test('previous-period request without session context clarifies instead of falling back to today', async () => {
  const { calls, query, executor } = setup();
  const result = await executor.execute({
    authorizedQuery: query,
    plan: makePlan({ period: 'previous_period' }),
  });
  assert.deepEqual(result, { kind: 'clarification', code: 'follow_up_context_required' });
  assert.equal(calls.length, 0);
});
