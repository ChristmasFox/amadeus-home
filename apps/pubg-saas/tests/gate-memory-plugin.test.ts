import assert from 'node:assert/strict';
import test from 'node:test';
import { GateMemoryPlugin } from '../src/application/gate-memory-plugin.js';
import type { KookIngressJob } from '../src/application/kook-ingress-queue.js';
import type { GateMemoryConsolidationConsentService, GateMemoryConsolidationWorker } from '../src/application/gate-memory-consolidation.js';
import type { MemoryRetriever } from '../src/application/gate-memory-retriever.js';
import type { GateMemoryWriteCoordinator } from '../src/application/gate-memory-writer.js';
import type { AgentMemoryPlugin, MemoryRecallResult } from '@agent/memory';

function job(kind: 'direct' | 'group', content = 'my safe preference'): KookIngressJob {
  const request = kind === 'direct'
    ? { kind, event: { content, userId: 'actor-1', messageId: 'event-1', timestamp: 1_797_000_000_000 } }
    : { kind, event: { content, userId: 'actor-1', messageId: 'event-1', timestamp: 1_797_000_000_000 } };
  return { botAccountId: 'bot-1', eventId: 'event-1', leaseToken: 'lease-1', attemptCount: 1,
    bindingRevision: null, request, boundTeam: null } as unknown as KookIngressJob;
}

test('Gate memory plugin routes trusted observe, recall, explicit writes and use signals through one instance', async () => {
  const observed: KookIngressJob[] = [];
  const writes: string[] = [];
  const recalled: string[] = [];
  let handleCalls = 0;
  const emptyRecall: MemoryRecallResult = { mode: 'lexical_only', reason: 'semantic_unconfigured', candidates: [], context: null };
  const consentAdapter = { async admitCurrentMessage(value: KookIngressJob) { observed.push(value); return 2; } };
  const consent = consentAdapter as unknown as GateMemoryConsolidationConsentService;
  const retriever = {
    async retrieve(_value: KookIngressJob, query: string) { recalled.push(query); return emptyRecall; },
    async recordUsed(_value: KookIngressJob, query: string) { writes.push(`used:${query}`); },
  } as unknown as MemoryRetriever;
  const writer = {
    async remember(_value: KookIngressJob) { writes.push('remember'); return { status: 'created' as const }; },
    async forget(_value: KookIngressJob) { writes.push('forget'); return { status: 'forgotten' as const }; },
    async handle(value: KookIngressJob, _signal: AbortSignal, plugin: AgentMemoryPlugin<KookIngressJob>) {
      handleCalls += 1;
      await plugin.remember(value, { operation: 'remember', key: 'favorite_map', content: '艾伦格' });
      await plugin.forget(value, { key: 'favorite_map' });
      return { type: 'text' as const, content: 'handled' };
    },
  } as unknown as GateMemoryWriteCoordinator;
  const plugin = new GateMemoryPlugin({
    botAccountId: 'bot-1', readEnabled: true, writeEnabled: true, autoLearnEnabled: true,
    retriever, writer, consent, worker: {} as unknown as GateMemoryConsolidationWorker,
  });
  const dm = job('direct');
  const observedAt = new Date(dm.request.kind === 'direct' ? dm.request.event.timestamp : 0).toISOString();

  await plugin.observe(dm, { content: 'my safe preference', observedAt,
    evidence: [{ id: dm.eventId, observedAt, source: 'conversation' }] });
  await plugin.observe(job('group'), { content: 'my safe preference', observedAt,
    evidence: [{ id: 'event-1', observedAt, source: 'conversation' }] });
  await plugin.observe(dm, { content: 'different text', observedAt,
    evidence: [{ id: dm.eventId, observedAt, source: 'conversation' }] });
  assert.deepEqual(observed, [dm], 'only the matching trusted DM source reaches Gate admission');

  assert.deepEqual(await plugin.recall(dm, { query: 'where do I land?' }), emptyRecall);
  await plugin.recordUsed(dm, 'where do I land?', [{ canonicalKey: 'favorite_map', key: 'favorite_map', content: '艾伦格',
    revision: 1, updatedAt: observedAt, sourceEventId: 'source-1', sourceKind: 'user_confirmed', score: 1,
    sources: ['exact'], reasons: ['key_match'] }]);
  await plugin.handleExplicitMessage(dm, new AbortController().signal);
  assert.deepEqual(recalled, ['where do I land?']);
  assert.deepEqual(writes, ['used:where do I land?', 'remember', 'forget']);
  assert.equal(handleCalls, 1);
  assert.deepEqual(await plugin.health(), { status: 'ready', lastDreamingAt: null, reason: null });
});

test('Gate plugin runs a bounded Light then REM then Deep pass and reports ordered stages', async () => {
  const calls: string[] = [];
  const worker = {
    async processNext(workflow: 'light' | 'rem') {
      calls.push(workflow);
      return { status: 'SKIPPED_NO_ELIGIBLE_CORPUS' as const, workflow };
    },
    async processDeep() { calls.push('deep'); return { status: 'SKIPPED_NO_ELIGIBLE_CORPUS' as const }; },
  } as unknown as GateMemoryConsolidationWorker;
  const plugin = new GateMemoryPlugin({
    botAccountId: 'bot-1', readEnabled: false, writeEnabled: false, autoLearnEnabled: true,
    retriever: null, writer: null,
    consent: {} as unknown as GateMemoryConsolidationConsentService,
    worker,
  });
  const report = await plugin.runDreaming(new AbortController().signal);
  assert.deepEqual(calls, ['light', 'rem', 'deep']);
  assert.deepEqual(report.stages.map(stage => stage.stage), ['light', 'rem', 'deep']);
  assert.deepEqual(await plugin.health(), { status: 'ready', lastDreamingAt: report.completedAt, reason: null });
});
