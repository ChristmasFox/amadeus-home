import type { ReplyEmotion, ReplyEnvelope } from './reply-envelope.js';

export type ReplyTelemetry = Readonly<{
  run_id: string;
  delivery_id: string;
  origin: ReplyEnvelope['origin'];
  modality: ReplyEnvelope['modality'];
  source: ReplyEnvelope['source'];
  tts_requested: boolean;
  tts_provider?: string;
  tts_attempt?: number;
  deadline_ms?: number;
  queue_wait_ms?: number;
  provider_ms?: number;
  audio_validation_ms?: number;
  channel_send_ms?: number;
  final_status: 'silent' | 'text_sent' | 'voice_sent' | 'text_fallback' | 'duplicate';
  fallback_reason?: string;
}>;

export type ReplyDeliveryAdapters = Readonly<{
  sendText(text: string): Promise<void>;
  synthesize(input: { text: string; emotion: ReplyEmotion; deadlineAt: number }): Promise<{
    audio: unknown;
    provider?: string;
    attempt?: number;
    providerMs?: number;
  }>;
  sendVoice(audio: unknown): Promise<void>;
  now?: () => number;
  deadlineMs?: number;
  record?: (telemetry: ReplyTelemetry) => void;
}>;

export type ReplyDeliveryContext = {
  settled: Set<string>;
  live: Map<string, ReplyEnvelope>;
  inFlight: Map<string, Promise<ReplyTelemetry>>;
};

export function createReplyDeliveryContext(): ReplyDeliveryContext {
  return { settled: new Set(), live: new Map(), inFlight: new Map() };
}

function record(context: ReplyDeliveryContext, telemetry: ReplyTelemetry, adapters: ReplyDeliveryAdapters): ReplyTelemetry {
  adapters.record?.(telemetry);
  context.live.delete(telemetry.delivery_id);
  context.settled.add(telemetry.delivery_id);
  return telemetry;
}

export async function deliverReplyEnvelope(
  envelope: ReplyEnvelope,
  adapters: ReplyDeliveryAdapters,
  context = createReplyDeliveryContext(),
): Promise<ReplyTelemetry> {
  if (context.settled.has(envelope.deliveryId)) {
    return { run_id: envelope.runId, delivery_id: envelope.deliveryId, origin: envelope.origin, modality: envelope.modality, source: envelope.source, tts_requested: false, final_status: 'duplicate' };
  }
  const existing = context.inFlight.get(envelope.deliveryId);
  if (existing) {
    await existing;
    return { run_id: envelope.runId, delivery_id: envelope.deliveryId, origin: envelope.origin, modality: envelope.modality, source: envelope.source, tts_requested: false, final_status: 'duplicate' };
  }
  const operation = deliverReplyEnvelopeOnce(envelope, adapters, context);
  context.inFlight.set(envelope.deliveryId, operation);
  try {
    return await operation;
  } finally {
    context.inFlight.delete(envelope.deliveryId);
  }
}

async function deliverReplyEnvelopeOnce(
  envelope: ReplyEnvelope,
  adapters: ReplyDeliveryAdapters,
  context: ReplyDeliveryContext,
): Promise<ReplyTelemetry> {
  context.live.set(envelope.deliveryId, envelope);
  const now = adapters.now ?? Date.now;
  const base = { run_id: envelope.runId, delivery_id: envelope.deliveryId, origin: envelope.origin, modality: envelope.modality, source: envelope.source } as const;
  if (envelope.silent) return record(context, { ...base, tts_requested: false, final_status: 'silent' }, adapters);
  if (envelope.modality === 'text') {
    const started = now();
    await adapters.sendText(envelope.visibleText);
    return record(context, { ...base, tts_requested: false, channel_send_ms: now() - started, final_status: 'text_sent' }, adapters);
  }

  const deadlineMs = adapters.deadlineMs ?? 110_000;
  const deadlineAt = now() + deadlineMs;
  const started = now();
  try {
    const result = await adapters.synthesize({ text: envelope.speechText!, emotion: envelope.emotion ?? 'default', deadlineAt });
    await adapters.sendVoice(result.audio);
    await adapters.sendText(envelope.visibleText);
    return record(context, {
      ...base,
      tts_requested: true,
      deadline_ms: deadlineMs,
      channel_send_ms: now() - started,
      final_status: 'voice_sent',
      ...(result.provider ? { tts_provider: result.provider } : {}),
      ...(result.attempt !== undefined ? { tts_attempt: result.attempt } : {}),
      ...(result.providerMs !== undefined ? { provider_ms: result.providerMs } : {}),
    }, adapters);
  } catch (error) {
    if (envelope.visibleText) await adapters.sendText(envelope.visibleText);
    return record(context, {
      ...base,
      tts_requested: true,
      deadline_ms: deadlineMs,
      channel_send_ms: now() - started,
      final_status: 'text_fallback',
      fallback_reason: error instanceof Error ? error.message.slice(0, 80) : 'tts_failed',
    }, adapters);
  }
}
