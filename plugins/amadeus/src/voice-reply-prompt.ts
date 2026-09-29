import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { parseStructuredReplyJson, validateReplyEnvelope, type ReplyEnvelope, type ReplyOrigin } from './reply-envelope.js';
import { planTypedReply, resolveReplyEnvelope } from './reply-planner.js';

/** The transport lease is lifecycle state, not modality state. */
export const WHATSAPP_VOICE_RUNS_GLOBAL = '__amadeusWhatsAppVoiceRuns20260925';
/** Stateless bridge used by the pinned OpenClaw TTS boundary to call this resolver. */
export const REPLY_ENVELOPE_RESOLVER_GLOBAL = '__amadeusReplyEnvelopeResolver20260929';
const REPLY_ENVELOPE_RUN_CONTEXT_NAMESPACE = 'amadeus.reply-envelope';

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

function originForContext(context: { inputProvenance?: { kind?: string; sourceTool?: string }; trigger?: string }): ReplyOrigin {
  if (context.trigger === 'heartbeat' || context.inputProvenance?.kind === 'heartbeat') return 'heartbeat';
  if (context.trigger === 'cron' || context.inputProvenance?.kind === 'cron' || context.inputProvenance?.sourceTool === 'cron') return 'cron';
  if (context.inputProvenance?.kind === 'inter_session') return 'internal_handoff';
  if (context.inputProvenance?.kind === 'internal_system') return 'system';
  return 'external_user';
}

function isReplyOrigin(value: unknown): value is ReplyOrigin {
  return value === 'external_user' || value === 'inbound_voice' || value === 'heartbeat'
    || value === 'cron' || value === 'internal_handoff' || value === 'system';
}

type ReplyEnvelopeRunContext = Readonly<{
  origin: ReplyOrigin;
  sessionKey?: string;
  channel?: string;
}>;

type ReplyEnvelopeResolverInput = Readonly<{
  runId?: unknown;
  sessionKey?: unknown;
  channel?: unknown;
  kind?: unknown;
  payload?: unknown;
  candidate?: unknown;
}>;

type ReplyEnvelopeResolver = (input: ReplyEnvelopeResolverInput) => ReplyEnvelope | null;

function fallbackRunId(input: ReplyEnvelopeResolverInput, sessionKey: string, channel: string): string {
  const payload = input.payload && typeof input.payload === 'object'
    ? input.payload as Record<string, unknown>
    : undefined;
  for (const key of ['replyToId', 'messageId', 'idempotencyKey', 'deliveryId']) {
    const value = payload?.[key];
    if (typeof value === 'string' && value.trim()) return `amadeus:${channel}:${sessionKey}:${key}:${value}`;
  }
  return `amadeus:${channel}:${sessionKey}:reply`;
}

function runContextFor(api: OpenClawPluginApi, runId: string): ReplyEnvelopeRunContext | undefined {
  const value = api.runContext?.getRunContext({ runId, namespace: REPLY_ENVELOPE_RUN_CONTEXT_NAMESPACE });
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  return isReplyOrigin(candidate.origin)
    ? {
      origin: candidate.origin,
      ...(typeof candidate.sessionKey === 'string' ? { sessionKey: candidate.sessionKey } : {}),
      ...(typeof candidate.channel === 'string' ? { channel: candidate.channel } : {}),
    }
    : undefined;
}

function candidateFromPayload(input: ReplyEnvelopeResolverInput): unknown {
  if (input.candidate !== undefined) return input.candidate;
  if (!input.payload || typeof input.payload !== 'object') return undefined;
  const payload = input.payload as Record<string, unknown>;
  return payload.amadeusEnvelope ?? payload.text;
}

function registerReplyEnvelopeResolver(api: OpenClawPluginApi): void {
  const resolver: ReplyEnvelopeResolver = (input) => {
    if (input.kind !== undefined && input.kind !== 'final') return null;
    const observedRunId = typeof input.runId === 'string' && input.runId.trim() ? input.runId : undefined;
    const runContext = observedRunId ? runContextFor(api, observedRunId) : undefined;
    const channel = typeof input.channel === 'string' && input.channel.trim()
      ? input.channel
      : runContext?.channel ?? 'unknown';
    const sessionKey = typeof input.sessionKey === 'string' && input.sessionKey.trim()
      ? input.sessionKey
      : runContext?.sessionKey ?? observedRunId ?? 'unknown';
    const runId = observedRunId ?? fallbackRunId(input, sessionKey, channel);
    const origin = runContext?.origin
      ?? (hasActiveWhatsAppVoiceLease(channel, sessionKey) ? 'inbound_voice' : 'external_user');
    const candidate = candidateFromPayload(input);
    const existing = validateReplyEnvelope(candidate)
      && candidate.runId === runId
      && candidate.sessionKey === sessionKey
      && candidate.channel === channel
      ? candidate
      : undefined;
    if (existing) return existing;
    const parsed = parseStructuredReplyJson(candidate);
    const plan = planTypedReply(parsed?.modality === 'voice'
      ? { modality: 'voice', answer_plan: 'answer_with_voice', ...(parsed.emotion ? { emotion: parsed.emotion } : {}) }
      : { modality: 'text', answer_plan: 'answer_with_text' });
    return resolveReplyEnvelope({
      runId,
      deliveryId: `${runId}:delivery`,
      sessionKey,
      channel,
      origin,
    }, candidate, plan);
  };
  (globalThis as Record<string, unknown>)[REPLY_ENVELOPE_RESOLVER_GLOBAL] = resolver;
}

export function registerVoiceReplyPrompt(api: OpenClawPluginApi): void {
  const skill = loadVoiceSkill(api);
  registerReplyEnvelopeResolver(api);
  api.on('before_prompt_build', ({ prompt: _prompt }, context) => {
    const channel = context.channel ?? context.messageProvider;
    const inboundVoice = hasActiveWhatsAppVoiceLease(channel, context.sessionKey);
    const origin = inboundVoice ? 'inbound_voice' : originForContext(context);
    if (context.runId) {
      api.runContext?.setRunContext({
        runId: context.runId,
        namespace: REPLY_ENVELOPE_RUN_CONTEXT_NAMESPACE,
        value: {
          origin,
          ...(context.sessionKey ? { sessionKey: context.sessionKey } : {}),
          ...(channel ? { channel: String(channel) } : {}),
        },
      });
    }
    if (inboundVoice) {
      return {
        appendSystemContext: [
          'The verified current WhatsApp run has an inbound audio attachment. The complete voice-reply Skill body is included below; apply it directly to this final reply and do not generalize it to other runs.',
          skill,
          'Return one strict JSON object with exactly visibleText, speechText, modality, and emotion. Use modality voice and a Japanese speechText for this run.',
        ].join('\n\n'),
      };
    }
    const isTypedWhatsApp = typeof channel === 'string' && channel.trim().toLowerCase() === 'whatsapp';
    const isExternalUserTurn = context.inputProvenance?.kind === 'external_user'
      || (context.inputProvenance === undefined && origin === 'external_user');
    if (isTypedWhatsApp && isExternalUserTurn) {
      return {
        appendSystemContext: [
          'This is an external WhatsApp turn. Decide the answer modality with the single structured reply planner. The planner input is strict JSON: {"modality":"text"|"voice","answer_plan":"answer_with_text"|"answer_with_voice","emotion":"default"|"irritated"|"embarrassed"|"angry"|"sarcastic"|"soft"|"sad"}. Questions about voice or TTS remain text answers; an explicit request for this answer as audio is voice; ambiguity defaults to text.',
          'Return the final answer as one strict JSON object with exactly visibleText, speechText, modality, and emotion. Never put routing metadata into visibleText. If modality is text, omit speechText. If modality is voice, speechText must be Japanese and visibleText must contain the final Chinese/Japanese contract from the Skill.',
          skill,
        ].join('\n\n'),
      };
    }
    // Internal runs are represented by a silent envelope at the resolver
    // boundary. Keep this hook free of a session registry or text protocol.
    if (origin !== 'external_user') {
      return;
    }
    return;
  });
  api.on('reply_payload_sending', (event) => {
    const runId = typeof event.runId === 'string' && event.runId ? event.runId : undefined;
    if (event.kind !== undefined && event.kind !== 'final') return;
    const resolver = (globalThis as Record<string, unknown>)[REPLY_ENVELOPE_RESOLVER_GLOBAL] as ReplyEnvelopeResolver | undefined;
    const envelope = resolver?.({
      runId,
      sessionKey: event.sessionKey,
      channel: event.channel,
      kind: event.kind,
      payload: event.payload,
    });
    if (!envelope) return;
    if (envelope.silent) return { cancel: true, reason: 'silent_reply_envelope' };
    return {
      payload: {
        ...event.payload,
        text: envelope.visibleText,
        amadeusEnvelope: envelope,
        ...(envelope.speechText ? { spokenText: envelope.speechText } : {}),
      },
    };
  });
}
