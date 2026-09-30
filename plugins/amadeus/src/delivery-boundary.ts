import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { configFor } from './config.js';
import { bindImageDelivery, resolveRegisteredImageAsset, enqueueGeneratedCompletionAssets } from './image-assets.js';
import { settleTelegramDelivery } from './telegram-runtime.js';
import { deliveryRuns } from './delivery-runs.js';
import { validateDeliveryEnvelope, type AttachmentPart, type DeliveryEnvelope } from './delivery-envelope.js';
import { deliverySettlementState, settleDelivery, type DeliveryReceipt } from './delivery-settlement.js';
import { createDeliverySpeech } from './delivery-speech.js';
import { createWhatsAppAttachmentSender } from './whatsapp-delivery.js';
import type { ResolvedDeliveryAsset } from './delivery-assets.js';

export const DELIVERY_BOUNDARY_GLOBAL = '__amadeusDeliveryBoundaryV2_20260930';
export type WhatsAppDeliveryPort = Readonly<{
  sessionKey: string; accountId: string; conversationId: string; messageId: string;
  inboundVoice: boolean;
  sendText(text: string): Promise<DeliveryReceipt>;
  sendVoice(audio: { audio: Buffer; mimeType: string }): Promise<DeliveryReceipt>;
  sendImage(asset: ResolvedDeliveryAsset): Promise<DeliveryReceipt>;
  sendDocument(asset: ResolvedDeliveryAsset): Promise<DeliveryReceipt>;
  start(): void; stop(): void;
}>;
const settlement = deliverySettlementState;

export function registerDeliveryBoundary(api: OpenClawPluginApi): void {
  const speech = createDeliverySpeech(api);
  const completionPorts = new Map<string, { send: (envelope: DeliveryEnvelope) => Promise<void>; expiresAt: number }>();
  const completionTasks = new Map<string, Promise<void>>();
  const boundary = {
    async settleWhatsAppCompletion(envelope: DeliveryEnvelope): Promise<void> {
      if (!deliveryRuns.owns(envelope) || envelope.origin !== 'media_completion' || envelope.channel !== 'whatsapp') throw new Error('image_completion_envelope_invalid');
      const entry = completionPorts.get(envelope.sessionKey);
      if (!entry || entry.expiresAt < Date.now()) throw new Error('image_completion_route_missing');
      await entry.send(envelope);
      // Retain the bounded route so a retried completion hits the same ledger.
    },
    async completeImageGeneration(input: { taskId: string; sessionKey: string; channel: string; accountId?: string; conversationId?: string; attachments: readonly { type?: string; path?: string; mimeType?: string }[] }): Promise<void> {
      if (!/^[a-f0-9-]{36}$/iu.test(input.taskId) || !input.sessionKey || !['whatsapp', 'telegram'].includes(input.channel)) throw new Error('image_completion_identity_invalid');
      const existing = completionTasks.get(input.taskId);
      if (existing) return existing;
      const job = (async () => {
        const runId = `image_generate:${input.taskId}:typed-completion`;
        deliveryRuns.start({ runId, sessionKey: input.sessionKey, channel: input.channel, origin: 'media_completion', deliveryId: `image-completion:${input.taskId}` });
        enqueueGeneratedCompletionAssets(api, runId, input.attachments);
        const envelope = await deliveryRuns.prepareToolOnly(runId);
        if (input.channel === 'whatsapp') await boundary.settleWhatsAppCompletion(envelope);
        else await settleTelegramDelivery(api, envelope, { ...(input.accountId ? { accountId: input.accountId } : {}), ...(input.conversationId ? { conversationId: input.conversationId } : {}) });
      })();
      completionTasks.set(input.taskId, job);
      if (completionTasks.size > 1024) completionTasks.delete(completionTasks.keys().next().value!);
      try { await job; } catch (error) { completionTasks.delete(input.taskId); throw error; }
    },
    version: 2 as const,
    createWhatsAppPlan(port: WhatsAppDeliveryPort) {
      let visible = false;
      let runId = `whatsapp:${port.accountId}:${port.conversationId}:${port.messageId}`;
      deliveryRuns.start({ runId, sessionKey: port.sessionKey, channel: 'whatsapp', origin: port.inboundVoice ? 'inbound_voice' : 'external_user' });
      const prepare = async (payload: unknown, info: { kind: string }) => {
        if (info.kind !== 'final') return null;
        const row = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
        const channelData = row.channelData as Record<string, unknown> | undefined;
        const prepared = channelData?.amadeusDelivery;
        if (validateDeliveryEnvelope(prepared) && deliveryRuns.owns(prepared)) {
          if (prepared.sessionKey !== port.sessionKey || prepared.channel !== 'whatsapp') throw new Error('delivery_route_mismatch');
          return { channelData: { amadeusDelivery: prepared } };
        }
        const exactRunId = deliveryRuns.runIdFor(port.sessionKey) ?? runId;
        const envelope = await deliveryRuns.prepare(exactRunId, row.text);
        return { channelData: { amadeusDelivery: envelope } };
      };
      const settleTyped = async (envelope: DeliveryEnvelope): Promise<void> => {
            const config = configFor(api);
            const sendAttachment = createWhatsAppAttachmentSender((part) => resolveRegisteredImageAsset(config, part), port);
            const result = await settleDelivery(envelope, {
              sendText: async (part) => { const receipt = await port.sendText(part.text); visible = true; return receipt; },
              synthesize: speech,
              sendVoice: async (_part, audio) => { const receipt = await port.sendVoice(audio); visible = true; return receipt; },
              sendAttachment: async (part: AttachmentPart) => {
                const receipt = await sendAttachment(part); visible = true;
                if (receipt.messageId) {
                  try { await bindImageDelivery(config, part.assetId, receipt.messageId, { channel: 'whatsapp', conversationId: port.conversationId, runId: envelope.runId }); }
                  catch { api.logger.warn('amadeus asset delivery correlation failed'); }
                }
                return receipt;
              },
              record: (event) => api.logger.info(`amadeus delivery ${JSON.stringify(event)}`),
            }, settlement);
            if (result.final_status === 'failed') throw new Error(`delivery_failed:${result.failure_stage}`);
      };
      completionPorts.set(port.sessionKey, { send: settleTyped, expiresAt: Date.now() + 30 * 60_000 });
      if (completionPorts.size > 1024) completionPorts.delete(completionPorts.keys().next().value!);
      return {
        dispatcherOptions: {
          onReplyStart: () => port.start(),
          onSettled: () => { port.stop(); return { visibleReplySent: visible }; },
        },
        // The pinned host's channel-turn contract reads `delivery` directly.
        // Do not put these methods in dispatcherOptions: the core would see an
        // undefined delivery and never settle an inbound message.
        delivery: {
          observeMessageSent: true,
          // No native durable text/media split: one complete envelope settles here.
          durable: () => false,
          preparePayload: prepare,
          deliver: async (payload: unknown, info: { kind: string }) => {
            if (info.kind !== 'final') return { visibleReplySent: false };
            const row = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
            const envelope = (row.channelData as Record<string, unknown> | undefined)?.amadeusDelivery;
            if (!validateDeliveryEnvelope(envelope) || !deliveryRuns.owns(envelope) || envelope.sessionKey !== port.sessionKey || envelope.channel !== 'whatsapp') throw new Error('delivery_typed_payload_required');
            await settleTyped(envelope);
            return { visibleReplySent: visible };
          },
          onError: () => api.logger.warn('amadeus delivery boundary failed closed'),
        },
        replyOptions: {
          disableBlockStreaming: true,
          onAgentRunStart: (id: string) => {
            runId = id;
            deliveryRuns.start({ runId, sessionKey: port.sessionKey, channel: 'whatsapp', origin: port.inboundVoice ? 'inbound_voice' : 'external_user' });
          },
        },
        finalize: (result: { observedReplyDelivery?: boolean }) => visible || result.observedReplyDelivery === true,
      };
    },
  };
  (globalThis as Record<string, unknown>)[DELIVERY_BOUNDARY_GLOBAL] = boundary;
}
