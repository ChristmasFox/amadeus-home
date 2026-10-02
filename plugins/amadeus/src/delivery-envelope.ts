/**
 * DeliveryEnvelope v2 is the only Amadeus user-facing settlement contract.
 *
 * Agent protocol JSON is decoded once at this boundary. Everything below this
 * module receives typed parts; it must never receive the serialized protocol
 * string as presentation text.
 */

export type DeliveryOrigin =
  | 'external_user'
  | 'inbound_voice'
  | 'heartbeat'
  | 'cron'
  | 'internal_handoff'
  | 'media_completion'
  | 'system';

export type DeliverySource =
  | 'agent_structured_output'
  | 'inbound_voice_policy'
  | 'tool_result'
  | 'image_generation_lifecycle'
  | 'system_silent';

export type DeliveryEmotion =
  | 'default'
  | 'irritated'
  | 'embarrassed'
  | 'angry'
  | 'sarcastic'
  | 'soft'
  | 'sad';


export type DeliveryContext = Readonly<{
  runId: string;
  sessionKey: string;
  channel: string;
  origin: DeliveryOrigin;
  deliveryId?: string;
}>;

export type TextPart = Readonly<{
  kind: 'text';
  text: string;
}>;

export type VoicePart = Readonly<{
  kind: 'voice';
  speechText: string;
  emotion: DeliveryEmotion;
}>;

export type AttachmentDisposition = 'inline' | 'document';

export type AttachmentPart = Readonly<{
  kind: 'attachment';
  assetId: string;
  mimeType: string;
  fileName: string;
  disposition: AttachmentDisposition;
  byteSize?: number;
  sha256?: string;
  /** Plain user-visible caption for native inline image delivery only. */
  caption?: string;
}>;

export type DeliveryPart = TextPart | VoicePart | AttachmentPart;

export type DeliveryEnvelope = Readonly<{
  version: 2;
  runId: string;
  deliveryId: string;
  sessionKey: string;
  channel: string;
  origin: DeliveryOrigin;
  silent: boolean;
  parts: readonly DeliveryPart[];
  source: DeliverySource;
  fallbackReason?: 'planner_invalid' | 'speech_missing' | 'tts_failed' | 'invalid_structured_output';
}>;

const EMOTIONS = new Set<DeliveryEmotion>([
  'default',
  'irritated',
  'embarrassed',
  'angry',
  'sarcastic',
  'soft',
  'sad',
]);

const ORIGINS = new Set<DeliveryOrigin>([
  'external_user',
  'inbound_voice',
  'heartbeat',
  'cron',
  'internal_handoff',
  'media_completion',
  'system',
]);

const SOURCES = new Set<DeliverySource>([
  'agent_structured_output',
  'inbound_voice_policy',
  'tool_result',
  'image_generation_lifecycle',
  'system_silent',
]);

const CONTROL_TOKEN = /\[\[[^\]\r\n]+\]\]/u;
const SHA256 = /^[a-f0-9]{64}$/iu;

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function immutable<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function containsControlToken(value: unknown): boolean {
  return typeof value === 'string' && CONTROL_TOKEN.test(value);
}

function isJsonValue(value: string): boolean {
  try { JSON.parse(value); return true; } catch { return false; }
}

function cleanText(value: string): string {
  const text = value.trim();
  if (!text || containsControlToken(text)) throw new Error('delivery_text_contains_control_token');
  return text;
}

/** Normalize caption presentation before it enters the typed delivery contract. */
function cleanCaption(value: string): string {
  const caption = value.normalize('NFC').replace(/[\r\n\t]+/gu, ' ').replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').replace(/\s{2,}/gu, ' ').trim();
  if (!caption || containsControlToken(caption)) throw new Error('delivery_caption_invalid');
  // Protocol-shaped/model-serialized output is never presentation. Do not try
  // to salvage JSON or fenced protocol by stringifying/stripping it.
  if (/^(?:\{[\s\S]*\}|\[[\s\S]*\]|```)/u.test(caption) || /(?:"(?:caption|deliveryId|assetId|disposition)"\s*:|\bMEDIA\s*:)/iu.test(caption) || isJsonValue(caption)) throw new Error('delivery_caption_protocol_rejected');
  return caption;
}

function sanitizedFileName(value: string): string {
  const name = value.trim().replaceAll('\\', '/').split('/').pop() ?? '';
  if (!name || name === '.' || name === '..' || /[\x00-\x1f]/u.test(name)) throw new Error('delivery_file_name_invalid');
  return name.slice(0, 255);
}

function validByteSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validAttachment(value: unknown): value is AttachmentPart {
  if (!value || typeof value !== 'object') return false;
  const attachment = value as Record<string, unknown>;
  if (Object.keys(attachment).some((key) => !['kind','assetId','mimeType','fileName','disposition','byteSize','sha256','caption'].includes(key))) return false;
  if (attachment.kind !== 'attachment'
    || !nonEmpty(attachment.assetId)
    || typeof attachment.mimeType !== 'string' || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u.test(attachment.mimeType)
    || !nonEmpty(attachment.fileName)
    || (attachment.disposition !== 'inline' && attachment.disposition !== 'document')) return false;
  try { if (sanitizedFileName(String(attachment.fileName)) !== attachment.fileName) return false; } catch { return false; }
  if (attachment.byteSize !== undefined && !validByteSize(attachment.byteSize)) return false;
  if (attachment.sha256 !== undefined && (typeof attachment.sha256 !== 'string' || !SHA256.test(attachment.sha256))) return false;
  if (attachment.caption !== undefined) {
    if (attachment.disposition !== 'inline' || !String(attachment.mimeType).startsWith('image/')) return false;
    if (typeof attachment.caption !== 'string') return false;
    try { if (cleanCaption(attachment.caption) !== attachment.caption) return false; } catch { return false; }
  }
  return true;
}

export function validateDeliveryEnvelope(value: unknown): value is DeliveryEnvelope {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Record<string, unknown>;
  if (Object.keys(envelope).some((key) => !['version','runId','deliveryId','sessionKey','channel','origin','silent','parts','source','fallbackReason'].includes(key))) return false;
  if (envelope.version !== 2
    || !nonEmpty(envelope.runId)
    || !nonEmpty(envelope.deliveryId)
    || !nonEmpty(envelope.sessionKey)
    || !nonEmpty(envelope.channel)
    || !ORIGINS.has(envelope.origin as DeliveryOrigin)
    || typeof envelope.silent !== 'boolean'
    || !Array.isArray(envelope.parts)
    || !SOURCES.has(envelope.source as DeliverySource)) return false;
  if (envelope.fallbackReason !== undefined
    && !['planner_invalid', 'speech_missing', 'tts_failed', 'invalid_structured_output'].includes(String(envelope.fallbackReason))) return false;
  for (const part of envelope.parts) {
    if (!part || typeof part !== 'object') return false;
    const candidate = part as Record<string, unknown>;
    if (candidate.kind === 'text') {
      if (!nonEmpty(candidate.text) || containsControlToken(candidate.text)) return false;
    } else if (candidate.kind === 'voice') {
      if (!nonEmpty(candidate.speechText) || !EMOTIONS.has(candidate.emotion as DeliveryEmotion) || !/[\u3040-\u30ff]/u.test(candidate.speechText) || containsControlToken(candidate.speechText)) return false;
    } else if (candidate.kind === 'attachment') {
      if (!validAttachment(part)) return false;
    } else return false;
  }
  const voices = envelope.parts.filter((part: Record<string, unknown>) => part.kind === 'voice');
  if (voices.length > 1 || (voices.length === 1 && (!envelope.parts.some((part: Record<string, unknown>) => part.kind === 'text') || (envelope.parts[0] as Record<string, unknown>).kind !== 'voice'))) return false;
  if (envelope.silent !== (envelope.parts.length === 0)) return false;
  if (envelope.silent && envelope.source !== 'system_silent' && envelope.fallbackReason === undefined) return false;
  if (!envelope.silent && envelope.parts.length === 0) return false;
  return true;
}

export function createDeliveryEnvelope(value: Omit<DeliveryEnvelope, 'version'>): DeliveryEnvelope {
  if ('version' in value && value.version !== 2) throw new Error('invalid_delivery_version');
  const envelope = immutable({ ...value, version: 2 as const, parts: Object.freeze(value.parts.map((part) => Object.freeze({ ...part }))) });
  if (!validateDeliveryEnvelope(envelope)) throw new Error('invalid_delivery_envelope');
  return envelope;
}

export function createSilentDelivery(context: DeliveryContext, fallbackReason?: DeliveryEnvelope['fallbackReason']): DeliveryEnvelope {
  return createDeliveryEnvelope({
    runId: context.runId,
    deliveryId: context.deliveryId ?? `${context.runId}:silent`,
    sessionKey: context.sessionKey,
    channel: context.channel,
    origin: context.origin,
    silent: true,
    parts: [],
    source: fallbackReason ? 'agent_structured_output' : 'system_silent',
    ...(fallbackReason ? { fallbackReason } : {}),
  });
}

export function createTextDelivery(
  context: DeliveryContext,
  text: string,
  options: Pick<DeliveryEnvelope, 'source' | 'fallbackReason'> = { source: 'agent_structured_output' },
): DeliveryEnvelope {
  return createDeliveryEnvelope({
    runId: context.runId,
    deliveryId: context.deliveryId ?? `${context.runId}:text`,
    sessionKey: context.sessionKey,
    channel: context.channel,
    origin: context.origin,
    silent: false,
    parts: [{ kind: 'text', text: cleanText(text) }],
    source: options.source,
    ...(options.fallbackReason ? { fallbackReason: options.fallbackReason } : {}),
  });
}

export function createVoiceDelivery(
  context: DeliveryContext,
  visibleText: string,
  speechText: string,
  emotion: DeliveryEmotion = 'default',
  source: DeliverySource = 'agent_structured_output',
): DeliveryEnvelope {
  return createDeliveryEnvelope({
    runId: context.runId,
    deliveryId: context.deliveryId ?? `${context.runId}:voice`,
    sessionKey: context.sessionKey,
    channel: context.channel,
    origin: context.origin,
    silent: false,
    parts: [
      { kind: 'voice', speechText: cleanText(speechText), emotion },
      { kind: 'text', text: cleanText(visibleText) },
    ],
    source,
  });
}

export function createAttachmentPart(input: Omit<AttachmentPart, 'kind'>): AttachmentPart {
  const attachment = immutable({
    kind: 'attachment' as const,
    assetId: input.assetId.trim(),
    mimeType: input.mimeType.trim(),
    fileName: sanitizedFileName(input.fileName),
    disposition: input.disposition,
    ...(input.byteSize !== undefined ? { byteSize: input.byteSize } : {}),
    ...(input.sha256 !== undefined ? { sha256: input.sha256.toLowerCase() } : {}),
    ...(input.caption !== undefined ? { caption: cleanCaption(input.caption) } : {}),
  });
  if (!validAttachment(attachment)) throw new Error('invalid_delivery_attachment');
  return attachment;
}

export function appendDeliveryParts(envelope: DeliveryEnvelope, parts: readonly DeliveryPart[]): DeliveryEnvelope {
  if (envelope.silent && parts.length) throw new Error('cannot_append_to_silent_delivery');
  if (!parts.length) return envelope;
  return createDeliveryEnvelope({
    ...envelope,
    silent: false,
    parts: [...envelope.parts, ...parts],
  });
}
