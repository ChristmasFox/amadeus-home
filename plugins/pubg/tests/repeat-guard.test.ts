import assert from 'node:assert/strict';
import test from 'node:test';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { MAX_IDENTICAL_CALLS, REPEAT_BLOCK_REASON, RepeatTracker, registerPubgRepeatGuard } from '../src/repeat-guard.js';

const args = { team: true, selector: { type: 'relative_period', value: 'yesterday' }, groupBy: 'player' };

test('identical calls are allowed MAX_IDENTICAL_CALLS times in a row, then blocked', () => {
  assert.equal(MAX_IDENTICAL_CALLS, 3);
  const tracker = new RepeatTracker();
  const verdicts = Array.from({ length: 6 }, () => tracker.shouldBlock('run', 'pubg_query_stats', args));
  assert.deepEqual(verdicts, [false, false, false, true, true, true]);
});

test('argument key order does not matter, a different call restarts the streak, scopes are independent', () => {
  const tracker = new RepeatTracker();
  for (let i = 0; i < 3; i += 1) tracker.shouldBlock('run', 'pubg_query_stats', args);
  assert.equal(tracker.shouldBlock('run', 'pubg_query_stats', { groupBy: 'player', selector: { value: 'yesterday', type: 'relative_period' }, team: true }), true);
  assert.equal(tracker.shouldBlock('run', 'pubg_query_stats', { ...args, groupBy: 'team' }), false, 'changed arguments are a new call');
  assert.equal(tracker.shouldBlock('run', 'pubg_query_stats', args), false, 'the streak restarted');
  for (let i = 0; i < 3; i += 1) tracker.shouldBlock('other', 'pubg_query_stats', args);
  assert.equal(tracker.shouldBlock('run', 'pubg_query_stats', args), false);
  assert.equal(tracker.shouldBlock('run', 'pubg_compare_stats', args), false, 'another tool is a new call');
});

test('the hook blocks the 4th identical pubg call with an answer-now reason, and counts one call once per registration', () => {
  const handlers: Array<(event: any, context: any) => unknown> = [];
  const logger = { warn() {}, info() {}, error() {}, debug() {} };
  const api = { logger, on: (_name: string, handler: (event: any, context: any) => unknown) => { handlers.push(handler); } } as unknown as OpenClawPluginApi;
  registerPubgRepeatGuard(api);
  registerPubgRepeatGuard(api); // the plugin is registered more than once per process
  const results: unknown[] = [];
  for (let i = 1; i <= 5; i += 1) {
    const event = { toolName: 'pubg_query_stats', params: args, runId: 'hook-run', toolCallId: `call-${i}` };
    const outcomes = handlers.map((handler) => handler(event, { sessionKey: 'hook-session' }));
    results.push(outcomes[0]);
    assert.deepEqual(outcomes[1], outcomes[0], 'every registration agrees on the same call');
  }
  assert.deepEqual(results.slice(0, 3), [undefined, undefined, undefined]);
  assert.deepEqual(results[3], { block: true, blockReason: REPEAT_BLOCK_REASON });
  assert.deepEqual(results[4], { block: true, blockReason: REPEAT_BLOCK_REASON });
  assert.match(REPEAT_BLOCK_REASON, /answer the user now/);
  const other = handlers[0]!({ toolName: 'steam_get_achievements', params: args, runId: 'hook-run', toolCallId: 'x' }, {});
  assert.equal(other, undefined, 'only pubg tools are guarded');
});
