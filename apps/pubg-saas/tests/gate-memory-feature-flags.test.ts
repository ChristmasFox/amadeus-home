import assert from 'node:assert/strict';
import test from 'node:test';
import { gateMemoryEmbeddingStatus, readGateMemoryFeatureFlags } from '../src/application/gate-memory-feature-flags.js';
import { readGateMemoryEmbeddingConfig } from '../src/infrastructure/ai/gate-memory-embedding-config.js';

function env(values: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...values };
}

test('Gate memory reads, writes and auto-learning default on; embeddings capability-detect config', () => {
  assert.deepEqual(readGateMemoryFeatureFlags(env()), {
    read: { enabled: true, status: 'enabled_default' },
    write: { enabled: true, status: 'enabled_default' },
    autoLearn: { enabled: true, status: 'enabled_default' },
  });
  assert.equal(gateMemoryEmbeddingStatus(env(), readGateMemoryEmbeddingConfig), 'disabled_unconfigured');
});

test('operator flags are independent kill switches', () => {
  const flags = readGateMemoryFeatureFlags(env({
    GATE_MEMORY_READ_ENABLED: '1', GATE_MEMORY_WRITE_ENABLED: '0',
    GATE_MEMORY_AUTO_LEARN_ENABLED: '1',
  }));
  assert.equal(flags.read.status, 'enabled_by_operator');
  assert.equal(flags.write.status, 'disabled_by_operator');
  assert.deepEqual(flags.autoLearn, { enabled: true, status: 'enabled_by_operator' });
});

test('invalid operator and embedding configuration reports misconfigured and fails closed', () => {
  const flags = readGateMemoryFeatureFlags(env({
    GATE_MEMORY_READ_ENABLED: 'true', GATE_MEMORY_WRITE_ENABLED: 'yes', GATE_MEMORY_AUTO_LEARN_ENABLED: '2',
  }));
  assert.deepEqual([flags.read.status, flags.write.status, flags.autoLearn.status], [
    'misconfigured', 'misconfigured', 'misconfigured',
  ]);
  assert.equal(flags.read.enabled || flags.write.enabled || flags.autoLearn.enabled, false);
  assert.equal(gateMemoryEmbeddingStatus(env({ GATE_MEMORY_EMBEDDING_ENABLED: '1' }),
    readGateMemoryEmbeddingConfig), 'misconfigured');
  assert.equal(gateMemoryEmbeddingStatus(env({ GATE_MEMORY_EMBEDDING_ENABLED: 'yes' }),
    readGateMemoryEmbeddingConfig), 'misconfigured');
  assert.throws(() => readGateMemoryEmbeddingConfig(env({ GATE_MEMORY_EMBEDDING_ENABLED: 'yes' })),
    /gate_memory_embedding_config_invalid/u);
});

test('a complete embedding contract reports configured without returning secret values', () => {
  const config = env({
    GATE_MEMORY_EMBEDDING_BASE_URL: 'https://embedding.example.test/v1',
    GATE_MEMORY_EMBEDDING_MODEL_ID: 'fixture-memory-v1',
    GATE_MEMORY_EMBEDDING_API_KEY: 'fixture-only-key',
    GATE_MEMORY_EMBEDDING_DAILY_TOKEN_BUDGET: '1000',
  });
  assert.equal(gateMemoryEmbeddingStatus(config, readGateMemoryEmbeddingConfig), 'enabled_configured');
  assert.equal(gateMemoryEmbeddingStatus({ ...config, GATE_MEMORY_EMBEDDING_ENABLED: '0' },
    readGateMemoryEmbeddingConfig), 'disabled_by_operator');
});
