import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';

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

export function registerImageGenerationToolPolicy(api: OpenClawPluginApi): void {
  api.on('before_tool_call', (event) => {
    if (event.toolName !== 'image_generate') return;
    const rewritten = clearImageGenerationModelOverride(event.params);
    if (!rewritten) return;
    api.logger.warn('amadeus ignored model override for image_generate; using configured image capability');
    return { params: rewritten };
  }, { matcher: ['image_generate'] });
}
