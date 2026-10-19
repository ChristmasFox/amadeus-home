import assert from 'node:assert/strict';
import test from 'node:test';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { assessPubgEvidence, droppedReplyFacts, registerPubgEvidenceGuard } from '../src/evidence-guard.js';

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

test('a bare record request names no one, so it is a whole-team request', () => {
  const data = [call('pubg_query_stats', { team: true, refresh: true }), result('pubg_query_stats', 'ok')];
  for (const request of ['昨日战绩', '今日战绩', '今天战绩？', '@Kurisu 昨天战绩', '昨天的PUBG战绩']) {
    assert.equal(assessPubgEvidence([user(request), ...data], '昨天全队 12 局 PUBG'), 'verified', request);
  }
  for (const request of ['我昨天战绩', '猴昨日战绩', '今日猴的战绩']) {
    assert.equal(assessPubgEvidence([user(request), ...data], '昨天全队 12 局 PUBG'), 'wrong_scope', request);
  }
});

test('valid individual facts and safe uncertainty pass; unrelated conversation is untouched', () => {
  const data = [call('pubg_query_stats', { personIds: ['p1'], refresh: true }), result('pubg_query_stats', 'ok')];
  assert.equal(assessPubgEvidence([user('今日猴的战绩'), ...data], 'PUBG 今天 7 局'), 'verified');
  assert.equal(assessPubgEvidence([user('今日猴的战绩')], '这次没有查到数据，我不能确认。'), 'not_applicable');
  assert.equal(assessPubgEvidence([user('中午吃什么')], '今天没有吃鸡。'), 'not_applicable');
});

test('unsupported claims request one native-tool revision and still fail closed if it persists', () => {
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
  const revision = finalize(event, context) as { action?: string; retry?: { maxAttempts?: number; instruction?: string } };
  assert.equal(revision.action, 'revise');
  assert.equal(revision.retry?.maxAttempts, 1);
  assert.match(revision.retry?.instruction ?? '', /native PUBG tool/u);
  assert.match(outbound({ payload: { text: reply, mediaUrl: 'file:///unsafe' }, sessionKey: 'group-session' }, { channelId: 'whatsapp' })?.payload?.text ?? '', /不能确认结果/);
  assert.deepEqual(outbound({ payload: { text: reply }, sessionKey: 'group-session' }, context), { cancel: true, reason: 'pubg_unverified_followup_chunk' });
  assert.equal(outbound({ payload: { text: '普通文字' }, sessionKey: 'group-session' }, context), undefined);
  assert.equal(finalize({ ...event, messages: [user('今日猴的战绩'), call('pubg_query_stats', { personIds: ['p1'] }), result('pubg_query_stats', 'ok')] }, context), undefined);
  assert.equal(outbound({ payload: { text: reply }, sessionKey: 'group-session' }, context), undefined);
  assert.ok(warnings.length >= 2);
});

test('outbound guard still blocks when the delivery hook spells the session key differently', () => {
  const hooks = new Map<string, (event: any, context: any) => any>();
  registerPubgEvidenceGuard({
    on: (name: string, handler: (event: any, context: any) => any) => { hooks.set(name, handler); },
    logger: { warn: () => undefined },
  } as unknown as OpenClawPluginApi);
  const reply = '昨天 12 场，Nori 5 杀';
  hooks.get('before_agent_finalize')!({ runId: 'turn-9', sessionKey: 'agent:main:whatsapp:group:1', lastAssistantMessage: reply, messages: [user('昨天战绩'), assistant(reply)] }, { sessionKey: 'agent:main:whatsapp:group:1', trigger: 'user' });
  const sent = hooks.get('reply_payload_sending')!({ payload: { text: reply }, runId: 'turn-9', sessionKey: 'whatsapp:group:1' }, { channelId: 'whatsapp' });
  assert.match(sent?.payload?.text ?? '', /不能确认结果/);
});

test('a 战绩 reply that dropped a card gets one rewrite request, then goes out as is', () => {
  const presentation = {
    type: 'pubg_stats', status: 'ok', dataUpdatedAt: '2026-10-19T15:50:00.000Z', headline: 'x', operation: 'report', groupBy: 'player', summary: 'x', evidenceRefs: [],
    rows: [
      { label: 'kim_kkl', evidenceRefs: [], values: { kd: 1.56, damage: 1935.3 } },
      { label: 'SG_LabmemNo004', evidenceRefs: [], values: { kd: 1.33, damage: 2630.4 } },
    ],
  };
  const stats = { role: 'toolResult', toolName: 'pubg_query_stats', content: [{ type: 'text', text: JSON.stringify({ status: 'ok', presentation }) }] };
  const short = '今天 PUBG 战绩：Nori KD 1.56，1935.3 伤害，团队合计 …';
  const full = `${short}\n变态猴 KD 1.33，2630.4 伤害（全队伤害第一）`;
  assert.deepEqual(droppedReplyFacts([user('今日战绩'), call('pubg_query_stats', { team: true }), stats], full), []);
  assert.deepEqual(droppedReplyFacts([user('今日战绩'), call('pubg_query_stats', { team: true }), stats], short), ['SG_LabmemNo004 的 KD 1.33', 'SG_LabmemNo004 的伤害 2630.4', 'SG_LabmemNo004 的称号「全队伤害第一」']);

  const hooks = new Map<string, (event: any, context: any) => any>();
  registerPubgEvidenceGuard({ on: (name: string, handler: (event: any, context: any) => any) => { hooks.set(name, handler); }, logger: { warn: () => undefined } } as unknown as OpenClawPluginApi);
  const finalize = hooks.get('before_agent_finalize')!;
  const event = { runId: 'turn-shape', sessionKey: 'group', lastAssistantMessage: short, messages: [user('今日战绩'), call('pubg_query_stats', { team: true }), stats] };
  const revision = finalize(event, { sessionKey: 'group', trigger: 'user' }) as { action?: string; reason?: string; retry?: { instruction?: string } };
  assert.equal(revision.action, 'revise');
  assert.equal(revision.reason, 'pubg_reply_incomplete');
  assert.match(revision.retry?.instruction ?? '', /KD 1\.33/u);
  assert.equal(finalize(event, { sessionKey: 'group', trigger: 'user' }), undefined, 'only one rewrite per run');
  // A complete reply is never sent back, and the outbound guard does not touch it.
  assert.equal(finalize({ ...event, runId: 'turn-full', lastAssistantMessage: full }, { sessionKey: 'group', trigger: 'user' }), undefined);
  assert.equal(hooks.get('reply_payload_sending')!({ payload: { text: full }, sessionKey: 'group', runId: 'turn-full' }, {}), undefined);
});
