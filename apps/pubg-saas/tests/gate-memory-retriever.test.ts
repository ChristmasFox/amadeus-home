import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryRetriever } from '../src/application/gate-memory-retriever.js';
import type { GateMemoryAuthorizedSearch, GateMemoryEntry, GateMemoryStore } from '../src/application/gate-memory-store.js';
import type { KookIngressJob } from '../src/application/kook-ingress-queue.js';

const job = { botAccountId: 'bot', eventId: 'event', leaseToken: 'lease' } as KookIngressJob;

function entry(overrides: Partial<GateMemoryEntry> = {}): GateMemoryEntry {
  return {
    key: 'favorite_map', content: '我常去艾伦格的森林区域', revision: 2,
    updatedAt: new Date().toISOString(), sourceEventId: 'private-source-event',
    sourceKind: 'user_confirmed', sourceReliability: 95, validUntil: null,
    ...overrides,
  };
}

function fakeStore(
  search: Partial<GateMemoryAuthorizedSearch>,
  authorize: () => Promise<void> = async () => undefined,
  writeUsage: () => Promise<void> = async () => undefined,
) {
  let scoped = 0;
  const usageWrites: Array<{ kind: string; signals: readonly unknown[] }> = [];
  const store = {
    async withAuthorizedSearch(_job: KookIngressJob, work: (sources: GateMemoryAuthorizedSearch) => Promise<unknown>) {
      scoped += 1;
      await authorize();
      return work({
        exact: async () => [], lexical: async () => [],
        semantic: async () => ({ matches: [], reason: 'semantic_unconfigured' }),
        ...search,
      } as GateMemoryAuthorizedSearch);
    },
    async recordUsageSignals(_job: KookIngressJob, signals: readonly unknown[], kind: string) {
      usageWrites.push({ kind, signals });
      await writeUsage();
    },
  } as unknown as GateMemoryStore;
  return { store, scoped: () => scoped, usageWrites };
}

test('semantic candidates recover a different wording and carry explainable provenance', async () => {
  const fact = entry({ semanticSimilarity: 0.94 });
  const fixture = fakeStore({ semantic: async () => ({ matches: [fact], reason: null }) });
  const retriever = new MemoryRetriever(fixture.store, null);
  const result = await retriever.retrieve(job, 'where do I usually land in Erangel?');

  assert.equal(fixture.scoped(), 1, 'all candidate sources share one current authorization resolution');
  assert.equal(result.mode, 'hybrid');
  assert.equal(result.candidates[0]?.key, 'favorite_map');
  assert.ok(result.candidates[0]?.sources.includes('semantic'));
  assert.ok(result.candidates[0]?.reasons.some(reason => reason.startsWith('cosine_similarity_')));
  assert.match(result.context ?? '', /艾伦格的森林区域/u);
  assert.doesNotMatch(result.context ?? '', /private-source-event/u);
  assert.equal(fixture.usageWrites[0]?.kind, 'recalled');
  assert.equal(fixture.usageWrites[0]?.signals.length, 1);
});

test('a successful prompt can record a distinct use signal for recalled memories', async () => {
  const fact = entry({ semanticSimilarity: 0.94 });
  const fixture = fakeStore({ semantic: async () => ({ matches: [fact], reason: null }) });
  const retriever = new MemoryRetriever(fixture.store, null);
  const result = await retriever.retrieve(job, 'where do I usually land in Erangel?');
  await retriever.recordUsed(job, 'where do I usually land in Erangel?', result.candidates);

  assert.deepEqual(fixture.usageWrites.map(write => write.kind), ['recalled', 'used']);
  assert.equal(fixture.usageWrites[0]?.signals[0] && fixture.usageWrites[1]?.signals[0]
    ? JSON.stringify(fixture.usageWrites[0].signals[0]) === JSON.stringify(fixture.usageWrites[1].signals[0])
    : false, true);
});

test('a failed usage-signal write does not disable otherwise successful recall', async () => {
  const fact = entry({ semanticSimilarity: 0.94 });
  const fixture = fakeStore(
    { semantic: async () => ({ matches: [fact], reason: null }) },
    async () => undefined,
    async () => { throw new Error('usage_signal_store_unavailable'); },
  );
  const result = await new MemoryRetriever(fixture.store, null).retrieve(job, 'where do I usually land in Erangel?');

  assert.equal(result.mode, 'hybrid');
  assert.equal(result.candidates[0]?.key, 'favorite_map');
  assert.match(result.context ?? '', /艾伦格的森林区域/u);
  assert.equal(fixture.usageWrites[0]?.kind, 'recalled');
});

test('fixed lexical fallback filters expired and unknown facts', async () => {
  const fixture = fakeStore({
    lexical: async () => [
      entry({ key: 'active_fact' }),
      entry({ key: 'expired_fact', validUntil: '2000-01-01T00:00:00.000Z' }),
      entry({ key: 'unknown_fact', sourceKind: 'unknown' }),
    ],
    semantic: async () => ({ matches: [], reason: 'semantic_timeout' }),
  });
  const result = await new MemoryRetriever(fixture.store, null).retrieve(job, '艾伦格森林');

  assert.equal(result.mode, 'lexical_only');
  assert.equal(result.reason, 'semantic_timeout');
  assert.deepEqual(result.candidates.map(candidate => candidate.key), ['active_fact']);
});

test('scope uncertainty and complete store failure disable recall', async () => {
  const denied = fakeStore({}, async () => { throw new Error('permission_unavailable'); });
  const deniedResult = await new MemoryRetriever(denied.store, null).retrieve(job, 'query');
  assert.equal(deniedResult.mode, 'disabled');
  assert.equal(deniedResult.context, null);
  assert.equal(deniedResult.reason, 'memory_scope_unavailable');

  const failedSources = fakeStore({
    exact: async () => { throw new Error('db'); },
    lexical: async () => { throw new Error('db'); },
  });
  const failedResult = await new MemoryRetriever(failedSources.store, null).retrieve(job, 'query');
  assert.equal(failedResult.mode, 'disabled');
  assert.equal(failedResult.context, null);
});
