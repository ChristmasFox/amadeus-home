import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { MemoryRetriever } from '../src/application/gate-memory-retriever.js';
import { estimateGateEmbeddingTokens } from '../src/application/gate-memory-embedding.js';
import type { GateMemoryAuthorizedSearch, GateMemoryEntry, GateMemoryStore } from '../src/application/gate-memory-store.js';
import type { KookIngressJob } from '../src/application/kook-ingress-queue.js';

interface EvalEntry extends GateMemoryEntry { actorId: string }
interface Selection { key: string; revision: number; similarity?: number; foreignActorId?: string }
interface EvalCase {
  id: string;
  actorId: string;
  query: string;
  exact?: Selection[];
  lexical?: Selection[];
  semantic?: Selection[];
  semanticReason?: 'semantic_timeout';
  expected: string[];
  expectedRevision?: number;
}
interface EvalDataset { datasetVersion: number; fixture: string; entries: EvalEntry[]; cases: EvalCase[] }

function selected(entries: EvalEntry[], actorId: string, selection: Selection[] = []): GateMemoryEntry[] {
  return selection.flatMap(item => {
    const sourceActor = item.foreignActorId ?? actorId;
    const row = entries.find(entry => entry.actorId === sourceActor
      && entry.key === item.key && entry.revision === item.revision);
    if (!row || row.actorId !== actorId) return [];
    return [{ ...row, ...(item.similarity === undefined ? {} : { semanticSimilarity: item.similarity }) }];
  });
}

test('synthetic Gate memory recall evaluation reports measured fixture metrics', async () => {
  const datasetUrl = new URL('./fixtures/gate-memory-recall-eval.json', import.meta.url);
  const dataset = JSON.parse(await readFile(datasetUrl, 'utf8')) as EvalDataset;
  assert.equal(dataset.datasetVersion, 1);
  assert.equal(dataset.fixture, 'synthetic-no-user-data');
  assert.ok(dataset.cases.length >= 8);
  const entries = dataset.entries.map(row => ({ ...row, updatedAt: new Date(row.updatedAt).toISOString() }));
  let activeCase: EvalCase | null = null;
  let scopeResolutions = 0;
  let embeddingRequests = 0;
  let embeddingInputTokenEstimate = 0;
  let foreignCandidatesPresented = 0;
  let isolationLeaks = 0;
  const jobFor = (actorId: string) => ({
    botAccountId: 'synthetic-bot', eventId: `synthetic-event-${actorId}`, leaseToken: 'synthetic-lease',
    request: { kind: 'direct', event: { userId: actorId } },
  }) as unknown as KookIngressJob;
  const fakeStore = {
    async withAuthorizedSearch(job: KookIngressJob, work: (searches: GateMemoryAuthorizedSearch) => Promise<unknown>) {
      scopeResolutions += 1;
      const actorId = job.request.kind === 'direct' ? job.request.event.userId : '';
      return work({
        exact: async () => selected(entries, actorId, activeCase?.exact),
        lexical: async () => selected(entries, actorId, activeCase?.lexical),
        semantic: async query => {
          embeddingRequests += 1;
          embeddingInputTokenEstimate += estimateGateEmbeddingTokens([query]);
          for (const result of activeCase?.semantic ?? []) {
            if (result.foreignActorId) foreignCandidatesPresented += 1;
          }
          const matches = selected(entries, actorId, activeCase?.semantic);
          if (matches.some(match => !entries.some(entry => entry.actorId === actorId
            && entry.key === match.key && entry.revision === match.revision))) isolationLeaks += 1;
          return { matches, reason: activeCase?.semanticReason ?? null };
        },
      });
    },
  } as unknown as GateMemoryStore;
  const retriever = new MemoryRetriever(fakeStore, null, { topK: 6 });
  const measuredCases: Array<{ id: string; mode: string; reason: string | null; returned: number; latencyMs: number }> = [];
  let recalled = 0;
  let evaluated = 0;
  let falsePositives = 0;
  let returnedCandidates = 0;
  let emptyIsolationCases = 0;

  for (const item of dataset.cases) {
    activeCase = item;
    const startedAt = performance.now();
    const result = await retriever.retrieve(jobFor(item.actorId), item.query);
    const latencyMs = performance.now() - startedAt;
    const topFive = result.candidates.slice(0, 5);
    const returnedKeys = new Set(topFive.map(candidate => candidate.key));
    const isRecalled = item.expected.every(key => returnedKeys.has(key));
    if (item.expected.length) {
      evaluated += 1;
      if (isRecalled) recalled += 1;
    } else if (topFive.length === 0) emptyIsolationCases += 1;
    falsePositives += topFive.filter(candidate => !item.expected.includes(candidate.key)).length;
    returnedCandidates += topFive.length;
    if (item.expectedRevision !== undefined) {
      assert.equal(topFive.find(candidate => candidate.key === item.expected[0])?.revision, item.expectedRevision,
        `${item.id} must prefer the latest CAS revision`);
    }
    if (item.id === 'older-relevant-fact') {
      assert.equal(topFive[0]?.key, 'old_match_note', 'age alone must not hide the relevant historic fact');
    }
    if (item.id === 'cross-actor-contamination') {
      assert.equal(topFive.length, 0, 'foreign scope rows must never enter the candidate list');
    }
    measuredCases.push({ id: item.id, mode: result.mode, reason: result.reason,
      returned: topFive.length, latencyMs: Number(latencyMs.toFixed(3)) });
  }

  const metrics = {
    dataset: dataset.fixture,
    environment: 'in-memory synthetic GateMemoryStore; no database or provider call',
    queryCount: dataset.cases.length,
    recallAt5: { hits: recalled, queries: evaluated, rate: evaluated ? recalled / evaluated : null },
    falsePositiveCount: falsePositives,
    returnedCandidateCount: returnedCandidates,
    isolationChecks: scopeResolutions,
    foreignCandidatesPresented,
    foreignCandidatesRejected: foreignCandidatesPresented - isolationLeaks,
    isolationLeaks,
    emptyIsolationCases,
    embeddingRequests,
    embeddingRequestKind: 'synthetic semantic fixture calls; no provider billing or network request',
    embeddingInputTokenEstimate,
    latencyMs: {
      total: Number(measuredCases.reduce((sum, item) => sum + item.latencyMs, 0).toFixed(3)),
      mean: Number((measuredCases.reduce((sum, item) => sum + item.latencyMs, 0) / measuredCases.length).toFixed(3)),
    },
    degradationStates: [...new Set(measuredCases.map(item => `${item.mode}:${item.reason ?? 'none'}`))].sort(),
    cases: measuredCases,
  };
  assert.equal(scopeResolutions, dataset.cases.length, 'each turn resolves one scope for all retrieval sources');
  assert.equal(isolationLeaks, 0);
  assert.ok(emptyIsolationCases >= 1);
  process.stdout.write(`GATE_MEMORY_EVAL_JSON=${JSON.stringify(metrics)}\n`);
});
