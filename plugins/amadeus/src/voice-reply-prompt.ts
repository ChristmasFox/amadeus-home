import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { validateDeliveryEnvelope, type DeliveryOrigin } from './delivery-envelope.js';
import { deliveryRuns } from './delivery-runs.js';
import { registerDeliveryBoundary, type DeliveryBoundaryOptions } from './delivery-boundary.js';
import { settleTelegramDelivery } from './telegram-runtime.js';

export const WHATSAPP_VOICE_RUNS_GLOBAL = '__amadeusWhatsAppVoiceRuns20260925';
export function hasActiveWhatsAppVoiceLease(channel: unknown, sessionKey: unknown): boolean {
  if (typeof channel !== 'string' || channel.trim().toLowerCase() !== 'whatsapp' || typeof sessionKey !== 'string') return false;
  const registry = (globalThis as Record<string, unknown>)[WHATSAPP_VOICE_RUNS_GLOBAL];
  if (!(registry instanceof Map)) return false;
  const lease = registry.get(sessionKey) as { closed?: boolean; sessionKey?: string; messageId?: string } | undefined;
  return Boolean(lease && lease.closed === false && lease.sessionKey === sessionKey && Boolean(lease.messageId));
}
function originFor(context: { trigger?: string; inputProvenance?: { kind?: string; sourceTool?: string; sourceSessionKey?: string } }): DeliveryOrigin {
  if (context.trigger === 'heartbeat' || context.inputProvenance?.kind === 'heartbeat') return 'heartbeat';
  if (context.trigger === 'cron' || context.inputProvenance?.kind === 'cron' || context.inputProvenance?.sourceTool === 'cron') return 'cron';
  if (context.inputProvenance?.kind === 'inter_session') {
    if (deliveryRuns.isMediaCompletionProvenance(context.inputProvenance)) return 'media_completion';
    return 'internal_handoff';
  }
  if (context.inputProvenance?.kind === 'internal_system') return 'system';
  return 'external_user';
}
export function registerVoiceReplyPrompt(api: OpenClawPluginApi, boundaryOptions: DeliveryBoundaryOptions = {}): void {
  const root = api.rootDir ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const skill = readFileSync(resolve(root, 'skills/voice-reply/SKILL.md'), 'utf8');
  registerDeliveryBoundary(api, boundaryOptions);
  const loggedInvalidRuns = new Set<string>();
  const warnInvalidStructuredOutput = (runId: string, envelope: { fallbackReason?: string; channel: string }, raw: unknown): void => {
    if (envelope.fallbackReason !== 'invalid_structured_output' || loggedInvalidRuns.has(runId)) return;
    const rawLength = typeof raw === 'string' ? raw.length : 0;
    api.logger.warn(`amadeus structured reply fallback: reason=invalid_structured_output run_id=${runId} channel=${envelope.channel} raw_length=${rawLength}`);
    loggedInvalidRuns.add(runId);
    if (loggedInvalidRuns.size > 1024) loggedInvalidRuns.delete(loggedInvalidRuns.values().next().value!);
  };
  api.on('before_prompt_build', (_event, context) => {
    const channel = context.channel ?? context.messageProvider;
    const origin = hasActiveWhatsAppVoiceLease(channel, context.sessionKey) ? 'inbound_voice' : originFor(context);
    if (context.runId && context.sessionKey && channel) {
      deliveryRuns.start({ runId: context.runId, sessionKey: context.sessionKey, channel, origin });
      if (origin === 'media_completion' && context.inputProvenance?.sourceSessionKey) {
        deliveryRuns.claimMediaCompletion(context.runId, context.inputProvenance.sourceSessionKey);
        api.logger.info(`amadeus image completion ${JSON.stringify({ event: 'image_completion_native_continuation_started', run_id: context.runId, source_session_key_present: true, channel })}`);
      }
      // The native plan may be created with a provisional external-user
      // origin before OpenClaw exposes heartbeat/cron/internal provenance.
      // Update the still-unsettled run so the final delivery adapter remains
      // silent for trusted internal turns regardless of hook ordering.
      deliveryRuns.setOrigin(context.runId, origin);
    }
    if (origin === 'media_completion') return { appendSystemContext: [
      'This is a trusted successful native image-generation completion. Inspect the supplied generated image and write one short, natural Kurisu-style user-facing caption based on what is actually visible. Return only the DeliveryEnvelope v2 wire object with exactly one plain text part; do not emit voice, attachments, paths, MEDIA directives, JSON inside text, or a second message.',
      'The runtime owns the image asset and recipient. Your text is presentation only and will be bound as the existing inline image caption.',
      'Use exactly {"version":2,"silent":false,"parts":[{"kind":"text","text":"<caption>"}]} with no surrounding prose or markdown fences.',
    ].join('\n\n') };
    if (origin !== 'external_user' && origin !== 'inbound_voice') return;
    return { appendSystemContext: [
      skill,
      'Return ONLY the DeliveryEnvelope v2 Agent wire object: {"version":2,"silent":false,"parts":[{"kind":"text","text":"<answer>"}]}. No extra keys or surrounding prose/fences. Escape control characters inside JSON strings (use \\n instead of a literal line break). Model-authored parts may only be text or voice; tool attachments are added by settlement, never emit MEDIA paths or tool serialization. User-requested JSON belongs inside a text part. The structured reply planner chooses parts semantically; normal typed input uses text only.',
      ...(origin === 'inbound_voice' ? ['This verified inbound voice run requires a Japanese voice part followed by the explicit visible Chinese/Japanese text part.'] : []),
    ].join('\n\n') };
  });
  api.on('before_agent_finalize', (event) => {
    if (event.runId && deliveryRuns.has(event.runId) && event.lastAssistantMessage !== undefined) {
      const envelope = deliveryRuns.decode(event.runId, event.lastAssistantMessage);
      // Persist only bounded correlation metadata. The malformed model
      // payload can contain user data or secrets and must never enter logs.
      warnInvalidStructuredOutput(event.runId, envelope, event.lastAssistantMessage);
    }
  });
  api.on('reply_payload_sending', async (event, context) => {
    const runId = event.runId ?? (event.sessionKey ? deliveryRuns.runIdFor(event.sessionKey) : undefined);
    const channel = event.channel ?? context.channelId ?? (runId ? deliveryRuns.channelFor(runId) : undefined);
    if (channel !== 'whatsapp' && channel !== 'telegram') return;
    // Tool/progress/pending media never enters a sender for Amadeus replies.
    if (event.kind !== 'final') return { cancel: true, reason: 'delivery_nonfinal_suppressed' };
    const prepared = event.payload.channelData?.amadeusDelivery;
    if (validateDeliveryEnvelope(prepared) && deliveryRuns.owns(prepared)) return { payload: { channelData: { amadeusDelivery: prepared } } };
    if (!runId) return { cancel: true, reason: 'delivery_run_missing' };
    try {
      const envelope = await deliveryRuns.prepare(runId, event.payload.text);
      warnInvalidStructuredOutput(runId, envelope, event.payload.text);
      if (channel === 'telegram') {
        await settleTelegramDelivery(api, envelope, { ...context, ...(event.payload.replyToId ? { replyToId: event.payload.replyToId } : {}) });
        if (envelope.origin === 'media_completion') {
          const captionSource = deliveryRuns.captionSourceFor(envelope.runId) ?? 'none';
          api.logger.info(`amadeus image completion ${JSON.stringify({ event: captionSource === 'native_completion' ? 'image_completion_caption_ready' : 'image_completion_caption_fallback', run_id: envelope.runId, delivery_id: envelope.deliveryId, channel, caption_source: captionSource })}`);
          api.logger.info(`amadeus image completion ${JSON.stringify({ event: 'image_completion_delivery_settled', run_id: envelope.runId, delivery_id: envelope.deliveryId, channel, caption_source: captionSource })}`);
        }
        return { cancel: true, reason: 'delivery_settled' };
      }
      return { payload: { channelData: { amadeusDelivery: envelope } } };
    } catch { api.logger.warn('amadeus envelope preparation failed closed'); return { cancel: true, reason: 'delivery_preparation_failed' }; }
  }, { timeoutMs: 180_000 });
}
