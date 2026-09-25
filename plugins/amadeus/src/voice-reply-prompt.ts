import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';

export const VOICE_RUN_TTL_MS = 10 * 60_000;
export const VOICE_RUN_MAX = 128;

type MediaFact = { kind?: unknown; contentType?: unknown };
type VoiceRun = { expiresAt: number };

function includesAudio(media: unknown): boolean {
  if (!Array.isArray(media)) return false;
  return media.some((value) => {
    if (!value || typeof value !== 'object') return false;
    const fact = value as MediaFact;
    return fact.kind === 'audio' || (typeof fact.contentType === 'string' && fact.contentType.toLowerCase().startsWith('audio/'));
  });
}

export class VoiceReplyTurnTracker {
  private readonly runs = new Map<string, VoiceRun>();

  record(channel: unknown, runId: unknown, media: unknown, now = Date.now()): boolean {
    if (channel !== 'whatsapp' || typeof runId !== 'string' || !runId || !includesAudio(media)) return false;
    this.prune(now);
    this.runs.set(runId, { expiresAt: now + VOICE_RUN_TTL_MS });
    while (this.runs.size > VOICE_RUN_MAX) {
      const oldest = this.runs.keys().next().value;
      if (oldest === undefined) break;
      this.runs.delete(oldest);
    }
    return true;
  }

  shouldInject(channel: unknown, runId: unknown, now = Date.now()): boolean {
    this.prune(now);
    return channel === 'whatsapp' && typeof runId === 'string' && this.runs.has(runId);
  }

  private prune(now: number): void {
    for (const [runId, run] of this.runs) if (run.expiresAt <= now) this.runs.delete(runId);
  }
}

function loadVoiceSkill(api: OpenClawPluginApi): string {
  const pluginRoot = api.rootDir ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const raw = readFileSync(resolve(pluginRoot, 'skills/voice-reply/SKILL.md'), 'utf8');
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, '').trim();
  if (!body) throw new Error('voice-reply Skill body is empty');
  return body;
}

export function registerVoiceReplyPrompt(api: OpenClawPluginApi): void {
  const tracker = new VoiceReplyTurnTracker();
  const skill = loadVoiceSkill(api);
  api.on('message_received', (event, context) => {
    tracker.record(context.channelId, event.runId ?? context.runId, [...(event.media ?? []), ...(event.originalMedia ?? [])]);
  });
  api.on('before_prompt_build', (_event, context) => {
    if (!tracker.shouldInject(context.channel, context.runId)) return;
    return {
      appendSystemContext: [
        'The verified current WhatsApp run has an inbound audio attachment. The complete voice-reply Skill body is included below; do not call the read tool to retrieve that Skill again. Apply it directly to this final reply and do not generalize it to other runs.',
        skill,
      ].join('\n\n'),
    };
  });
}
