import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_TEAM } from '../src/config/team.js';
import { FixtureDataProvider } from '../src/data/provider.js';
import { InMemoryContextStore } from '../src/context/context-store.js';
import { createNotificationBackend, createReadOnlyBackends } from '../src/kurisu/read-only.js';
import { publicReadAuthorization } from '../src/kurisu/policy.js';
import type { ToolResponse, TrustedExecutionContext } from '../src/kurisu/contracts.js';
import { KurisuStore } from '../src/kurisu/storage.js';
import { MediaOperations } from '../src/homehub/operations/media-operations.js';
import type { HomeHubRuntime } from '../src/runtime/homehub-runtime.js';
import { PubgMastraRuntime } from '../src/runtime/workflow.js';
import type { Coverage, SourceInfo } from '../src/schema/status.js';
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

function trustedContext(overrides: Partial<TrustedExecutionContext> = {}): TrustedExecutionContext {
  return {
    runId: 'run-p2-read-only',
    requestId: 'request-p2-read-only',
    identity: { platform: 'test', platformUserId: 'user-p2', displayName: 'Test' },
    conversation: { kind: 'private', chatId: 'chat-p2' },
    sessionKey: 'test:user-p2:bot-p2:private:chat-p2:-:-',
    principalKey: 'test:user-p2',
    botId: 'bot-p2',
    authorization: publicReadAuthorization(),
    now: TEST_NOW.toISOString(),
    source: 'test-harness',
    ...overrides,
  };
}

function toolResponse(value: unknown): ToolResponse<Record<string, unknown>> {
  return value as ToolResponse<Record<string, unknown>>;
}

function fixtureRuntime(coverage: Coverage = completeCoverage): { runtime: PubgMastraRuntime; provider: FixtureDataProvider } {
  const provider = new FixtureDataProvider(FIXTURE_RECORDS, coverage, fixtureSource);
  return {
    provider,
    runtime: new PubgMastraRuntime({
      team: DEFAULT_TEAM,
      provider,
      contextStore: new InMemoryContextStore(),
    }),
  };
}

test('PUBG read adapter sends a canonical structured query to the existing deterministic runtime', async () => {
  const { runtime, provider } = fixtureRuntime();
  const backends = createReadOnlyBackends({ pubgRuntime: runtime });
  const response = toolResponse(await backends.pubg!.query({
    operation: 'report',
    subject: { type: 'team', ids: [] },
    timeRange: { kind: 'recent', start: '7', timezone: 'Asia/Shanghai' },
    metrics: ['kills', 'assists', 'damage'],
  }, trustedContext()));

  assert.equal(response.status, 'ok');
  assert.equal(provider.calls, 1);
  assert.equal(response.evidence[0]?.source, 'pubg.mastra-runtime');
  const data = response.data!;
  assert.equal((data.query as { operation: string }).operation, 'report');
  assert.equal((data.query as { selector: { type: string } }).selector.type, 'recent_days');
  assert.equal((data.coverage as { sourceUnavailable: boolean }).sourceUnavailable, false);
  assert.equal((data.source as { store: string }).store, 'fixture');
  assert.ok((data.data as { rows: unknown[] }).rows.length > 0);
});

test('PUBG source failure is unknown rather than an inferred empty result', async () => {
  const unavailable: Coverage = {
    ...completeCoverage,
    status: 'SOURCE_UNAVAILABLE',
    complete: false,
    sourceUnavailable: true,
    freshness: 'unknown',
  };
  const { runtime } = fixtureRuntime(unavailable);
  const backends = createReadOnlyBackends({ pubgRuntime: runtime });
  const response = toolResponse(await backends.pubg!.list({
    subject: { type: 'team', ids: [] },
    timeRange: { kind: 'today', timezone: 'Asia/Shanghai' },
    limit: 10,
  }, trustedContext()));

  assert.equal(response.status, 'unknown');
  assert.equal(response.error?.code, 'PUBG_SOURCE_UNAVAILABLE');
  assert.match(response.error?.message ?? '', /unavailable/u);
});

test('HomeHub read adapters preserve service selection, diagnostics, and principal-scoped audit evidence', async () => {
  const auditCalls: Array<{ principalKey: string; limit: number }> = [];
  const diagnosisCalls: string[][] = [];
  const fakeRuntime = {
    listServices: () => [
      { serviceId: 'emby', displayName: 'Emby', allowedActions: ['check', 'restart'] },
      { serviceId: 'n8n', displayName: 'n8n', allowedActions: ['check', 'restart'] },
    ],
    status: async () => ({
      services: [
        { serviceId: 'emby', status: 'healthy' },
        { serviceId: 'n8n', status: 'unknown' },
      ],
      summary: { totalServices: 2, healthy: 1, unknown: 1 },
    }),
    diagnoseServices: async (ids: readonly string[]) => {
      diagnosisCalls.push([...ids]);
      return ids.map((serviceId) => ({ serviceId, status: 'healthy', checks: [] }));
    },
    getAuditLogs: async (principalKey: string, limit: number) => {
      auditCalls.push({ principalKey, limit });
      return [{ serviceId: 'emby', action: 'check', status: 'observed' }];
    },
  } as unknown as HomeHubRuntime;

  const backends = createReadOnlyBackends({ homehubRuntime: fakeRuntime });
  const context = trustedContext({ principalKey: 'test:principal-scoped' });
  const list = toolResponse(await backends.homehub!.list({ serviceIds: ['emby'], includeMetrics: false }, context));
  const status = toolResponse(await backends.homehub!.status({ serviceIds: ['emby'], includeMetrics: false }, context));
  const diagnose = toolResponse(await backends.homehub!.diagnose({ serviceIds: ['emby'], includeMetrics: false }, context));
  const errors = toolResponse(await backends.homehub!.errors({ serviceId: 'emby', limit: 7 }, context));

  assert.equal(list.status, 'ok');
  assert.deepEqual((list.data as { requested: string[] }).requested, ['emby']);
  assert.deepEqual((status.data as { services: Array<{ serviceId: string }> }).services.map((item) => item.serviceId), ['emby']);
  assert.deepEqual(diagnosisCalls, [['emby']]);
  assert.equal((errors.data as { principalKey: string }).principalKey, 'test:principal-scoped');
  assert.deepEqual(auditCalls, [{ principalKey: 'test:principal-scoped', limit: 20 }]);
});

test('media read adapters scan and preview without changing the filesystem', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kurisu-media-read-'));
  const downloads = join(root, 'downloads');
  const source = join(downloads, 'Example.Movie.2026');
  const movies = join(root, 'movies');
  const tv = join(root, 'tv');
  try {
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'Example.Movie.2026.mkv'), 'fixture');
    const operations = new MediaOperations({ downloadsPaths: [downloads], libraryPaths: { movies, tv }, backupPath: join(root, 'backups') });
    const backends = createReadOnlyBackends({ mediaOperations: operations });
    const scanned = toolResponse(await backends.media!.scan({ targetPattern: 'Example' }, trustedContext()));
    assert.equal(scanned.status, 'ok');
    assert.equal((scanned.data as { count: number }).count, 1);
    const preview = toolResponse(await backends.media!.preview({ sourcePath: source }, trustedContext()));
    assert.equal(preview.status, 'ok');
    assert.equal((preview.data as { preview: { success: boolean } }).preview.success, true);
    assert.equal((preview.data as { plan: { targetPath: string } }).plan.targetPath, join(movies, 'Example Movie (2026)'));
    assert.equal(await access(source).then(() => true, () => false), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Product Radar adapter reports structured data, rate limiting, invalid JSON, and timeout as distinct outcomes', async () => {
  const requested: string[] = [];
  const okBackends = createReadOnlyBackends({
    radar: {
      baseUrl: 'http://radar.test/',
      apiKey: 'test-key',
      fetchImpl: async (url, init) => {
        requested.push(String(url));
        assert.equal((init?.headers as Record<string, string>)['x-product-radar-key'], 'test-key');
        return new Response(JSON.stringify({ watches: [{ id: 'watch-1', status: 'healthy' }] }), { status: 200 });
      },
    },
  });
  const context = trustedContext();
  const listed = toolResponse(await okBackends.radar!.list({ includeRuns: false }, context));
  assert.equal(listed.status, 'ok');
  assert.equal(requested[0], 'http://radar.test/api/watches');

  const limited = createReadOnlyBackends({
    radar: {
      baseUrl: 'http://radar.test',
      fetchImpl: async () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
    },
  });
  const rateLimited = toolResponse(await limited.radar!.list({ includeRuns: false }, context));
  assert.equal(rateLimited.status, 'unknown');
  assert.equal(rateLimited.error?.code, 'RADAR_HTTP_429');

  const malformed = createReadOnlyBackends({
    radar: {
      baseUrl: 'http://radar.test',
      fetchImpl: async () => new Response('{not-json', { status: 200 }),
    },
  });
  const invalidJson = toolResponse(await malformed.radar!.list({ includeRuns: false }, context));
  assert.equal(invalidJson.status, 'unknown');
  assert.equal(invalidJson.error?.code, 'RADAR_INVALID_JSON');

  const timedOut = createReadOnlyBackends({
    radar: {
      baseUrl: 'http://radar.test',
      fetchImpl: async () => {
        const error = new Error('request aborted');
        error.name = 'AbortError';
        throw error;
      },
    },
  });
  const timeout = toolResponse(await timedOut.radar!.list({ includeRuns: false }, context));
  assert.equal(timeout.status, 'unknown');
  assert.equal(timeout.error?.code, 'RADAR_TIMEOUT');
});

test('entity resolution never selects the first candidate when the reference is ambiguous', async () => {
  const backends = createReadOnlyBackends();
  const context = trustedContext();
  const multiple = toolResponse(await backends.entities!.resolve({
    domain: 'radar',
    reference: '我的监控',
    candidateRefs: ['radar:watch-1', 'radar:watch-2'],
  }, context));
  const one = toolResponse(await backends.entities!.resolve({
    domain: 'radar',
    reference: 'watch-1',
    candidateRefs: ['radar:watch-1'],
  }, context));

  assert.equal(multiple.status, 'needs_input');
  assert.deepEqual((multiple.data as { candidates: string[] }).candidates, ['radar:watch-1', 'radar:watch-2']);
  assert.equal(one.status, 'ok');
  assert.deepEqual(one.entityRefs, ['radar:watch-1']);
});

test('notification diagnosis exposes only principal-owned persisted event and delivery facts', async () => {
  const store = new KurisuStore();
  try {
    const owned = store.createEvent('radar.digest', 'radar.digest:user-p2:2026-09-16', {
      principalKey: 'test:user-p2',
      summary: 'no matching listing',
    }, 'evt-owned', '2026-09-16T00:00:00.000Z');
    const delivery = store.enqueueDelivery(owned.id, 'telegram', 'test:user-p2', 'delivery-owned', '2026-09-16T00:00:01.000Z');
    store.updateDelivery(delivery.id, 'retryable_failed', { lastError: 'temporary upstream error' }, '2026-09-16T00:00:02.000Z');
    const global = store.createEvent('system.internal', 'system.internal:unscoped', { message: 'not for public diagnosis' }, 'evt-global', '2026-09-16T00:00:03.000Z');
    store.enqueueDelivery(global.id, 'telegram', 'admin-only', 'delivery-global', '2026-09-16T00:00:04.000Z');

    const backend = createNotificationBackend(store);
    const ownedResponse = toolResponse(await backend.diagnosis({ eventType: undefined, channel: 'telegram', limit: 20 }, trustedContext()));
    const otherResponse = toolResponse(await backend.diagnosis({ eventType: undefined, channel: 'all', limit: 20 }, trustedContext({ principalKey: 'test:other' })));

    assert.equal(ownedResponse.status, 'ok');
    const events = (ownedResponse.data as { events: Array<{ eventType: string; deliveries: Array<{ status: string }> }> }).events;
    assert.equal(events.length, 1);
    assert.equal(events[0]?.eventType, 'radar.digest');
    assert.equal(events[0]?.deliveries[0]?.status, 'retryable_failed');
    assert.deepEqual((otherResponse.data as { events: unknown[] }).events, []);
  } finally {
    store.close();
  }
});
