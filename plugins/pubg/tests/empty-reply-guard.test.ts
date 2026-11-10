import assert from 'node:assert/strict';
import test from 'node:test';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { isDegenerateReply, registerEmptyReplyGuard } from '../src/empty-reply-guard.js';

test('markup-only and empty replies are degenerate; real text, digits and emoji are not', () => {
  for (const text of ['**', '', '  \n', '* * *', '```', '—', undefined]) assert.equal(isDegenerateReply(text), true, String(text));
  for (const text of ['好的', '**1**', '🏆', 'ok']) assert.equal(isDegenerateReply(text), false, text);
});

function harness() {
  const hooks: Record<string, (event: any, context: any) => any> = {};
  const logger = { warn() {}, info() {}, error() {}, debug() {} };
  registerEmptyReplyGuard({ logger, on: (name: string, handler: (event: any, context: any) => any) => { hooks[name] = handler; } } as unknown as OpenClawPluginApi);
  return hooks;
}

test('a bare ** is dropped when nothing was obtained, and replaced by the PUBG displayText already obtained in the run', () => {
  const hooks = harness();
  const bare = { payload: { text: '**' }, runId: 'run-empty', sessionKey: 'sess-empty' };
  assert.deepEqual(hooks.reply_payload_sending!(bare, {}), { cancel: true, reason: 'empty_reply' });
  hooks.after_tool_call!({ toolName: 'pubg_query_stats', runId: 'run-a', result: { content: [{ type: 'text', text: JSON.stringify({ status: 'ok', displayText: '🏆 PUBG 昨日战绩' }) }] } }, { sessionKey: 'sess-a' });
  const replaced = hooks.reply_payload_sending!({ payload: { text: '**' }, runId: 'run-a', sessionKey: 'sess-a' }, {});
  assert.deepEqual(replaced, { payload: { text: '🏆 PUBG 昨日战绩' } });
  assert.equal(hooks.reply_payload_sending!({ payload: { text: '正常回复' }, runId: 'run-a' }, {}), undefined, 'real replies are untouched');
  assert.equal(hooks.reply_payload_sending!({ payload: { text: '', mediaUrl: 'file:///x.png' }, runId: 'run-empty' }, {}), undefined, 'media-only replies are untouched');
  hooks.after_tool_call!({ toolName: 'pubg_query_stats', runId: 'run-b', result: { status: 'error', displayText: 'x' } }, {});
  assert.deepEqual(hooks.reply_payload_sending!({ payload: { text: '**' }, runId: 'run-b' }, {}), { cancel: true, reason: 'empty_reply' }, 'only successful results are reused');
});
