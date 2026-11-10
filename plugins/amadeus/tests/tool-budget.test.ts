import assert from 'node:assert/strict';
import test from 'node:test';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { MAX_TOOL_CALLS_PER_RUN, MAX_TOOL_RESULT_BYTES_PER_RUN, TOOL_BUDGET_REASON, ToolBudget, registerToolBudget, resultBytes } from '../src/tool-budget.js';

test('a run may make MAX_TOOL_CALLS_PER_RUN calls, then is blocked; other runs are unaffected', () => {
  const budget = new ToolBudget();
  const verdicts = Array.from({ length: MAX_TOOL_CALLS_PER_RUN + 2 }, (_, i) => budget.admit('run-a', `c${i}`));
  assert.equal(verdicts.slice(0, MAX_TOOL_CALLS_PER_RUN).every(Boolean), true);
  assert.deepEqual(verdicts.slice(MAX_TOOL_CALLS_PER_RUN), [false, false]);
  assert.equal(budget.admit('run-b', 'x'), true);
  assert.equal(budget.admit('run-a', 'c0'), false, 'a repeated call id is not counted twice and keeps the verdict');
});

test('accumulated tool-result bytes stop further calls even with few calls', () => {
  const budget = new ToolBudget();
  assert.equal(budget.admit('run', '1'), true);
  budget.record('run', '1', 26_000 * 10);
  assert.equal(MAX_TOOL_RESULT_BYTES_PER_RUN < 260_000, true);
  assert.equal(budget.admit('run', '2'), false, 'the next call is refused once the results are over the limit');
  assert.equal(resultBytes({ a: 'x'.repeat(100) }) > 100, true);
  assert.equal(resultBytes(undefined), 0);
});

test('the hooks block the call past the budget with an answer-now reason and count results from after_tool_call', () => {
  const hooks: Record<string, (event: any, context: any) => any> = {};
  const logger = { warn() {}, info() {}, error() {}, debug() {} };
  registerToolBudget({ logger, on: (name: string, handler: (event: any, context: any) => any) => { hooks[name] = handler; } } as unknown as OpenClawPluginApi);
  const big = { content: [{ type: 'text', text: 'x'.repeat(130_000) }] };
  for (let i = 1; i <= 2; i += 1) {
    assert.equal(hooks.before_tool_call!({ toolName: 'pubg_query_stats', runId: 'hook-run', toolCallId: `t${i}` }, {}), undefined);
    hooks.after_tool_call!({ toolName: 'pubg_query_stats', runId: 'hook-run', toolCallId: `t${i}`, result: big }, {});
  }
  assert.deepEqual(hooks.before_tool_call!({ toolName: 'pubg_query_stats', runId: 'hook-run', toolCallId: 't3' }, {}), { block: true, blockReason: TOOL_BUDGET_REASON });
  assert.match(TOOL_BUDGET_REASON, /answer the user now/);
  assert.equal(hooks.before_tool_call!({ toolName: 'x', toolCallId: 'n' }, {}), undefined, 'no run id, no accounting');
});
