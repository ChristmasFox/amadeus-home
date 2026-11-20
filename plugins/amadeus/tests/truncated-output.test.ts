import assert from 'node:assert/strict';
import test from 'node:test';
import { DeliveryRuns } from '../src/delivery-runs.js';
import { decideFinalize, isDegenerateRun, isFragmentText, isIncompleteJsonText, registerTruncatedOutputGuard, RETRY_INSTRUCTION } from '../src/truncated-output.js';

const GROUP = 'agent:main:whatsapp:group:120363000000000000@g.us:thread:whatsapp-account-secondary';
const DM = 'agent:main:whatsapp:secondary:direct:contact';
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

test('a flagged run posts the truncation notice instead of the fragment; an unflagged short answer is still delivered', () => {
  const runs = new DeliveryRuns();
  const decideFor = (runId: string, raw: string) => {
    runs.start({ runId, sessionKey: GROUP, channel: 'whatsapp', origin: 'external_user' });
    return runs.decode(runId, raw);
  };
  decideFinalize({ runId: 'run-h', sessionKey: GROUP, lastAssistantMessage: '先', messages: withUsage(0) }, new Map());
  decideFinalize({ runId: 'run-h', sessionKey: GROUP, lastAssistantMessage: '先', messages: withUsage(0) }, new Map([['run-h', 1]]));
  const flagged = decideFor('run-h', '先');
  assert.match(JSON.stringify(flagged.parts), /仍不完整/u);
  assert.doesNotMatch(JSON.stringify(flagged.parts), /回复格式异常/u);
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

test('incomplete JSON objects and unterminated strings retry even when reasoning usage is present', () => {
  const cases = [
    '{"',
    '{"version":2,"silent":false,"parts":[{"kind":"text","text":"unfinished',
  ];
  for (const [index, lastAssistantMessage] of cases.entries()) {
    const attempts = new Map<string, number>();
    assert.equal(isIncompleteJsonText(lastAssistantMessage), true);
    assert.equal(decideFinalize({
      runId: `run-incomplete-${index}`,
      sessionKey: DM,
      lastAssistantMessage,
      messages: withUsage(800),
    }, attempts).action, 'revise');
    assert.equal(decideFinalize({
      runId: `run-incomplete-${index}`,
      sessionKey: DM,
      lastAssistantMessage,
      messages: withUsage(800),
    }, attempts).action, 'continue');
  }
  assert.equal(isIncompleteJsonText('{"version":2,"silent":false,"parts":[]}'), false);
  assert.equal(isIncompleteJsonText('{"version":}'), false, 'balanced malformed JSON is a format error, not truncation');
});

test('persistent truncation uses a truncation notice, never the format fallback', () => {
  const runs = new DeliveryRuns();
  const partials = [
    '{"',
    '{"version":2,"silent":false,"parts":[{"kind":"text","text":"unfinished',
  ];
  for (const [index, partial] of partials.entries()) {
    const runId = `run-persistent-json-truncation-${index}`;
    const attempts = new Map<string, number>();
    decideFinalize({ runId, sessionKey: DM, lastAssistantMessage: partial, messages: withUsage(800) }, attempts);
    decideFinalize({ runId, sessionKey: DM, lastAssistantMessage: partial, messages: withUsage(800) }, attempts);
    runs.start({ runId, sessionKey: DM, channel: 'whatsapp', origin: 'external_user' });
    const decoded = runs.decode(runId, partial);
    assert.equal(decoded.fallbackReason, 'truncated_output', partial);
    assert.match(JSON.stringify(decoded.parts), /仍不完整/u);
    assert.doesNotMatch(JSON.stringify(decoded.parts), /格式异常/u);
  }
});


test('cached fragment is checked again when finalize marks the run', async () => {
  const runs = new DeliveryRuns();
  runs.start({ runId: 'late-fragment', sessionKey: DM, channel: 'whatsapp', origin: 'external_user' });
  runs.decode('late-fragment', '这');
  decideFinalize({ runId: 'late-fragment', sessionKey: DM, lastAssistantMessage: '这', messages: withUsage(0) }, new Map());
  const result = await runs.prepare('late-fragment', '这');
  assert.equal(result.fallbackReason, 'truncated_output');
});

test('a complete revised answer replaces a cached fragment', async () => {
  const runs = new DeliveryRuns();
  runs.start({ runId: 'late-revised', sessionKey: DM, channel: 'whatsapp', origin: 'external_user' });
  runs.decode('late-revised', '这');
  decideFinalize({ runId: 'late-revised', sessionKey: DM, lastAssistantMessage: '这', messages: withUsage(0) }, new Map());
  const result = await runs.prepare('late-revised', '这是一条完整回复。');
  assert.match(JSON.stringify(result.parts), /这是一条完整回复/u);
});
