import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { chmod, copyFile, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  assertAmadeusImageTransportRouteModel,
  buildAmadeusReferenceImagePayload,
  classifyImageGenerationFailure,
  IMAGE_ROUTE_AUTHORITY_PIN,
  patchImageGenerationRuntimeSource,
  patchImageGenerationToolSource,
  patchOpenAIImageProviderSource,
  resolveAmadeusImageRouteAuthority,
  shouldRetryImageGeneration,
} from './image-route-authority.mjs';
import { installCoreCompletionSource, main as installPinnedOverlay, CORE_PIN } from './core-completion.mjs';
import { COMPLETION_CAPTION_PIN, patchCompletionCaptionSource } from './completion-caption.mjs';

const repoRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const openclawRoot = await realpath(join(repoRoot, 'plugins/amadeus/node_modules/openclaw'));
const openclawDist = join(openclawRoot, 'dist');
const requireFromOpenClaw = createRequire(join(openclawRoot, 'package.json'));
const acorn = requireFromOpenClaw('acorn');
const parseModule = (source) => acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const digest = (source) => createHash('sha256').update(source).digest('hex');

test('image failures distinguish safety refusals, account locks, invalid requests and transient provider faults', () => {
  assert.equal(classifyImageGenerationFailure({ status: 400, error: { message: 'content policy violation' } }), 'safety_refusal');
  assert.equal(shouldRetryImageGeneration({ status: 400, error: { message: 'content policy violation' } }), false);
  assert.equal(classifyImageGenerationFailure('Codex did not return an image. Account may not be entitled (Plus/Pro required).'), 'account_unavailable');
  assert.equal(classifyImageGenerationFailure({ status: 400, message: 'invalid prompt' }), 'invalid_request');
  assert.equal(classifyImageGenerationFailure({ status: 502, message: 'upstream temporarily unavailable' }), 'provider_unavailable');
  assert.equal(shouldRetryImageGeneration(new Error('request timed out')), true);
});

test('cloud Combo failure returns after one three-model fallback pass', async () => {
  const source = await pinnedSource(IMAGE_ROUTE_AUTHORITY_PIN.toolModule);
  const patched = patchImageGenerationToolSource(source);
  const ast = parseModule(patched);
  const node = ast.body.find((candidate) => candidate.type === 'FunctionDeclaration' && candidate.id?.name === 'executeImageGenerationJobWithRetry');
  assert.ok(node, 'bounded retry wrapper must remain present for other routes');
  const helperSource = patched.slice(node.start, node.end);
  const run = new Function('shouldRetryImageGeneration', 'imageGenerationTaskLifecycle', `${helperSource}; return executeImageGenerationJobWithRetry;`)(
    () => true,
    { recordTaskProgress() {} },
  );
  let calls = 0;
  await assert.rejects(run({ imageRouteDiagnostic: { configuredLogicalModel: 'openai/amadeus-image' } }, async () => {
    calls += 1;
    throw new Error('request timed out');
  }), /request timed out/);
  assert.equal(calls, 1, 'the OpenAI route must not replay the whole 9Router three-model Combo');
});

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
  assert.match(patched, /executeImageGenerationJobWithRetry/);
  assert.match(patched, /Retrying image generation/);
  assert.match(patched, /queue: "process_local_microtask"/);
  assert.doesNotMatch(patched, /postMessage\(\{\s*input:.*image_generate/s);

  const bundle = installCoreCompletionSource(source, openclawRoot);
  parseModule(bundle);
  assert.match(bundle, /image_route_task_enqueued/);
  assert.match(bundle, /log\$5\.info\(JSON\.stringify\(\{ event: "image_route_task_enqueued"/);
  assert.match(bundle, /image_route_worker_model_resolved/);
  assert.match(bundle, /amadeus_image_lifecycle_boundary_unavailable/);
  assert.match(bundle, /onTimeout: async \(\) =>/);
  assert.match(bundle, /__amadeusImageCompletionFallbacks20261002/);
  assert.match(bundle, /cron continuation did not become ready before the handoff deadline/);
});

test('successful ordinary image generation keeps native task completion after one typed attachment send', async () => {
  const source = await pinnedSource(CORE_PIN.module);
  const bundle = installCoreCompletionSource(source, openclawRoot);
  const ast = parseModule(bundle);
  const node = ast.body.find((candidate) => candidate.type === 'FunctionDeclaration' && candidate.id?.name === 'wakeMediaGenerationTaskCompletion');
  assert.ok(node, 'patched native completion function must remain present');
  const nativeSource = bundle.slice(node.start, node.end);
  const completionCalls = [];
  const nativeDeliveries = [];
  const finishCalls = [];
  const previousBoundary = globalThis.__amadeusDeliveryBoundaryV2_20260930;
  globalThis.__amadeusDeliveryBoundaryV2_20260930 = {
    version: 2,
    completeImageGeneration: async (input) => { completionCalls.push(input); return { completionImages: [{ type: 'image', data: 'c2afeA==', mimeType: 'image/png' }] }; },
    finishImageGeneration: async (input) => { finishCalls.push(input); },
  };
  try {
    const wake = new Function(
      'mediaUrlsFromGeneratedAttachments',
      'formatAgentInternalEventsForPrompt',
      'buildMediaGenerationReplyInstruction',
      'deliverSubagentAnnouncement',
      'log$7',
      `return (${nativeSource});`,
    )(
      (attachments) => attachments.map((attachment) => attachment.url).filter(Boolean),
      (events) => JSON.stringify(events),
      ({ status }) => `generation ${status}`,
      async (delivery) => { nativeDeliveries.push(delivery); return { delivered: true }; },
      { warn() {}, error() {} },
    );
    const params = {
      eventSource: 'image_generation',
      toolName: 'image_generate',
      status: 'ok',
      statusLabel: 'completed successfully',
      completionLabel: 'image',
      result: 'native completion result',
      mediaUrls: ['native-media-url'],
      attachments: [{ type: 'image', url: 'generated-media-url' }],
      handle: {
        taskId: 'task-completion-1',
        runId: 'run-completion-1',
        requesterSessionKey: 'whatsapp:session',
        requesterAgentId: 'main',
        taskLabel: '生成图片',
        requesterOrigin: { channel: 'whatsapp', to: 'chat', accountId: 'secondary' },
      },
    };
    const outcome = await wake(params);
    assert.equal(completionCalls.length, 1, 'Amadeus typed completion must run once');
    assert.equal(nativeDeliveries.length, 1, 'native completion-agent continuation must run');
    assert.deepEqual(nativeDeliveries[0].images, [{ type: 'image', data: 'c2afeA==', mimeType: 'image/png' }]);
    assert.equal(nativeDeliveries[0].requireDirectDelivery, true);
    assert.equal(finishCalls.length, 0, 'a delivered native completion must not trigger fallback media');
    assert.equal(outcome.status, 'delivered');
    const event = nativeDeliveries[0].internalEvents[0];
    assert.equal(event.type, 'task_completion');
    assert.equal(event.status, 'ok');
    assert.equal(event.attachments, undefined, 'native announcement must not send the image again');
    assert.equal(event.mediaUrls, undefined, 'native announcement must not send a second media primitive');
    assert.equal(params.attachments.length, 0);
    assert.deepEqual(params.mediaUrls, []);
  } finally {
    if (previousBoundary === undefined) delete globalThis.__amadeusDeliveryBoundaryV2_20260930;
    else globalThis.__amadeusDeliveryBoundaryV2_20260930 = previousBoundary;
  }
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
    pinnedSource(IMAGE_ROUTE_AUTHORITY_PIN.openaiProviderModule).then(async (source) => {
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
      const fallbackNode = parseModule(patched).body.find((node) => node.type === 'FunctionDeclaration' && node.id?.name === 'amadeusQwenFallbackEligible');
      assert.ok(fallbackNode, 'local fallback classifier must be present in the pinned provider overlay');
      const fallbackClassifier = new Function(`${patched.slice(fallbackNode.start, fallbackNode.end)}; return amadeusQwenFallbackEligible;`)();
      const fallbackEnabledNode = parseModule(patched).body.find((node) => node.type === 'FunctionDeclaration' && node.id?.name === 'amadeusQwenFallbackEnabled');
      const fallbackEnabled = new Function('process', `${patched.slice(fallbackEnabledNode.start, fallbackEnabledNode.end)}; return amadeusQwenFallbackEnabled;`);
      assert.equal(fallbackClassifier(new Error('request timed out'), undefined), true);
      assert.equal(fallbackClassifier({ message: 'content policy violation' }, 400), false);
      assert.equal(fallbackClassifier({ message: 'invalid prompt' }, 400), false);
      assert.equal(fallbackClassifier({ message: 'request timeout' }, 400), false);
      assert.equal(fallbackClassifier({ message: 'request timeout' }, 408), true);
      assert.equal(fallbackClassifier({ message: 'quota exceeded' }, 429), true);
      assert.equal(fallbackEnabled({ env: { AMADEUS_QWEN_IMAGE_FALLBACK_ENABLED: '0' } })(), false);
      assert.equal(fallbackEnabled({ env: { AMADEUS_QWEN_IMAGE_FALLBACK_ENABLED: '1' } })(), true);
      assert.match(patched, /AMADEUS_QWEN_IMAGE_BASE_URL/);
      assert.match(patched, /AMADEUS_QWEN_IMAGE_TOKEN_FILE/);
      assert.match(patched, /AMADEUS_QWEN_IMAGE_LOCAL_ONLY/);
      assert.match(patched, /const transport = localOnly \? await requestAmadeusQwenFallback/);
      assert.match(patched, /referenceCount <= 1/);
      assert.match(patched, /amadeus_qwen_fallback_terminal/, 'local fallback failures are terminal and do not start a duplicate generation');
      assert.doesNotMatch(patched, /KREA2|krea2|wild-krea2/);

      const ast = parseModule(patched);
      const routeNode = ast.body.find((node) => node.type === 'FunctionDeclaration' && node.id?.name === 'amadeusQwenFallbackRouteAllowed');
      const requestNode = ast.body.find((node) => node.type === 'FunctionDeclaration' && node.id?.name === 'buildAmadeusQwenFallbackRequest');
      const routeAllowed = new Function('resolveOpenAIImageCount', `${patched.slice(routeNode.start, routeNode.end)}; return amadeusQwenFallbackRouteAllowed;`)((count) => count ?? 1);
      const buildRequest = new Function(`const AMADEUS_QWEN_IMAGE_MODEL = 'local/qwen-image-2.1-uncensored'; ${patched.slice(requestNode.start, requestNode.end)}; return buildAmadeusQwenFallbackRequest;`)();
      const route = { configuredLogicalModel: 'openai/amadeus-image' };
      const safeRequest = { imageRouteContext: route, provider: 'openai', model: 'amadeus-image', prompt: 'make the pot teal', count: 1 };
      assert.equal(routeAllowed(safeRequest), true);
      assert.equal(routeAllowed({ ...safeRequest, inputImages: [{}, {}] }), false);
      assert.equal(routeAllowed({ ...safeRequest, count: 2 }), false);
      const localOnlyNode = ast.body.find((node) => node.type === 'FunctionDeclaration' && node.id?.name === 'amadeusQwenLocalOnly');
      const terminalNode = ast.body.find((node) => node.type === 'FunctionDeclaration' && node.id?.name === 'amadeusQwenTerminalFailure');
      const fallbackRequestNode = ast.body.find((node) => node.type === 'FunctionDeclaration' && node.id?.name === 'requestAmadeusQwenFallback');
      const disabledFallbackRequest = new Function(
        'process', 'resolveOpenAIImageCount',
        `${patched.slice(routeNode.start, routeNode.end)}\n${patched.slice(fallbackNode.start, fallbackNode.end)}\n${patched.slice(fallbackEnabledNode.start, fallbackEnabledNode.end)}\n${patched.slice(fallbackRequestNode.start, fallbackRequestNode.end)}\nreturn requestAmadeusQwenFallback;`,
      )({ env: { AMADEUS_QWEN_IMAGE_FALLBACK_ENABLED: '0', AMADEUS_QWEN_IMAGE_TOKEN_FILE: '/missing/qwen-token' } }, (count) => count ?? 1);
      assert.equal(await disabledFallbackRequest(safeRequest, { error: new Error('request timed out'), status: 408 }), null,
        'a GPT timeout must not attempt Qwen while production fallback is disabled');
      const localOnly = new Function('process', 'resolveOpenAIImageCount', `${patched.slice(routeNode.start, routeNode.end)}\n${patched.slice(terminalNode.start, terminalNode.end)}\n${patched.slice(localOnlyNode.start, localOnlyNode.end)}\nreturn amadeusQwenLocalOnly;`)(
        { env: { AMADEUS_QWEN_IMAGE_LOCAL_ONLY: '1' } }, (count) => count ?? 1,
      );
      assert.equal(localOnly(safeRequest), true);
      assert.throws(() => localOnly({ ...safeRequest, inputImages: [{}, {}] }), (error) => error.code === 'amadeus_qwen_fallback_terminal');

      const imageBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
      const backing = Uint8Array.from([255, ...imageBytes, 255]);
      const referenceView = new Uint8Array(backing.buffer, 1, imageBytes.length);
      const edit = buildRequest({ ...safeRequest, inputImages: [{ buffer: referenceView, mimeType: 'image/png' }] }, 'qwen-token', 600000);
      assert.equal(edit.path, '/images/edits');
      assert.equal(edit.options.headers.Authorization, 'Bearer qwen-token');
      assert.equal(edit.options.headers['Content-Type'], undefined, 'fetch must set the multipart boundary');
      assert.equal(edit.options.body.get('prompt'), safeRequest.prompt);
      assert.equal(edit.options.body.get('model'), 'local/qwen-image-2.1-uncensored');
      assert.equal(edit.options.body.get('n'), '1');
      const file = edit.options.body.get('image[]');
      assert.equal(file.type, 'image/png');
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from(imageBytes));

      const generation = buildRequest(safeRequest, 'qwen-token', 600000);
      assert.equal(generation.path, '/images/generations');
      assert.deepEqual(JSON.parse(generation.options.body), {
        model: 'local/qwen-image-2.1-uncensored', prompt: safeRequest.prompt, n: 1, output_format: 'png',
      });
      assert.doesNotMatch(generation.options.body, /size/);

      const requestNames = [
        'amadeusQwenFallbackEligible', 'amadeusQwenFallbackEnabled', 'amadeusQwenFallbackRouteAllowed', 'resolveAmadeusQwenImageEndpoint',
        'readAmadeusQwenImageToken', 'buildAmadeusQwenFallbackRequest', 'amadeusQwenTerminalFailure', 'requestAmadeusQwenFallback',
      ];
      const requestSources = requestNames.map((name) => {
        const node = ast.body.find((entry) => entry.type === 'FunctionDeclaration' && entry.id?.name === name);
        assert.ok(node, `${name} must exist in the pinned provider overlay`);
        return patched.slice(node.start, node.end);
      }).join('\n');
      const withoutRuntimeLogger = requestSources.replace(
        /[ \t]*const \{ createSubsystemLogger \} = await import\("\.\/plugin-sdk\/logging-core\.js"\);\n[ \t]*const log = createSubsystemLogger\("image-generation\/openai"\);\n[ \t]*log\.info\(JSON\.stringify\(\{[^\n]*\}\)\);/u,
        'const log = { info() {} };',
      );
      assert.notEqual(withoutRuntimeLogger, requestSources, 'the isolated test replaces only the runtime logger');
      class TestAgent {
        constructor(options) { this.options = options; this.closed = false; }
        async close() { this.closed = true; }
        destroy() { this.closed = true; }
      }
      const isolatedSources = withoutRuntimeLogger.replace('await import("undici")', 'await Promise.resolve({ Agent: TestAgent, fetch: (...args) => globalThis.fetch(...args), FormData })');
      assert.notEqual(isolatedSources, withoutRuntimeLogger);
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const requestQwenFallback = await new AsyncFunction('TestAgent', `
        const AMADEUS_QWEN_IMAGE_MODEL = 'local/qwen-image-2.1-uncensored';
        function resolveOpenAIImageCount(count) { return count ?? 1; }
        ${isolatedSources}
        return requestAmadeusQwenFallback;
      `)(TestAgent);
      const tokenDirectory = await mkdtemp(join(tmpdir(), 'amadeus-qwen-token-'));
      const tokenPath = join(tokenDirectory, 'token');
      const previousBase = process.env.AMADEUS_QWEN_IMAGE_BASE_URL;
      const previousTokenPath = process.env.AMADEUS_QWEN_IMAGE_TOKEN_FILE;
      const previousFallbackEnabled = process.env.AMADEUS_QWEN_IMAGE_FALLBACK_ENABLED;
      const previousFetch = globalThis.fetch;
      const previousSignalTimeout = AbortSignal.timeout;
      const calls = [];
      const timeoutValues = [];
      try {
        await writeFile(tokenPath, 'qwen-token\n', { mode: 0o600 });
        await chmod(tokenPath, 0o600);
        process.env.AMADEUS_QWEN_IMAGE_BASE_URL = 'http://127.0.0.1:18793/v1';
        process.env.AMADEUS_QWEN_IMAGE_TOKEN_FILE = tokenPath;
        process.env.AMADEUS_QWEN_IMAGE_FALLBACK_ENABLED = '1';
        AbortSignal.timeout = (milliseconds) => {
          timeoutValues.push(milliseconds);
          return previousSignalTimeout.call(AbortSignal, milliseconds);
        };
        globalThis.fetch = async (url, options) => {
          calls.push({ url, options });
          return new Response(JSON.stringify({ created: 1, data: [{ b64_json: 'cG5n' }] }), { status: 200 });
        };
        const editResult = await requestQwenFallback(
          { ...safeRequest, timeoutMs: 120000, inputImages: [{ buffer: referenceView, mimeType: 'image/png' }] },
          { error: new Error('primary request timed out') },
        );
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, 'http://127.0.0.1:18793/v1/images/edits');
        assert.equal(calls[0].options.signal.aborted, false);
        assert.equal(timeoutValues[0], 600000, 'Qwen keeps its measured ten-minute deadline despite the 120-second primary timeout');
        assert.deepEqual(calls[0].options.dispatcher.options, { headersTimeout: 600000, bodyTimeout: 600000 });
        assert.equal(calls[0].options.body.get('prompt'), safeRequest.prompt);
        assert.deepEqual(Buffer.from(await calls[0].options.body.get('image[]').arrayBuffer()), Buffer.from(imageBytes));
        assert.equal(editResult.model, 'local/qwen-image-2.1-uncensored');
        await editResult.release();
        assert.equal(calls[0].options.dispatcher.closed, true);

        calls.length = 0;
        const generationResult = await requestQwenFallback(safeRequest, { error: new Error('upstream timeout'), status: 408 });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, 'http://127.0.0.1:18793/v1/images/generations');
        assert.deepEqual(JSON.parse(calls[0].options.body), {
          model: 'local/qwen-image-2.1-uncensored', prompt: safeRequest.prompt, n: 1, output_format: 'png',
        });
        assert.equal(generationResult.model, 'local/qwen-image-2.1-uncensored');
        await generationResult.release();

        calls.length = 0;
        const safetyResult = await requestQwenFallback(safeRequest, { error: new Error('content policy violation'), status: 400 });
        assert.equal(safetyResult, null);
        assert.equal(calls.length, 0, 'safety refusal remains terminal before local inference');

        calls.length = 0;
        globalThis.fetch = async (url, options) => {
          calls.push({ url, options });
          return new Response('unavailable', { status: 503 });
        };
        await assert.rejects(
          requestQwenFallback(safeRequest, { error: new Error('primary timeout') }),
          (error) => error.code === 'amadeus_qwen_fallback_terminal',
        );
        assert.equal(calls.length, 1, 'a failed local attempt is marked terminal and never retried locally');
      } finally {
        globalThis.fetch = previousFetch;
        AbortSignal.timeout = previousSignalTimeout;
        if (previousBase === undefined) delete process.env.AMADEUS_QWEN_IMAGE_BASE_URL;
        else process.env.AMADEUS_QWEN_IMAGE_BASE_URL = previousBase;
        if (previousTokenPath === undefined) delete process.env.AMADEUS_QWEN_IMAGE_TOKEN_FILE;
        else process.env.AMADEUS_QWEN_IMAGE_TOKEN_FILE = previousTokenPath;
        if (previousFallbackEnabled === undefined) delete process.env.AMADEUS_QWEN_IMAGE_FALLBACK_ENABLED;
        else process.env.AMADEUS_QWEN_IMAGE_FALLBACK_ENABLED = previousFallbackEnabled;
        await rm(tokenDirectory, { recursive: true, force: true });
      }
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
  const completion = patchCompletionCaptionSource(await pinnedSource(COMPLETION_CAPTION_PIN.module));
  parseModule(completion);
  assert.match(completion, /images: params\.images/);
  assert.match(completion, /expectedMedia[\s\S]*images: params\.images/);
  assert.match(completion, /AMADEUS_NATIVE_COMPLETION_CAPTION_20261002/);
});


test('pinned installer patches all OpenClaw runtime modules as a build-time unit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amadeus-image-route-'));
  try {
    await mkdir(join(root, 'dist'), { recursive: true });
    await symlink(dirname(openclawRoot), join(root, 'node_modules'), 'dir');
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '2026.9.4', name: 'openclaw-fixture' }));
    for (const name of [CORE_PIN.module, IMAGE_ROUTE_AUTHORITY_PIN.runtimeModule, IMAGE_ROUTE_AUTHORITY_PIN.openaiProviderModule, COMPLETION_CAPTION_PIN.module]) {
      await copyFile(join(openclawDist, name), join(root, 'dist', name));
    }

    await installPinnedOverlay(['--host-root', root, '--apply']);
    const tool = await readFile(join(root, 'dist', CORE_PIN.module), 'utf8');
    const runtime = await readFile(join(root, 'dist', IMAGE_ROUTE_AUTHORITY_PIN.runtimeModule), 'utf8');
    const provider = await readFile(join(root, 'dist', IMAGE_ROUTE_AUTHORITY_PIN.openaiProviderModule), 'utf8');
    const completion = await readFile(join(root, 'dist', COMPLETION_CAPTION_PIN.module), 'utf8');
    parseModule(tool);
    parseModule(runtime);
    parseModule(provider);
    parseModule(completion);
    assert.match(tool, /image_route_task_enqueued/);
    assert.match(runtime, /AMADEUS_IMAGE_ROUTE_AUTHORITY_20261001_RUNTIME/);
    assert.match(provider, /AMADEUS_IMAGE_ROUTE_AUTHORITY_20261001_OPENAI/);
    assert.match(provider, /image_route_transport_failed/);
    assert.match(completion, /AMADEUS_NATIVE_COMPLETION_CAPTION_20261002/);
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
  const end = source.indexOf('\n\t\t\ttry {\n\t\t\t\ttry {', start);
  assert.ok(start > 0 && end > start);
  const snippet = source.slice(start, end);
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  const run = new AsyncFunction('env', `const { req, model, isEdit, inputImages, postJsonRequest, postMultipartRequest, appendOpenAIImageOptions, buildAmadeusReferenceImagePayload, amadeusQwenLocalOnly, requestAmadeusQwenFallback } = env;
const isAzure=false,rawBaseUrl='http://router.invalid/v1',baseUrl=rawBaseUrl,count=1,size='1024x1536',headers={Authorization:'fixture'},timeoutMs=300000,allowPrivateNetwork=true,dispatcherPolicy=undefined;
const bufferToBlobPart=x=>x,inferImageUploadFileName=()=> 'fixture.png';
${snippet}`);
  async function capture(req, localOnly = false) {
    let call;
    const make = (kind) => async (value) => { call={ kind, ...value }; return { response: new Response('{}'), release:async()=>{} }; };
    await run({ req, model:req.model, isEdit:!!req.inputImages.length, inputImages:req.inputImages,
      postJsonRequest:make('json'),postMultipartRequest:make('multipart'),appendOpenAIImageOptions:appendOptions,buildAmadeusReferenceImagePayload,
      amadeusQwenLocalOnly:()=>localOnly,requestAmadeusQwenFallback:async()=>{ call={kind:'local'}; return {response:new Response('{}'),release:async()=>{},model:'local/qwen-image-2.1-uncensored'}; } });
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
  const local = await capture(referenceReq(), true);
  assert.equal(local.kind, 'local', 'local-only candidate must never call the primary transport');
});
