import type { AttachmentPart, DeliveryEnvelope, DeliveryEmotion, DeliveryPart, VoicePart } from './delivery-envelope.js';

export type DeliveryReceipt = Readonly<{ messageId?: string }>;
export type DeliveryTelemetry = Readonly<{
  run_id: string; delivery_id: string; channel: string;
  part_kinds: readonly DeliveryPart['kind'][]; attachment_count: number;
  attachment_dispositions: readonly AttachmentPart['disposition'][];
  asset_ids: readonly string[]; asset_byte_sizes: readonly number[]; asset_sha256_present: readonly boolean[];
  provider_primitives: readonly ('text' | 'voice' | 'image' | 'document')[];
  final_status: 'silent' | 'sent' | 'duplicate' | 'text_fallback' | 'failed';
  failure_stage?: 'text' | 'tts' | 'voice' | 'attachment'; fallback_reason?: string;
}>;
export type DeliverySettlementContext = { settled: Map<string, DeliveryTelemetry>; inFlight: Map<string, Promise<DeliveryTelemetry>> };
export type DeliverySettlementAdapters = Readonly<{
  sendText(part: { kind: 'text'; text: string }): Promise<DeliveryReceipt>;
  synthesize(input: { text: string; emotion: DeliveryEmotion; deadlineAt: number }): Promise<{ audio: Buffer; mimeType: string }>;
  sendVoice(part: VoicePart, audio: { audio: Buffer; mimeType: string }): Promise<DeliveryReceipt>;
  sendAttachment(part: AttachmentPart): Promise<DeliveryReceipt & { providerPrimitive: 'image' | 'document' }>;
  now?: () => number; deadlineMs?: number; record?: (telemetry: DeliveryTelemetry) => void;
}>;
export function createDeliverySettlementContext(): DeliverySettlementContext { return { settled: new Map(), inFlight: new Map() }; }
/** The one process-owned production settlement ledger, shared by every channel. */
export const deliverySettlementState = createDeliverySettlementContext();
function telemetry(envelope: DeliveryEnvelope, status: DeliveryTelemetry['final_status'], extra: Partial<DeliveryTelemetry> = {}): DeliveryTelemetry {
  const attachments = envelope.parts.filter((part): part is AttachmentPart => part.kind === 'attachment');
  return { run_id: envelope.runId, delivery_id: envelope.deliveryId, channel: envelope.channel,
    part_kinds: envelope.parts.map((part) => part.kind), attachment_count: attachments.length,
    attachment_dispositions: attachments.map((part) => part.disposition), asset_ids: attachments.map((part) => part.assetId),
    asset_byte_sizes: attachments.flatMap((part) => part.byteSize === undefined ? [] : [part.byteSize]),
    asset_sha256_present: attachments.map((part) => part.sha256 !== undefined), provider_primitives: [], final_status: status, ...extra };
}
export async function settleDelivery(envelope: DeliveryEnvelope, adapters: DeliverySettlementAdapters, context: DeliverySettlementContext): Promise<DeliveryTelemetry> {
  if (context.settled.has(envelope.deliveryId)) return telemetry(envelope, 'duplicate');
  const existing = context.inFlight.get(envelope.deliveryId);
  if (existing) { await existing; return telemetry(envelope, 'duplicate'); }
  // Reserve before calling an adapter, including synchronous/reentrant callbacks.
  const operation = Promise.resolve().then(() => settleOnce(envelope, adapters));
  context.inFlight.set(envelope.deliveryId, operation);
  try {
    const result = await operation;
    context.settled.set(envelope.deliveryId, result);
    if (context.settled.size > 4096) context.settled.delete(context.settled.keys().next().value!);
    adapters.record?.(result);
    return result;
  } finally { context.inFlight.delete(envelope.deliveryId); }
}
async function settleOnce(envelope: DeliveryEnvelope, adapters: DeliverySettlementAdapters): Promise<DeliveryTelemetry> {
  if (envelope.silent) return telemetry(envelope, 'silent');
  const primitives: Array<'text' | 'voice' | 'image' | 'document'> = [];
  const now = adapters.now ?? Date.now;
  let ttsFailed = false;
  for (const part of envelope.parts) {
    if (part.kind === 'voice') {
      let audio: { audio: Buffer; mimeType: string };
      try { audio = await adapters.synthesize({ text: part.speechText, emotion: part.emotion, deadlineAt: now() + (adapters.deadlineMs ?? 110_000) }); }
      catch { ttsFailed = true; continue; }
      try { await adapters.sendVoice(part, audio); primitives.push('voice'); }
      catch { return telemetry(envelope, 'failed', { provider_primitives: primitives, failure_stage: 'voice', fallback_reason: 'voice_send_failed' }); }
    } else {
      try {
        if (part.kind === 'text') { await adapters.sendText(part); primitives.push('text'); }
        else { const result = await adapters.sendAttachment(part); primitives.push(result.providerPrimitive); }
      } catch {
        return telemetry(envelope, 'failed', { provider_primitives: primitives, failure_stage: part.kind, fallback_reason: `${part.kind}_delivery_failed` });
      }
    }
  }
  // TTS fallback can use only the explicitly ordered text parts, never speech/protocol.
  return telemetry(envelope, ttsFailed ? (primitives.includes('text') ? 'text_fallback' : 'failed') : 'sent', {
    provider_primitives: primitives, ...(ttsFailed ? { failure_stage: 'tts' as const, fallback_reason: 'tts_failed' } : {}) });
}
