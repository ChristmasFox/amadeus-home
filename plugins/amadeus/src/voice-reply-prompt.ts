import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { validateDeliveryEnvelope, type DeliveryOrigin, type DeliveryEnvelope } from './delivery-envelope.js';
import { deliveryRuns } from './delivery-runs.js';
import { registerDeliveryBoundary, DELIVERY_BOUNDARY_GLOBAL } from './delivery-boundary.js';
import { enqueueGeneratedCompletionAssets } from './image-assets.js';
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
  if (context.inputProvenance?.kind === 'inter_session') return context.inputProvenance.sourceTool === 'image_generate' && /^image_generate:[a-f0-9-]{36}$/iu.test(context.inputProvenance.sourceSessionKey ?? '') ? 'media_completion' : 'internal_handoff';
  if (context.inputProvenance?.kind === 'internal_system') return 'system';
  return 'external_user';
}
export function registerVoiceReplyPrompt(api: OpenClawPluginApi): void {
  const root = api.rootDir ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const skill = readFileSync(resolve(root, 'skills/voice-reply/SKILL.md'), 'utf8');
  registerDeliveryBoundary(api);
  api.on('before_prompt_build', (_event, context) => {
    const channel = context.channel ?? context.messageProvider;
    const origin = hasActiveWhatsAppVoiceLease(channel, context.sessionKey) ? 'inbound_voice' : originFor(context);
    const sourceSessionKey = context.inputProvenance?.sourceSessionKey;
    const deliveryId = origin === 'media_completion' && /^image_generate:[a-f0-9-]{36}$/iu.test(sourceSessionKey ?? '')
      ? `image-completion:${createHash('sha256').update(sourceSessionKey!).digest('hex')}` : undefined;
    if (context.runId && context.sessionKey && channel) deliveryRuns.start({ runId: context.runId, sessionKey: context.sessionKey, channel, origin, ...(deliveryId ? { deliveryId } : {}) });
    if (origin !== 'external_user' && origin !== 'inbound_voice' && origin !== 'media_completion') return;
    return { appendSystemContext: [
      skill,
      'Return ONLY the DeliveryEnvelope v2 Agent wire object: {"version":2,"silent":false,"parts":[{"kind":"text","text":"<answer>"}]}. No extra keys or surrounding prose/fences. Model-authored parts may only be text or voice; tool attachments are added by settlement, never emit MEDIA paths or tool serialization. User-requested JSON belongs inside a text part. The structured reply planner chooses parts semantically; normal typed input uses text only.',
      ...(origin === 'inbound_voice' ? ['This verified inbound voice run requires a Japanese voice part followed by the explicit visible Chinese/Japanese text part.'] : []),
      ...(origin === 'media_completion' ? ['This verified image generation completion needs a short text caption only. Generated attachments are registered from typed completion media by settlement; never copy a path or internal task text into the caption.'] : []),
    ].join('\n\n') };
  });
  api.on('before_agent_finalize', (event) => {
    if (event.runId && deliveryRuns.has(event.runId) && event.lastAssistantMessage !== undefined) deliveryRuns.decode(event.runId, event.lastAssistantMessage);
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
      if (deliveryRuns.originFor(runId) === 'media_completion') enqueueGeneratedCompletionAssets(api, runId, event.payload);
      const envelope = await deliveryRuns.prepare(runId, event.payload.text);
      if (channel === 'whatsapp' && envelope.origin === 'media_completion') {
        const boundary = (globalThis as Record<string, unknown>)[DELIVERY_BOUNDARY_GLOBAL] as { settleWhatsAppCompletion(envelope: DeliveryEnvelope): Promise<void> };
        await boundary.settleWhatsAppCompletion(envelope);
        return { cancel: true, reason: 'delivery_settled' };
      }
      if (channel === 'telegram') {
        await settleTelegramDelivery(api, envelope, { ...context, ...(event.payload.replyToId ? { replyToId: event.payload.replyToId } : {}) });
        return { cancel: true, reason: 'delivery_settled' };
      }
      return { payload: { channelData: { amadeusDelivery: envelope } } };
    } catch { api.logger.warn('amadeus envelope preparation failed closed'); return { cancel: true, reason: 'delivery_preparation_failed' }; }
  }, { timeoutMs: 180_000 });
}
