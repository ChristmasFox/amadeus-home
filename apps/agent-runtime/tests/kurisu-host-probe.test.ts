import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isSuccessfulFakeHostProbe,
  runFakeHostProbe,
} from '../src/kurisu/host-probe.js';

test('Kurisu Path A host probe uses typed tools, dependencies, and correlated results', async () => {
  const trace = await runFakeHostProbe();

  assert.equal(isSuccessfulFakeHostProbe(trace), true);
  assert.deepEqual(
    trace.toolCalls.map((call) => call.name),
    ['kurisu_probe_status', 'kurisu_probe_details'],
  );
  assert.deepEqual(
    trace.toolResults.map((result) => result.toolCallId),
    ['probe-call-1', 'probe-call-2'],
  );
  assert.equal(trace.context.platformUserId, 'probe-user-1');
  assert.equal(trace.context.conversationId, 'probe-conversation-1');
  assert.equal(trace.context.runId, 'probe-run-1');
  assert.match(trace.finalAnswer ?? '', /evidence is correlated/u);
});

test('a missing typed tool produces a bounded error and no final success', async () => {
  const trace = await runFakeHostProbe([]);

  assert.equal(trace.toolCalls.length, 1);
  assert.equal(trace.toolResults[0]?.status, 'error');
  assert.equal(trace.finalAnswer, null);
  assert.equal(isSuccessfulFakeHostProbe(trace), false);
});
