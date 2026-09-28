import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import {
  clearReplyModalityForTurn,
  setReplyModalityForTurn,
} from './reply-modality.js';

// Pinned WhatsApp lifecycle patch creates this registry only for admitted audio
// turns, before Agent dispatch, and removes each lease after full delivery.
export const WHATSAPP_VOICE_RUNS_GLOBAL = '__amadeusWhatsAppVoiceRuns20260925';

type VoiceLease = { closed?: unknown; messageId?: unknown; sessionKey?: unknown };

export function hasActiveWhatsAppVoiceLease(channel: unknown, sessionKey: unknown): boolean {
  if (typeof channel !== 'string' || channel.trim().toLowerCase() !== 'whatsapp') return false;
  if (typeof sessionKey !== 'string' || !sessionKey) return false;
  const registry = (globalThis as Record<string, unknown>)[WHATSAPP_VOICE_RUNS_GLOBAL];
  if (!(registry instanceof Map)) return false;
  const lease = registry.get(sessionKey) as VoiceLease | undefined;
  return Boolean(lease && lease.closed === false && lease.sessionKey === sessionKey
    && typeof lease.messageId === 'string' && lease.messageId);
}

function loadVoiceSkill(api: OpenClawPluginApi): string {
  const pluginRoot = api.rootDir ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const raw = readFileSync(resolve(pluginRoot, 'skills/voice-reply/SKILL.md'), 'utf8');
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, '').trim();
  if (!body) throw new Error('voice-reply Skill body is empty');
  return body;
}

export function registerVoiceReplyPrompt(api: OpenClawPluginApi): void {
  const skill = loadVoiceSkill(api);
  api.on('before_prompt_build', ({ prompt: _prompt }, context) => {
    const channel = context.channel ?? context.messageProvider;
    const inboundVoice = hasActiveWhatsAppVoiceLease(channel, context.sessionKey);
    if (inboundVoice) {
      clearReplyModalityForTurn(context);
      return {
        appendSystemContext: [
          'The verified current WhatsApp run has an inbound audio attachment. The complete voice-reply Skill body is included below; do not call the read tool to retrieve that Skill again. Apply it directly to this final reply and do not generalize it to other runs.',
          skill,
        ].join('\n\n'),
      };
    }
    const isTypedWhatsApp = typeof channel === 'string' && channel.trim().toLowerCase() === 'whatsapp';
    // OpenClaw supplies native turn provenance. Heartbeats, cron runs, and
    // internal handoffs can share the WhatsApp route but must not receive a
    // user-reply modality protocol or emit its control marker.
    const isExternalUserTurn = context.inputProvenance?.kind === 'external_user';
    if (isTypedWhatsApp && isExternalUserTurn) {
      // The model makes the semantic decision in this same Agent turn. The
      // runtime only trusts its explicit control marker; no user-text regex or
      // second classifier is involved. Default is fail-closed until the model
      // emits the current turn's voice marker.
      setReplyModalityForTurn(context, 'default');
      return {
        appendSystemContext: [
          'The runtime has initialized this turn-scoped replyModality to default. Before answering, semantically classify the user\'s requested reply modality from the complete current request and conversation context, then set replyModality to voice or default. Do not classify by matching fixed trigger words. An explicit request for this answer to be sent, told, or answered as a voice/audio reply is voice; a question about how voice, TTS, or audio works is default; an ordinary translation request is default; if intent is ambiguous, choose default.',
          'Your final payload MUST begin with exactly one hidden control line, either [[amadeus:reply-modality=voice]] or [[amadeus:reply-modality=default]], followed immediately by the user-facing answer. The line is the serialized replyModality metadata for the current turn, not user-visible text. Never mention it, omit it, or put a second modality marker in the answer.',
          'When and only when your semantic decision is voice, apply the canonical voice-reply Skill body below and produce its exact Chinese/Japanese plus TTS contract. When the decision is default, answer normally and do not produce a Japanese voice line or TTS directive. This modality belongs only to the current turn; never create or change the verified inbound voice lease and never carry it into a later turn.',
          skill,
        ].join('\n\n'),
      };
    }
    clearReplyModalityForTurn(context);
    return;
  });
  api.on('agent_end', (_event, context) => {
    clearReplyModalityForTurn(context);
  });
}
