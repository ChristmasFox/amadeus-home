import test from 'node:test';
import assert from 'node:assert/strict';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { clearImageGenerationModelOverride, normalizeAmadeusImageGeometry, registerImageGenerationToolPolicy } from '../src/image-generation-policy.js';

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

test('Amadeus geometry maps unsupported aspect/resolution controls to bounded supported sizes', () => {
  assert.deepEqual(normalizeAmadeusImageGeometry({ aspectRatio: '9:19.5', resolution: '2K' }), {
    size: '1024x1536', aspectRatio: '', resolution: '',
  });
  assert.deepEqual(normalizeAmadeusImageGeometry({ aspectRatio: '9:19.5', resolution: '4K' }), {
    size: '2160x3840', aspectRatio: '', resolution: '',
  });
  assert.equal(normalizeAmadeusImageGeometry({ aspectRatio: 'invalid', resolution: '2K' }), undefined);
  assert.equal(normalizeAmadeusImageGeometry({ aspectRatio: '1:1', resolution: '12K' }), undefined);
});

test('image provider/model discovery and task status actions retain their explicit model parameter', () => {
  const model = 'openai/gpt-image-2';
  assert.equal(clearImageGenerationModelOverride({ action: 'list', model }), undefined);
  assert.equal(clearImageGenerationModelOverride({ action: 'status', model }), undefined);
  assert.equal(clearImageGenerationModelOverride({ action: 'generate', prompt: 'no override' }), undefined);
});

test('native before_tool_call registration reports safe routing facts and rewrites only image_generate', () => {
  let registered: ((event: any) => unknown) | undefined;
  let matcher: unknown;
  const warnings: string[] = [];
  const diagnostics: string[] = [];
  const api = {
    on(name: string, handler: (event: any) => unknown, options?: { matcher?: string[] }) {
      assert.equal(name, 'before_tool_call');
      registered = handler;
      matcher = options?.matcher;
    },
    config: { agents: { defaults: { mediaModels: { image: { primary: 'openai/amadeus-image' } } } } },
    logger: {
      warn(message: string) { warnings.push(message); },
      info(message: string) { diagnostics.push(message); },
    },
  } as unknown as OpenClawPluginApi;
  registerImageGenerationToolPolicy(api);
  assert.deepEqual(matcher, ['image_generate']);
  const rewritten = registered?.({
    toolName: 'image_generate',
    runId: 'run-safe-id',
    toolCallId: 'tool-safe-id',
    params: { model: 'openai/gpt-image-2', prompt: 'redacted fixture value' },
  });
  assert.deepEqual(rewritten, { params: { model: '', prompt: 'redacted fixture value' } });
  assert.equal(warnings.length, 1);
  const event = JSON.parse(diagnostics[0] ?? '{}');
  assert.deepEqual(event, {
    event: 'image_route_tool_override_observed',
    runId: 'run-safe-id',
    toolCallId: 'tool-safe-id',
    overridePresent: true,
    overrideIgnored: true,
    configuredLogicalModel: 'openai/amadeus-image',
  });
  assert.equal(diagnostics[0]?.includes('redacted fixture value'), false, 'routing diagnostics must never include prompts');
  assert.equal(registered?.({ toolName: 'other_tool', params: { model: 'keep' } }), undefined);
});
