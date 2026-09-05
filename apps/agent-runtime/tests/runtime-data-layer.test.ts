import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataProvider } from '../src/data/provider.js';
import { FixtureDataProvider, N8nDataProvider } from '../src/data/provider.js';
import type { DataLayerResult, NormalizedMatch } from '../src/data/model.js';
import { InMemoryContextStore } from '../src/context/context-store.js';
import { buildDeterministicQuery } from '../src/planner/deterministic-planner.js';
import { PubgMastraRuntime } from '../src/runtime/workflow.js';
import type { CanonicalQuery } from '../src/schema/query.js';
import type { Coverage, SourceInfo } from '../src/schema/status.js';
import { DEFAULT_TEAM } from '../src/config/team.js';
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
  localComplete: true,
  queryCovered: true,
};

const fixtureSource: SourceInfo = {
  store: 'fixture',
  syncInvoked: false,
  playerApiCalls: 0,
  matchApiCalls: 0,
  localMatchCount: FIXTURE_RECORDS.length,
};

class SequenceProvider implements DataProvider {
  calls = 0;
  requests: Array<{ query: CanonicalQuery; request: Record<string, unknown> }> = [];

  constructor(private readonly responses: DataLayerResult[]) {}

  async ensureData(query: CanonicalQuery, request: { queryId: string; sessionId: string; subjectIds?: string[]; resultSetMatchIds?: string[]; now?: string }): Promise<DataLayerResult> {
    this.calls += 1;
    this.requests.push({ query, request: { ...request } });
    return this.responses[Math.min(this.calls - 1, this.responses.length - 1)] ?? {
      records: [],
      coverage: { ...completeCoverage, status: 'SOURCE_UNAVAILABLE', complete: false, queryCovered: false, sourceUnavailable: true },
      source: { ...fixtureSource, syncInvoked: true },
    };
  }
}

function runtime(provider: DataProvider): PubgMastraRuntime {
  return new PubgMastraRuntime({ provider, contextStore: new InMemoryContextStore(), team: DEFAULT_TEAM });
}

function resultData(records: NormalizedMatch[], coverage: Coverage = completeCoverage, source: SourceInfo = fixtureSource): DataLayerResult {
  return { records, coverage, source };
}

test('N8nDataProvider maps legacy syncTriggered and forwards the request clock', async () => {
  const captured = { body: null as Record<string, unknown> | null };
  const provider = new N8nDataProvider({
    url: 'http://n8n.test/webhook/pubg-data-gateway-v3',
    fetchImpl: async (_input, init) => {
      captured.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        status: 'OK',
        records: FIXTURE_RECORDS,
        coverage: { ...completeCoverage },
        source: { store: 'n8n-data-table', syncTriggered: true, playersApi: true, matchApiCount: 3, localMatchCount: 9 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const query = buildDeterministicQuery({ text: '昨天战绩', now: TEST_NOW, queryId: 'provider-query', sessionId: 'provider-session' });
  const result = await provider.ensureData(query, {
    queryId: query.queryId,
    sessionId: 'provider-session',
    subjectIds: DEFAULT_TEAM.players.map((player) => player.id),
    now: TEST_NOW.toISOString(),
  });
  assert.equal(result.source.syncInvoked, true);
  assert.equal(result.source.playerApiCalls, 1);
  assert.equal(result.source.matchApiCalls, 3);
  assert.equal(result.source.localMatchCount, 9);
  assert.equal(captured.body?.now, TEST_NOW.toISOString());
});

test('historical complete data does not require a repeated sync on a follow-up', async () => {
  const provider = new SequenceProvider([
    resultData(FIXTURE_RECORDS),
    resultData(FIXTURE_RECORDS),
  ]);
  const app = runtime(provider);
  const identity = { platform: 'kook', launcherType: 'group', launcherId: 'freshness-history', senderId: 'alice', now: TEST_NOW.toISOString() };
  await app.handle({ ...identity, text: '昨天战绩' });
  const followUp = await app.handle({ ...identity, text: '谁最强' });
  assert.equal(provider.calls, 2);
  assert.equal(followUp.source?.syncInvoked, false);
});

test('today follow-up carries the current clock and can use newly synced records', async () => {
  const newer = structuredClone(FIXTURE_RECORDS[0]!);
  newer.matchId = 'new-today-match';
  newer.createdAt = '2026-09-01T03:30:00.000Z';
  newer.timestamp = Date.parse(newer.createdAt);
  const provider = new SequenceProvider([
    resultData(FIXTURE_RECORDS, completeCoverage, fixtureSource),
    resultData([...FIXTURE_RECORDS, newer], { ...completeCoverage, checkedAt: '2026-09-01T12:00:00.000Z' }, { ...fixtureSource, syncInvoked: true, playerApiCalls: 1, matchApiCalls: 1 }),
  ]);
  const app = runtime(provider);
  const identity = { platform: 'kook', launcherType: 'group', launcherId: 'freshness-today', senderId: 'alice', now: TEST_NOW.toISOString() };
  await app.handle({ ...identity, text: '今天战绩' });
  const followUp = await app.handle({ ...identity, text: '谁最强' });
  assert.equal(provider.calls, 2);
  assert.equal(provider.requests[1]?.request.now, TEST_NOW.toISOString());
  assert.equal(followUp.source?.syncInvoked, true);
  assert.ok(followUp.evidence?.matchIds.includes('new-today-match'));
});

test('source failure distinguishes stale fallback from unavailable coverage', async () => {
  const staleProvider = new FixtureDataProvider(FIXTURE_RECORDS, {
    ...completeCoverage,
    status: 'SOURCE_UNAVAILABLE',
    sourceUnavailable: true,
    queryCovered: true,
  }, { ...fixtureSource, syncInvoked: true });
  const stale = await runtime(staleProvider).handle({ text: '昨天战绩', platform: 'kook', launcherType: 'person', launcherId: 'status', senderId: 'alice', now: TEST_NOW.toISOString() });
  assert.equal(stale.status, 'STALE');

  const unavailableProvider = new FixtureDataProvider([], {
    ...completeCoverage,
    status: 'SOURCE_UNAVAILABLE',
    complete: false,
    queryCovered: false,
    sourceUnavailable: true,
  }, { ...fixtureSource, syncInvoked: true, localMatchCount: 0 });
  const unavailable = await runtime(unavailableProvider).handle({ text: '今天战绩', platform: 'kook', launcherType: 'person', launcherId: 'status', senderId: 'bob', now: TEST_NOW.toISOString() });
  assert.equal(unavailable.status, 'SOURCE_UNAVAILABLE');
});

test('empty ResultSet follow-up does not call the data provider', async () => {
  const provider = new SequenceProvider([resultData([]), resultData(FIXTURE_RECORDS)]);
  const app = runtime(provider);
  const identity = { platform: 'kook', launcherType: 'person', launcherId: 'result-set-empty', senderId: 'alice', now: TEST_NOW.toISOString() };
  const first = await app.handle({ ...identity, text: '2026年8月1日战绩' });
  assert.equal(first.status, 'NO_MATCHES');
  const followUp = await app.handle({ ...identity, text: '哪一把伤害最高' });
  assert.equal(followUp.status, 'NO_MATCHES');
  assert.equal(provider.calls, 1);
});

test('provided canonical plans are validated and traced without bypassing the runtime', async () => {
  const provider = new SequenceProvider([resultData(FIXTURE_RECORDS)]);
  const app = runtime(provider);
  const query = buildDeterministicQuery({ text: '昨天战绩', now: TEST_NOW, queryId: 'provided-plan', sessionId: 'provided-session' });
  const result = await app.handle({
    text: '这是一段由上层传入的 PUBG 查询',
    platform: 'kook',
    launcherType: 'person',
    launcherId: 'provided-plan',
    senderId: 'alice',
    now: TEST_NOW.toISOString(),
    providedQuery: query,
  });
  assert.equal(result.status, 'OK');
  assert.equal(result.query?.reference.planner, 'provided');
  assert.equal(result.trace.some((event) => event.stage === 'domain_router'), true);
  assert.equal(result.trace.some((event) => event.stage === 'planner_input'), true);
});
