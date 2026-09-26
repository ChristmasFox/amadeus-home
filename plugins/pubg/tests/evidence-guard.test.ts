import assert from 'node:assert/strict';
import test from 'node:test';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { assessPubgEvidence, registerPubgEvidenceGuard } from '../src/evidence-guard.js';

const user = (value: string) => ({ role: 'user', content: [{ type: 'text', text: value }] });
const assistant = (value: string) => ({ role: 'assistant', content: [{ type: 'text', text: value }] });
const call = (name: string, args: Record<string, unknown>) => ({ role: 'assistant', content: [{ type: 'toolCall', name, arguments: args }] });
const result = (name: string, status: string) => ({ role: 'toolResult', toolName: name, content: [{ type: 'text', text: JSON.stringify({ status }) }] });
const reply = '今天一局都没有打，PUBG 战绩为零。';

test('reproduced group failure: no data tool means no factual reply, regardless of old cached context', () => {
  assert.equal(assessPubgEvidence([call('pubg_query_stats', { team: true }), result('pubg_query_stats', 'ok'), user('@member 今日猴的战绩'), assistant(reply)], reply), 'missing_data');
  assert.equal(assessPubgEvidence([user('今日猴的战绩'), assistant(reply)], reply), 'missing_data');
});

test('current-turn failed tools cannot turn an unverified zero into no_matches', () => {
  assert.equal(assessPubgEvidence([user('今日猴的战绩'), call('pubg_query_stats', { personIds: ['p1'] }), result('pubg_query_stats', 'error')], reply), 'missing_data');
  assert.equal(assessPubgEvidence([user('今日猴的战绩'), call('pubg_prefetch_telemetry', { team: true }), result('pubg_prefetch_telemetry', 'ok')], reply), 'missing_data');
});

test('person request and short refresh follow-up cannot use team=true', () => {
  const data = [call('pubg_query_stats', { team: true, refresh: true }), result('pubg_query_stats', 'ok')];
  assert.equal(assessPubgEvidence([user('今日猴的战绩'), ...data], '今天 7 局 PUBG，10 杀'), 'wrong_scope');
  assert.equal(assessPubgEvidence([user('今日猴的战绩'), assistant('暂时无法确认'), user('刷新一下 查最新'), ...data], '今天 7 局 PUBG，10 杀'), 'wrong_scope');
  assert.equal(assessPubgEvidence([user('今天全队战绩'), ...data], '今天 7 局 PUBG'), 'verified');
});

test('valid individual facts and safe uncertainty pass; unrelated conversation is untouched', () => {
  const data = [call('pubg_query_stats', { personIds: ['p1'], refresh: true }), result('pubg_query_stats', 'ok')];
  assert.equal(assessPubgEvidence([user('今日猴的战绩'), ...data], 'PUBG 今天 7 局'), 'verified');
  assert.equal(assessPubgEvidence([user('今日猴的战绩')], '这次没有查到数据，我不能确认。'), 'not_applicable');
  assert.equal(assessPubgEvidence([user('中午吃什么')], '今天没有吃鸡。'), 'not_applicable');
});

test('outbound fails closed without a host finalize revision when unsupported claims persist', () => {
  const hooks = new Map<string, (event: any, context: any) => any>();
  const warnings: string[] = [];
  registerPubgEvidenceGuard({
    on: (name: string, handler: (event: any, context: any) => any) => { hooks.set(name, handler); },
    logger: { warn: (message: string) => warnings.push(message) },
  } as unknown as OpenClawPluginApi);
  const finalize = hooks.get('before_agent_finalize')!;
  const outbound = hooks.get('reply_payload_sending')!;
  assert.equal(hooks.has('message_sending'), false);
  const context = { sessionKey: 'group-session', trigger: 'user' };
  assert.equal(finalize({ lastAssistantMessage: 'PUBG 战绩为零', messages: [user('PUBG 战绩')] }, { sessionKey: 'cron-session', trigger: 'cron' }), undefined);
  const event = { runId: 'turn-1', sessionKey: 'group-session', lastAssistantMessage: reply, messages: [user('今日猴的战绩'), assistant(reply)] };
  assert.equal(finalize(event, context), undefined);
  assert.match(outbound({ payload: { text: reply, mediaUrl: 'file:///unsafe' }, sessionKey: 'group-session' }, { channelId: 'whatsapp' })?.payload?.text ?? '', /不能确认结果/);
  assert.deepEqual(outbound({ payload: { text: reply }, sessionKey: 'group-session' }, context), { cancel: true, reason: 'pubg_unverified_followup_chunk' });
  assert.equal(outbound({ payload: { text: '普通文字' }, sessionKey: 'group-session' }, context), undefined);
  assert.equal(finalize({ ...event, messages: [user('今日猴的战绩'), call('pubg_query_stats', { personIds: ['p1'] }), result('pubg_query_stats', 'ok')] }, context), undefined);
  assert.equal(outbound({ payload: { text: reply }, sessionKey: 'group-session' }, context), undefined);
  assert.ok(warnings.length >= 2);
});
