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

function response(content: Array<Record<string, unknown>>, finish: 'stop' | 'tool-calls' | 'length') {
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
  assert.ok(PUBLIC_KOOK_AGENT_LIMITS.maxSteps >= 100);
  assert.equal(PUBLIC_KOOK_AGENT_LIMITS.totalTimeoutMs, 300_000);
  assert.equal(PUBLIC_KOOK_AGENT_LIMITS.stepTimeoutMs, 120_000);
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

test('ToolLoopAgent can call multiple tools in sequence before composing its final answer', async () => {
  const model = new MockLanguageModelV4({ doGenerate: [
    response([{ type: 'tool-call', toolCallId: 'team-info-1', toolName: 'team_info', input: JSON.stringify({ includeRoster: true }) }], 'tool-calls') as never,
    response([{ type: 'tool-call', toolCallId: 'query-1', toolName: 'pubg_query', input: JSON.stringify({ selector: 'yesterday', metric: 'damage' }) }], 'tool-calls') as never,
    response([{ type: 'text', text: '昨天 Alice 伤害最高；小队共覆盖两场，数据不完整。' }], 'stop') as never,
  ] });
  const calls: string[] = [];
  const tools = {
    team_info: tool({
      description: 'Read the authorized team roster.',
      inputSchema: z.object({ includeRoster: z.boolean() }).strict(),
      execute: async input => {
        calls.push('team_info');
        assert.deepEqual(input, { includeRoster: true });
        return { status: 'ok', team: 'Fixture Squad', roster: ['Alice', 'Bob'] };
      },
    }),
    pubg_query: tool({
      description: 'Read authorized PUBG Domain facts.',
      inputSchema: z.object({ selector: z.string(), metric: z.string() }).strict(),
      execute: async input => {
        calls.push('pubg_query');
        assert.deepEqual(input, { selector: 'yesterday', metric: 'damage' });
        return { status: 'partial', coverage: { complete: false }, asOf: '2026-10-14T00:00:00.000Z', facts: 'Alice 420 damage; Bob 180 damage' };
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
  assert.deepEqual(calls, ['team_info', 'pubg_query']);
  assert.match(result.text, /Alice 伤害最高/u);
  assert.equal(result.stepCount, 3);
  assert.match(JSON.stringify(model.doGenerateCalls[2]?.prompt), /Alice 420 damage/u,
    'the final model step receives the actual query-tool result');
});

test('long Agent tool chains are not cut off by the former six-step ceiling', async () => {
  const calls: number[] = [];
  const model = new MockLanguageModelV4({ doGenerate: [
    ...Array.from({ length: 18 }, (_, index) => response([
      { type: 'tool-call', toolCallId: `extended-${index}`, toolName: 'team_info', input: JSON.stringify({ id: index }) },
    ], 'tool-calls') as never),
    response([{ type: 'text', text: '我已查完需要的队员数据，再按结果整理。' }], 'stop') as never,
  ] });
  const result = await runPublicKookAgent({
    model,
    tools: {
      team_info: tool({
        description: 'Read one fixture player; team roster and stats should be batched where possible.',
        inputSchema: z.object({ id: z.number() }).strict(),
        execute: async ({ id }) => { calls.push(id); return { status: 'partial', summary: `player-${id}` }; },
      }),
    },
    messages: [{ role: 'user', content: '[成员1] 看看昨天小队战绩。' }],
    signal: new AbortController().signal,
    currentMessage: '看看昨天小队战绩。',
  });
  assert.deepEqual(calls, Array.from({ length: 18 }, (_, index) => index));
  assert.equal(result.stepCount, 19);
  assert.equal(result.recoveryCode, null);
  assert.notEqual(model.doGenerateCalls.at(-1)?.toolChoice?.type, 'none',
    'normal turns keep tools available and are not forced into a final text-only call');
});

test('a repeated identical tool call forces a no-tools summary step', async () => {
  const repeatedCall = () => response([
    { type: 'tool-call', toolCallId: 'same-query', toolName: 'pubg_query', input: JSON.stringify({ period: 'yesterday' }) },
  ], 'tool-calls') as never;
  const model = new MockLanguageModelV4({ doGenerate: [
    repeatedCall(),
    repeatedCall(),
    response([{ type: 'text', text: '昨天资料已查到，我根据刚才的结果总结。' }], 'stop') as never,
  ] });
  const result = await runPublicKookAgent({
    model,
    tools: {
      pubg_query: tool({
        description: 'Read authorized PUBG facts.',
        inputSchema: z.object({ period: z.string() }).strict(),
        execute: async () => ({ status: 'ok', summary: '昨日两场已覆盖' }),
      }),
    },
    messages: [{ role: 'user', content: '[成员1] 昨日小队战绩' }],
    signal: new AbortController().signal,
    currentMessage: '昨日小队战绩',
  });
  assert.match(result.text, /根据刚才的结果/u);
  assert.equal(model.doGenerateCalls[2]?.toolChoice?.type, 'none');
  assert.match(JSON.stringify(model.doGenerateCalls[2]?.prompt), /昨日两场已覆盖/u);
});

test('the high step safety ceiling summarizes completed tool results instead of returning a degradation message', async () => {
  let toolExecutions = 0;
  const model = new MockLanguageModelV4({ doGenerate: Array.from(
    { length: PUBLIC_KOOK_AGENT_LIMITS.maxSteps }, (_, index) => response([
      { type: 'tool-call', toolCallId: `loop-${index}`, toolName: 'team_info', input: JSON.stringify({ id: index }) },
    ], 'tool-calls') as never,
  ).concat(response([{ type: 'text', text: '已根据工具结果完成总结；仍有少数资料可能未覆盖。' }], 'stop') as never) });
  const result = await runPublicKookAgent({
    model,
    tools: {
      team_info: tool({
        description: 'Read a bounded fixture.',
        inputSchema: z.object({ id: z.number() }).strict(),
        execute: async ({ id }) => { toolExecutions += 1; return { status: 'ok', summary: `team-player-result-${id}` }; },
      }),
    },
    messages: [{ role: 'user', content: '[成员1] 查一下队伍。' }],
    signal: new AbortController().signal,
    currentMessage: '查一下队伍。',
  });
  assert.equal(toolExecutions, PUBLIC_KOOK_AGENT_LIMITS.maxSteps);
  assert.equal(result.recoveryCode, 'public_agent_step_limit');
  assert.equal(result.stepCount, PUBLIC_KOOK_AGENT_LIMITS.maxSteps + 1);
  assert.match(result.text, /工具结果完成总结/u);
  assert.equal(model.doGenerateCalls.at(-1)?.toolChoice?.type, 'none', 'only the recovery pass is text-only');
  assert.match(JSON.stringify(model.doGenerateCalls.at(-1)?.prompt), /team-player-result-127/u,
    'the recovery pass receives completed outputs from the bounded tool loop');

  const truncatedModel = new MockLanguageModelV4({ doGenerate: [response([], 'length') as never] });
  await assert.rejects(runPublicKookAgent({
    model: truncatedModel,
    tools: {},
    messages: [{ role: 'user', content: '你好' }],
    signal: new AbortController().signal,
    currentMessage: '你好',
  }), error => error instanceof Error && 'code' in error && error.code === 'public_agent_output_truncated');
});

test('a timed out Agent summarizes already completed tools within the reserved recovery window', async () => {
  let calls = 0;
  const model = new MockLanguageModelV4({ doGenerate: async () => {
    calls += 1;
    if (calls === 1) return response([
      { type: 'tool-call', toolCallId: 'timeout-result', toolName: 'pubg_query', input: JSON.stringify({ period: 'yesterday' }) },
    ], 'tool-calls') as never;
    if (calls === 2) throw Object.assign(new Error('fixture timeout'), { name: 'TimeoutError' });
    return response([{ type: 'text', text: '已收到昨日真实数据，我先按目前可用的部分回答。' }], 'stop') as never;
  } });
  const result = await runPublicKookAgent({
    model,
    tools: {
      pubg_query: tool({
        description: 'Read authorized team facts.',
        inputSchema: z.object({ period: z.string() }).strict(),
        execute: async () => ({ status: 'partial', summary: '昨天覆盖两场；队伍伤害合计 2,100。' }),
      }),
    },
    messages: [{ role: 'user', content: '[成员1] 昨日小队战绩' }],
    signal: new AbortController().signal,
    currentMessage: '昨日小队战绩',
  });
  assert.equal(result.recoveryCode, 'public_agent_timeout');
  assert.match(result.text, /按目前可用的部分回答/u);
  assert.equal(model.doGenerateCalls.at(-1)?.toolChoice?.type, 'none');
  assert.match(JSON.stringify(model.doGenerateCalls.at(-1)?.prompt), /队伍伤害合计 2,100/u,
    'timeout recovery is grounded in the tool output already obtained');
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
