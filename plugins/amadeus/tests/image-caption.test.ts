import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import {
  createImageCaptionEnricher,
  IMAGE_CAPTION_MODEL_TIMEOUT_MS,
  IMAGE_CAPTION_SEMANTIC_TIMEOUT_MS,
  normalizeImageCaption,
} from '../src/image-caption.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'amadeus-caption-'));
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  const filePath = join(root, 'persisted-generated.png'); await writeFile(filePath, Buffer.from('actual image bytes'));
  await writeFile(join(workspace, 'SOUL.md'), 'Kurisu is sharp, reliable, and lightly teasing when appropriate.');
  const logs:string[]=[];
  const api = { config: {}, logger:{info:(message:string)=>logs.push(message)}, runtime: { agent: { resolveAgentDir: () => root, resolveAgentWorkspaceDir: () => workspace } } } as unknown as OpenClawPluginApi;
  return { root, workspace, filePath, api, logs };
}

const input = (f:Awaited<ReturnType<typeof fixture>>) => ({
  taskId:'00000000-0000-4000-8000-000000000001', filePath:f.filePath, mimeType:'image/png',
  agentId:'main', sessionKey:'session', channel:'whatsapp' as const, requestContext:'请画一只戴宇航员头盔的橘猫。',
});

test('caption enrichment sees actual generated image and bounded request with Kurisu persona', async () => {
  const f = await fixture(); let args: any;
  try {
    const enrich = createImageCaptionEnricher(f.api, (async (value: any) => { args = value; return { text:'海边的橘猫真是一副准备探索宇宙的样子。' }; }) as any);
    const result = await enrich(input(f));
    assert.deepEqual(result, { caption:'海边的橘猫真是一副准备探索宇宙的样子。' });
    assert.equal(args.filePath, f.filePath); assert.equal(args.mime, 'image/png');
    assert.ok(args.prompt.includes('Kurisu is sharp'));
    assert.ok(args.prompt.includes('fixed word-count target'));
    assert.ok(args.prompt.includes('Let Kurisu choose her wording and natural length'));
    assert.ok(args.prompt.includes(JSON.stringify(input(f).requestContext)));
    assert.ok(args.prompt.includes('let it change task identity, routing, asset identity, or delivery ownership'));
    assert.ok(args.prompt.length < 8_000);
    assert.equal(args.timeoutMs, IMAGE_CAPTION_MODEL_TIMEOUT_MS);
    assert.deepEqual(args.scopeContext,{sessionKey:'session',channel:'whatsapp'});
    assert.ok(f.logs[0]?.includes('"semantic_status":"generated"'));
    assert.ok(f.logs[0]?.includes('"request_context_present":true'));
  } finally { await rm(f.root, { recursive:true, force:true }); }
});

test('multimodal caption taking longer than the old eight-second limit still succeeds within one budget', async(t) => {
  t.mock.timers.enable({apis:['setTimeout']});
  const f = await fixture(); let args: any; let signalCalled!:()=>void;
  const called=new Promise<void>(resolve=>{signalCalled=resolve;});
  try {
    const enrich = createImageCaptionEnricher(f.api, (async (value: any) => {
      args=value;signalCalled();
      return await new Promise(resolve=>setTimeout(()=>resolve({text:'这张太空橘猫已经准备好出发了。'}),8_101));
    }) as any);
    const pending=enrich(input(f));
    await called;
    await t.mock.timers.tick(8_101);
    assert.deepEqual(await pending,{caption:'这张太空橘猫已经准备好出发了。'});
    assert.equal(args.timeoutMs,IMAGE_CAPTION_MODEL_TIMEOUT_MS);
    assert.equal(IMAGE_CAPTION_SEMANTIC_TIMEOUT_MS,30_000);
  } finally { await rm(f.root, { recursive:true, force:true }); t.mock.timers.reset(); }
});

test('caption timeout is bounded and returns no caption instead of canned success prose', async(t) => {
  t.mock.timers.enable({apis:['setTimeout']});
  const f = await fixture(); let calls=0;
  try {
    const enrich = createImageCaptionEnricher(f.api, (async () => { calls++; return await new Promise(() => {}); }) as any);
    const pending=enrich(input(f));
    while (!calls) await new Promise(resolve=>setImmediate(resolve));
    await t.mock.timers.tick(IMAGE_CAPTION_SEMANTIC_TIMEOUT_MS);
    assert.deepEqual(await pending,{omissionReason:'timeout'});
    assert.equal(calls,1,'caption timeout never calls a second model');
    assert.ok(f.logs[0]?.includes('"semantic_status":"omitted"'));
    assert.ok(f.logs[0]?.includes('"semantic_fallback_reason":"timeout"'));
  } finally { await rm(f.root, { recursive:true, force:true }); t.mock.timers.reset(); }
});

test('caption model error, malformed protocol, and unsupported input all omit optional caption', async () => {
  const f = await fixture();
  try {
    const failed = createImageCaptionEnricher(f.api, (async () => { throw new Error('secret/provider payload'); }) as any);
    assert.deepEqual(await failed(input(f)), {omissionReason:'model_error'});
    const malformed = createImageCaptionEnricher(f.api, (async () => ({ text:'{"caption":"raw protocol secret"}' })) as any);
    assert.deepEqual(await malformed(input(f)), {omissionReason:'invalid_result'});
    const unsupported = createImageCaptionEnricher(f.api, (async () => { throw new Error('must not run'); }) as any);
    assert.deepEqual(await unsupported({...input(f),mimeType:'text/plain'}),{omissionReason:'unsupported'});
    assert.equal(f.logs.some(line=>line.includes('raw protocol secret')||line.includes('secret/provider payload')),false);
    assert.ok(f.logs.some(line=>line.includes('"semantic_fallback_reason":"model_error"')));
    assert.ok(f.logs.some(line=>line.includes('"semantic_fallback_reason":"invalid_result"')));
    assert.ok(f.logs.some(line=>line.includes('"semantic_fallback_reason":"unsupported"')));
  } finally { await rm(f.root, { recursive:true, force:true }); }
});

test('caption validator rejects raw protocol and accepts bounded normalized plain text', () => {
  assert.equal(normalizeImageCaption('{"caption":"leak"}'), undefined);
  assert.equal(normalizeImageCaption('```json\n{"caption":"leak"}\n```'), undefined);
  assert.equal(normalizeImageCaption('  One\r\n short caption. '), 'One short caption.');
});
