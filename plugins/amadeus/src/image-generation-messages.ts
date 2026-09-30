import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { normalizeImageCaption, resolveKurisuPersona } from './image-caption.js';

export type ImageGenerationMessageKind = 'accepted' | 'failed';
const MESSAGE_TIMEOUT_MS = 2_000;
const MAX_MESSAGE_LENGTH = 220;
const FALLBACKS: Record<ImageGenerationMessageKind, string> = {
  accepted: '画像生成を始めたわ。少し待ちなさい。',
  failed: '画像生成に失敗したわ。条件を変えて、もう一度試して。',
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('lifecycle_message_timeout'), { code: 'timeout' })), timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export function createImageGenerationMessageEnricher(api: OpenClawPluginApi) {
  return async (kind: ImageGenerationMessageKind, agentId: string): Promise<string> => {
    try {
      const { persona } = await resolveKurisuPersona(api, agentId);
      const task = kind === 'accepted'
        ? 'The image-generation task has actually been accepted and detached. Tell the user briefly that it has started and ask them to wait.'
        : 'The image-generation task failed. Clearly tell the user it did not complete and invite them to try changing the request. Do not expose internal failure details.';
      const generated = await withTimeout(api.runtime.subagent.complete({
        agentId,
        message: `${task}\nReturn only one short, natural, plain-text sentence. Do not mention task IDs, sessions, providers, exceptions, URLs, or internal systems.`,
        ...(persona ? { extraSystemPrompt: `Follow this current Kurisu persona guidance for style only:\n${persona}` } : {}),
        timeoutMs: MESSAGE_TIMEOUT_MS,
      }), MESSAGE_TIMEOUT_MS + 250);
      const normalized = normalizeImageCaption(generated?.text);
      if (normalized && normalized.length <= MAX_MESSAGE_LENGTH) return normalized;
    } catch { /* use the safe local fallback; never block task settlement */ }
    return FALLBACKS[kind];
  };
}
