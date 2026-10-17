import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createResearchModel } from '../src/server/model.js';

test('research model loads an owner-only external 9Router config and honors explicit environment overrides', () => {
  const root = mkdtempSync(join(tmpdir(), 'pubg-intelligence-model-config-'));
  const configDirectory = join(root, 'config');
  mkdirSync(configDirectory, { mode: 0o700 });
  chmodSync(configDirectory, 0o700);
  const configPath = join(configDirectory, 'router.json');
  writeFileSync(configPath, JSON.stringify({ baseURL: 'http://127.0.0.1:20128/v1', apiKey: 'test-key-not-real', modelId: 'arthur-combo' }), { mode: 0o600 });
  try {
    const model = createResearchModel({ PUBG_INTELLIGENCE_AI_CONFIG_FILE: configPath });
    assert.ok(model);
    assert.equal(model.modelId, 'arthur-combo');
    const overridden = createResearchModel({
      PUBG_INTELLIGENCE_AI_CONFIG_FILE: configPath,
      PUBG_INTELLIGENCE_AI_BASE_URL: 'http://127.0.0.1:20129/v1',
      PUBG_INTELLIGENCE_AI_API_KEY: 'override-key-not-real',
      PUBG_INTELLIGENCE_AI_MODEL: 'google/gemini-2.5-flash',
    });
    assert.ok(overridden);
    assert.equal(overridden.modelId, 'google/gemini-2.5-flash');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('research model fails closed for missing, unsafe-permission, or invalid external configs', () => {
  const root = mkdtempSync(join(tmpdir(), 'pubg-intelligence-model-invalid-'));
  const configDirectory = join(root, 'config');
  mkdirSync(configDirectory, { mode: 0o700 });
  chmodSync(configDirectory, 0o700);
  const configPath = join(configDirectory, 'router.json');
  try {
    assert.equal(createResearchModel({ PUBG_INTELLIGENCE_AI_CONFIG_FILE: join(root, 'missing.json') }), undefined);
    writeFileSync(configPath, JSON.stringify({ baseURL: 'http://127.0.0.1:20128/v1', apiKey: 'test-key-not-real', modelId: 'arthur-combo' }), { mode: 0o644 });
    chmodSync(configPath, 0o644);
    assert.equal(createResearchModel({ PUBG_INTELLIGENCE_AI_CONFIG_FILE: configPath }), undefined);
    writeFileSync(configPath, JSON.stringify({ baseURL: 'file:///tmp/x', apiKey: 'test-key-not-real' }), { mode: 0o600 });
    chmodSync(configPath, 0o600);
    assert.equal(createResearchModel({ PUBG_INTELLIGENCE_AI_CONFIG_FILE: configPath }), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
