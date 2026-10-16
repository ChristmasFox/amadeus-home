import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nextGateMemoryDreamingAt,
  runMemoryLearningScheduler,
  type GateMemoryDreamingRunIdentity,
  type GateMemoryDreamingRunStore,
} from '../src/application/gate-memory-dreaming.js';
import type { GateMemoryConsolidationWorker } from '../src/application/gate-memory-consolidation.js';

const shanghai = 'Asia/Shanghai';
const at = (value: string) => Date.parse(value);

test('next Dreaming schedule is the next strictly future local 03:00', () => {
  assert.equal(nextGateMemoryDreamingAt(at('2026-10-15T18:59:00Z'), shanghai), at('2026-10-15T19:00:00Z'));
  assert.equal(nextGateMemoryDreamingAt(at('2026-10-15T19:00:00Z'), shanghai), at('2026-10-16T19:00:00Z'));
  assert.equal(nextGateMemoryDreamingAt(at('2026-10-15T19:01:00Z'), shanghai), at('2026-10-16T19:00:00Z'));
  assert.throws(() => nextGateMemoryDreamingAt(at('2026-10-15T00:00:00Z'), 'Invalid/Zone'));
});

test('one scheduled Dreaming run drains Light, REM, then Deep and records the local date', async () => {
  let clock = at('2026-10-15T18:59:00Z');
  const calls: string[] = [];
  const identities: GateMemoryDreamingRunIdentity[] = [];
  const statuses: string[] = [];
  const worker = {
    async processNext(workflow: 'light' | 'rem') {
      calls.push(workflow);
      return { status: 'SKIPPED_NO_ELIGIBLE_CORPUS', workflow } as const;
    },
    async processDeep() {
      calls.push('deep');
      return { status: 'SKIPPED_NO_ELIGIBLE_CORPUS' } as const;
    },
  } as unknown as GateMemoryConsolidationWorker;
  const store: GateMemoryDreamingRunStore = {
    async claim(identity) { identities.push(identity); return 'run-1'; },
    async finish(_identity, _runId, status) { statuses.push(status); },
  };
  const controller = new AbortController();

  await runMemoryLearningScheduler(worker, store, 'bot-fixture', controller.signal, event => {
    if (event.event === 'dreaming_run_completed') controller.abort();
  }, {
    timezone: shanghai,
    now: () => clock,
    sleepUntil: async timestamp => { clock = timestamp; },
  });

  assert.deepEqual(calls, ['light', 'rem', 'deep']);
  assert.deepEqual(statuses, ['succeeded']);
  assert.equal(identities.length, 1);
  assert.equal(identities[0]?.localDate, '2026-10-16');
  assert.equal(identities[0]?.scheduledAt.toISOString(), '2026-10-15T19:00:00.000Z');
});

test('a failed run is recorded and retried only at the next local 03:00', async () => {
  let clock = at('2026-10-15T18:59:00Z');
  let lightCalls = 0;
  const dates: string[] = [];
  const statuses: string[] = [];
  const events: Record<string, unknown>[] = [];
  const worker = {
    async processNext(workflow: 'light' | 'rem') {
      if (workflow === 'light' && lightCalls++ === 0) throw new Error('transcript must not be logged');
      return { status: 'SKIPPED_NO_ELIGIBLE_CORPUS', workflow } as const;
    },
    async processDeep() { return { status: 'SKIPPED_NO_ELIGIBLE_CORPUS' } as const; },
  } as unknown as GateMemoryConsolidationWorker;
  const store: GateMemoryDreamingRunStore = {
    async claim(identity) { dates.push(identity.localDate); return `run-${dates.length}`; },
    async finish(_identity, _runId, status) { statuses.push(status); },
  };
  const controller = new AbortController();

  await runMemoryLearningScheduler(worker, store, 'bot-fixture', controller.signal, event => {
    events.push(event);
    if (event.event === 'dreaming_run_completed') controller.abort();
  }, {
    timezone: shanghai,
    now: () => clock,
    sleepUntil: async timestamp => { clock = timestamp; },
  });

  assert.deepEqual(dates, ['2026-10-16', '2026-10-17']);
  assert.deepEqual(statuses, ['failed', 'succeeded']);
  assert.ok(events.some(event => event.event === 'dreaming_run_failed'));
  assert.ok(!JSON.stringify(events).includes('transcript must not be logged'));
});
