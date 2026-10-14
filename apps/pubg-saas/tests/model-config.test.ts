import assert from 'node:assert/strict';
import test from 'node:test';
import { readPublicModelConfig } from '../src/infrastructure/ai/model-config.js';
import { createPublicModelFetch } from '../src/infrastructure/ai/model-fetch.js';
import { createPublicQueryPlanner } from '../src/infrastructure/ai/public-model.js';

test('public AI model configuration is optional only when every field is absent', () => {
  assert.equal(readPublicModelConfig({}), null);
  assert.equal(readPublicModelConfig({ MODEL_BASE_URL: ' ', MODEL_ID: '', MODEL_API_KEY: '' }), null);
});

test('partial configuration fails closed without echoing secret values', () => {
  assert.throws(
    () => readPublicModelConfig({ MODEL_BASE_URL: 'https://models.example/v1', MODEL_API_KEY: 'never-log-this' }),
    error => error instanceof Error && error.message === 'pubg_saas_model_config_incomplete'
      && !error.message.includes('never-log-this'),
  );
});

test('accepts a complete OpenAI-compatible endpoint without URL credentials or query secrets', () => {
  assert.deepEqual(readPublicModelConfig({
    MODEL_BASE_URL: 'https://models.example/v1', MODEL_ID: 'saas-combo', MODEL_API_KEY: 'inference-only-key',
  }), {
    baseURL: 'https://models.example/v1', modelId: 'saas-combo', apiKey: 'inference-only-key',
    allowedInternalHosts: [],
  });
  assert.deepEqual(readPublicModelConfig({
    MODEL_BASE_URL: 'http://9router:20128/v1', MODEL_ID: 'local-test', MODEL_API_KEY: 'fixture-key',
    MODEL_ALLOWED_INTERNAL_HOSTS: '9router:20128',
  }), {
    baseURL: 'http://9router:20128/v1', modelId: 'local-test', apiKey: 'fixture-key',
    allowedInternalHosts: ['9router:20128'],
  });
});

test('rejects insecure remote URLs and credential-bearing endpoint URLs', () => {
  for (const baseURL of [
    'http://models.example/v1',
    'http://127.0.0.1:8080/v1',
    'http://10.0.0.2:20128/v1',
    'http://9router:20129/v1',
    'http://9router.example:20128/v1',
    'https://user:pass@models.example/v1',
    'https://models.example/v1?key=secret',
  ]) {
    assert.throws(() => readPublicModelConfig({
      MODEL_BASE_URL: baseURL, MODEL_ID: 'saas-combo', MODEL_API_KEY: 'fixture-key',
      MODEL_ALLOWED_INTERNAL_HOSTS: '9router:20128',
    }), { message: 'pubg_saas_model_config_invalid' });
  }
});

test('rejects malformed internal host allowlists', () => {
  for (const allowedHosts of ['9router:*', '9router:0', '9router:65536', '10.0.0.2:20128', '9router:20128,', '9router:20128,9Router:20128']) {
    assert.throws(() => readPublicModelConfig({
      MODEL_BASE_URL: 'http://9router:20128/v1', MODEL_ID: 'saas-combo', MODEL_API_KEY: 'fixture-key',
      MODEL_ALLOWED_INTERNAL_HOSTS: allowedHosts,
    }), { message: 'pubg_saas_model_config_invalid' });
  }
});

test('only the exact allowlisted model authority bypasses the egress proxy', async () => {
  const directAgent = new (await import('undici')).Agent();
  const directCalls: Array<{ input: string; redirect: RequestRedirect | undefined; dispatcher: unknown }> = [];
  const proxiedCalls: string[] = [];
  const modelFetch = createPublicModelFetch(['9router:20128'], {
    dispatcher: directAgent,
    directFetch: async (input, init, dispatcher) => {
      directCalls.push({ input: String(input), redirect: init?.redirect, dispatcher });
      return new Response('direct');
    },
    proxiedFetch: async input => {
      proxiedCalls.push(String(input));
      return new Response('proxied');
    },
  });

  try {
    assert.equal(await (await modelFetch('http://9router:20128/v1/chat/completions')).text(), 'direct');
    assert.equal(await (await modelFetch('http://10.0.0.2:20128/v1')).text(), 'proxied');
    assert.equal(await (await modelFetch('http://9router.evil:20128/v1')).text(), 'proxied');
    assert.equal(directCalls.length, 1);
    assert.equal(directCalls[0]?.redirect, 'error');
    assert.equal(directCalls[0]?.dispatcher, directAgent);
    assert.deepEqual(proxiedCalls, [
      'http://10.0.0.2:20128/v1',
      'http://9router.evil:20128/v1',
    ]);
  } finally {
    await directAgent.close();
  }
});

test('constructs the public AI SDK model without issuing a provider request', () => {
  const result = createPublicQueryPlanner({
    MODEL_BASE_URL: 'https://models.example/v1', MODEL_ID: 'saas-combo', MODEL_API_KEY: 'fixture-only-key',
  });
  assert.ok(result);
  assert.equal(result.provider, 'saas-combo');
  assert.equal(result.modelId, 'saas-combo');
  assert.equal(typeof result.planner.plan, 'function');
});

test('sends explicit non-streaming requests through the public query planner', async () => {
  let requestedStream: unknown;
  const originalFetch = globalThis.fetch;
  const plan = {
    version: 1,
    intent: 'team_stats',
    subject: 'team',
    playerName: null,
    actorName: null,
    victimName: null,
    metric: 'kills',
    period: 'today',
    comparePeriod: null,
    matchCount: null,
    needsClarification: false,
  };
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { stream?: unknown };
    requestedStream = body.stream;
    return new Response(JSON.stringify({
      id: 'chatcmpl-fixture',
      object: 'chat.completion',
      created: 1,
      model: 'saas-combo',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call-query-plan',
            type: 'function',
            function: { name: 'submit_query_plan', arguments: JSON.stringify(plan) },
          }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 },
    }), { headers: { 'content-type': 'application/json' } });
  };

  try {
    const configured = createPublicQueryPlanner({
      MODEL_BASE_URL: 'https://models.example/v1', MODEL_ID: 'saas-combo', MODEL_API_KEY: 'fixture-only-key',
    });
    assert.ok(configured);

    const result = await configured.planner.plan({ authorizationContext: {}, message: '今天队伍击杀' });

    assert.equal(requestedStream, false);
    assert.equal(result.source, 'model');
    assert.equal(result.failure, null);
    assert.equal(result.plan.intent, 'team_stats');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
