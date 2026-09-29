/**
 * The single structured contract carried from an Amadeus run to channel
 * settlement.  Nothing in this module depends on a channel implementation.
 */

export type ReplyModality = 'text' | 'voice';

export type ReplyOrigin =
  | 'external_user'
  | 'inbound_voice'
  | 'heartbeat'
  | 'cron'
  | 'internal_handoff'
  | 'system';

export type ReplySource =
  | 'agent_structured_output'
  | 'inbound_voice_policy'
  | 'system_silent';

export type ReplyEmotion =
  | 'default'
  | 'irritated'
  | 'embarrassed'
  | 'angry'
  | 'sarcastic'
  | 'soft'
  | 'sad';

export type ReplyEnvelope = Readonly<{
  version: 1;
  runId: string;
  deliveryId: string;
  sessionKey: string;
  channel: string;
  origin: ReplyOrigin;
  modality: ReplyModality;
  silent: boolean;
  visibleText: string;
  speechText?: string;
  emotion?: ReplyEmotion;
  source: ReplySource;
  fallbackReason?: 'planner_invalid' | 'speech_missing' | 'tts_failed';
}>;

export type ReplyContext = Readonly<{
  runId: string;
  sessionKey: string;
  channel: string;
  origin: ReplyOrigin;
  deliveryId?: string;
}>;

const EMOTIONS = new Set<ReplyEmotion>([
  'default',
  'irritated',
  'embarrassed',
  'angry',
  'sarcastic',
  'soft',
  'sad',
]);

const ORIGINS = new Set<ReplyOrigin>([
  'external_user',
  'inbound_voice',
  'heartbeat',
  'cron',
  'internal_handoff',
  'system',
]);

const SOURCES = new Set<ReplySource>([
  'agent_structured_output',
  'inbound_voice_policy',
  'system_silent',
]);

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function containsInternalControlToken(value: unknown): boolean {
  return typeof value === 'string' && /\[\[[^\]\r\n]+\]\]/u.test(value);
}

function visibleReplyText(value: string): string {
  return value.replace(/\[\[[^\]\r\n]+\]\]/gu, '').trim();
}

function immutable<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

export function validateReplyEnvelope(value: unknown): value is ReplyEnvelope {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Record<string, unknown>;
  if (envelope.version !== 1
    || !nonEmpty(envelope.runId)
    || !nonEmpty(envelope.deliveryId)
    || !nonEmpty(envelope.sessionKey)
    || !nonEmpty(envelope.channel)
    || !ORIGINS.has(envelope.origin as ReplyOrigin)
    || !(['text', 'voice'] as const).includes(envelope.modality as ReplyModality)
    || typeof envelope.silent !== 'boolean'
    || typeof envelope.visibleText !== 'string'
    || !SOURCES.has(envelope.source as ReplySource)) return false;
  if (containsInternalControlToken(envelope.visibleText)) return false;
  if (envelope.emotion !== undefined && !EMOTIONS.has(envelope.emotion as ReplyEmotion)) return false;
  if (envelope.speechText !== undefined && typeof envelope.speechText !== 'string') return false;
  if (containsInternalControlToken(envelope.speechText)) return false;
  if (envelope.fallbackReason !== undefined
    && !['planner_invalid', 'speech_missing', 'tts_failed'].includes(String(envelope.fallbackReason))) return false;
  if (envelope.silent) {
    return envelope.modality === 'text'
      && envelope.visibleText === ''
      && envelope.speechText === undefined;
  }
  if (!envelope.visibleText.trim()) return false;
  if (envelope.modality === 'voice') {
    if (!nonEmpty(envelope.speechText)) return false;
    if (!/[\u3040-\u30ff]/u.test(envelope.speechText)) return false;
  } else if (envelope.speechText !== undefined) return false;
  return true;
}

export function createReplyEnvelope(value: Omit<ReplyEnvelope, 'version'>): ReplyEnvelope {
  const envelope = immutable({ version: 1 as const, ...value });
  if (!validateReplyEnvelope(envelope)) throw new Error('invalid_reply_envelope');
  return envelope;
}

export function createSilentEnvelope(context: ReplyContext): ReplyEnvelope {
  return createReplyEnvelope({
    runId: context.runId,
    deliveryId: context.deliveryId ?? `${context.runId}:silent`,
    sessionKey: context.sessionKey,
    channel: context.channel,
    origin: context.origin,
    modality: 'text',
    silent: true,
    visibleText: '',
    source: 'system_silent',
  });
}

export function createTextEnvelope(
  context: ReplyContext,
  visibleText: string,
  options: Pick<ReplyEnvelope, 'source' | 'fallbackReason'> = { source: 'agent_structured_output' },
): ReplyEnvelope {
  return createReplyEnvelope({
    runId: context.runId,
    deliveryId: context.deliveryId ?? `${context.runId}:text`,
    sessionKey: context.sessionKey,
    channel: context.channel,
    origin: context.origin,
    modality: 'text',
    silent: false,
    visibleText: visibleReplyText(visibleText),
    source: options.source,
    ...(options.fallbackReason ? { fallbackReason: options.fallbackReason } : {}),
  });
}

export function createVoiceEnvelope(
  context: ReplyContext,
  visibleText: string,
  speechText: string,
  emotion: ReplyEmotion = 'default',
  source: ReplySource = 'agent_structured_output',
): ReplyEnvelope {
  return createReplyEnvelope({
    runId: context.runId,
    deliveryId: context.deliveryId ?? `${context.runId}:voice`,
    sessionKey: context.sessionKey,
    channel: context.channel,
    origin: context.origin,
    modality: 'voice',
    silent: false,
    visibleText: visibleReplyText(visibleText),
    speechText: visibleReplyText(speechText),
    emotion,
    source,
  });
}

export function parseStructuredReply(value: unknown): {
  visibleText: string;
  speechText?: string;
  modality?: ReplyModality;
  emotion?: ReplyEmotion;
  silent?: boolean;
} | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (keys.some((key) => !['visibleText', 'speechText', 'modality', 'emotion', 'silent'].includes(key))) return null;
  if (typeof candidate.visibleText !== 'string') return null;
  if (candidate.speechText !== undefined && typeof candidate.speechText !== 'string') return null;
  if (candidate.modality !== undefined && candidate.modality !== 'text' && candidate.modality !== 'voice') return null;
  if (candidate.emotion !== undefined && !EMOTIONS.has(candidate.emotion as ReplyEmotion)) return null;
  if (candidate.silent !== undefined && typeof candidate.silent !== 'boolean') return null;
  return {
    visibleText: candidate.visibleText,
    ...(candidate.speechText !== undefined ? { speechText: candidate.speechText } : {}),
    ...(candidate.modality !== undefined ? { modality: candidate.modality as ReplyModality } : {}),
    ...(candidate.emotion !== undefined ? { emotion: candidate.emotion as ReplyEmotion } : {}),
    ...(candidate.silent !== undefined ? { silent: candidate.silent } : {}),
  };
}

export function parseStructuredReplyJson(value: unknown): ReturnType<typeof parseStructuredReply> {
  if (typeof value !== 'string') return parseStructuredReply(value);
  try {
    return parseStructuredReply(JSON.parse(value));
  } catch {
    return null;
  }
}
