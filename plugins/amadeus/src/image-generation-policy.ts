import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';

const CONFIGURED_AMADEUS_IMAGE_MODEL = 'openai/amadeus-image';
const SUPPORTED_IMAGE_SIZES = new Set([
  '1024x1024', '1536x1024', '1024x1536', '2048x2048', '2048x1152', '3840x2160', '2160x3840',
]);

type ImageOrientation = 'square' | 'landscape' | 'portrait';

function orientationForAspectRatio(value: unknown): ImageOrientation | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/u.exec(value.trim());
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  const ratio = width / height;
  return ratio < 0.85 ? 'portrait' : ratio > 1.18 ? 'landscape' : 'square';
}

function configuredSize(orientation: ImageOrientation, resolution: string | undefined): string {
  const tier = resolution?.trim().toUpperCase();
  if (tier === '4K') {
    if (orientation === 'portrait') return '2160x3840';
    if (orientation === 'landscape') return '3840x2160';
    return '2048x2048';
  }
  if (tier === '2K') {
    if (orientation === 'portrait') return '1024x1536'; // closest portrait size not exceeding 2K
    if (orientation === 'landscape') return '2048x1152';
    return '2048x2048';
  }
  if (orientation === 'portrait') return '1024x1536';
  if (orientation === 'landscape') return '1536x1024';
  return '1024x1024';
}

/**
 * The logical image Combo accepts OpenAI-compatible calls but its selected
 * OpenAI adapter advertises only discrete sizes, not arbitrary ratio/resolution.
 * Translate those preferences to a bounded supported size instead of allowing
 * unsupported 2K ratios to be promoted to a 4K dimensions fallback.
 */
export function normalizeAmadeusImageGeometry(params: Record<string, unknown>): Record<string, unknown> | undefined {
  const aspect = typeof params.aspectRatio === 'string' ? params.aspectRatio.trim() : '';
  const resolution = typeof params.resolution === 'string' ? params.resolution.trim().toUpperCase() : '';
  if (!aspect && !resolution) return undefined;
  if (resolution && !['1K', '2K', '4K'].includes(resolution)) return undefined;
  const orientation = aspect ? orientationForAspectRatio(aspect) : 'square';
  if (!orientation) return undefined;

  const currentSize = typeof params.size === 'string' ? params.size.trim() : '';
  let size: string;
  if (currentSize && SUPPORTED_IMAGE_SIZES.has(currentSize) && !resolution) size = currentSize;
  else size = configuredSize(orientation, resolution || undefined);
  return { size, aspectRatio: '', resolution: '' };
}

/**
 * A language model must not pick a concrete image provider/model. Clearing the
 * override makes native image_generate resolve the operator-owned configured
 * capability (currently openai/amadeus-image and its 9Router fallback chain).
 */
export function clearImageGenerationModelOverride(params: Record<string, unknown>): Record<string, unknown> | undefined {
  const action = typeof params.action === 'string' ? params.action.trim().toLowerCase() : '';
  if (action === 'list' || action === 'status' || !Object.hasOwn(params, 'model')) return undefined;
  // OpenClaw 2026.9.4 merges hook params over original params; omission alone
  // therefore does not delete the model key. The native tool treats blank as
  // no override and resolves its configured media-model capability.
  return { ...params, model: '' };
}

function configuredImageModel(api: OpenClawPluginApi): string | undefined {
  const config = api.config as unknown as { agents?: { defaults?: { mediaModels?: { image?: unknown } } } };
  const image = config.agents?.defaults?.mediaModels?.image;
  if (typeof image === 'string') return image.trim() || undefined;
  if (image && typeof image === 'object' && !Array.isArray(image)) {
    const primary = (image as Record<string, unknown>).primary;
    return typeof primary === 'string' ? primary.trim() || undefined : undefined;
  }
  return undefined;
}

function safeImageRouteLabel(value: string | undefined): string | null {
  if (!value || value.length > 160 || !/^[a-z0-9_.-]+\/[a-z0-9_.:-]+$/iu.test(value)) return null;
  return value;
}

export function registerImageGenerationToolPolicy(api: OpenClawPluginApi): void {
  api.on('before_tool_call', (event) => {
    if (event.toolName !== 'image_generate') return;
    const params = event.params;
    const action = typeof params.action === 'string' ? params.action.trim().toLowerCase() : '';
    if (action === 'list' || action === 'status') return;

    const authoredModel = typeof params.model === 'string' ? params.model.trim() : '';
    const overridePresent = authoredModel.length > 0;
    api.logger.info(JSON.stringify({
      event: 'image_route_tool_override_observed',
      runId: event.runId,
      toolCallId: event.toolCallId,
      overridePresent,
      overrideIgnored: overridePresent,
      configuredLogicalModel: safeImageRouteLabel(configuredImageModel(api)),
    }));

    const modelRewrite = clearImageGenerationModelOverride(params);
    const geometryRewrite = configuredImageModel(api)?.toLowerCase() === CONFIGURED_AMADEUS_IMAGE_MODEL
      ? normalizeAmadeusImageGeometry(params)
      : undefined;
    if (!modelRewrite && !geometryRewrite) return;

    if (modelRewrite) api.logger.warn('amadeus ignored model override for image_generate; using configured image capability');
    if (geometryRewrite) api.logger.warn(`amadeus normalized image geometry to ${String(geometryRewrite.size)}`);
    return { params: { ...params, ...modelRewrite, ...geometryRewrite } };
  }, { matcher: ['image_generate'] });
}
