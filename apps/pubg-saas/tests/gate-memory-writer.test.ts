import assert from 'node:assert/strict';
import test from 'node:test';
import { MockLanguageModelV4 } from 'ai/test';
import { GateMemoryIntentClassifier } from '../src/application/gate-memory-writer.js';

const usage = {
  inputTokens: { total: 12, noCache: 12, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 8, text: 8, reasoning: undefined },
};

function modelFor(output: unknown): MockLanguageModelV4 {
  const content = typeof output === 'string' ? output : JSON.stringify(output);
  return new MockLanguageModelV4({ doGenerate: {
    content: [{ type: 'tool-call', toolCallId: 'memory-intent-call', toolName: 'submit_gate_memory_intent', input: content }],
    finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [],
  } });
}

const rememberPlan = {
  intent: 'remember', confidence: 'high', subject: 'self', memoryType: 'stable_preference',
  key: 'favorite_map', content: '喜欢艾伦格', evidence: '请记住我喜欢艾伦格', validity: 'stable',
};

test('memory intent extraction uses one strict AI SDK tool and sees only the current message', async () => {
  const model = modelFor(rememberPlan);
  const classifier = new GateMemoryIntentClassifier(model);
  const message = '请记住我喜欢艾伦格';
  const plan = await classifier.classify(message);

  assert.equal(plan.intent, 'remember');
  assert.deepEqual(plan, rememberPlan);
  assert.equal(model.doGenerateCalls.length, 1);
  const choice = model.doGenerateCalls[0]?.toolChoice;
  assert.equal(choice?.type, 'tool');
  if (choice?.type === 'tool') assert.equal(choice.toolName, 'submit_gate_memory_intent');
  const prompt = JSON.stringify(model.doGenerateCalls[0]);
  assert.match(prompt, /untrusted data/iu);
  assert.match(prompt, new RegExp(message, 'u'));
  assert.doesNotMatch(prompt, /tenant-secret|channel-secret|database-url/u);
});

test('invalid routing fields and ambiguous output produce no memory intent', async () => {
  const forged = modelFor({ ...rememberPlan, tenantId: 'other-tenant', userId: 'other-user' });
  assert.equal((await new GateMemoryIntentClassifier(forged).classify('请记住我喜欢艾伦格')).intent, 'none');
  const ambiguous = modelFor({ ...rememberPlan, confidence: 'low', evidence: null });
  assert.equal((await new GateMemoryIntentClassifier(ambiguous).classify('也许可以记一下某件事')).confidence, 'low');
});

test('classifier failure and oversized text safely fall through without a write suggestion', async () => {
  const model = new MockLanguageModelV4({ doGenerate: async () => { throw new Error('private provider detail'); } });
  const classifier = new GateMemoryIntentClassifier(model);
  assert.equal((await classifier.classify('请记住我喜欢艾伦格')).intent, 'none');
  assert.equal((await classifier.classify('记住'.repeat(2_000))).intent, 'none');
  assert.equal(model.doGenerateCalls.length, 1);
});
