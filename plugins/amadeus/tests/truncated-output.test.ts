import assert from 'node:assert/strict';
import test from 'node:test';
import { DeliveryRuns } from '../src/delivery-runs.js';
import { decideFinalize, isDegenerateRun, isFragmentText, registerTruncatedOutputGuard, RETRY_INSTRUCTION } from '../src/truncated-output.js';

const GROUP = 'agent:main:whatsapp:group:120363000000000000@g.us:thread:whatsapp-account-secondary';
const DM = 'agent:main:whatsapp:secondary:direct:+15550100123';
const withUsage = (output: number) => [{ role: 'user', content: 'q' }, { role: 'assistant', usage: { output }, content: [{ type: 'text', text: 'x' }] }];

test('fragments are 1-3 character cut-offs including short JSON stubs; reaction tags and whitespace do not count', () => {
  for (const text of ['先', '上一', '绑定', ' 先 ', '先[react:👍]', '{"', '{', '[', '`', '[x', '```']) assert.equal(isFragmentText(text), true, text);
  for (const text of ['', '   ', '这是一个完整的回答', undefined, 3]) assert.equal(isFragmentText(text as never), false, String(text));
});

test('a fragment with no usage is sent back once, then accepted but flagged', () => {
  const attempts = new Map<string, number>();
  const event = { runId: 'run-a', sessionKey: GROUP, lastAssistantMessage: '先', messages: withUsage(0) };
  const first = decideFinalize(event, attempts);
  assert.deepEqual(first, { action: 'revise', reason: 'truncated_final_answer', retry: { instruction: RETRY_INSTRUCTION, maxAttempts: 1 } });
  assert.equal(decideFinalize(event, attempts).action, 'continue');
  assert.equal(isDegenerateRun('run-a'), true);
});

test('an absent usage also counts; reported usage, real text, non-chat keys and unknown sessions are left alone', () => {
  const attempts = new Map<string, number>();
  assert.equal(decideFinalize({ runId: 'run-b', sessionKey: DM, lastAssistantMessage: '上一', messages: [] }, attempts).action, 'revise');
  assert.equal(decideFinalize({ runId: 'run-c', sessionKey: GROUP, lastAssistantMessage: '好', messages: withUsage(40) }, attempts).action, 'continue');
  assert.equal(decideFinalize({ runId: 'run-d', sessionKey: GROUP, lastAssistantMessage: '这是完整的回答', messages: withUsage(0) }, attempts).action, 'continue');
  assert.equal(decideFinalize({ runId: 'run-e', sessionKey: 'agent:main:cron:1', lastAssistantMessage: '先', messages: withUsage(0) }, attempts).action, 'continue');
  assert.equal(decideFinalize({ runId: 'run-f', lastAssistantMessage: '先', messages: withUsage(0) }, attempts).action, 'continue');
  assert.equal(isDegenerateRun('run-c'), false);
});

test('the registered hook returns the revision and never throws', () => {
  const hooks = new Map<string, (...args: any[]) => any>();
  const logs: string[] = [];
  registerTruncatedOutputGuard({ logger: { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m) }, on: (name: string, handler: never) => hooks.set(name, handler) } as never);
  const hook = hooks.get('before_agent_finalize')!;
  assert.equal(hook({ runId: 'run-g', sessionKey: GROUP, lastAssistantMessage: '绑定', messages: withUsage(0) }, {}).action, 'revise');
  assert.equal(hook({ runId: 'run-g', sessionKey: GROUP, lastAssistantMessage: '绑定', messages: withUsage(0) }, {}), undefined);
  assert.equal(hook(null, null), undefined);
});

test('a flagged run posts the failure notice instead of the fragment; an unflagged short answer is still delivered', () => {
  const runs = new DeliveryRuns();
  const decideFor = (runId: string, raw: string) => {
    runs.start({ runId, sessionKey: GROUP, channel: 'whatsapp', origin: 'external_user' });
    return runs.decode(runId, raw);
  };
  decideFinalize({ runId: 'run-h', sessionKey: GROUP, lastAssistantMessage: '先', messages: withUsage(0) }, new Map());
  decideFinalize({ runId: 'run-h', sessionKey: GROUP, lastAssistantMessage: '先', messages: withUsage(0) }, new Map([['run-h', 1]]));
  const flagged = decideFor('run-h', '先');
  assert.match(JSON.stringify(flagged.parts), /回复格式异常/u);
  const plain = decideFor('run-i', '好');
  assert.match(JSON.stringify(plain.parts), /好/u);
  assert.doesNotMatch(JSON.stringify(plain.parts), /回复格式异常/u);
});

test('a short JSON stub with no usage is retried once like a plain fragment', () => {
  const attempts = new Map<string, number>();
  const event = { runId: 'run-json-stub', sessionKey: GROUP, lastAssistantMessage: '{"', messages: withUsage(0) };
  assert.equal(decideFinalize(event, attempts).action, 'revise');
  assert.equal(decideFinalize(event, attempts).action, 'continue');
  assert.equal(isDegenerateRun('run-json-stub'), true);
});
