import { readFile } from 'node:fs/promises';
import { basename, join, normalize, posix } from 'node:path';
import { Type, type Static } from 'typebox';
import type { OpenClawPluginApi, OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import { configFor, readRequiredFile, type AmadeusConfig } from './config.js';
import { identityContextFromOpenClaw } from './identity.js';
import { registerTool } from './shared/register-tool.js';

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
  byteSize?: number;
  storageKey: string;
  status?: string;
  transform?: Record<string, unknown>;
};
type ImageAttachment = {
  type: 'image';
  path: string;
  mimeType: string;
  name: string;
  sizeBytes?: number;
  forceDocument?: boolean;
};
type CurrentImageContext = ImageAssetOrigin & { sessionKey: string; expiresAt: number };

const IMAGE_CONTEXT_TTL_MS = 10 * 60 * 1000;
const currentImageContexts = new Map<string, CurrentImageContext>();
const pendingDeliveredAssets = new Map<string, { assetIds: string[]; origin: ImageAssetOrigin; expiresAt: number }>();

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

function storagePath(containerRoot: string, storageKey: string): string {
  const normalized = normalize(storageKey).replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some((part) => part === '..')) {
    throw new Error('image_asset_storage_key_invalid');
  }
  const root = normalize(containerRoot);
  const candidate = normalize(join(root, ...normalized.split('/')));
  const prefix = root.endsWith(posix.sep) ? root : `${root}${posix.sep}`;
  if (candidate !== root && !candidate.startsWith(prefix)) throw new Error('image_asset_storage_key_invalid');
  return candidate;
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
  if (!asset || text(asset.imageId) === undefined || text(asset.storageKey) === undefined || typeof asset.mimeType !== 'string' || typeof asset.width !== 'number' || typeof asset.height !== 'number') {
    throw new Error('image_asset_service_response_invalid');
  }
  return asset as unknown as ImageAssetResult;
}

async function importImageAsset(config: AmadeusConfig, path: string, mimeType: string, sourceKind: string, origin: ImageAssetOrigin, signal?: AbortSignal): Promise<ImageAssetResult> {
  const body = await readFile(path);
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

async function bindDeliveredAssets(config: AmadeusConfig, assetIds: string[], messageId: string, origin: ImageAssetOrigin): Promise<void> {
  await serviceJson(config, '/v1/assets/bind-delivery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetIds, messageId, origin }),
  });
}

function outputAttachment(config: AmadeusConfig, asset: ImageAssetResult): ImageAttachment {
  const path = storagePath(config.imageAssetContainerRoot, asset.storageKey);
  return {
    type: 'image',
    path,
    mimeType: asset.mimeType,
    name: asset.imageId,
    forceDocument: true,
    ...(asset.byteSize !== undefined ? { sizeBytes: asset.byteSize } : {}),
  };
}

function pendingForKey(key: string | undefined): { assetIds: string[]; origin: ImageAssetOrigin } | undefined {
  if (!key) return undefined;
  const pending = pendingDeliveredAssets.get(key);
  if (!pending) return undefined;
  if (pending.expiresAt <= Date.now()) {
    pendingDeliveredAssets.delete(key);
    return undefined;
  }
  return pending;
}

export async function upscaleImage(config: AmadeusConfig, input: ImageUpscaleParameters, context: OpenClawPluginToolContext, signal?: AbortSignal): Promise<unknown> {
  const current = currentContextFor(context.sessionKey);
  const identity = identityContextFromOpenClaw(context);
  const origin = originForContext(context, current);
  const response = await serviceJson(config, '/v1/upscale', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(input.target?.imageId ? { imageId: input.target.imageId } : {}),
      ...(input.scale !== undefined ? { scale: input.scale } : {}),
      ...(input.mode !== undefined ? { mode: input.mode } : {}),
      ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
      ...(origin.conversationId ? { conversationId: origin.conversationId } : {}),
      ...(current?.replyToMessageId ? { replyMessageId: current.replyToMessageId } : {}),
    }),
  }, signal);
  const asset = parseServiceResult(response);
  const attachment = outputAttachment(config, asset);
  const pendingKey = current?.runId ?? context.sessionKey;
  if (pendingKey) {
    pendingDeliveredAssets.set(pendingKey, { assetIds: [asset.imageId], origin, expiresAt: Date.now() + IMAGE_CONTEXT_TTL_MS });
  }
  const mediaPath = attachment.path;
  return {
    status: 'ok',
    imageId: asset.imageId,
    parentImageId: asset.parentImageId,
    scale: asset.transform?.scale ?? input.scale ?? 2,
    mode: asset.transform?.mode ?? input.mode ?? 'auto',
    ...(asset.transform?.resolution ? { resolution: asset.transform.resolution } : input.resolution ? { resolution: input.resolution } : {}),
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    mediaUrl: mediaPath,
    mediaUrls: [mediaPath],
    attachments: [attachment],
    paths: [mediaPath],
    media: { mediaUrls: [mediaPath], attachments: [attachment], forceDocument: true },
    forceDocument: true,
    contentText: `Upscaled image ${asset.imageId}.`,
    ...(identity.channel ? { channel: identity.channel } : {}),
  };
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
    currentImageContexts.set(sessionKey, {
      sessionKey,
      ...(channel ? { channel } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(messageId ? { messageId } : {}),
      ...(replyToMessageId ? { replyToMessageId } : {}),
      expiresAt: Date.now() + IMAGE_CONTEXT_TTL_MS,
    });
  });
  api.on('after_tool_call', async (event, hookContext) => {
    if (event.toolName !== 'image_generate' || event.error) return;
    const paths = generatedPaths(event.result);
    if (!paths.length) return;
    const config = configFor(api);
    const current = currentContextFor(hookContext.sessionKey);
    const channel = text(hookContext.channelId) ?? current?.channel;
    const conversationId = current?.conversationId ?? hookContext.sessionKey;
    const origin: ImageAssetOrigin = {
      ...(channel ? { channel } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(current?.messageId ? { messageId: current.messageId } : {}),
      ...(current?.replyToMessageId ? { replyToMessageId: current.replyToMessageId } : {}),
      ...(current?.sessionId ? { sessionId: current.sessionId } : {}),
      ...(event.runId ? { runId: event.runId } : {}),
    };
    const assets: ImageAssetResult[] = [];
    for (const path of paths.slice(0, 4)) {
      try {
        assets.push(await importImageAsset(config, path, generatedMime(event.result, path), 'generated', origin, hookContext.abortSignal));
      } catch (error) {
        api.logger.warn(`amadeus image asset registration failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (event.runId && assets.length) pendingDeliveredAssets.set(event.runId, {
      assetIds: assets.map((asset) => asset.imageId),
      origin,
      expiresAt: Date.now() + IMAGE_CONTEXT_TTL_MS,
    });
  }, { matcher: ['image_generate'], timeoutMs: 60_000 });
  api.on('message_sent', async (event) => {
    if (!event.success || !event.messageId) return;
    const pending = pendingForKey(event.runId) ?? pendingForKey(event.sessionKey);
    if (!pending) return;
    try {
      await bindDeliveredAssets(configFor(api), pending.assetIds, event.messageId, pending.origin);
      if (event.runId) pendingDeliveredAssets.delete(event.runId);
      if (event.sessionKey) pendingDeliveredAssets.delete(event.sessionKey);
    } catch (error) {
      api.logger.warn(`amadeus image delivery correlation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  registerTool(api, 'amadeus_image_upscale', 'Upscale one existing image on the configured host service. Use only when the user explicitly asks to enhance or upscale an existing image; reply context is resolved before the current conversation’s recent image.', ImageUpscaleParameters, async (params, context, _notifier, signal) => upscaleImage(configFor(api), params, context, signal));
}

export { ImageUpscaleParameters };
