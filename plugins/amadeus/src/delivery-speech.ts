import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import type { DeliveryEmotion } from './delivery-envelope.js';

/** One logical speech route: existing authenticated 9Router bridge owns fallback. */
export function createDeliverySpeech(api: OpenClawPluginApi) {
  return async ({ text, emotion, deadlineAt }: { text: string; emotion: DeliveryEmotion; deadlineAt: number }) => {
    if (!text || text.length > 1200) throw new Error('speech_text_limit');
    const config = api.config.tts?.providers?.openai as Record<string, unknown> | undefined;
    if (!config || typeof config.baseUrl !== 'string' || config.model !== 'amadeus-tts' || config.speakerVoice !== 'kurisu-v1') throw new Error('speech_route_invalid');
    const credential = config.apiKey;
    const key = typeof credential === 'string' ? credential : credential && typeof credential === 'object' && (credential as Record<string, unknown>).source === 'env'
      ? process.env[String((credential as Record<string, unknown>).id)] : undefined;
    if (!key) throw new Error('speech_credential_unavailable');
    const timeout = Math.min(110_000, deadlineAt - Date.now());
    if (timeout <= 0) throw new Error('speech_deadline_exceeded');
    const response = await fetch(`${config.baseUrl.replace(/\/$/u, '')}/audio/speech`, {
      method: 'POST', signal: AbortSignal.timeout(timeout),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, voice: config.speakerVoice, input: text, response_format: 'mp3', style: emotion }),
    });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) throw new Error('speech_provider_failed');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('speech_body_missing');
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 25 * 1024 * 1024) throw new Error('speech_audio_limit'); chunks.push(value); } }
    finally { await reader.cancel(); }
    const audio = Buffer.concat(chunks);
    if (audio.length < 32) throw new Error('speech_audio_invalid');
    return { audio, mimeType: 'audio/mpeg' };
  };
}
