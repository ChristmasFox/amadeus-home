import test from 'node:test';
import assert from 'node:assert/strict';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { clearImageGenerationModelOverride, registerImageGenerationToolPolicy } from '../src/image-generation-policy.js';

test('image generation clears model-authored overrides while preserving other options', () => {
  const params = {
    action: 'generate',
    model: 'openai/gpt-image-2',
    prompt: 'a test image prompt',
    aspectRatio: '9:19.5',
    resolution: '2K',
    quality: 'high',
  };
  const rewritten = clearImageGenerationModelOverride(params);
  assert.deepEqual(rewritten, {
    action: 'generate', model: '', prompt: 'a test image prompt', aspectRatio: '9:19.5', resolution: '2K', quality: 'high',
  });
  assert.equal({ ...params, ...rewritten }.model, '', 'empty override survives OpenClaw 2026.9.4 merge semantics');
  assert.deepEqual(params, {
    action: 'generate', model: 'openai/gpt-image-2', prompt: 'a test image prompt', aspectRatio: '9:19.5', resolution: '2K', quality: 'high',
  }, 'the hook rewrites a copy and does not mutate the host event');
});

test('image provider/model discovery and task status actions retain their explicit model parameter', () => {
  const model = 'openai/gpt-image-2';
  assert.equal(clearImageGenerationModelOverride({ action: 'list', model }), undefined);
  assert.equal(clearImageGenerationModelOverride({ action: 'status', model }), undefined);
  assert.equal(clearImageGenerationModelOverride({ action: 'generate', prompt: 'no override' }), undefined);
});

test('native before_tool_call registration rewrites only image_generate', () => {
  let registered: ((event: any) => unknown) | undefined;
  let matcher: unknown;
  const warnings: string[] = [];
  const api = {
    on(name: string, handler: (event: any) => unknown, options?: { matcher?: string[] }) {
      assert.equal(name, 'before_tool_call');
      registered = handler;
      matcher = options?.matcher;
    },
    logger: { warn(message: string) { warnings.push(message); } },
  } as unknown as OpenClawPluginApi;
  registerImageGenerationToolPolicy(api);
  assert.deepEqual(matcher, ['image_generate']);
  const rewritten = registered?.({ toolName: 'image_generate', params: { model: 'openai/gpt-image-2', prompt: 'safe' } });
  assert.deepEqual(rewritten, { params: { model: '', prompt: 'safe' } });
  assert.equal(warnings.length, 1);
  assert.equal(registered?.({ toolName: 'other_tool', params: { model: 'keep' } }), undefined);
});
