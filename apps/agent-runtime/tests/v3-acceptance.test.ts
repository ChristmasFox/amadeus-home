import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TEAM } from '../src/config/team.js';
import { InMemoryContextStore, contextForQuery } from '../src/context/context-store.js';
import type { Coverage, SourceInfo } from '../src/schema/status.js';
import { FixtureDataProvider } from '../src/data/provider.js';
import { DeterministicQueryEngine } from '../src/engine/query-engine.js';
import { buildDeterministicQuery } from '../src/planner/deterministic-planner.js';
import { renderResult } from '../src/renderers/renderers.js';
import { resolveSelector } from '../src/time/selector-resolver.js';
import { PubgMastraRuntime } from '../src/runtime/workflow.js';
import { classifyPubgRequest } from '../src/runtime/router.js';
import { FIXTURE_RECORDS, TEST_NOW } from './fixtures.js';

const completeCoverage: Coverage = {
  status: 'OK',
  complete: true,
  coverageStart: '2026-08-01T00:00:00.000Z',
  coverageEnd: TEST_NOW.toISOString(),
  checkedAt: TEST_NOW.toISOString(),
  failedMatchIds: [],
  sourceUnavailable: false,
  freshness: 'fresh',
};

const fixtureSource: SourceInfo = {
  store: 'fixture',
  syncInvoked: false,
  playerApiCalls: 0,
  matchApiCalls: 0,
  localMatchCount: FIXTURE_RECORDS.length,
};

function execute(text: string, coverage = completeCoverage) {
  const query = buildDeterministicQuery({ text, now: TEST_NOW, sessionId: 'acceptance-session' });
  const engine = new DeterministicQueryEngine({ team: DEFAULT_TEAM, now: TEST_NOW });
  return { query, result: engine.execute(query, FIXTURE_RECORDS, coverage, fixtureSource, {}) };
}

test('planner covers default report, ranking aliases, selectors and explicit players', () => {
  const report = buildDeterministicQuery({ text: '今天战绩', now: TEST_NOW });
  assert.deepEqual(report.subject, { type: 'team', ids: ['default_team'], label: '四人组' });
  assert.equal(report.operation, 'report');
  assert.equal(report.groupBy, 'player');
  assert.deepEqual(report.orderBy, { metric: 'kd', direction: 'desc' });

  const strongest = buildDeterministicQuery({ text: '上周谁最强', now: TEST_NOW });
  assert.equal(strongest.operation, 'strongest');
  assert.equal(strongest.selector.type, 'relative_period');

  const weakest = buildDeterministicQuery({ text: '昨天谁拉完了', now: TEST_NOW });
  assert.equal(weakest.operation, 'weakest');

  const multiple = buildDeterministicQuery({ text: '昨天比较 007 和 008', now: TEST_NOW });
  assert.equal(multiple.subject.type, 'players');
  assert.equal(multiple.subject.ids.length, 2);

  const player = buildDeterministicQuery({ text: 'SG_LabmemNo007 昨天怎么样', now: TEST_NOW });
  assert.equal(player.subject.type, 'player');
  assert.deepEqual(player.subject.ids, [DEFAULT_TEAM.players[0]?.id]);
});

test('time selectors keep explicit date/hour precedence and business-day boundaries', () => {
  const inputs = [
    ['前天战绩', 'day_before_yesterday'],
    ['上周六战绩', '上周六'],
    ['8月20号战绩', '8月20号战绩'],
    ['8月20号晚上10点以后战绩', '8月20号晚上10点以后战绩'],
    ['昨晚10点以后战绩', '昨晚10点以后战绩'],
  ] as const;
  for (const [text, value] of inputs) {
    const query = buildDeterministicQuery({ text, now: TEST_NOW });
    assert.equal(query.selector.type, 'relative_period');
    assert.equal(query.selector.value, value);
  }

  const yesterday = resolveSelector({ type: 'relative_period', value: 'yesterday', label: '昨天' }, { now: TEST_NOW });
  assert.equal(yesterday.start, '2026-08-30T22:00:00.000Z');
  assert.equal(yesterday.end, '2026-08-31T22:00:00.000Z');

  const dateHour = resolveSelector({ type: 'relative_period', value: '8月20号晚上10点以后战绩', label: '指定时段' }, { now: TEST_NOW });
  assert.equal(dateHour.start, '2026-08-20T14:00:00.000Z');
  assert.equal(dateHour.end, '2026-08-20T22:00:00.000Z');

  const lastNight = resolveSelector({ type: 'relative_period', value: '昨晚10点以后', label: '指定时段' }, { now: TEST_NOW });
  assert.equal(lastNight.start, '2026-08-31T14:00:00.000Z');
  assert.equal(lastNight.end, '2026-08-31T22:00:00.000Z');
});

test('default team report includes all four players, KD order and mobile-first card layout', () => {
  const { query, result } = execute('昨天战绩');
  assert.equal(result.status, 'OK');
  assert.equal(result.data.rows.length, 4);
  assert.deepEqual(result.data.rows.map((row) => row.label), ['SG_LabmemNo004', 'SG_LabmemNo007', 'SG_LabmemNo008', 'kim_kkl']);
  const rendered = renderResult(result, { ...query, selector: resolveSelector(query.selector, { now: TEST_NOW }) });
  assert.match(rendered, /SG_LabmemNo007/u);
  assert.match(rendered, /🔥 KD 排名/u);
  assert.match(rendered, /击杀/u);
  assert.match(rendered, /🥔 菜鸡指数/u);
  assert.doesNotMatch(rendered, /\| 队员 \|/u);
  const cards = rendered.split(/\n\n/u).filter((section) => /^(?:🥇|🥈|🥉|#4) (?:SG_LabmemNo|kim_kkl)/u.test(section));
  assert.equal(cards.length, 4);
});

test('explicit player report uses a player renderer instead of team totals', () => {
  const { query, result } = execute('SG_LabmemNo007 昨天战绩');
  assert.equal(query.subject.type, 'player');
  const rendered = renderResult(result, { ...query, selector: resolveSelector(query.selector, { now: TEST_NOW }) });
  assert.match(rendered, /🎮 PUBG/u);
  assert.match(rendered, /SG_LabmemNo007/u);
  assert.doesNotMatch(rendered, /👥 小队总览/u);
});

test('deterministic engine implements match ranking, last N, compare and trend', () => {
  const matchRank = execute('昨天哪一把伤害最高');
  assert.equal(matchRank.query.groupBy, 'match');
  assert.equal(matchRank.result.data.rows.length, 1);
  assert.equal(matchRank.result.data.rows[0]?.matchId, 'm2');

  const lastN = execute('最近20场哪一把杀人最多');
  assert.equal(lastN.query.selector.type, 'last_n_matches');
  assert.equal(lastN.result.data.groupBy, 'match');
  assert.equal(lastN.result.evidence.matchIds.length, FIXTURE_RECORDS.length);

  const compare = execute('昨天 vs 前天怎么样');
  assert.equal(compare.result.data.operation, 'compare');
  assert.equal(compare.result.data.segments?.length, 2);

  const trend = execute('最近7天状态是不是变好了');
  assert.equal(trend.result.data.operation, 'trend');
  assert.ok(trend.result.data.dailySeries?.length);
  assert.ok(trend.result.data.change);
});

test('status semantics never convert source failure or coverage gaps into NO_MATCHES', () => {
  const sourceFailure: Coverage = {
    ...completeCoverage,
    status: 'SOURCE_UNAVAILABLE',
    sourceUnavailable: true,
  };
  const stale = execute('未来日期战绩', sourceFailure);
  assert.equal(stale.result.status, 'STALE');

  const gap: Coverage = {
    ...completeCoverage,
    status: 'COVERAGE_GAP',
    complete: false,
  };
  const coverageGap = execute('未来日期战绩', gap);
  assert.equal(coverageGap.result.status, 'COVERAGE_GAP');

  const noMatches = execute('2026年8月1日战绩');
  assert.equal(noMatches.result.status, 'NO_MATCHES');
});

test('Chicken Index handles infinite KD and excludes inactive players', () => {
  const records = structuredClone(FIXTURE_RECORDS).map((record) => ({
    ...record,
    players: record.players.map((player) => player.accountId === DEFAULT_TEAM.players[0]?.id
      ? { ...player, kills: 5, deaths: 0 }
      : player),
  }));
  const query = buildDeterministicQuery({ text: '最近3场战绩', now: TEST_NOW });
  const engine = new DeterministicQueryEngine({ team: DEFAULT_TEAM, now: TEST_NOW });
  const result = engine.execute(query, records, completeCoverage, fixtureSource, {});
  const player = result.data.rows.find((row) => row.label === 'SG_LabmemNo007');
  assert.equal(player?.metrics.kd, '∞');
  assert.equal(typeof player?.metrics.chicken_index, 'number');
  const highestKd = engine.execute(buildDeterministicQuery({ text: '最近3场谁KD最高', now: TEST_NOW }), records, completeCoverage, fixtureSource, {});
  assert.equal(highestKd.data.rows[0]?.label, 'SG_LabmemNo007');
});

test('structured context inherits selectors, result sets and isolates senders', async () => {
  const store = new InMemoryContextStore();
  const provider = new FixtureDataProvider(FIXTURE_RECORDS, completeCoverage, fixtureSource);
  const runtime = new PubgMastraRuntime({ provider, contextStore: store, team: DEFAULT_TEAM });

  const first = await runtime.handle({ text: '昨天战绩', platform: 'kook', launcherType: 'group', launcherId: 'g-acceptance', senderId: 'alice', now: TEST_NOW.toISOString() });
  const strongest = await runtime.handle({ text: '谁最强', platform: 'kook', launcherType: 'group', launcherId: 'g-acceptance', senderId: 'alice', now: TEST_NOW.toISOString() });
  assert.equal(strongest.query?.reference.inheritedFromContext, true);
  assert.equal(strongest.resolvedQuery?.selector.type, 'time_range');
  assert.equal(strongest.resolvedQuery?.selector.label, '昨天');

  const match = await runtime.handle({ text: '哪一把伤害最高', platform: 'kook', launcherType: 'group', launcherId: 'g-acceptance', senderId: 'alice', now: TEST_NOW.toISOString() });
  assert.equal(match.query?.selector.type, 'result_set');
  assert.equal(match.data?.groupBy, 'match');
  assert.ok(first.resultSetId);

  const other = await runtime.handle({ text: '谁最菜', platform: 'kook', launcherType: 'group', launcherId: 'g-acceptance', senderId: 'bob', now: TEST_NOW.toISOString() });
  assert.equal(other.query?.reference.inheritedFromContext, false);
  assert.equal(other.query?.selector.type, 'relative_period');
  if (other.query?.selector.type === 'relative_period') assert.equal(other.query.selector.value, 'today');
});

test('context TTL is configurable and router recognizes structured date follow-ups', () => {
  const query = buildDeterministicQuery({ text: '昨天战绩', now: TEST_NOW, sessionId: 's' });
  const context = contextForQuery(query, 'rs_test', 's', -1);
  assert.equal(context.sessionId, 's');
  const active = { ...context, expiresAt: new Date(Date.now() + 60_000).toISOString(), activeDomain: 'pubg' as const };
  assert.equal(classifyPubgRequest('8月20号呢', active).route, 'mandatory');
  assert.equal(classifyPubgRequest('帮我查天气', active).route, 'pass');
});

test('unsupported capabilities return a machine-readable status', () => {
  const { result } = execute('昨天我用什么枪杀人最多');
  assert.equal(result.status, 'UNSUPPORTED_CAPABILITY');
  assert.match(renderResult(result, buildDeterministicQuery({ text: '昨天我用什么枪杀人最多', now: TEST_NOW })), /不支持|未编造/u);
});
