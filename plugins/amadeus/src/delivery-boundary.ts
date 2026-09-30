import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { configFor } from './config.js';
import { bindImageDelivery, resolveRegisteredImageAsset } from './image-assets.js';
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
  const boundary = {
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
      return {
        dispatcherOptions: {
          onReplyStart: () => port.start(),
          onSettled: () => { port.stop(); return { visibleReplySent: visible }; },
          // No native durable text/media split: one complete envelope settles here.
          durable: () => false,
          preparePayload: prepare,
          deliver: async (payload: unknown, info: { kind: string }) => {
            if (info.kind !== 'final') return { visibleReplySent: false };
            const row = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
            const envelope = (row.channelData as Record<string, unknown> | undefined)?.amadeusDelivery;
            if (!validateDeliveryEnvelope(envelope) || !deliveryRuns.owns(envelope) || envelope.sessionKey !== port.sessionKey || envelope.channel !== 'whatsapp') throw new Error('delivery_typed_payload_required');
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
