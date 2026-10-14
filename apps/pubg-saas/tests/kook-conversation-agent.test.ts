import assert from 'node:assert/strict';
import test from 'node:test';
import { MockLanguageModelV4 } from 'ai/test';
import { tool } from 'ai';
import { z } from 'zod';
import {
  PUBLIC_KOOK_AGENT_LIMITS,
  PUBLIC_KOOK_ASSISTANT_INSTRUCTIONS,
  runPublicKookAgent,
} from '../src/application/kook-conversation-agent.js';

const usage = {
  inputTokens: { total: 8, noCache: 8, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function response(content: Array<Record<string, unknown>>, finish: 'stop' | 'tool-calls') {
  return {
    content,
    finishReason: { unified: finish, raw: finish },
    usage,
    warnings: [],
  };
}

test('ordinary group chat can finish directly without PUBG keywords or tool calls', async () => {
  const model = new MockLanguageModelV4({ doGenerate: [response([{ type: 'text', text: '今晚开黑当然行，落地别先把车开进海里就好。' }], 'stop') as never] });
  const result = await runPublicKookAgent({
    model,
    tools: {},
    messages: [{ role: 'user', content: '[成员1] 今晚开黑吗？' }],
    signal: new AbortController().signal,
    currentMessage: '今晚开黑吗？',
  });
  assert.match(result.text, /今晚开黑/u);
  assert.equal(result.stepCount, 1);
  assert.equal(result.totalTokens, 13);
  assert.match(PUBLIC_KOOK_ASSISTANT_INSTRUCTIONS, /每条有效人类消息都值得自然回应/u);
  assert.ok(PUBLIC_KOOK_AGENT_LIMITS.maxSteps > 1);
});

test('ToolLoopAgent executes a selected domain tool and returns to the model for the final answer', async () => {
  const model = new MockLanguageModelV4({ doGenerate: [
    response([{ type: 'tool-call', toolCallId: 'query-call-1', toolName: 'pubg_query', input: JSON.stringify({ selector: 'yesterday' }) }], 'tool-calls') as never,
    response([{ type: 'text', text: '昨天 Alice 伤害最高；公开数据只覆盖到两场。' }], 'stop') as never,
  ] });
  const toolInputs: unknown[] = [];
  const tools = {
    pubg_query: tool({
      description: 'Read authorized PUBG facts.',
      inputSchema: z.object({ selector: z.string() }).strict(),
      execute: async input => {
        toolInputs.push(input);
        return { status: 'partial', asOf: '2026-10-14T00:00:00.000Z', coverage: { complete: false }, evidenceRefs: ['match-1', 'match-2'], facts: 'Alice 420 damage' };
      },
    }),
  };
  const result = await runPublicKookAgent({
    model,
    tools,
    messages: [{ role: 'user', content: '[成员1] 昨天谁伤害最高？' }],
    signal: new AbortController().signal,
    currentMessage: '昨天谁伤害最高？',
  });
  assert.equal(toolInputs.length, 1);
  assert.deepEqual(toolInputs[0], { selector: 'yesterday' });
  assert.match(result.text, /Alice 伤害最高/u);
  assert.equal(result.stepCount, 2);
});

test('provider failures reject from the SDK wrapper for the ingress handler to persist and answer safely', async () => {
  const model = new MockLanguageModelV4({ doGenerate: async () => { throw new Error('private provider detail and key'); } });
  await assert.rejects(runPublicKookAgent({
    model,
    tools: {},
    messages: [{ role: 'user', content: '你好' }],
    signal: new AbortController().signal,
    currentMessage: '你好',
  }), /private provider detail/u);
});
