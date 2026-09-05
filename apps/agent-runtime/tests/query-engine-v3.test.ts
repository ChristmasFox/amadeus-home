import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TEAM } from '../src/config/team.js';
import { CHICKEN_INDEX_WEIGHTS, normalizeChickenIndexWeights } from '../src/config/chicken-index.js';
import { InMemoryContextStore, sessionId } from '../src/context/context-store.js';
import { FixtureDataProvider } from '../src/data/provider.js';
import { DeterministicQueryEngine } from '../src/engine/query-engine.js';
import { buildDeterministicQuery } from '../src/planner/deterministic-planner.js';
import { renderResult } from '../src/renderers/renderers.js';
import { CanonicalQuerySchema } from '../src/schema/query.js';
import { resolveSelector } from '../src/time/selector-resolver.js';
import { PubgMastraRuntime } from '../src/runtime/workflow.js';
import { classifyPubgRequest } from '../src/runtime/router.js';
import { FIXTURE_RECORDS, TEST_NOW } from './fixtures.js';

const coverage = {
  status: 'OK' as const,
  complete: true,
  coverageStart: '2026-08-01T00:00:00.000Z',
  coverageEnd: TEST_NOW.toISOString(),
  checkedAt: TEST_NOW.toISOString(),
  failedMatchIds: [],
  sourceUnavailable: false,
  freshness: 'fresh' as const,
};
const source = { store: 'fixture', syncInvoked: false, playerApiCalls: 0, matchApiCalls: 0, localMatchCount: FIXTURE_RECORDS.length };

test('time resolver handles business day, weekday, date and hour deterministically', () => {
  const yesterday = resolveSelector({ type: 'relative_period', value: 'yesterday', label: '昨天' }, { now: TEST_NOW });
  assert.equal(yesterday.start, '2026-08-30T22:00:00.000Z');
  assert.equal(yesterday.end, '2026-08-31T22:00:00.000Z');
  const saturday = resolveSelector({ type: 'relative_period', value: '上周六', label: '上周六' }, { now: TEST_NOW });
  assert.equal(saturday.start, '2026-08-28T22:00:00.000Z');
  const night = resolveSelector({ type: 'relative_period', value: '8月20号晚上10点以后', label: '指定时段' }, { now: TEST_NOW });
  assert.equal(night.start, '2026-08-20T14:00:00.000Z');
  assert.equal(night.end, '2026-08-20T22:00:00.000Z');
});

test('planner produces versioned default team and semantic operations', () => {
  const report = buildDeterministicQuery({ text: '昨天战绩怎么样？', now: TEST_NOW, queryId: 'q1', sessionId: 's1' });
  assert.equal(report.version, 3);
  assert.deepEqual(report.subject.ids, ['default_team']);
  assert.equal(report.operation, 'report');
  assert.equal(report.groupBy, 'player');
  assert.deepEqual(report.orderBy, { metric: 'kd', direction: 'desc' });
  assert.equal(CanonicalQuerySchema.safeParse(report).success, true);

  const strongest = buildDeterministicQuery({ text: '最近20场表现最好的是谁？', now: TEST_NOW });
  assert.equal(strongest.operation, 'strongest');
  assert.equal(strongest.selector.type, 'last_n_matches');
  const matchRank = buildDeterministicQuery({ text: '昨天哪一把伤害最高？', now: TEST_NOW });
  assert.equal(matchRank.operation, 'rank');
  assert.equal(matchRank.groupBy, 'match');
  assert.equal(matchRank.orderBy.metric, 'damage');
});

test('context preserves semantic operation when only the selector changes', () => {
  const previousStrongest = buildDeterministicQuery({ text: '昨天谁最强', now: TEST_NOW, sessionId: 's1' });
  const strongestFollowUp = buildDeterministicQuery({
    text: '前天呢',
    now: TEST_NOW,
    sessionId: 's1',
    context: {
      activeDomain: 'pubg',
      lastSelector: previousStrongest.selector,
      lastResultSetId: null,
      lastQuery: previousStrongest,
    },
  });
  assert.equal(strongestFollowUp.operation, 'strongest');
  assert.equal(strongestFollowUp.selector.type, 'relative_period');
  assert.equal(strongestFollowUp.selector.value, 'day_before_yesterday');

  const previousMetric = buildDeterministicQuery({ text: '昨天哪一把伤害最高', now: TEST_NOW, sessionId: 's1' });
  const metricFollowUp = buildDeterministicQuery({
    text: '前天呢',
    now: TEST_NOW,
    sessionId: 's1',
    context: {
      activeDomain: 'pubg',
      lastSelector: previousMetric.selector,
      lastResultSetId: null,
      lastQuery: previousMetric,
    },
  });
  assert.equal(metricFollowUp.operation, 'rank');
  assert.equal(metricFollowUp.groupBy, 'match');
  assert.equal(metricFollowUp.orderBy.metric, 'damage');
});

test('Chicken Index weights are configured and normalized deterministically', () => {
  assert.deepEqual(CHICKEN_INDEX_WEIGHTS, { kd: 0.35, avgDamage: 0.3, avgKills: 0.2, placement: 0.1, top10Rate: 0.05 });
  const weights = normalizeChickenIndexWeights({ kd: 2, avgDamage: 1, avgKills: 1, placement: 0, top10Rate: 0 });
  assert.equal(weights.kd, 0.5);
  assert.equal(Object.values(weights).reduce((sum, value) => sum + value, 0), 1);
});

test('domain router mandates explicit PUBG and structured follow-up requests', () => {
  assert.equal(classifyPubgRequest('谁最强？', null).route, 'mandatory');
  assert.equal(classifyPubgRequest('帮我查天气', null).route, 'pass');
  const context = {
    schemaVersion: 3 as const,
    sessionId: 's1',
    activeDomain: 'pubg' as const,
    lastQuery: null,
    lastSelector: null,
    lastResultSetId: null,
    lastSubject: null,
    references: {},
    updatedAt: TEST_NOW.toISOString(),
    expiresAt: new Date(TEST_NOW.getTime() + 3600000).toISOString(),
  };
  assert.equal(classifyPubgRequest('哪一把？', context).reason, 'active_pubg_follow_up');
  assert.equal(classifyPubgRequest('帮我查天气', context).route, 'pass');
});

test('default report includes all four players, KD ordering and team totals', () => {
  const query = buildDeterministicQuery({ text: '昨天战绩', now: TEST_NOW, sessionId: 's1' });
  const engine = new DeterministicQueryEngine({ team: DEFAULT_TEAM, now: TEST_NOW });
  const result = engine.execute(query, FIXTURE_RECORDS, coverage, source, {});
  assert.equal(result.status, 'OK');
  assert.equal(result.data.rows.length, 4);
  assert.deepEqual(result.data.rows.map((row) => row.label), ['SG_LabmemNo004', 'SG_LabmemNo007', 'SG_LabmemNo008', 'kim_kkl']);
  assert.equal(result.data.summary.uniqueMatchCount, 2);
  assert.equal((result.data.summary.team as Record<string, unknown>).kills, 30);
  const rendered = renderResult(result, resultQuery(result, query));
  assert.match(rendered, /SG_LabmemNo007/u);
  assert.match(rendered, /👥 小队总览/u);
  assert.doesNotMatch(rendered, /\| 队员 \|/u);
});

test('match-level ranking returns a match, not a player', () => {
  const query = buildDeterministicQuery({ text: '昨天哪一把伤害最高？', now: TEST_NOW });
  const engine = new DeterministicQueryEngine({ team: DEFAULT_TEAM, now: TEST_NOW });
  const result = engine.execute(query, FIXTURE_RECORDS, coverage, source, {});
  assert.equal(result.data.groupBy, 'match');
  assert.equal(result.data.rows.length, 1);
  assert.equal(result.data.rows[0]?.matchId, 'm2');
  assert.ok(result.data.rows[0]?.players?.length === 4);
});

test('last N, strongest, weakest, compare and trend are deterministic operations', () => {
  const engine = new DeterministicQueryEngine({ team: DEFAULT_TEAM, now: TEST_NOW });
  for (const text of ['最近3场谁最强？', '最近3场谁最菜？', '最近3场哪一把杀人最多？']) {
    const query = buildDeterministicQuery({ text, now: TEST_NOW });
    const result = engine.execute(query, FIXTURE_RECORDS, coverage, source, {});
    assert.equal(result.status, 'OK');
    assert.equal(result.data.rows.length, 1);
  }
  const compareQuery = buildDeterministicQuery({ text: '昨天 vs 前天怎么样？', now: TEST_NOW });
  const compare = engine.execute(compareQuery, FIXTURE_RECORDS, coverage, source, {});
  assert.equal(compare.data.segments?.length, 2);
  const firstSegmentRow = compare.data.segments?.[0]?.rows.find((row) => row.label === 'SG_LabmemNo007');
  const secondSegmentRow = compare.data.segments?.[1]?.rows.find((row) => row.label === 'SG_LabmemNo007');
  const deltaRow = compare.data.rows.find((row) => row.label === 'SG_LabmemNo007');
  assert.equal(deltaRow?.metrics.kills, (firstSegmentRow?.metrics.kills as number) - (secondSegmentRow?.metrics.kills as number));
  const trendQuery = buildDeterministicQuery({ text: '最近7天状态是不是变好了？', now: TEST_NOW });
  const trend = engine.execute(trendQuery, FIXTURE_RECORDS, coverage, source, {});
  assert.equal(trend.data.operation, 'trend');
  assert.ok(trend.data.dailySeries?.length);
});

test('unsupported capabilities never become a factual answer', () => {
  const query = buildDeterministicQuery({ text: '昨天用什么枪杀人最多？', now: TEST_NOW });
  const engine = new DeterministicQueryEngine({ team: DEFAULT_TEAM, now: TEST_NOW });
  const result = engine.execute(query, FIXTURE_RECORDS, coverage, source, {});
  assert.equal(result.status, 'UNSUPPORTED_CAPABILITY');
  assert.match(renderResult(result, query), /不支持|未编造/u);
});

test('Mastra runtime preserves structured context and isolates senders', async () => {
  const store = new InMemoryContextStore();
  const provider = new FixtureDataProvider(FIXTURE_RECORDS, coverage, source);
  const runtime = new PubgMastraRuntime({ provider, contextStore: store, team: DEFAULT_TEAM });
  const first = await runtime.handle({ text: '昨天战绩', platform: 'kook', launcherType: 'group', launcherId: 'g1', senderId: 'a', now: TEST_NOW.toISOString() });
  assert.equal(first.status, 'OK');
  const follow = await runtime.handle({ text: '谁最强？', platform: 'kook', launcherType: 'group', launcherId: 'g1', senderId: 'a', now: TEST_NOW.toISOString() });
  assert.equal(follow.query?.reference.inheritedFromContext, true);
  assert.equal(follow.query?.selector.type, 'relative_period');
  const matchFollow = await runtime.handle({ text: '哪一把伤害最高？', platform: 'kook', launcherType: 'group', launcherId: 'g1', senderId: 'a', now: TEST_NOW.toISOString() });
  assert.equal(matchFollow.query?.selector.type, 'result_set');
  assert.equal(matchFollow.data?.groupBy, 'match');
  const otherUser = await runtime.handle({ text: '谁最菜？', platform: 'kook', launcherType: 'group', launcherId: 'g1', senderId: 'b', now: TEST_NOW.toISOString() });
  assert.equal(otherUser.query?.reference.inheritedFromContext, false);
  assert.equal(otherUser.query?.selector.type, 'relative_period');
  assert.equal(otherUser.query?.selector.value, 'today');
  assert.match(first.response, /SG_LabmemNo007/u);
  assert.equal(sessionId({ platform: 'kook', launcherType: 'group', launcherId: 'g1', senderId: 'a', domain: 'pubg' }), 'kook:group:g1:a:pubg');
});

function resultQuery(_result: unknown, query: ReturnType<typeof buildDeterministicQuery>) {
  return { ...query, selector: resolveSelector(query.selector, { now: TEST_NOW }) } as ReturnType<typeof buildDeterministicQuery>;
}
