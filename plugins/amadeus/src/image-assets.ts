import { lstat, readFile, realpath } from 'node:fs/promises';
import { basename } from 'node:path';
import { Type, type Static } from 'typebox';
import type { OpenClawPluginApi, OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import { configFor, readRequiredFile, type AmadeusConfig } from './config.js';
import { identityContextFromOpenClaw } from './identity.js';
import { registerTool } from './shared/register-tool.js';
import { deliveryRuns } from './delivery-runs.js';
import { assetPath, readRegisteredAsset, type AssetMetadata } from './delivery-assets.js';
import { createAttachmentPart, type AttachmentPart } from './delivery-envelope.js';
import { normalizeImageCaption, type ImageCaptionEnricher } from './image-caption.js';
import type { ImageRequestLanguage } from './image-generation-context.js';

const ImageUpscaleParameters = Type.Object({
  target: Type.Optional(Type.Object({
    imageId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  }, { additionalProperties: false })),
  scale: Type.Optional(Type.Union([Type.Literal(2), Type.Literal(4)])),
  mode: Type.Optional(Type.Union([Type.Literal('auto'), Type.Literal('realistic'), Type.Literal('anime')])),
  resolution: Type.Optional(Type.Union([Type.Literal('2k'), Type.Literal('4k')])),
}, { additionalProperties: false });

type ImageUpscaleParameters = Static<typeof ImageUpscaleParameters>;
type ImageAssetOrigin = {
  channel?: string;
  conversationId?: string;
  messageId?: string;
  replyToMessageId?: string;
  sessionId?: string;
  runId?: string;
};
type ImageAssetResult = {
  imageId: string;
  parentImageId?: string;
  kind?: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  storageKey: string;
  status: string;
  transform?: Record<string, unknown>;
  fileName?: string;
  sha256: string;
};
type CurrentImageContext = ImageAssetOrigin & { sessionKey: string; explicitScale?: 2 | 4; expiresAt: number };

const IMAGE_CONTEXT_TTL_MS = 10 * 60 * 1000;
const currentImageContexts = new Map<string, CurrentImageContext>();

/** A bounded parameter constraint, not a capability/tool router. A bare 4K/2K is
 * a resolution profile and must never be mistaken for an upscale multiplier. */
export function explicitUpscaleScale(body: string): 2 | 4 | undefined {
  const four = /(?:\b4\s*[x×倍]|四\s*倍)/iu.test(body);
  const two = /(?:\b2\s*[x×倍]|二\s*倍|两\s*倍)/iu.test(body);
  return four === two ? undefined : four ? 4 : 2;
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function currentContextFor(sessionKey: string | undefined): CurrentImageContext | undefined {
  if (!sessionKey) return undefined;
  const current = currentImageContexts.get(sessionKey);
  if (!current) return undefined;
  if (current.expiresAt <= Date.now()) {
    currentImageContexts.delete(sessionKey);
    return undefined;
  }
  return current;
}

async function serviceHeaders(config: AmadeusConfig): Promise<Headers> {
  const token = await readRequiredFile(config.imageAssetServiceTokenFile, 'image asset service token');
  return new Headers({
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  });
}

async function serviceJson(config: AmadeusConfig, path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  const abort = (): void => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const headers = await serviceHeaders(config);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    const response = await fetch(`${config.imageAssetServiceBaseUrl}${path}`, { ...init, headers, signal: controller.signal });
    const body = await response.text();
    let payload: unknown;
    try { payload = body ? JSON.parse(body) as unknown : undefined; } catch { payload = body; }
    if (!response.ok) {
      const error = object(payload);
      throw new Error(text(error?.error) ?? `image_asset_service_http_${response.status}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function originForContext(context: OpenClawPluginToolContext, current?: CurrentImageContext): ImageAssetOrigin {
  const identity = identityContextFromOpenClaw(context);
  return {
    ...(identity.channel ? { channel: identity.channel } : {}),
    ...(identity.conversationId ? { conversationId: identity.conversationId } : current?.conversationId ? { conversationId: current.conversationId } : context.sessionKey ? { conversationId: context.sessionKey } : {}),
    ...(context.sessionId ? { sessionId: context.sessionId } : current?.sessionId ? { sessionId: current.sessionId } : {}),
    ...(current?.messageId ? { messageId: current.messageId } : {}),
    ...(current?.replyToMessageId ? { replyToMessageId: current.replyToMessageId } : {}),
  };
}

function resultObject(value: unknown): Record<string, unknown> | undefined {
  const outer = object(value);
  return object(outer?.details) ?? outer;
}

function generatedPaths(value: unknown): string[] {
  const result = resultObject(value);
  const media = object(result?.media);
  const candidates = [result?.paths, result?.mediaUrls, media?.mediaUrls];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const paths = candidate.flatMap((item) => typeof item === 'string' && item.startsWith('/') ? [item] : []);
    if (paths.length) return paths;
  }
  const attachments = Array.isArray(result?.attachments) ? result.attachments : Array.isArray(media?.attachments) ? media.attachments : [];
  return attachments.flatMap((item) => {
    const row = object(item);
    return typeof row?.path === 'string' && row.path.startsWith('/') ? [row.path] : [];
  });
}

function generatedMime(value: unknown, path: string): string {
  const result = resultObject(value);
  const media = object(result?.media);
  const attachments = Array.isArray(result?.attachments) ? result.attachments : Array.isArray(media?.attachments) ? media.attachments : [];
  const row = attachments.find((item) => object(item)?.path === path);
  const mime = text(object(row)?.mimeType);
  if (mime) return mime;
  const ext = basename(path).toLowerCase().split('.').pop();
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
}

function parseServiceResult(value: unknown): ImageAssetResult {
  const payload = object(value);
  const asset = object(payload?.asset) ?? payload;
  if (!asset || text(asset.imageId) === undefined || text(asset.storageKey) === undefined || typeof asset.mimeType !== 'string' || typeof asset.width !== 'number' || typeof asset.height !== 'number'
    || asset.status !== 'ready' || typeof asset.byteSize !== 'number' || !Number.isSafeInteger(asset.byteSize) || asset.byteSize <= 0
    || typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(asset.sha256)) {
    throw new Error('image_asset_service_response_invalid');
  }
  return asset as unknown as ImageAssetResult;
}

async function importImageAsset(config: AmadeusConfig, path: string, mimeType: string, sourceKind: string, origin: ImageAssetOrigin, signal?: AbortSignal): Promise<ImageAssetResult> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > 25 * 1024 * 1024) throw new Error('image_import_path_invalid');
  return importImageBytes(config, await readFile(path), mimeType, sourceKind, origin, signal);
}

async function importImageBytes(config: AmadeusConfig, body: Buffer, mimeType: string, sourceKind: string, origin: ImageAssetOrigin, signal?: AbortSignal): Promise<ImageAssetResult> {
  const headers = await serviceHeaders(config);
  headers.set('Content-Type', mimeType);
  headers.set('X-Amadeus-Source-Kind', sourceKind);
  headers.set('X-Amadeus-Origin', JSON.stringify(origin));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  const abort = (): void => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(`${config.imageAssetServiceBaseUrl}/v1/assets/import`, { method: 'POST', headers, body: new Uint8Array(body) as unknown as BodyInit, signal: controller.signal });
    const payload = await response.json() as unknown;
    if (!response.ok) throw new Error(text(object(payload)?.error) ?? `image_asset_import_http_${response.status}`);
    return parseServiceResult(payload);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function inboundMediaPaths(event: { media?: Array<{ path?: string; contentType?: string; kind?: unknown }>; originalMedia?: Array<{ path?: string; contentType?: string; kind?: unknown }> }): Array<{ path: string; mimeType: string }> {
  const facts = Array.isArray(event.media) && event.media.length ? event.media : event.originalMedia ?? [];
  return facts.flatMap((fact) => {
    const path = text(fact.path);
    if (!path || !path.startsWith('/')) return [];
    const mimeType = text(fact.contentType) ?? (fact.kind === 'image' ? 'image/png' : generatedMime(undefined, path));
    return [{ path, mimeType }];
  });
}

export function imageAssetAttachment(asset: ImageAssetResult, disposition: AttachmentPart['disposition'], caption?: string): AttachmentPart {
  if (asset.status !== 'ready') throw new Error('image_asset_not_ready');
  return createAttachmentPart({
    assetId: asset.imageId, mimeType: asset.mimeType,
    fileName: asset.fileName ?? basename(asset.storageKey), disposition,
    byteSize: asset.byteSize, sha256: asset.sha256,
    ...(caption ? { caption } : {}),
  });
}
export async function resolveRegisteredImageAsset(config: AmadeusConfig, part: AttachmentPart) {
  if (!/^img_[a-f0-9]{32}$/u.test(part.assetId)) throw new Error('asset_id_invalid');
  const asset = parseServiceResult(await serviceJson(config, `/v1/assets/${part.assetId}/metadata`));
  return await readRegisteredAsset(config.imageAssetContainerRoot, part, asset as AssetMetadata);
}
export async function bindImageDelivery(config: AmadeusConfig, assetId: string, messageId: string, origin: ImageAssetOrigin): Promise<void> {
  await serviceJson(config, '/v1/assets/bind-delivery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetIds: [assetId], messageId, origin }) });
}

export async function upscaleImage(config: AmadeusConfig, input: ImageUpscaleParameters, context: OpenClawPluginToolContext, signal?: AbortSignal): Promise<unknown> {
  const current = currentContextFor(context.sessionKey);
  const identity = identityContextFromOpenClaw(context);
  const origin = originForContext(context, current);
  // A user turn defaults to 2x even when the model invents 4x; explicit user 4x wins.
  const scale = current?.explicitScale ?? 2;
  const response = await serviceJson(config, '/v1/upscale', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(input.target?.imageId ? { imageId: input.target.imageId } : {}),
      ...(scale !== undefined ? { scale } : {}),
      ...(input.mode !== undefined ? { mode: input.mode } : {}),
      ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
      ...(origin.conversationId ? { conversationId: origin.conversationId } : {}),
      ...(current?.replyToMessageId ? { replyMessageId: current.replyToMessageId } : {}),
    }),
  }, signal);
  const asset = parseServiceResult(response);
  const attachment = imageAssetAttachment(asset, 'document');
  return {
    status: 'ok',
    imageId: asset.imageId,
    parentImageId: asset.parentImageId,
    scale: asset.transform?.scale ?? scale,
    mode: asset.transform?.mode ?? input.mode ?? 'auto',
    ...(asset.transform?.resolution ? { resolution: asset.transform.resolution } : input.resolution ? { resolution: input.resolution } : {}),
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    contentText: `Upscaled image ${asset.imageId}.`,
    deliveryAttachment: attachment,
    ...(identity.channel ? { channel: identity.channel } : {}),
  };
}

export type GeneratedCompletionAttachment = Readonly<{ type?: string; path?: string; mimeType?: string }>;
export type GeneratedCompletionAssetOptions = Readonly<{
  taskId: string;
  agentId: string;
  sessionKey: string;
  channel: 'whatsapp' | 'telegram';
  requestContext?: string;
  requestLanguage?: ImageRequestLanguage;
  captionEnricher?: ImageCaptionEnricher;
}>;

export async function resolveRegisteredImageCaptionInput(config: AmadeusConfig, part: AttachmentPart): Promise<{ filePath: string; mimeType: string }> {
  if (!/^img_[a-f0-9]{32}$/u.test(part.assetId) || part.disposition !== 'inline' || !part.mimeType.startsWith('image/')) throw new Error('caption_asset_invalid');
  const response = await serviceJson(config, `/v1/assets/${part.assetId}/metadata`);
  const asset = parseServiceResult(response);
  if (asset.imageId !== part.assetId || asset.status !== 'ready' || asset.mimeType !== part.mimeType) throw new Error('caption_asset_metadata_invalid');
  // Reuse strict registry/root/hash validation as native delivery. Captioning
  // receives only this verified persisted asset path, never a model-authored path.
  await readRegisteredAsset(config.imageAssetContainerRoot, part, asset as AssetMetadata);
  const root = await realpath(config.imageAssetContainerRoot);
  return { filePath: assetPath(root, asset.storageKey), mimeType: asset.mimeType };
}

/** Import only OpenClaw's persisted structured image attachments, then enrich from the registered bytes. */
export async function importGeneratedCompletionAssets(
  api: OpenClawPluginApi,
  attachments: readonly GeneratedCompletionAttachment[],
  options: GeneratedCompletionAssetOptions,
): Promise<readonly AttachmentPart[]> {
  if (!attachments.length || attachments.length > 4
    || attachments.some((item) => item.type !== 'image' || typeof item.path !== 'string' || !item.path.startsWith('/')
      || !['image/png', 'image/jpeg', 'image/webp'].includes(item.mimeType ?? ''))) throw new Error('image_completion_attachments_invalid');
  const config = configFor(api);
  return await Promise.all(attachments.map(async (item) => {
    const asset = await importImageAsset(config, item.path!, item.mimeType!, 'generated', { runId: `image_generate:${options.taskId}` });
    const base = imageAssetAttachment(asset, 'inline');
    let caption: string | undefined;
    let fallbackReason: 'timeout' | 'model_error' | 'invalid_result' | 'unsupported' | 'language_mismatch' | undefined;
    const captionStartedAt = Date.now();
    if (options.captionEnricher) {
      try {
        const image = await resolveRegisteredImageCaptionInput(config, base);
        const outcome = await options.captionEnricher({
          ...image, taskId:options.taskId, agentId: options.agentId, sessionKey: options.sessionKey, channel: options.channel,
          ...(options.requestContext ? { requestContext: options.requestContext.slice(0, 2_000) } : {}),
          ...(options.requestLanguage ? { requestLanguage: options.requestLanguage } : {}),
        });
        const safeCaption = normalizeImageCaption(outcome?.caption);
        if (safeCaption) caption = safeCaption;
        else fallbackReason = outcome?.omissionReason ?? 'invalid_result';
      } catch {
        // Enrichment/registry path lookup can never make an imported image
        // ineligible for the existing DeliveryEnvelope settlement.
        fallbackReason = 'model_error';
      }
    }
    if (options.captionEnricher && fallbackReason) api.logger.info(`amadeus image caption delivery ${JSON.stringify({ task_id: options.taskId, lifecycle_stage:'captioning', semantic_status:'omitted', semantic_fallback_reason:fallbackReason, elapsed_ms:Math.max(0, Date.now() - captionStartedAt), channel:options.channel, request_context_present:Boolean(options.requestContext) })}`);
    return imageAssetAttachment(asset, 'inline', caption);
  }));
}

export function registerImageAssets(api: OpenClawPluginApi): void {
  const importedInboundMedia = new Map<string, number>();
  api.on('message_received', async (event, hookContext) => {
    const media = inboundMediaPaths(event);
    if (!media.length) return;
    const config = configFor(api);
    const messageId = text(event.messageId);
    const channel = text(hookContext.channelId);
    const conversationId = text(hookContext.conversationId) ?? hookContext.sessionKey;
    const replyToMessageId = text(event.replyToId);
    const runId = text(event.runId);
    const origin: ImageAssetOrigin = {
      ...(channel ? { channel } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(messageId ? { messageId } : {}),
      ...(replyToMessageId ? { replyToMessageId } : {}),
      ...(runId ? { runId } : {}),
    };
    for (const item of media.slice(0, 4)) {
      const key = `${messageId ?? 'unknown'}\u0000${item.path}`;
      const importedAt = importedInboundMedia.get(key);
      if (importedAt && Date.now() - importedAt < IMAGE_CONTEXT_TTL_MS) continue;
      importedInboundMedia.set(key, Date.now());
      try {
        await importImageAsset(config, item.path, item.mimeType, 'inbound', origin);
      } catch (error) {
        api.logger.warn(`amadeus inbound image asset registration failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });
  api.on('before_dispatch', (event, hookContext) => {
    const sessionKey = text(hookContext.sessionKey ?? event.sessionKey);
    if (!sessionKey) return;
    const channel = text(hookContext.channelId ?? event.channel);
    const conversationId = text(hookContext.conversationId);
    const messageId = text(hookContext.messageId ?? event.messageId);
    const replyToMessageId = text(hookContext.replyToId ?? event.replyToId);
    const explicitScale = explicitUpscaleScale(event.body ?? event.content);
    currentImageContexts.set(sessionKey, {
      sessionKey,
      ...(channel ? { channel } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(messageId ? { messageId } : {}),
      ...(replyToMessageId ? { replyToMessageId } : {}),
      ...(explicitScale !== undefined ? { explicitScale } : {}),
      expiresAt: Date.now() + IMAGE_CONTEXT_TTL_MS,
    });
  });
  api.on('after_tool_call', (event, hookContext) => {
    if (event.error || (event.toolName !== 'image_generate' && event.toolName !== 'amadeus_image_upscale')) return;
    const runId = event.runId ?? hookContext.runId ?? (hookContext.sessionKey ? deliveryRuns.runIdFor(hookContext.sessionKey) : undefined);
    if (!runId) throw new Error('image_delivery_run_missing');
    const config = configFor(api);
    const current = currentContextFor(hookContext.sessionKey);
    const origin: ImageAssetOrigin = { ...current, runId };
    // Enqueue the promise synchronously: the pinned after-tool hook is observed,
    // not awaited by core. Final settlement must await registration itself.
    const job = (async (): Promise<readonly AttachmentPart[]> => {
      if (event.toolName === 'amadeus_image_upscale') {
        const result = resultObject(event.result);
        const part = result?.deliveryAttachment;
        if (!part || typeof part !== 'object') return [];
        return [createAttachmentPart(part as Omit<AttachmentPart, 'kind'>)];
      }
      const paths = generatedPaths(event.result);
      const assets = await Promise.all(paths.slice(0, 4).map((path) => importImageAsset(config, path, generatedMime(event.result, path), 'generated', origin, hookContext.abortSignal)));
      return assets.map((asset) => imageAssetAttachment(asset, 'inline'));
    })();
    deliveryRuns.addAssets(runId, job);
    return job.then(() => undefined);
  }, { matcher: ['image_generate', 'amadeus_image_upscale'], timeoutMs: 60_000 });

  registerTool(api, 'amadeus_image_upscale', 'Upscale one existing image on the configured host service. Default to scale:2; an explicit user 4x/4倍 request uses scale:4. 4K/2K are resolution profiles, not multipliers. The current inbound turn also constrains an unambiguous explicit multiplier. Reply context wins over the current conversation’s recent image.', ImageUpscaleParameters, async (params, context, _notifier, signal) => upscaleImage(configFor(api), params, context, signal));
}

export { ImageUpscaleParameters };
