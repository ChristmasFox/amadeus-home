import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { createImageCaptionEnricher, IMAGE_CAPTION_FALLBACK, normalizeImageCaption } from '../src/image-caption.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'amadeus-caption-'));
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  const filePath = join(root, 'persisted-generated.png'); await writeFile(filePath, Buffer.from('actual image bytes'));
  await writeFile(join(workspace, 'SOUL.md'), 'Kurisu is sharp, reliable, and lightly teasing when appropriate.');
  const api = { config: {}, logger:{info(){}}, runtime: { agent: { resolveAgentDir: () => root, resolveAgentWorkspaceDir: () => workspace } } } as unknown as OpenClawPluginApi;
  return { root, workspace, filePath, api };
}

test('caption enrichment sees the registered generated image and bounded request with Kurisu persona', async () => {
  const f = await fixture(); let args: any;
  try {
    const enrich = createImageCaptionEnricher(f.api, (async (input: any) => { args = input; return { text:'海辺で風に髪をなびかせてるわね。' }; }) as any);
    const result = await enrich({ taskId:'00000000-0000-4000-8000-000000000001', filePath:f.filePath, mimeType:'image/png', agentId:'main', sessionKey:'session', channel:'whatsapp', requestContext:'a'.repeat(900) });
    assert.deepEqual(result, { caption:'海辺で風に髪をなびかせてるわね。' });
    assert.equal(args.filePath, f.filePath); assert.equal(args.mime, 'image/png');
    assert.ok(args.prompt.includes('Kurisu is sharp'));
    assert.ok(args.prompt.includes('fixed word-count target'));
    assert.ok(args.prompt.includes('Let Kurisu choose her wording and natural length'));
    assert.ok(args.prompt.length < 8_000); assert.ok(!args.prompt.includes('a'.repeat(900)));
    assert.equal(args.timeoutMs, 7_000);
  } finally { await rm(f.root, { recursive:true, force:true }); }
});

test('caption timeout uses deterministic fallback without a second model', async () => {
  const f = await fixture(); let calls=0;
  try {
    const enrich = createImageCaptionEnricher(f.api, (async () => { calls++; return await new Promise(() => {}); }) as any, { timeoutMs:10, modelTimeoutMs:5 });
    const result = await enrich({ taskId:'00000000-0000-4000-8000-000000000001', filePath:f.filePath, mimeType:'image/png', agentId:'main', sessionKey:'session', channel:'telegram' });
    assert.equal(calls, 1); assert.deepEqual(result, { caption:IMAGE_CAPTION_FALLBACK });
  } finally { await rm(f.root, { recursive:true, force:true }); }
});

test('caption model error and malformed JSON never leak raw output', async () => {
  const f = await fixture();
  try {
    const failed = createImageCaptionEnricher(f.api, (async () => { throw new Error('secret/provider payload'); }) as any);
    assert.deepEqual(await failed({ taskId:'00000000-0000-4000-8000-000000000001',filePath:f.filePath,mimeType:'image/png',agentId:'main',sessionKey:'s',channel:'whatsapp' }), { caption:IMAGE_CAPTION_FALLBACK });
    const malformed = createImageCaptionEnricher(f.api, (async () => ({ text:'{"caption":"raw protocol secret"}' })) as any);
    const result = await malformed({ taskId:'00000000-0000-4000-8000-000000000001',filePath:f.filePath,mimeType:'image/png',agentId:'main',sessionKey:'s',channel:'whatsapp' });
    assert.deepEqual(result, { caption:IMAGE_CAPTION_FALLBACK });
    assert.equal(JSON.stringify(result).includes('raw protocol secret'), false);
  } finally { await rm(f.root, { recursive:true, force:true }); }
});

test('caption validator rejects raw protocol and accepts bounded normalized plain text', () => {
  assert.equal(normalizeImageCaption('{"caption":"leak"}'), undefined);
  assert.equal(normalizeImageCaption('```json\n{"caption":"leak"}\n```'), undefined);
  assert.equal(normalizeImageCaption('  One\r\n short caption. '), 'One short caption.');
});
