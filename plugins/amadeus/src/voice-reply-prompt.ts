import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';

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
  api.on('before_prompt_build', (_event, context) => {
    if (!hasActiveWhatsAppVoiceLease(context.channel ?? context.messageProvider, context.sessionKey)) return;
    return {
      appendSystemContext: [
        'The verified current WhatsApp run has an inbound audio attachment. The complete voice-reply Skill body is included below; do not call the read tool to retrieve that Skill again. Apply it directly to this final reply and do not generalize it to other runs.',
        skill,
      ].join('\n\n'),
    };
  });
}
