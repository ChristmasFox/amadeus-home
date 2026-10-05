import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, chmod, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const IMAGE_ROUTE_AUTHORITY_PIN = Object.freeze({
  version: '2026.9.4',
  toolModule: 'openclaw-tools-Bo9W_tg_.mjs',
  toolSha256: 'f8d27b259dbb9bc4ffd491c3e756004d35433974653e488682fc8369080e4124',
  hookModule: 'agent-tools.before-tool-call-WtmCO7BO.mjs',
  hookSha256: '809c4545e65460961c9cb3e43fcfa506a4829c1a0f6c83889b689ff266903274',
  runtimeModule: 'runtime-DlMtF4kc.mjs',
  runtimeSha256: '026404feba781c4a3d0a2fec90ba7627999c5b5aceca844c0bea298836011ffc',
  openaiProviderModule: 'image-generation-provider-Dq32DoC6.mjs',
  openaiProviderSha256: 'cd6adbb0c868fbf896d09779b6101157b64418b4613e649bb4ef8510afa9fb15',
});

export const IMAGE_ROUTE_AUTHORITY_MARKER = 'AMADEUS_IMAGE_ROUTE_AUTHORITY_20261001';

export function failureText(value) {
  if (value instanceof Error) return `${value.name} ${value.message}`;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value && typeof value === 'object') {
    const entries = [value.name, value.message, value.code, value.status,
      value.error?.name, value.error?.message, value.error?.code, value.error?.status,
      value.body, value.response?.status, value.response?.data?.error?.message];
    return entries.filter((entry) => typeof entry === 'string' || typeof entry === 'number').join(' ');
  }
  return String(value ?? '');
}

/** Classifies provider failures without exposing raw upstream payloads to users. */
export function classifyImageGenerationFailure(value) {
  const text = failureText(value).toLowerCase();
  if (/(?:safety|moderation|content\s+policy|policy\s+(?:violation|refusal)|prompt\s+(?:blocked|rejected)|unsafe|disallowed|prohibited|responsible\s+ai|violat\w*\s+(?:guideline|policy)|copyright\s+restriction)/u.test(text)) return 'safety_refusal';
  if (/(?:not\s+entitled|plus\/pro\s+required|account\w*\s+(?:locked|unavailable)|all\s+\d+\s+accounts\s+locked|no\s+credentials|model\s+lock)/u.test(text)) return 'account_unavailable';
  if (/(?:invalid\s+(?:prompt|request|model|parameter)|unsupported|missing\s+(?:required\s+)?field|malformed|bad\s+request|validation)/u.test(text)) return 'invalid_request';
  if (/(?:\b(?:408|409|425|429|500|502|503|504)\b|timeout|timed\s+out|temporar(?:y|ily)|upstream|connection\s+(?:reset|closed)|network\s+error)/u.test(text)) return 'provider_unavailable';
  return 'unknown';
}

export function shouldRetryImageGeneration(value) {
  return classifyImageGenerationFailure(value) === 'provider_unavailable';
}

/** Shared with the exact native-tool overlay and unit tests. */
export function resolveAmadeusImageRouteAuthority(input) {
  const configured = input?.configuredImageModel;
  const candidate = typeof configured === 'string'
    ? configured.trim()
    : configured && typeof configured === 'object' && !Array.isArray(configured) && typeof configured.primary === 'string'
      ? configured.primary.trim()
      : '';
  const configuredLogicalModel = /^[a-z0-9_.-]+\/[a-z0-9_.:-]+$/iu.test(candidate) && candidate.length <= 160
    ? candidate
    : '';
  const authored = input?.modelAuthoredOverride;
  const overridePresent = typeof authored === 'string' && authored.trim().length > 0;
  return {
    configuredLogicalModel,
    // Model-authored image models are never carried into task preparation.
    modelOverride: undefined,
    overridePresent,
    overrideIgnored: overridePresent,
  };
}

/** Validates the final logical provider/model pair before an OpenAI-compatible request. */
export function assertAmadeusImageTransportRouteModel(input) {
  const configured = typeof input?.configuredLogicalModel === 'string' ? input.configuredLogicalModel.trim() : '';
  const provider = typeof input?.provider === 'string' ? input.provider.trim() : '';
  const model = typeof input?.model === 'string' ? input.model.trim() : '';
  const actual = provider && model ? `${provider}/${model}` : '';
  if (!configured || actual !== configured) throw new Error('image_route_invariant_violation');
  return actual;
}

/** 9Router 0.5.91 JSON reference contract; its fallback supports one image. */
export function buildAmadeusReferenceImagePayload(req) {
  if (req.imageRouteContext?.configuredLogicalModel !== 'openai/amadeus-image' ||
      req.provider !== 'openai' || req.model !== 'amadeus-image') return undefined;
  const images = req.inputImages ?? [];
  if (images.length === 0) return undefined;
  if (images.length !== 1) throw new Error('amadeus_image_reference_count_unsupported');
  const image = images[0];
  if (!(image.buffer instanceof Uint8Array)) throw new Error('amadeus_image_reference_invalid');
  const bytes = Buffer.from(image.buffer);
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('amadeus_image_reference_size_unsupported');
  const mime = image.mimeType?.trim().toLowerCase();
  const detected = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
    : bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
    : bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : undefined;
  if (!detected || mime !== detected) throw new Error('amadeus_image_reference_mime_unsupported');
  return { image: 'data:' + mime + ';base64,' + bytes.toString('base64') };
}

function replaceOnce(source, find, replacement, label) {
  const count = source.split(find).length - 1;
  if (count !== 1) throw new Error(`pinned image route ${label} anchor count=${count}; refusing to patch`);
  return source.replace(find, replacement);
}

function assertDigest(source, expected, label) {
  const actual = createHash('sha256').update(source).digest('hex');
  if (actual !== expected) throw new Error(`pinned image route ${label} digest mismatch`);
}

function routeAuthoritySource() {
  return `\n// ${IMAGE_ROUTE_AUTHORITY_MARKER}\n${resolveAmadeusImageRouteAuthority.toString()}\n${failureText.toString()}\n${classifyImageGenerationFailure.toString()}\n${shouldRetryImageGeneration.toString()}\nasync function executeImageGenerationJobWithRetry(params, run) {\n\tlet attempt = 0;\n\twhile (true) {\n\t\tattempt += 1;\n\t\ttry { return await run(); }\n\t\tcatch (error) {\n\t\t\tif (attempt >= 2 || !shouldRetryImageGeneration(error)) throw error;\n\t\t\ttry { params.taskHandle && imageGenerationTaskLifecycle.recordTaskProgress({ handle: params.taskHandle, progressSummary: "Retrying image generation" }); } catch {}\n\t\t\tawait new Promise((resolve) => setTimeout(resolve, 1200));\n\t\t}\n\t}\n}\n`;
}

export function patchImageGenerationToolSource(original) {
  if (original.includes(IMAGE_ROUTE_AUTHORITY_MARKER)) {
    if (!original.includes('image_route_native_input_resolved') || !original.includes('executeImageGenerationJobWithRetry') || !original.includes('safety_refusal') ||
        !original.includes('modelOverride: undefined') ||
        !original.includes('image_route_operator_model_selected') ||
        !original.includes('image_route_task_enqueued') ||
        !original.includes('image_route_worker_model_resolved') || !original.includes('amadeus_image_reference_count_unsupported') || !original.includes('amadeus-image accepts exactly one') || !original.includes('up to 10 MiB') || !original.includes('Ignored for image generation') || !original.includes('Action=list shows provider/model availability')) {
      throw new Error('incomplete image route authority patch');
    }
    return original;
  }

  let output = replaceOnce(original, 'function createImageGenerateTool(options) {',
    `${routeAuthoritySource()}\nfunction createImageGenerateTool(options) {`, 'native image tool function');

  output = replaceOnce(output, 'async function executeImageGenerationJob(params) {',
    `async function executeImageGenerationJob(params) {\n\treturn executeImageGenerationJobWithRetry(params, () => executeImageGenerationJobOnce(params));\n}\nasync function executeImageGenerationJobOnce(params) {`,
    'bounded image generation retry wrapper');

  output = replaceOnce(output,
`model: Type.Optional(Type.String({ description: "Provider/model override, e.g. openai/gpt-image-2; transparent OpenAI: openai/gpt-image-1.5." })),`,
`model: Type.Optional(Type.String({ description: "Ignored for image generation. The operator-configured logical image route is always used." })),`,
    'agent-visible image model hint');
  output = replaceOnce(output,
`image: Type.Optional(Type.String({ description: "Reference image path/URL for edit." })),`,
`image: Type.Optional(Type.String({ description: "Reference image path/URL for edit; the amadeus-image route accepts one PNG/JPEG/WebP reference up to 10 MiB." })),`,
    'agent-visible reference limit');
  output = replaceOnce(output,
`images: Type.Optional(Type.Array(Type.String(), { description: ` + "`Reference images for edit or style reference; max ${MAX_REFERENCE_IMAGE_INPUTS}.`" + ` })),`,
`images: Type.Optional(Type.Array(Type.String(), { description: ` + "`Reference images for edit; amadeus-image accepts exactly one, maximum ${MAX_REFERENCE_IMAGE_INPUTS} applies to other configured routes.`" + ` })),`,
    'agent-visible reference count');
  output = replaceOnce(output,
`resolution: Type.Optional(Type.String({ description: "Resolution: 1K, 2K, 4K; useful for Google." })),`,
`resolution: Type.Optional(Type.String({ description: "Resolution preference: 1K, 2K, 4K; normalized to the operator-configured image route capabilities." })),`,
    'agent-visible provider-specific resolution hint');
  output = replaceOnce(output,
`openai: Type.Optional(Type.Object({
		background: optionalStringEnum(SUPPORTED_BACKGROUNDS, { description: "OpenAI background: transparent, opaque, auto. Transparent needs png/webp; default model routes to gpt-image-1.5." }),`,
`openai: Type.Optional(Type.Object({
		background: optionalStringEnum(SUPPORTED_BACKGROUNDS, { description: "Background mode: transparent, opaque, auto. Transparent needs png/webp output." }),`,
    'agent-visible OpenAI model default hint');
  output = replaceOnce(output,
'OpenAI also openai.background, default gpt-image-1.5. action=list providers/models/readiness/auth; status active task.',
'Action=list shows provider/model availability; status shows active task.',
    'agent-visible image route description');

  output = replaceOnce(output,
`\t\t\tconst model = readToolStringParam(params, "model");`,
`\t\t\tconst routeAuthority = resolveAmadeusImageRouteAuthority({
\t\t\t\tconfiguredImageModel: cfg.agents?.defaults?.mediaModels?.image,
\t\t\t\tmodelAuthoredOverride: readToolStringParam(params, "model")
\t\t\t});
\t\t\tif (!routeAuthority.configuredLogicalModel) throw new ToolInputError("image_route_invariant_violation");
\t\t\tlog$5.info("image_route_native_input_resolved", {
\t\t\t\ttoolCallId: _toolCallId,
\t\t\t\tpostHookOverridePresent: routeAuthority.overridePresent,
\t\t\t\tmodelOverrideIgnored: true,
\t\t\t\tconfiguredLogicalModel: routeAuthority.configuredLogicalModel
\t\t\t});
\t\t\tconst model = routeAuthority.modelOverride;`,
    'native image model override');

  output = replaceOnce(output,
`const configuredModel = model || explicitModelConfig ? resolveCapabilityModelConfigForTool({
\t\t\t\tcfg,
\t\t\t\tmodelConfig: cfg.agents?.defaults?.mediaModels?.image,
\t\t\t\tmodelOverride: model,
\t\t\t\tproviders: []
\t\t\t}) : null;
\t\t\tconst readRequest = () => {`,
`const configuredModel = model || explicitModelConfig ? resolveCapabilityModelConfigForTool({
\t\t\t\tcfg,
\t\t\t\tmodelConfig: cfg.agents?.defaults?.mediaModels?.image,
\t\t\t\tmodelOverride: model,
\t\t\t\tproviders: []
\t\t\t}) : null;
\t\t\tif (!configuredModel || configuredModel.primary !== routeAuthority.configuredLogicalModel) throw new ToolInputError("image_route_invariant_violation");
\t\t\tlog$5.info("image_route_operator_model_selected", { toolCallId: _toolCallId, configuredLogicalModel: routeAuthority.configuredLogicalModel, transportLogicalModel: routeAuthority.configuredLogicalModel });
\t\t\tconst readRequest = () => {`,
    'native operator model validation');

  output = replaceOnce(output,
`generationLabel: "image",\n\t\t\t\t\t\tsessionKey: options?.agentSessionKey,`,
`generationLabel: "image",\n\t\t\t\t\t\timageRouteDiagnostic: {\n\t\t\t\t\t\t\tconfiguredLogicalModel: routeAuthority.configuredLogicalModel,\n\t\t\t\t\t\t\ttoolCallId: _toolCallId\n\t\t\t\t\t\t},\n\t\t\t\t\t\tsessionKey: options?.agentSessionKey,`,
    'image task route correlation');

  output = replaceOnce(output,
'const imageInputs = normalizeReferenceImages(params);',
'const imageInputs = normalizeReferenceImages(params);\n\t\t\t\tif (routeAuthority.configuredLogicalModel === "openai/amadeus-image" && imageInputs.length > 1) throw new ToolInputError("amadeus_image_reference_count_unsupported");',
    'single-reference admission boundary');

  const tabs = (count) => '\t'.repeat(count);
  output = replaceOnce(output,
`run: (taskHandle) => executeImageGenerationJob({\n${tabs(7)}effectiveCfg,\n${tabs(7)}prompt,`,
`run: (taskHandle) => executeImageGenerationJob({\n${tabs(7)}effectiveCfg,\n${tabs(7)}imageRouteDiagnostic: routeAuthority,\n${tabs(7)}prompt,`,
    'detached image closure capture');

  output = replaceOnce(output,
`\t\tif (handle && shouldDetachMediaGenerationTask(params.sessionKey, params.requesterAgentId)) {`,
`\t\tconst detachedTask = Boolean(handle && shouldDetachMediaGenerationTask(params.sessionKey, params.requesterAgentId));
\t\tif (toolName === "image_generate" && params.imageRouteDiagnostic && detachedTask) {
\t\t\tlog$5.info("image_route_task_enqueued", {
\t\t\t\ttaskId: handle.taskId,
\t\t\t\trunId: handle.runId,
\t\t\t\tconfiguredLogicalModel: params.imageRouteDiagnostic.configuredLogicalModel,
\t\t\t\ttransportLogicalModel: params.imageRouteDiagnostic.configuredLogicalModel,\n\t\t\t\tqueue: "process_local_microtask"
\t\t\t});
\t\t}
\t\tif (detachedTask) {`,
    'detached enqueue event');

  output = replaceOnce(output,
`\tif (params.taskHandle) imageGenerationTaskLifecycle.recordTaskProgress({\n\t\thandle: params.taskHandle,\n\t\tprogressSummary: "Generating image"\n\t});\n\tconst result = await generateImage({\n\t\tcfg: params.effectiveCfg,`,
`\tif (params.taskHandle) imageGenerationTaskLifecycle.recordTaskProgress({\n\t\thandle: params.taskHandle,\n\t\tprogressSummary: "Generating image"\n\t});\n\tconst imageRouteDiagnostic = params.imageRouteDiagnostic;\n\tconst configuredImageModel = params.effectiveCfg?.agents?.defaults?.mediaModels?.image;\n\tconst configuredLogicalModel = typeof configuredImageModel === "string" ? configuredImageModel.trim() : configuredImageModel?.primary?.trim();\n\tif (!configuredLogicalModel || configuredLogicalModel !== imageRouteDiagnostic?.configuredLogicalModel || typeof params.model === "string" && params.model.trim()) {\n\t\tthrow new Error("image_route_invariant_violation");\n\t}\n\tconst imageRouteContext = {\n\t\tconfiguredLogicalModel,\n\t\ttaskId: params.taskHandle?.taskId,\n\t\trunId: params.taskHandle?.runId,\n\t\ttoolCallId: imageRouteDiagnostic.toolCallId\n\t};\n\tlog$5.info("image_route_worker_model_resolved", {\n\t\ttaskId: imageRouteContext.taskId,\n\t\trunId: imageRouteContext.runId,\n\t\tconfiguredLogicalModel,\n\t\ttransportLogicalModel: configuredLogicalModel,\n\t\tmodelOverrideIgnored: true,\n\t\tworker: "process_local_microtask"\n\t});\n\tconst result = await generateImage({\n\t\tcfg: params.effectiveCfg,\n\t\timageRouteContext,`,
    'worker route assertion and diagnostic');

  output = replaceOnce(output,
`log$5.info("image_route_native_input_resolved", {`,
`log$5.info(JSON.stringify({ event: "image_route_native_input_resolved",`,
    'native JSON route diagnostic start');
  output = replaceOnce(output,
`configuredLogicalModel: routeAuthority.configuredLogicalModel
\t\t\t});
\t\t\tconst model = routeAuthority.modelOverride;`,
`configuredLogicalModel: routeAuthority.configuredLogicalModel
\t\t\t}));
\t\t\tconst model = routeAuthority.modelOverride;`,
    'native JSON route diagnostic end');
  output = replaceOnce(output,
`log$5.info("image_route_operator_model_selected", {`,
`log$5.info(JSON.stringify({ event: "image_route_operator_model_selected",`,
    'operator route JSON diagnostic start');
  output = replaceOnce(output,
`transportLogicalModel: routeAuthority.configuredLogicalModel });`,
`transportLogicalModel: routeAuthority.configuredLogicalModel }));`,
    'operator route JSON diagnostic end');
  output = replaceOnce(output,
`log$5.info("image_route_task_enqueued", {`,
`log$5.info(JSON.stringify({ event: "image_route_task_enqueued",`,
    'enqueue JSON diagnostic start');
  output = replaceOnce(output,
`queue: "process_local_microtask"
\t\t\t});
\t\t}
\t\tif (detachedTask)`,
`queue: "process_local_microtask"
\t\t\t}));
\t\t}
\t\tif (detachedTask)`,
    'enqueue JSON diagnostic end');
  output = replaceOnce(output,
`log$5.info("image_route_worker_model_resolved", {`,
`log$5.info(JSON.stringify({ event: "image_route_worker_model_resolved",`,
    'worker JSON diagnostic start');
  output = replaceOnce(output,
`worker: "process_local_microtask"
\t});
\tconst result = await generateImage({`,
`worker: "process_local_microtask"
\t}));
\tconst result = await generateImage({`,
    'worker JSON diagnostic end');
  return output;
}

export function patchImageGenerationRuntimeSource(original) {
  const marker = `${IMAGE_ROUTE_AUTHORITY_MARKER}_RUNTIME`;
  if (original.includes(marker)) {
    if (!original.includes('image_route_transport_model_resolved') || !original.includes('imageRouteContext')) {
      throw new Error('incomplete image route runtime patch');
    }
    return original;
  }
  const anchor = `\t\t\t\tconst result = await provider.generateImage({\n\t\t\t\t\tprovider: candidate.provider,\n\t\t\t\t\tmodel: candidate.model,`;
  const replacement = `// ${marker}\n\t\t\t\tconst routeContext = params.imageRouteContext;\n\t\t\t\tif (routeContext) {\n\t\t\t\t\tconst transportLogicalModel = \`${'${candidate.provider}/${candidate.model}'}\`;\n\t\t\t\t\tif (transportLogicalModel !== routeContext.configuredLogicalModel) throw new Error("image_route_invariant_violation");\n\t\t\t\t\tlogger.info("image_route_transport_model_resolved", {\n\t\t\t\t\t\ttaskId: routeContext.taskId,\n\t\t\t\t\t\trunId: routeContext.runId,\n\t\t\t\t\t\tconfiguredLogicalModel: routeContext.configuredLogicalModel,\n\t\t\t\t\t\ttransportLogicalModel,\n\t\t\t\t\t\tproviderStatus: "request_ready"\n\t\t\t\t\t});\n\t\t\t\t}\n\t\t\t\tconst result = await provider.generateImage({\n\t\t\t\t\tprovider: candidate.provider,\n\t\t\t\t\tmodel: candidate.model,\n\t\t\t\t\t...routeContext ? { imageRouteContext: routeContext } : {},`;
  let output = replaceOnce(original, anchor, replacement, 'provider transport resolution');
  output = replaceOnce(output,
`logger.info("image_route_transport_model_resolved", {`,
`logger.info(JSON.stringify({ event: "image_route_transport_model_resolved",`,
    'runtime JSON diagnostic start');
  output = replaceOnce(output,
`providerStatus: "request_ready"
\t\t\t\t\t});
\t\t\t\t}
\t\t\t\tconst result = await provider.generateImage({`,
`providerStatus: "request_ready"
\t\t\t\t\t}));
\t\t\t\t}
\t\t\t\tconst result = await provider.generateImage({`,
    'runtime JSON diagnostic end');
  return output;
}

export function patchOpenAIImageProviderSource(original) {
  const marker = `${IMAGE_ROUTE_AUTHORITY_MARKER}_OPENAI`;
  if (original.includes(marker)) {
    if (!original.includes('image_route_invariant_violation') || !original.includes('image_route_transport_model_resolved') ||
        !original.includes('image_route_transport_failed') || !original.includes('buildAmadeusReferenceImagePayload') ||
        !original.includes('amadeusReferencePayload')) {
      throw new Error('incomplete OpenAI image route patch');
    }
    return original;
  }
  const helper = `\n// ${marker}\n${assertAmadeusImageTransportRouteModel.toString()}\n${buildAmadeusReferenceImagePayload.toString()}\nasync function assertAmadeusImageTransportRoute(req, model) {\n\tconst route = req.imageRouteContext;\n\tif (!route) return;\n\tconst { createSubsystemLogger } = await import("./plugin-sdk/logging-core.js");\n\tconst log = createSubsystemLogger("image-generation/openai");\n\tlet transportLogicalModel;\n\ttry {\n\t\ttransportLogicalModel = assertAmadeusImageTransportRouteModel({ configuredLogicalModel: route.configuredLogicalModel, provider: req.provider, model });\n\t} catch {\n\t\tlog.error("image_route_invariant_violation", { taskId: route.taskId, runId: route.runId, configuredLogicalModel: route.configuredLogicalModel, providerStatus: "blocked" });\n\t\tthrow new Error("image_route_invariant_violation");\n\t}\n\tlog.info("image_route_transport_model_resolved", { taskId: route.taskId, runId: route.runId, configuredLogicalModel: route.configuredLogicalModel, transportLogicalModel, providerStatus: "request_ready" });\n}
async function logAmadeusImageTransportFailure(req, model, status) {\n\tconst route = req.imageRouteContext;\n\tif (!route) return;\n\tconst { createSubsystemLogger } = await import("./plugin-sdk/logging-core.js");\n\tconst log = createSubsystemLogger("image-generation/openai");\n\tlog.warn("image_route_transport_failed", {\n\t\ttaskId: route.taskId,\n\t\trunId: route.runId,\n\t\tconfiguredLogicalModel: route.configuredLogicalModel,\n\t\ttransportLogicalModel: req.provider + "/" + model,\n\t\tproviderStatus: Number.isInteger(status) && status >= 100 && status <= 599 ? status : "transport_error",\n\t\terrorCategory: "upstream_http_error"\n\t});\n}
`;
  let output = replaceOnce(original, 'function buildOpenAIImageGenerationProvider(modelAuth) {',
    `${helper}\nfunction buildOpenAIImageGenerationProvider(modelAuth) {`, 'OpenAI transport guard');
  output = replaceOnce(output,
`\tconst model = resolveOpenAIImageRequestModel(req, { allowTransparentDefaultReroute: true });\n\tconst count = resolveOpenAIImageCount(req.count);`,
`\tconst model = resolveOpenAIImageRequestModel(req, { allowTransparentDefaultReroute: true });\n\tawait assertAmadeusImageTransportRoute(req, model);\n\tconst count = resolveOpenAIImageCount(req.count);`,
    'OpenAI Codex transport boundary');
  output = replaceOnce(output,
`\t\t\tconst model = resolveOpenAIImageRequestModel(req, { allowTransparentDefaultReroute: publicOpenAIBaseUrl });\n\t\t\tconst count = resolveOpenAIImageCount(req.count);`,
`\t\t\tconst model = resolveOpenAIImageRequestModel(req, { allowTransparentDefaultReroute: publicOpenAIBaseUrl });\n\t\t\tawait assertAmadeusImageTransportRoute(req, model);\n\t\t\tconst count = resolveOpenAIImageCount(req.count);`,
    'OpenAI-compatible transport boundary');
  output = replaceOnce(output,
`\t\t\tawait assertOkOrThrowHttpError(response, "OpenAI Codex image generation failed");`,
`\t\t\ttry {
\t\t\t\tawait assertOkOrThrowHttpError(response, "OpenAI Codex image generation failed");
\t\t\t} catch (error) {
\t\t\t\tawait logAmadeusImageTransportFailure(req, model, response.status);
\t\t\t\tthrow error;
\t\t\t}`,
    'Codex bounded provider failure');
  output = replaceOnce(output,
`\t\t\t\tawait assertOkOrThrowHttpError(response, isEdit ? "OpenAI image edit failed" : "OpenAI image generation failed");`,
`\t\t\t\ttry {
\t\t\t\t\tawait assertOkOrThrowHttpError(response, isEdit ? "OpenAI image edit failed" : "OpenAI image generation failed");
\t\t\t\t} catch (error) {
\t\t\t\t\tawait logAmadeusImageTransportFailure(req, model, response.status);
\t\t\t\t\tthrow error;
\t\t\t\t}`,
    'OpenAI bounded provider failure');
  output = replaceOnce(output,
`log.error("image_route_invariant_violation", {`,
`log.error(JSON.stringify({ event: "image_route_invariant_violation",`,
    'provider invariant JSON diagnostic start');
  output = replaceOnce(output,
`providerStatus: "blocked" });`,
`providerStatus: "blocked" }));`,
    'provider invariant JSON diagnostic end');
  output = replaceOnce(output,
`log.info("image_route_transport_model_resolved", {`,
`log.info(JSON.stringify({ event: "image_route_transport_model_resolved",`,
    'provider route JSON diagnostic start');
  output = replaceOnce(output,
`providerStatus: "request_ready" });`,
`providerStatus: "request_ready" }));`,
    'provider route JSON diagnostic end');
  output = replaceOnce(output,
`log.warn("image_route_transport_failed", {`,
`log.warn(JSON.stringify({ event: "image_route_transport_failed",`,
    'provider failure JSON diagnostic start');
  output = replaceOnce(output,
`errorCategory: "upstream_http_error"
\t});
}`,
`errorCategory: "upstream_http_error"
\t}));
}`,
    'provider failure JSON diagnostic end');
  output = replaceOnce(output,
'const url = isAzure ? buildAzureImageUrl(rawBaseUrl, model, isEdit ? "edits" : "generations") : `${baseUrl}/images/${isEdit ? "edits" : "generations"}`;',
'const amadeusReferencePayload = buildAmadeusReferenceImagePayload(req);\n\t\t\tif (amadeusReferencePayload && isAzure) throw new Error("amadeus_image_reference_transport_unsupported");\n\t\t\tconst url = isAzure ? buildAzureImageUrl(rawBaseUrl, model, isEdit ? "edits" : "generations") : `${baseUrl}/images/${isEdit && !amadeusReferencePayload ? "edits" : "generations"}`;',
    'logical route reference JSON endpoint');
  output = replaceOnce(output,
'const { response, release } = isEdit ? await (() => {',
'const { response, release } = isEdit && !amadeusReferencePayload ? await (() => {',
    'reference JSON versus native multipart');
  output = replaceOnce(output,
`const body = {
\t\t\t\t\tprompt: req.prompt,
\t\t\t\t\tn: count,
\t\t\t\t\tsize
\t\t\t\t};`,
`const body = {
\t\t\t\t\tprompt: req.prompt,
\t\t\t\t\tn: count,
\t\t\t\t\tsize,
\t\t\t\t\t...amadeusReferencePayload
\t\t\t\t};`,
    'preserved inline reference in JSON body');
  return output;
}

export async function installImageRouteAuthorityModules(coreRoot) {
  const paths = [IMAGE_ROUTE_AUTHORITY_PIN.runtimeModule, IMAGE_ROUTE_AUTHORITY_PIN.openaiProviderModule]
    .map((name) => join(coreRoot, 'dist', name));
  const [runtimeOriginal, providerOriginal] = await Promise.all(paths.map((path) => readFile(path, 'utf8')));
  assertDigest(runtimeOriginal, IMAGE_ROUTE_AUTHORITY_PIN.runtimeSha256, 'image runtime');
  assertDigest(providerOriginal, IMAGE_ROUTE_AUTHORITY_PIN.openaiProviderSha256, 'OpenAI image provider');
  const outputs = [patchImageGenerationRuntimeSource(runtimeOriginal), patchOpenAIImageProviderSource(providerOriginal)];
  const checks = await Promise.all(paths.map((path) => stat(path)));
  for (let index = 0; index < paths.length; index += 1) {
    const mode = checks[index].mode & 0o777;
    const temporary = `${paths[index]}.image-route-tmp`;
    await writeFile(temporary, outputs[index]);
    await chmod(temporary, mode);
    await rename(temporary, paths[index]);
  }
  return outputs.length;
}
