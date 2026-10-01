import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';

/**
 * A language model must not pick a concrete image provider/model. Omitting the
 * override makes native image_generate resolve the operator-owned configured
 * capability (currently openai/amadeus-image and its 9Router fallback chain).
 */
export function removeImageGenerationModelOverride(params: Record<string, unknown>): Record<string, unknown> | undefined {
  const action = typeof params.action === 'string' ? params.action.trim().toLowerCase() : '';
  if (action === 'list' || action === 'status' || !Object.hasOwn(params, 'model')) return undefined;
  const { model: _untrustedModel, ...configured } = params;
  return configured;
}

export function registerImageGenerationToolPolicy(api: OpenClawPluginApi): void {
  api.on('before_tool_call', (event) => {
    if (event.toolName !== 'image_generate') return;
    const rewritten = removeImageGenerationModelOverride(event.params);
    if (!rewritten) return;
    api.logger.warn('amadeus ignored model override for image_generate; using configured image capability');
    return { params: rewritten };
  }, { matcher: ['image_generate'] });
}
