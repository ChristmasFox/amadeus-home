import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';

export const VOICE_RUN_TTL_MS = 10 * 60_000;
export const VOICE_RUN_MAX = 128;

type MediaFact = { kind?: unknown; contentType?: unknown };
type VoiceRun = { expiresAt: number; runId?: string; sessionKey?: string };

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
  private readonly sessionRunKeys = new Map<string, string>();

  record(channel: unknown, runId: unknown, media: unknown, now = Date.now(), sessionKey?: unknown): boolean {
    const normalizedRunId = typeof runId === 'string' && runId ? runId : undefined;
    const normalizedSessionKey = typeof sessionKey === 'string' && sessionKey ? sessionKey : undefined;
    if (channel !== 'whatsapp' || (!normalizedRunId && !normalizedSessionKey) || !includesAudio(media)) return false;
    this.prune(now);
    const key = normalizedRunId ? `run:${normalizedRunId}` : `session:${normalizedSessionKey}`;
    if (normalizedSessionKey) {
      const previousKey = this.sessionRunKeys.get(normalizedSessionKey);
      if (previousKey && previousKey !== key) this.deleteRun(previousKey);
      this.sessionRunKeys.set(normalizedSessionKey, key);
    }
    this.runs.set(key, {
      expiresAt: now + VOICE_RUN_TTL_MS,
      ...(normalizedRunId ? { runId: normalizedRunId } : {}),
      ...(normalizedSessionKey ? { sessionKey: normalizedSessionKey } : {}),
    });
    while (this.runs.size > VOICE_RUN_MAX) {
      const oldest = this.runs.keys().next().value;
      if (oldest === undefined) break;
      this.deleteRun(oldest);
    }
    return true;
  }

  shouldInject(channel: unknown, runId: unknown, now = Date.now(), sessionKey?: unknown): boolean {
    this.prune(now);
    if (channel !== 'whatsapp') return false;
    const normalizedRunId = typeof runId === 'string' && runId ? runId : undefined;
    const normalizedSessionKey = typeof sessionKey === 'string' && sessionKey ? sessionKey : undefined;
    if (normalizedRunId && this.runs.has(`run:${normalizedRunId}`)) return true;
    if (!normalizedSessionKey) return false;
    const sessionKeyIndex = this.sessionRunKeys.get(normalizedSessionKey);
    if (!sessionKeyIndex) return false;
    const pending = this.runs.get(sessionKeyIndex);
    if (!pending) {
      this.sessionRunKeys.delete(normalizedSessionKey);
      return false;
    }
    if (pending.runId) return pending.runId === normalizedRunId;
    if (!normalizedRunId) return false;
    this.deleteRun(sessionKeyIndex);
    const runKey = `run:${normalizedRunId}`;
    this.runs.set(runKey, { ...pending, runId: normalizedRunId });
    this.sessionRunKeys.set(normalizedSessionKey, runKey);
    return true;
  }

  clear(runId: unknown, sessionKey?: unknown): void {
    const normalizedRunId = typeof runId === 'string' && runId ? runId : undefined;
    const normalizedSessionKey = typeof sessionKey === 'string' && sessionKey ? sessionKey : undefined;
    if (normalizedRunId) this.deleteRun(`run:${normalizedRunId}`);
    if (!normalizedSessionKey) return;
    const key = this.sessionRunKeys.get(normalizedSessionKey);
    if (!key) return;
    const run = this.runs.get(key);
    if (!run) {
      this.sessionRunKeys.delete(normalizedSessionKey);
      return;
    }
    // A prior run ending must not clear an unbound voice marker or a different run's marker.
    if (run.runId ? run.runId === normalizedRunId : normalizedRunId === undefined) this.deleteRun(key);
  }

  private deleteRun(key: string): void {
    const run = this.runs.get(key);
    if (!run) return;
    this.runs.delete(key);
    if (run.sessionKey && this.sessionRunKeys.get(run.sessionKey) === key) this.sessionRunKeys.delete(run.sessionKey);
  }

  private prune(now: number): void {
    for (const [key, run] of this.runs) if (run.expiresAt <= now) this.deleteRun(key);
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
    tracker.record(
      context.channelId,
      event.runId ?? context.runId,
      [...(event.media ?? []), ...(event.originalMedia ?? [])],
      Date.now(),
      event.sessionKey ?? context.sessionKey,
    );
  });
  api.on('before_prompt_build', (_event, context) => {
    if (!tracker.shouldInject(context.channel ?? context.channelId, context.runId, Date.now(), context.sessionKey)) return;
    return {
      appendSystemContext: [
        'The verified current WhatsApp run has an inbound audio attachment. The complete voice-reply Skill body is included below; do not call the read tool to retrieve that Skill again. Apply it directly to this final reply and do not generalize it to other runs.',
        skill,
      ].join('\n\n'),
    };
  });
  api.on('agent_end', (_event, context) => {
    tracker.clear(context.runId, context.sessionKey);
  });
}
