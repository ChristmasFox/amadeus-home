import assert from 'node:assert/strict';
import test from 'node:test';
import { readPublicModelConfig } from '../src/infrastructure/ai/model-config.js';
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
  });
  assert.deepEqual(readPublicModelConfig({
    MODEL_BASE_URL: 'http://127.0.0.1:8080/v1', MODEL_ID: 'local-test', MODEL_API_KEY: 'fixture-key',
  })?.modelId, 'local-test');
});

test('rejects insecure remote URLs and credential-bearing endpoint URLs', () => {
  for (const baseURL of [
    'http://models.example/v1',
    'https://user:pass@models.example/v1',
    'https://models.example/v1?key=secret',
  ]) {
    assert.throws(() => readPublicModelConfig({
      MODEL_BASE_URL: baseURL, MODEL_ID: 'saas-combo', MODEL_API_KEY: 'fixture-key',
    }), { message: 'pubg_saas_model_config_invalid' });
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
