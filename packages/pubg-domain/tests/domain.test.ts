import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  DeterministicQueryEngine,
  BUSINESS_DAY_START,
  PubgApiClient,
  PubgApiError,
  PubgDomainService,
  SqlitePubgRepository,
  TelemetryWorker,
  businessDayLabel,
  extractMatchReviewFacts,
  importLegacyPubgData,
  normalizeRecords,
  resolveSelector,
  selectMatchReviewFactCategories,
  scopeMatchReviewFacts,
  type Coverage,
  type NormalizedMatch,
  type TeamConfig,
} from '../src/index.js';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { run(...params: unknown[]): unknown };
    close(): void;
  };
};

const TEAM: TeamConfig = {
  id: 'team-test',
  label: 'Test Team',
  platform: 'steam',
  players: [
    { id: 'p1', name: 'Alice', aliases: ['a'] },
    { id: 'p2', name: 'Bob', aliases: ['b'] },
  ],
};

const SOURCE = { store: 'fixture', syncInvoked: false, playerApiCalls: 0, matchApiCalls: 0, localMatchCount: 3 };
const COVERAGE: Coverage = {
  status: 'OK',
  complete: true,
  coverageStart: '2026-09-15T00:00:00.000Z',
  coverageEnd: '2026-09-17T00:00:00.000Z',
  checkedAt: '2026-09-17T00:00:00.000Z',
  failedMatchIds: [],
  sourceUnavailable: false,
  freshness: 'fresh',
  queryCovered: true,
  requiredMatchCount: 3,
  availableMatchCount: 3,
};

function rawMatch(
  matchId: string,
  createdAt: string,
  players: Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 3,
    matchId,
    shard: 'steam',
    createdAt,
    matchType: 'competitive',
    gameMode: 'squad-fpp',
    isCompetitive: true,
    mapName: 'Erangel',
    duration: 1200,
    patchVersion: 'test',
    players,
    ...extra,
  };
}

const RAW_RECORDS = [
  rawMatch('m1', '2026-09-15T16:00:00.000Z', [
    { accountId: 'p1', playerName: 'Alice', kills: 4, deaths: 2, assists: 1, damage: 100, rank: 3 },
    { accountId: 'p2', playerName: 'Bob', kills: 3, deaths: 0, damage: 50, rank: 1 },
  ]),
  rawMatch('m2', '2026-09-16T12:00:00.000Z', [
    { accountId: 'p1', playerName: 'Alice', kills: 2, deaths: 1, assists: 2, damage: 80, rank: 5 },
    { accountId: 'p2', playerName: 'Bob', kills: 1, deaths: 0, assists: 0, damage: 10, rank: 2 },
  ], { mapName: 'Taego', gameMode: 'duo-fpp' }),
  rawMatch('m3', '2026-09-17T00:00:00.000Z', [
    { accountId: 'p1', playerName: 'Alice', kills: 99, deaths: 1, rank: 1 },
  ]),
];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/vnd.api+json' },
  });
}

function playerDiscovery(matchIds: string[]): Record<string, unknown> {
  return {
    data: TEAM.players.map((player) => ({
      type: 'player',
      id: player.id,
      attributes: { name: player.name },
      relationships: { matches: { data: matchIds.map((id) => ({ type: 'match', id })) } },
    })),
  };
}

function matchPayload(matchId: string, createdAt: string): Record<string, unknown> {
  return {
    data: {
      type: 'match',
      id: matchId,
      attributes: {
        createdAt,
        matchType: 'competitive',
        gameMode: 'squad-fpp',
        mapName: 'Erangel',
        duration: 1200,
        patchVersion: 'test',
      },
      relationships: { assets: { data: [] } },
    },
    included: TEAM.players.map((player, index) => ({
      type: 'participant',
      id: 'participant-' + player.id,
      attributes: { stats: { playerId: player.id, winPlace: index + 1, kills: index + 1, assists: 0, damageDealt: 100 } },
      relationships: {},
    })),
  };
}

function query(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 3,
    queryId: 'q-test',
    domain: 'pubg',
    subject: { type: 'players', ids: ['p1', 'p2'] },
    operation: 'report',
    selector: {
      type: 'time_range',
      start: '2026-09-15T00:00:00.000Z',
      end: '2026-09-17T00:00:00.000Z',
      timezone: 'Asia/Shanghai',
      businessDayStart: '00:00',
    },
    matchSelector: null,
    segments: [],
    groupBy: 'player',
    metrics: ['kills', 'kd', 'assists'],
    filters: {},
    orderBy: { metric: 'kills', direction: 'desc' },
    limit: null,
    reference: {
      sessionId: 'telegram:chat-a:user-a:pubg',
      selectorExplicit: true,
      subjectExplicit: true,
      useResultSet: false,
      inheritedFromContext: false,
      planner: 'provided',
    },
    presentation: { compact: true },
    ...overrides,
  };
}

test('normalization deduplicates match IDs and preserves unknown death semantics', () => {
  const records = normalizeRecords([
    ...RAW_RECORDS,
    rawMatch('m1', '2026-09-15T16:00:00.000Z', [
      { accountId: 'p1', playerName: 'Alice', kills: 4, deaths: 2, assists: 1, damage: 100, rank: 3 },
      { accountId: 'p2', playerName: 'Bob', kills: 3, deaths: 0, damage: 50, rank: 1 },
      { accountId: 'p3', playerName: 'Other', kills: 1, deaths: 1, rank: 8 },
    ]),
  ]);
  assert.equal(records.length, 3);
  assert.equal(records.find((record) => record.matchId === 'm1')?.players.length, 3);
  const unknown = normalizeRecords([rawMatch('unknown', '2026-09-16T00:00:00.000Z', [{ accountId: 'p1', kills: 1 }])])[0]!;
  assert.equal(unknown.players[0]?.deaths, null);
  assert.equal(unknown.players[0]?.deathSemantics, 'unknown');
  assert.ok(unknown.players.every((player) => Number.isFinite(player.kills)));
});

test('query engine uses half-open time ranges, zero-safe KD, missing assists, and category grouping', () => {
  const engine = new DeterministicQueryEngine({ team: TEAM, now: new Date('2026-09-17T00:00:00.000Z') });
  const result = engine.execute(query(), RAW_RECORDS, COVERAGE, SOURCE);
  assert.equal(result.status, 'OK');
  assert.equal(result.evidence.matchIds.includes('m3'), false);
  const alice = result.data.rows.find((row) => row.key === 'p1')!;
  const bob = result.data.rows.find((row) => row.key === 'p2')!;
  assert.equal(alice.metrics.kills, 6);
  assert.equal(alice.metrics.kd, 2);
  assert.equal(alice.metrics.assists, 3);
  assert.equal(bob.metrics.kd, null);
  assert.equal(bob.metrics.denominatorZero, 1);

  const mapResult = engine.execute(query({ groupBy: 'map' }), RAW_RECORDS, COVERAGE, SOURCE);
  assert.deepEqual(mapResult.data.rows.map((row) => row.label), ['Erangel', 'Taego']);
  const modeResult = engine.execute(query({ groupBy: 'mode' }), RAW_RECORDS, COVERAGE, SOURCE);
  assert.deepEqual(modeResult.data.rows.map((row) => row.label), ['squad-fpp', 'duo-fpp']);
});

test('business-day labels handle cross-midnight boundaries in Asia/Shanghai', () => {
  const beforeStart = Date.parse('2026-09-15T21:59:00.000Z');
  const atStart = Date.parse('2026-09-15T22:00:00.000Z');
  assert.equal(businessDayLabel(beforeStart, 'Asia/Shanghai', '06:00'), '2026-09-15');
  assert.equal(businessDayLabel(atStart, 'Asia/Shanghai', '06:00'), '2026-09-16');
});

test('PUBG relative selectors use the canonical 06:00 business day', () => {
  assert.equal(BUSINESS_DAY_START, '06:00');
  const resolved = resolveSelector(
    { type: 'relative_period', value: 'yesterday' },
    { now: new Date('2026-09-19T00:30:00.000Z'), timezone: 'Asia/Shanghai' },
  );
  assert.equal(resolved.start, '2026-09-17T22:00:00.000Z');
  assert.equal(resolved.end, '2026-09-18T22:00:00.000Z');
});

test('day grouping honors the selector business-day boundary', () => {
  const records = normalizeRecords([rawMatch('boundary', '2026-09-18T21:00:00.000Z', [
    { accountId: 'p1', playerName: 'Alice', kills: 1, deaths: 1, damage: 10, rank: 5 },
  ])]);
  const engine = new DeterministicQueryEngine({ team: TEAM, timezone: 'Asia/Shanghai', businessDayStart: '00:00' });
  const result = engine.execute(query({
    subject: { type: 'player', ids: ['p1'] },
    selector: {
      type: 'time_range',
      start: '2026-09-18T00:00:00.000Z',
      end: '2026-09-20T00:00:00.000Z',
      timezone: 'Asia/Shanghai',
      businessDayStart: '06:00',
    },
    groupBy: 'day',
  }), records, COVERAGE, SOURCE);
  assert.deepEqual(result.data.rows.map((row) => row.label), ['2026-09-18']);
});

test('unknown metrics stay out of ranking and performance scoring', () => {
  const engine = new DeterministicQueryEngine({ team: TEAM, now: new Date('2026-09-17T00:00:00.000Z') });
  const ranked = engine.execute(query({ operation: 'rank', orderBy: { metric: 'kd', direction: 'desc' } }), RAW_RECORDS, COVERAGE, SOURCE);
  const bob = ranked.data.rows.find((row) => row.key === 'p2')!;
  assert.equal(bob.metrics.kd, null);
  assert.equal(bob.position, undefined);
  const strongest = engine.execute(query({ operation: 'strongest' }), RAW_RECORDS, COVERAGE, SOURCE);
  assert.equal(strongest.data.rows.find((row) => row.key === 'p2')?.metrics.performance_score, null);
});

test('compare emits null ratios when a denominator is zero and never serializes Infinity or NaN', () => {
  const engine = new DeterministicQueryEngine({ team: TEAM, now: new Date('2026-09-17T00:00:00.000Z') });
  const compared = engine.execute(query({
    operation: 'compare',
    segments: [
      { label: 'first', selector: { type: 'time_range', start: '2026-09-15T00:00:00.000Z', end: '2026-09-16T00:00:00.000Z', timezone: 'Asia/Shanghai', businessDayStart: '00:00' } },
      { label: 'second', selector: { type: 'time_range', start: '2026-09-16T00:00:00.000Z', end: '2026-09-17T00:00:00.000Z', timezone: 'Asia/Shanghai', businessDayStart: '00:00' } },
    ],
  }), RAW_RECORDS, COVERAGE, SOURCE);
  const alice = compared.data.rows.find((row) => row.key === 'p1')!;
  assert.equal(alice.comparisonRatios?.kd, 1);
  const bob = compared.data.rows.find((row) => row.key === 'p2')!;
  assert.equal(bob.comparisonRatios?.kd, null);
  assert.equal(bob.metrics.kd, null);
  const serialized = JSON.stringify(compared);
  assert.equal(serialized.includes('Infinity'), false);
  assert.equal(serialized.includes('NaN'), false);
});

test('person-scoped review facts do not expand back to the full squad', () => {
  const match = normalizeRecords([RAW_RECORDS[0]!])[0]!;
  const facts = extractMatchReviewFacts(match, { events: [] }, TEAM);
  const scoped = scopeMatchReviewFacts(facts, ['p1']);
  assert.deepEqual(scoped.squad.playerIds, ['p1']);
  assert.deepEqual(scoped.players.map((player) => player.playerId), ['p1']);
  assert.equal(scoped.squad.kills, 4);
  assert.ok(scoped.evidence.every((item) => !item.id.includes('-p2')));
});

test('PUBG API retries bounded 5xx responses and never exposes credentials in errors', async () => {
  let calls = 0;
  const delays: number[] = [];
  const client = new PubgApiClient({
    apiKey: 'secret-api-key',
    baseUrl: 'https://api.example.test',
    maxRetries: 2,
    sleep: async (ms) => { delays.push(ms); },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ errors: [{ title: 'temporary' }] }), { status: 503 });
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/vnd.api+json' } });
    },
  });
  assert.deepEqual(await client.discoverPlayers('steam', ['p1']), []);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [1000]);

  const failing = new PubgApiClient({
    apiKey: 'secret-api-key',
    maxRetries: 0,
    fetchImpl: async () => new Response(JSON.stringify({ errors: [{ title: 'unauthorized' }] }), { status: 401 }),
  });
  await assert.rejects(failing.discoverPlayers('steam', ['p1']), (error: unknown) => {
    assert.ok(error instanceof PubgApiError);
    assert.equal(error.code, 'unauthorized');
    assert.equal(error.name, 'PubgApiError');
    assert.equal(String(error).includes('secret-api-key'), false);
    return true;
  });
});

test('PUBG API sync refreshes the match list but fetches only matches missing from cache', async () => {
  const requestedPaths: string[] = [];
  const client = new PubgApiClient({
    apiKey: 'test-api-key',
    baseUrl: 'https://api.example.test',
    maxRetries: 0,
    fetchImpl: async (input) => {
      const url = String(input);
      requestedPaths.push(new URL(url).pathname + new URL(url).search);
      if (url.includes('/players?')) return jsonResponse(playerDiscovery(['m1', 'm2']));
      if (url.endsWith('/matches/m2')) return jsonResponse(matchPayload('m2', '2026-09-18T12:00:00.000Z'));
      throw new Error('unexpected PUBG API request: ' + url);
    },
  });

  const synced = await client.syncTeam(TEAM, {
    knownMatchIds: new Set(['m1']),
    now: new Date('2026-09-19T00:00:00.000Z'),
  });
  assert.equal(synced.records.length, 1);
  assert.equal(synced.records[0]?.matchId, 'm2');
  assert.equal(synced.diagnostics?.cachedMatchCount, 1);
  assert.equal(synced.diagnostics?.newMatchCount, 1);
  assert.equal(requestedPaths.filter((path) => path.endsWith('/matches/m1')).length, 0);
  assert.equal(requestedPaths.filter((path) => path.endsWith('/matches/m2')).length, 1);
});

test('recent PUBG searches force fresh discovery and reuse cached details when no match is new', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pubg-domain-latest-cache-'));
  const dbPath = join(root, 'pubg.sqlite');
  let discoveredMatchIds = ['m1'];
  const requestedMatchIds: string[] = [];
  try {
    const client = new PubgApiClient({
      apiKey: 'test-api-key',
      baseUrl: 'https://api.example.test',
      maxRetries: 0,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes('/players?')) return jsonResponse(playerDiscovery(discoveredMatchIds));
        const matchId = url.split('/matches/')[1];
        requestedMatchIds.push(matchId ?? '');
        if (matchId === 'm1') return jsonResponse(matchPayload('m1', '2026-09-18T11:00:00.000Z'));
        if (matchId === 'm2') return jsonResponse(matchPayload('m2', '2026-09-18T12:00:00.000Z'));
        throw new Error('unexpected PUBG match: ' + matchId);
      },
    });
    const repository = new SqlitePubgRepository(dbPath);
    const service = new PubgDomainService({
      team: TEAM,
      repository,
      apiClient: client,
      now: () => new Date('2026-09-19T00:00:00.000Z'),
    });

    const first = await service.searchMatches({ sessionId: 'session-latest', recentN: 1, refresh: false });
    assert.equal(first.status, 'ok');
    assert.equal((first.data as { matches: Array<{ matchId: string }> }).matches[0]?.matchId, 'm1');

    discoveredMatchIds = ['m1', 'm2'];
    const second = await service.searchMatches({ sessionId: 'session-latest', recentN: 1, refresh: false });
    assert.equal(second.status, 'ok');
    assert.equal((second.data as { matches: Array<{ matchId: string }> }).matches[0]?.matchId, 'm2');

    const matchCallsAfterNewMatch = requestedMatchIds.length;
    const third = await service.searchMatches({ sessionId: 'session-latest', recentN: 1, refresh: false });
    assert.equal(third.status, 'ok');
    assert.equal((third.data as { matches: Array<{ matchId: string }> }).matches[0]?.matchId, 'm2');
    assert.equal(requestedMatchIds.length, matchCallsAfterNewMatch);
    assert.deepEqual(requestedMatchIds, ['m1', 'm2']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Telemetry distinguishes a successful cache miss from unavailable data', async () => {
  const match = normalizeRecords([RAW_RECORDS[0]!])[0]!;
  let downloads = 0;
  const worker = new TelemetryWorker({
    team: TEAM,
    downloader: {
      async download() {
        downloads += 1;
        return { events: [] };
      },
    },
  });
  const fetched = await worker.ensure(match);
  assert.equal(fetched.status, 'FETCHED');
  assert.equal(fetched.cacheStatus, 'MISS');
  assert.equal(fetched.availability, 'AVAILABLE');
  const hit = await worker.ensure(match);
  assert.equal(hit.status, 'HIT');
  assert.equal(hit.cacheStatus, 'HIT');
  assert.equal(hit.availability, 'AVAILABLE');
  assert.equal(downloads, 1);

  const unavailable = await new TelemetryWorker({ team: TEAM }).ensure(match);
  assert.equal(unavailable.status, 'UNAVAILABLE');
  assert.equal(unavailable.cacheStatus, 'MISS');
  assert.equal(unavailable.availability, 'UNAVAILABLE');
});

test('hourly telemetry prefetch only fetches new matches, persists retry state, and builds a D-mail report', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pubg-domain-prefetch-'));
  let currentNow = new Date('2026-09-18T15:00:00.000Z');
  let discoveredMatchIds = ['m1'];
  try {
    const repository = new SqlitePubgRepository(join(root, 'pubg.sqlite'));
    const client = new PubgApiClient({
      apiKey: 'test-api-key',
      baseUrl: 'https://api.example.test',
      maxRetries: 0,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes('/players?')) return jsonResponse(playerDiscovery(discoveredMatchIds));
        const matchId = url.split('/matches/')[1];
        if (matchId === 'm1') return jsonResponse(matchPayload('m1', '2026-09-18T14:00:00.000Z'));
        if (matchId === 'm2') return jsonResponse(matchPayload('m2', '2026-09-18T14:30:00.000Z'));
        throw new Error('unexpected PUBG match: ' + matchId);
      },
    });
    const worker = new TelemetryWorker({
      team: TEAM,
      store: repository,
      downloader: { async download() { return { events: [] }; } },
    });
    const service = new PubgDomainService({
      team: TEAM,
      repository,
      apiClient: client,
      telemetryWorker: worker,
      now: () => currentNow,
    });
    const first = await service.prefetchTelemetry({ maxFetches: 20 });
    assert.equal(first.status, 'ok');
    const firstRun = (first.data as { run: { fetchedCount: number; newMatchCount: number; pendingCount: number } }).run;
    assert.equal(firstRun.fetchedCount, 1);
    assert.equal(firstRun.newMatchCount, 1);
    assert.equal(firstRun.pendingCount, 0);
    assert.equal(repository.snapshot().features, 1);
    assert.equal(repository.getTelemetryPrefetchAttempt({ matchId: 'm1', parserVersion: worker.parserVersion, featureVersion: worker.featureVersion })?.status, 'FETCHED');

    discoveredMatchIds = ['m1', 'm2'];
    currentNow = new Date('2026-09-18T15:30:00.000Z');
    const second = await service.prefetchTelemetry({ maxFetches: 1 });
    assert.equal(second.status, 'ok');
    assert.equal((second.data as { run: { newMatchCount: number; fetchedCount: number } }).run.newMatchCount, 1);
    assert.equal((second.data as { run: { fetchedCount: number } }).run.fetchedCount, 1);
    assert.equal(repository.snapshot().features, 2);

    const report = await service.getTelemetrySyncReport({ reportDate: '2026-09-18' });
    assert.equal(report.status, 'ok');
    const reportData = report.data as { summary: { newMatchCount: number; fetchedCount: number }; notification: { title: string; message: string } };
    assert.equal(reportData.summary.newMatchCount, 2);
    assert.equal(reportData.summary.fetchedCount, 2);
    assert.equal(reportData.notification.title, 'Amadeus • D-mail');
    assert.match(reportData.notification.message, /PUBG 今日自动同步结果/);
    assert.match(reportData.notification.message, /El Psy Kongroo\.$/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cached PUBG records become stale partial data when discovery is unavailable', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pubg-domain-stale-cache-'));
  try {
    const repository = new SqlitePubgRepository(join(root, 'pubg.sqlite'));
    repository.upsertMatches([RAW_RECORDS[0]]);
    const client = new PubgApiClient({
      apiKey: 'test-api-key',
      maxRetries: 0,
      fetchImpl: async () => { throw new Error('offline'); },
    });
    const service = new PubgDomainService({
      team: TEAM,
      repository,
      apiClient: client,
      now: () => new Date('2026-09-19T00:00:00.000Z'),
    });
    const result = await service.queryStats({
      sessionId: 'session-stale',
      playerIds: ['p1'],
      selector: { type: 'time_range', from: '2026-09-15T00:00:00.000Z', to: '2026-09-17T00:00:00.000Z' },
      metrics: ['matches', 'kills'],
      refresh: true,
    });
    assert.equal(result.status, 'partial');
    assert.equal(result.error, undefined);
    assert.equal(result.coverage.status, 'STALE');
    assert.equal((result.data as { rows: unknown[] }).rows.length, 1);
    repository.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('SQLite repository survives restart, counts duplicate inputs, and isolates result sets by session', () => {
  const root = mkdtempSync(join(tmpdir(), 'pubg-domain-repository-'));
  const dbPath = join(root, 'pubg.sqlite');
  try {
    const first = new SqlitePubgRepository(dbPath);
    const write = first.upsertMatches([RAW_RECORDS[0], RAW_RECORDS[0], RAW_RECORDS[1]]);
    assert.equal(write.inserted, 2);
    assert.equal(write.duplicateInputs, 1);
    assert.equal(first.countMatches(), 2);
    const storedResult = {
      id: 'rs-a', queryId: 'q', sessionId: 'session-a', resolvedQuery: query(), resolvedSelector: query().selector,
      playerIds: ['p1'], matchIds: ['m1'], rows: [], aggregates: {}, rankings: [], coverage: COVERAGE,
      status: 'OK', source: SOURCE, createdAt: '2026-09-17T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z',
    } as never;
    first.setResultSet(storedResult);
    first.close();

    const second = new SqlitePubgRepository(dbPath);
    assert.equal(second.countMatches(), 2);
    assert.equal(second.getMatch('m1')?.players.length, 2);
    assert.ok(second.getResultSet('session-a', 'rs-a'));
    assert.equal(second.getResultSet('session-b', 'rs-a'), null);
    second.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('legacy importer is dry-run first, idempotent on apply, and reports invalid/duplicate data', () => {
  const root = mkdtempSync(join(tmpdir(), 'pubg-domain-import-'));
  const legacyPath = join(root, 'n8n.sqlite');
  const statePath = join(root, 'state.json');
  const featuresPath = join(root, 'features.json');
  const targetPath = join(root, 'target.sqlite');
  try {
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec('CREATE TABLE "data_table_user_fixture" (payload TEXT)');
    const insert = legacy.prepare('INSERT INTO "data_table_user_fixture" (payload) VALUES (?)');
    insert.run(JSON.stringify(RAW_RECORDS[0]));
    insert.run(JSON.stringify(RAW_RECORDS[0]));
    insert.run('{invalid-json');
    legacy.close();
    writeFileSync(statePath, JSON.stringify({ contexts: { stale: true }, records: [RAW_RECORDS[1]] }));
    writeFileSync(featuresPath, JSON.stringify({ features: { f1: { matchId: 'm1', parserVersion: 'p1', featureVersion: 'f1', facts: { evidence: [] }, createdAt: '2026-09-17T00:00:00.000Z' } } }));

    const dryRepository = new SqlitePubgRepository(targetPath);
    const dry = importLegacyPubgData(dryRepository, { n8nDatabasePath: legacyPath, stateJsonPath: statePath, featuresJsonPath: featuresPath, migrationId: 'migration-1', apply: false });
    assert.equal(dry.apply, false);
    assert.equal(dry.uniqueMatchIds, 2);
    assert.equal(dry.duplicateInputs, 1);
    assert.equal(dry.invalidInputs, 0);
    assert.ok(dry.errors.length > 0);
    assert.equal(dryRepository.countMatches(), 0);
    dryRepository.close();

    const appliedRepository = new SqlitePubgRepository(targetPath);
    const applied = importLegacyPubgData(appliedRepository, { n8nDatabasePath: legacyPath, stateJsonPath: statePath, featuresJsonPath: featuresPath, migrationId: 'migration-1', apply: true });
    assert.equal(applied.inserted, 2);
    assert.equal(applied.importedFeatures, 1);
    assert.equal(appliedRepository.snapshot().matches, 2);
    assert.ok(appliedRepository.getMigration('migration-1'));
    const rerun = importLegacyPubgData(appliedRepository, { n8nDatabasePath: legacyPath, stateJsonPath: statePath, featuresJsonPath: featuresPath, migrationId: 'migration-1', apply: true });
    assert.equal(rerun.inserted, 0);
    assert.equal(rerun.updated, 2);
    assert.equal(appliedRepository.snapshot().matches, 2);
    appliedRepository.close();
    assert.ok(readFileSync(targetPath).byteLength > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('review facts retain evidence IDs for Match Store facts', () => {
  const match = normalizeRecords([RAW_RECORDS[0]])[0]!;
  const facts = extractMatchReviewFacts(match, { events: [] }, TEAM);
  const evidenceIds = new Set(facts.evidence.map((item) => item.id));
  assert.ok(evidenceIds.has('match-summary-m1'));
  assert.ok(evidenceIds.has('player-summary-m1-p1'));
  assert.ok(evidenceIds.has('player-summary-m1-p2'));
  for (const evidenceId of facts.players.flatMap((player) => player.keyOperations.flatMap((operation) => operation.evidenceIds))) {
    assert.ok(evidenceIds.has(evidenceId));
  }
});

test('review fact categories bound detail groups without losing the match summary', () => {
  const match = normalizeRecords([RAW_RECORDS[0]!])[0]!;
  const facts = extractMatchReviewFacts(match, { events: [] }, TEAM);
  const selected = selectMatchReviewFactCategories(facts, ['weapons']);
  assert.equal(selected.match.matchId, 'm1');
  assert.deepEqual(selected.squad.playerIds, ['p1', 'p2']);
  assert.deepEqual(selected.fights, []);
  assert.deepEqual(selected.combat.events, []);
  assert.equal(selected.combat.eventCount, 0);
  assert.deepEqual(selected.vehicles, []);
  assert.deepEqual(selected.evidence, []);
  assert.deepEqual(selectMatchReviewFactCategories(facts, []), facts);
});
