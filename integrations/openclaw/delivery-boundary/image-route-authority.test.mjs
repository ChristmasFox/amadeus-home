import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFile, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  assertAmadeusImageTransportRouteModel,
  buildAmadeusReferenceImagePayload,
  IMAGE_ROUTE_AUTHORITY_PIN,
  patchImageGenerationRuntimeSource,
  patchImageGenerationToolSource,
  patchOpenAIImageProviderSource,
  resolveAmadeusImageRouteAuthority,
} from './image-route-authority.mjs';
import { installCoreCompletionSource, main as installPinnedOverlay, CORE_PIN } from './core-completion.mjs';

const repoRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const openclawRoot = await realpath(join(repoRoot, 'plugins/amadeus/node_modules/openclaw'));
const openclawDist = join(openclawRoot, 'dist');
const requireFromOpenClaw = createRequire(join(openclawRoot, 'package.json'));
const acorn = requireFromOpenClaw('acorn');
const parseModule = (source) => acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const digest = (source) => createHash('sha256').update(source).digest('hex');

async function pinnedSource(name) {
  return await readFile(join(openclawDist, name), 'utf8');
}

test('native image route ignores a model-authored concrete backend and requires operator primary', () => {
  const resolved = resolveAmadeusImageRouteAuthority({
    configuredImageModel: { primary: 'openai/amadeus-image' },
    modelAuthoredOverride: 'openai/gpt-image-2',
  });
  assert.equal(resolved.configuredLogicalModel, 'openai/amadeus-image');
  assert.equal(resolved.modelOverride, undefined);
  assert.equal(resolved.overridePresent, true);
  assert.equal(resolved.overrideIgnored, true);

  const absent = resolveAmadeusImageRouteAuthority({ configuredImageModel: { primary: 'openai/amadeus-image' } });
  assert.equal(absent.modelOverride, undefined);
  assert.equal(absent.overridePresent, false);
  assert.equal(absent.overrideIgnored, false);

  const invalid = resolveAmadeusImageRouteAuthority({ configuredImageModel: { primary: '' }, modelAuthoredOverride: 'cx/gpt-image-2.5' });
  assert.equal(invalid.configuredLogicalModel, '', 'missing operator route is rejected by the native boundary');
  assert.equal(invalid.modelOverride, undefined);
});

test('pinned shallow hook merge sentinel is defense-in-depth, not the native authority', async () => {
  const hostSource = await pinnedSource(IMAGE_ROUTE_AUTHORITY_PIN.hookModule);
  assert.equal(digest(hostSource), IMAGE_ROUTE_AUTHORITY_PIN.hookSha256);
  assert.match(hostSource, /mergeParamsWithApprovalOverrides\(finalParams, hookResult\.params\)/);
  const hostAst = parseModule(hostSource);
  const mergeNode = hostAst.body.find((node) => node.type === 'FunctionDeclaration' && node.id?.name === 'mergeParamsWithApprovalOverrides');
  assert.ok(mergeNode, 'pinned host merge function must remain present');
  const mergeSource = hostSource.slice(mergeNode.start, mergeNode.end);
  const mergeParamsWithApprovalOverrides = new Function('isPlainObject', `${mergeSource}; return mergeParamsWithApprovalOverrides;`)(
    (value) => value !== null && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null),
  );
  const original = { model: 'openai/gpt-image-2', prompt: 'redacted fixture value' };
  assert.equal(mergeParamsWithApprovalOverrides(original, {}).model, 'openai/gpt-image-2', 'omission preserves the authored model');
  assert.equal(mergeParamsWithApprovalOverrides(original, { model: '' }).model, '', 'blank sentinel survives pinned host shallow merge');

  const source = await pinnedSource(IMAGE_ROUTE_AUTHORITY_PIN.toolModule);
  const patched = patchImageGenerationToolSource(source);
  assert.match(patched, /const model = routeAuthority\.modelOverride;/);
  assert.match(patched, /modelOverride: model,/);
  assert.match(patched, /image_route_invariant_violation/);
  const schemaStart = patched.indexOf('const ImageGenerateToolSchema = Type.Object({');
  const schemaEnd = patched.indexOf('\n});', schemaStart);
  assert.ok(schemaStart >= 0 && schemaEnd > schemaStart);
  const schema = patched.slice(schemaStart, schemaEnd);
  assert.match(schema, /model: Type.Optional\(Type.String\(\{ description: "Ignored for image generation/);
  assert.doesNotMatch(schema, /gpt-image-/);
  const descriptionLine = patched.slice(patched.indexOf('function createImageGenerateTool(options)'))
    .split('\n').find((line) => line.includes('description: "Create/edit images.'));
  assert.ok(descriptionLine);
  assert.doesNotMatch(descriptionLine, /gpt-image-/);
});

test('detached image execution captures only the authoritative route and has no serialized worker boundary', async () => {
  const source = await pinnedSource(IMAGE_ROUTE_AUTHORITY_PIN.toolModule);
  const patched = patchImageGenerationToolSource(source);
  parseModule(patched);
  assert.match(patched, /queueMicrotask\(\(\) => \{/);
  assert.match(patched, /run: \(taskHandle\) => executeImageGenerationJob\(\{/);
  assert.match(patched, /imageRouteDiagnostic: routeAuthority/);
  assert.match(patched, /model,\s*size,/);
  assert.match(patched, /modelOverrideIgnored: true/);
  assert.match(patched, /queue: "process_local_microtask"/);
  assert.doesNotMatch(patched, /postMessage\(\{\s*input:.*image_generate/s);

  const bundle = installCoreCompletionSource(source, openclawRoot);
  parseModule(bundle);
  assert.match(bundle, /image_route_task_enqueued/);
  assert.match(bundle, /log\$5\.info\(JSON\.stringify\(\{ event: "image_route_task_enqueued"/);
  assert.match(bundle, /image_route_worker_model_resolved/);
  assert.match(bundle, /amadeus_image_lifecycle_boundary_unavailable/);
});

test('final OpenAI-compatible transport accepts only configured logical model', () => {
  assert.equal(assertAmadeusImageTransportRouteModel({
    configuredLogicalModel: 'openai/amadeus-image', provider: 'openai', model: 'amadeus-image',
  }), 'openai/amadeus-image');
  assert.throws(() => assertAmadeusImageTransportRouteModel({
    configuredLogicalModel: 'openai/amadeus-image', provider: 'openai', model: 'gpt-image-2',
  }), { message: 'image_route_invariant_violation' });
  assert.throws(() => assertAmadeusImageTransportRouteModel({
    configuredLogicalModel: 'openai/amadeus-image', provider: 'cx', model: 'gpt-image-2.5',
  }), { message: 'image_route_invariant_violation' });

  return Promise.all([
    pinnedSource(IMAGE_ROUTE_AUTHORITY_PIN.runtimeModule).then((source) => {
      const patched = patchImageGenerationRuntimeSource(source);
      parseModule(patched);
      assert.match(patched, /transportLogicalModel !== routeContext\.configuredLogicalModel/);
      assert.match(patched, /logger\.info\(JSON\.stringify\(\{ event: "image_route_transport_model_resolved"/);
      assert.match(patched, /imageRouteContext: routeContext/);
    }),
    pinnedSource(IMAGE_ROUTE_AUTHORITY_PIN.openaiProviderModule).then((source) => {
      const patched = patchOpenAIImageProviderSource(source);
      parseModule(patched);
      assert.match(patched, /assertAmadeusImageTransportRouteModel\(\{ configuredLogicalModel: route\.configuredLogicalModel, provider: req\.provider, model \}\)/);
      assert.match(patched, /await assertAmadeusImageTransportRoute\(req, model\)/);
      assert.match(patched, /body\.model = model/);
      assert.match(patched, /log\.warn\(JSON\.stringify\(\{ event: "image_route_transport_failed"/);
      assert.match(patched, /image_route_transport_failed/);
      const transportFunctionStart = patched.indexOf('async generateImage(req)');
      const finalGuard = patched.indexOf('await assertAmadeusImageTransportRoute(req, model);', transportFunctionStart);
      const outboundModel = patched.indexOf('body.model = model', finalGuard);
      assert.ok(transportFunctionStart >= 0 && finalGuard > transportFunctionStart && outboundModel > finalGuard,
        'the final OpenAI-compatible model invariant must guard the outbound body model');
    }),
  ]);
});

test('no explicit model continues to use configured route, while unrelated tools remain unchanged', async () => {
  const route = resolveAmadeusImageRouteAuthority({ configuredImageModel: 'openai/amadeus-image' });
  assert.equal(route.configuredLogicalModel, 'openai/amadeus-image');
  assert.equal(route.modelOverride, undefined);

  const source = await pinnedSource(IMAGE_ROUTE_AUTHORITY_PIN.toolModule);
  const patched = patchImageGenerationToolSource(source);
  const musicStart = source.indexOf('function createMusicGenerateTool(');
  const patchedMusicStart = patched.indexOf('function createMusicGenerateTool(');
  assert.notEqual(musicStart, -1);
  assert.notEqual(patchedMusicStart, -1);
  const nextRegion = source.indexOf('//#endregion', musicStart);
  const patchedNextRegion = patched.indexOf('//#endregion', patchedMusicStart);
  assert.notEqual(nextRegion, -1);
  assert.notEqual(patchedNextRegion, -1);
  assert.equal(patched.slice(patchedMusicStart, patchedNextRegion), source.slice(musicStart, nextRegion));
  assert.match(patched, /toolName === "image_generate" && params\.imageRouteDiagnostic/);
});

test('all source overlays are pinned to exact OpenClaw 2026.9.4 modules', async () => {
  const tool = await pinnedSource(CORE_PIN.module);
  const runtime = await pinnedSource(IMAGE_ROUTE_AUTHORITY_PIN.runtimeModule);
  const provider = await pinnedSource(IMAGE_ROUTE_AUTHORITY_PIN.openaiProviderModule);
  const hook = await pinnedSource(IMAGE_ROUTE_AUTHORITY_PIN.hookModule);
  assert.equal(digest(hook), IMAGE_ROUTE_AUTHORITY_PIN.hookSha256);
  assert.equal(digest(tool), CORE_PIN.sha256);
  assert.equal(digest(runtime), IMAGE_ROUTE_AUTHORITY_PIN.runtimeSha256);
  assert.equal(digest(provider), IMAGE_ROUTE_AUTHORITY_PIN.openaiProviderSha256);
});


test('pinned installer patches all three OpenClaw runtime modules as a build-time unit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amadeus-image-route-'));
  try {
    await mkdir(join(root, 'dist'), { recursive: true });
    await symlink(dirname(openclawRoot), join(root, 'node_modules'), 'dir');
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '2026.9.4', name: 'openclaw-fixture' }));
    for (const name of [CORE_PIN.module, IMAGE_ROUTE_AUTHORITY_PIN.runtimeModule, IMAGE_ROUTE_AUTHORITY_PIN.openaiProviderModule]) {
      await copyFile(join(openclawDist, name), join(root, 'dist', name));
    }

    await installPinnedOverlay(['--host-root', root, '--apply']);
    const tool = await readFile(join(root, 'dist', CORE_PIN.module), 'utf8');
    const runtime = await readFile(join(root, 'dist', IMAGE_ROUTE_AUTHORITY_PIN.runtimeModule), 'utf8');
    const provider = await readFile(join(root, 'dist', IMAGE_ROUTE_AUTHORITY_PIN.openaiProviderModule), 'utf8');
    parseModule(tool);
    parseModule(runtime);
    parseModule(provider);
    assert.match(tool, /image_route_task_enqueued/);
    assert.match(runtime, /AMADEUS_IMAGE_ROUTE_AUTHORITY_20261001_RUNTIME/);
    assert.match(provider, /AMADEUS_IMAGE_ROUTE_AUTHORITY_20261001_OPENAI/);
    assert.match(provider, /image_route_transport_failed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


const referencePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=', 'base64');
const referenceReq = () => ({ provider: 'openai', model: 'amadeus-image',
  imageRouteContext: { configuredLogicalModel: 'openai/amadeus-image' },
  prompt: 'synthetic fixture', inputImages: [{ buffer: referencePng, mimeType: 'image/png' }],
  quality: 'high', background: 'opaque', outputFormat: 'png' });

test('single-reference payload preserves bytes/MIME and rejects silent loss', () => {
  const req = referenceReq();
  const payload = buildAmadeusReferenceImagePayload(req);
  assert.deepEqual(Buffer.from(payload.image.split(',')[1], 'base64'), referencePng);
  assert.ok(payload.image.startsWith('data:image/png;base64,'));
  assert.equal(buildAmadeusReferenceImagePayload({ ...req, inputImages: [] }), undefined);
  assert.equal(buildAmadeusReferenceImagePayload({ ...req, model: 'other' }), undefined);
  assert.throws(() => buildAmadeusReferenceImagePayload({ ...req, inputImages: [req.inputImages[0], req.inputImages[0]] }), /reference_count_unsupported/);
  assert.throws(() => buildAmadeusReferenceImagePayload({ ...req, inputImages: [{ buffer: referencePng, mimeType: 'image/jpeg' }] }), /reference_mime_unsupported/);
  assert.throws(() => buildAmadeusReferenceImagePayload({ ...req, inputImages: [{ buffer: Buffer.alloc(10*1024*1024+1), mimeType: 'image/png' }] }), /reference_size_unsupported/);
});

test('exact patched HTTP construction sends reference JSON to generations, ordinary edits remain multipart', async () => {
  const source = patchOpenAIImageProviderSource(await pinnedSource(IMAGE_ROUTE_AUTHORITY_PIN.openaiProviderModule));
  const ast = parseModule(source);
  const functionSource = (name) => { const node = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === name); assert.ok(node); return source.slice(node.start, node.end); };
  const appendOptions = new Function(`${functionSource('resolveOpenAIImageOutputCompression')}\n${functionSource('appendOpenAIImageOptions')}\nreturn appendOpenAIImageOptions;`)();
  const start = source.indexOf('const amadeusReferencePayload = buildAmadeusReferenceImagePayload(req);');
  const end = source.indexOf('\n\t\t\ttry {', start);
  assert.ok(start > 0 && end > start);
  const snippet = source.slice(start, end);
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  const run = new AsyncFunction('env', `const { req, model, isEdit, inputImages, postJsonRequest, postMultipartRequest, appendOpenAIImageOptions, buildAmadeusReferenceImagePayload } = env;
const isAzure=false,rawBaseUrl='http://router.invalid/v1',baseUrl=rawBaseUrl,count=1,size='1024x1536',headers={Authorization:'fixture'},timeoutMs=300000,allowPrivateNetwork=true,dispatcherPolicy=undefined;
const bufferToBlobPart=x=>x,inferImageUploadFileName=()=> 'fixture.png';
${snippet}`);
  async function capture(req) {
    let call;
    const make = (kind) => async (value) => { call={ kind, ...value }; return { response: new Response('{}'), release:async()=>{} }; };
    await run({ req, model:req.model, isEdit:!!req.inputImages.length, inputImages:req.inputImages,
      postJsonRequest:make('json'),postMultipartRequest:make('multipart'),appendOpenAIImageOptions:appendOptions,buildAmadeusReferenceImagePayload });
    return call;
  }
  const ref = await capture(referenceReq());
  assert.equal(ref.url, 'http://router.invalid/v1/images/generations');
  assert.equal(ref.kind, 'json');
  assert.equal(ref.body.model, 'amadeus-image');
  assert.equal(ref.body.output_format, 'png');
  assert.equal(ref.body.quality, 'high');
  assert.equal(ref.body.background, 'opaque');
  assert.deepEqual(Buffer.from(ref.body.image.split(',')[1], 'base64'), referencePng);
  const plain = await capture({ ...referenceReq(),inputImages:[] });
  assert.equal(plain.url, ref.url); assert.equal(plain.body.image, undefined);
  const other = await capture({ ...referenceReq(),model:'other',imageRouteContext:undefined });
  assert.equal(other.kind, 'multipart'); assert.equal(other.url, 'http://router.invalid/v1/images/edits');
  assert.equal(other.body.get('model'), 'other');
  assert.deepEqual(Buffer.from(await other.body.get('image[]').arrayBuffer()),referencePng);
});
