import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGateWorkingContext,
  DEFAULT_GATE_CONTEXT_BUDGET_POLICY,
  estimateGateTokens,
} from '../src/index.js';

test('working context has a stable conservative budget across 10,000 synthetic turns', () => {
  const turns = Array.from({ length: 10_000 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
    content: `消息 ${index}: 这是一段用于预算回归的合成中文历史，包含一些 English terms 和 emoji 👩‍🚀。`,
  }));
  const currentMessage = '这个问题必须原样保留。';
  const context = buildGateWorkingContext({
    turns,
    currentSpeakerLabel: '成员1',
    currentQuoteContext: `引用目标消息 quote-123，来自成员2：${'较早的引用内容。'.repeat(10_000)}`,
  }, currentMessage);

  assert.equal(context.currentMessage, currentMessage);
  assert.ok(context.turns.length > 0);
  assert.equal(context.turns.at(-1)?.content, turns.at(-1)?.content);
  assert.ok(context.estimatedRecentTokens <= DEFAULT_GATE_CONTEXT_BUDGET_POLICY.recentTurnsTokens);
  assert.ok(context.estimatedQuoteTokens <= DEFAULT_GATE_CONTEXT_BUDGET_POLICY.quotedMessageTokens);
  assert.ok(estimateGateTokens(context.currentMessage) <= context.estimatedCurrentMessageTokens);
  assert.equal(context.estimateMethod, 'conservative_unicode_char_v1');
  assert.match(context.currentQuoteContext ?? '', /quote-123/u);
  assert.match(context.currentQuoteContext ?? '', /截断/u);
});

test('working context skips an oversized historic turn without cutting the current question', () => {
  const currentMessage = '请完整保留这条当前问题，不要截断。';
  const context = buildGateWorkingContext({
    turns: [
      { role: 'user', content: 'small older detail' },
      { role: 'assistant', content: 'oversized'.repeat(20_000) },
      { role: 'user', content: 'most recent useful detail' },
    ],
    currentSpeakerLabel: '成员1',
    currentQuoteContext: null,
  }, currentMessage, { ...DEFAULT_GATE_CONTEXT_BUDGET_POLICY, recentTurnsTokens: 40 });

  assert.deepEqual(context.turns.map(turn => turn.content), ['small older detail', 'most recent useful detail']);
  assert.equal(context.currentMessage, currentMessage);
});
