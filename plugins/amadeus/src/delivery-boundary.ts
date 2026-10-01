import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { configFor } from './config.js';
import { bindImageDelivery, resolveRegisteredImageAsset, importGeneratedCompletionAssets, type GeneratedCompletionAttachment } from './image-assets.js';
import { createImageCaptionEnricher, type ImageCaptionEnricher } from './image-caption.js';
import { createImageGenerationMessageEnricher, type ImageGenerationMessageEnricher, type ImageGenerationMessageKind, type ImageLifecycleMessageInput } from './image-generation-messages.js';
import { ImageGenerationLifecycleCoordinator } from './image-generation-lifecycle.js';
import { settleTelegramDelivery } from './telegram-runtime.js';
import { deliveryRuns } from './delivery-runs.js';
import { createTextDelivery, validateDeliveryEnvelope, type AttachmentPart, type DeliveryEnvelope } from './delivery-envelope.js';
import { deliverySettlementState, settleDelivery, type DeliveryReceipt } from './delivery-settlement.js';
import { createDeliverySpeech } from './delivery-speech.js';
import { createWhatsAppAttachmentSender } from './whatsapp-delivery.js';
import type { ResolvedDeliveryAsset } from './delivery-assets.js';
import { detectImageRequestLanguage, type ImageRequestLanguage } from './image-generation-context.js';

export const DELIVERY_BOUNDARY_GLOBAL = '__amadeusDeliveryBoundaryV2_20260930';
export type ImageGenerationLifecycleInput = Readonly<{
  taskId: string;
  sessionKey: string;
  requesterAgentId: string;
  channel: 'whatsapp' | 'telegram';
  accountId?: string;
  conversationId?: string;
  threadId?: string | number;
  requestContext?: string;
}>;
export type WhatsAppDeliveryPort = Readonly<{
  sessionKey: string; accountId: string; conversationId: string; messageId: string;
  inboundVoice: boolean;
  sendText(text: string): Promise<DeliveryReceipt>;
  sendVoice(audio: { audio: Buffer; mimeType: string }): Promise<DeliveryReceipt>;
  sendImage(asset: ResolvedDeliveryAsset, caption?: string): Promise<DeliveryReceipt>;
  sendDocument(asset: ResolvedDeliveryAsset): Promise<DeliveryReceipt>;
  start(): void; stop(): void;
}>;
export type DeliveryBoundaryOptions = Readonly<{
  captionEnricher?: ImageCaptionEnricher;
  lifecycleMessageEnricher?: ImageGenerationMessageEnricher;
}>;
const settlement = deliverySettlementState;
const TASK_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const SESSION_REQUEST_CONTEXT_TTL_MS = 5 * 60_000;
const TASK_REQUEST_CONTEXT_TTL_MS = 30 * 60_000;
const MAX_SESSION_REQUEST_CONTEXTS = 512;
const MAX_TASK_REQUEST_CONTEXTS = 1024;

function validLifecycleInput(value: ImageGenerationLifecycleInput): boolean {
  if (!value || typeof value !== 'object') return false;
  return typeof value.taskId === 'string' && TASK_ID.test(value.taskId)
    && typeof value.sessionKey === 'string' && value.sessionKey.length > 0 && value.sessionKey.length <= 512
    && typeof value.requesterAgentId === 'string' && value.requesterAgentId.length > 0 && value.requesterAgentId.length <= 128
    && (value.channel === 'whatsapp' || value.channel === 'telegram')
    && (value.accountId === undefined || (typeof value.accountId === 'string' && value.accountId.length <= 128))
    && typeof value.conversationId === 'string' && value.conversationId.length > 0 && value.conversationId.length <= 512
    && (value.threadId === undefined || (typeof value.threadId === 'string' && value.threadId.length <= 128)
      || (typeof value.threadId === 'number' && Number.isSafeInteger(value.threadId) && value.threadId >= 0))
    && (value.requestContext === undefined || typeof value.requestContext === 'string');
}
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
function boundedText(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  const text = value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').trim();
  return text ? [...text].slice(0, max).join('') : undefined;
}

type TimedRequestContext = Readonly<{ value: string; language: ImageRequestLanguage; expiresAt: number }>;
function pruneRequestContexts(contexts: Map<string, TimedRequestContext>, maxEntries: number, now: number): void {
  for (const [key, value] of contexts) if (value.expiresAt <= now) contexts.delete(key);
  while (contexts.size > maxEntries) contexts.delete(contexts.keys().next().value!);
}
function storeRequestContext(contexts: Map<string, TimedRequestContext>, key: string, value: string, language: ImageRequestLanguage, ttlMs: number, maxEntries: number, now: number): void {
  pruneRequestContexts(contexts, maxEntries, now);
  contexts.delete(key);
  contexts.set(key, { value, language, expiresAt: now + ttlMs });
  pruneRequestContexts(contexts, maxEntries, now);
}
function readRequestContext(contexts: Map<string, TimedRequestContext>, key: string, now: number): TimedRequestContext | undefined {
  const value = contexts.get(key);
  if (!value) return undefined;
  if (value.expiresAt <= now) { contexts.delete(key); return undefined; }
  contexts.delete(key);
  contexts.set(key, value);
  return value;
}

export function registerDeliveryBoundary(api: OpenClawPluginApi, options: DeliveryBoundaryOptions = {}): void {
  const speech = createDeliverySpeech(api);
  const captionEnricher = options.captionEnricher ?? createImageCaptionEnricher(api);
  const lifecycleMessageEnricher = options.lifecycleMessageEnricher ?? createImageGenerationMessageEnricher(api);
  const lifecycle = new ImageGenerationLifecycleCoordinator(1024);
  const completionPorts = new Map<string, { accountId: string; conversationId: string; send: (envelope: DeliveryEnvelope) => Promise<void>; expiresAt: number }>();
  const lifecycleMessages = new Map<string, Promise<string>>();
  const sessionRequestContexts = new Map<string, TimedRequestContext>();
  const taskRequestContexts = new Map<string, TimedRequestContext>();

  // Keep only a short, bounded snapshot of the actual inbound user text. The
  // model-produced image prompt remains separate context; neither can affect
  // runtime-owned task identity or delivery routing.
  api.on('before_dispatch', (event, hookContext) => {
    const sessionKey = text(hookContext.sessionKey ?? event.sessionKey);
    const channel = text(hookContext.channelId ?? event.channel);
    if (!sessionKey || (channel !== 'whatsapp' && channel !== 'telegram')) return;
    const originalRequest = boundedText(text(event.body ?? event.content), 300);
    if (!originalRequest) return;
    const language = detectImageRequestLanguage(originalRequest);
    storeRequestContext(sessionRequestContexts, `${channel}:${sessionKey}`, originalRequest, language, SESSION_REQUEST_CONTEXT_TTL_MS, MAX_SESSION_REQUEST_CONTEXTS, Date.now());
  });

  const lifecycleRequestContext = (input: ImageGenerationLifecycleInput): Readonly<{ requestContext?: string; requestLanguage: ImageRequestLanguage }> => {
    const now = Date.now();
    const existing = readRequestContext(taskRequestContexts, input.taskId, now);
    if (existing) return { requestContext: existing.value, requestLanguage: existing.language };
    const originalRequest = readRequestContext(sessionRequestContexts, `${input.channel}:${input.sessionKey}`, now);
    const imagePrompt = boundedText(input.requestContext, 120);
    const combined = originalRequest && imagePrompt
      ? `Original user request: ${originalRequest.value} | Image prompt: ${imagePrompt}`
      : originalRequest?.value ?? imagePrompt;
    const requestContext = boundedText(combined, 480);
    // Language identity comes only from runtime-captured inbound text. A model
    // may translate taskLabel for image quality; that prompt is context, not a
    // reliable signal of the user's reply language.
    const requestLanguage = originalRequest?.language ?? 'unknown';
    if (requestContext) storeRequestContext(taskRequestContexts, input.taskId, requestContext, requestLanguage, TASK_REQUEST_CONTEXT_TTL_MS, MAX_TASK_REQUEST_CONTEXTS, now);
    return { ...(requestContext ? { requestContext } : {}), requestLanguage };
  };

  const lifecycleSemanticInput = (input: ImageGenerationLifecycleInput, kind: ImageGenerationMessageKind): ImageLifecycleMessageInput => ({
    kind, taskId: input.taskId, agentId: input.requesterAgentId, sessionKey: input.sessionKey, channel: input.channel,
    ...lifecycleRequestContext(input),
  });
  const rememberLifecycleMessage = (input: ImageGenerationLifecycleInput): Promise<string> => {
    const key = `${input.taskId}:failed`;
    let pending = lifecycleMessages.get(key);
    if (!pending) {
      pending = lifecycleMessageEnricher(lifecycleSemanticInput(input, 'failed'));
      lifecycleMessages.set(key, pending);
      if (lifecycleMessages.size > 2048) lifecycleMessages.delete(lifecycleMessages.keys().next().value!);
    }
    return pending;
  };
  const lifecycleEnvelope = (input: ImageGenerationLifecycleInput, kind: 'accepted' | 'failed', message: string): DeliveryEnvelope => {
    const key = `image-generation:${input.taskId}:${kind}`;
    return createTextDelivery({
      runId: key, deliveryId: key, sessionKey: input.sessionKey, channel: input.channel, origin: 'media_completion',
    }, message, { source: 'image_generation_lifecycle' });
  };
  const sendLifecycleNotice = async (input: ImageGenerationLifecycleInput, kind: 'accepted' | 'failed', message: string): Promise<void> => {
    const envelope = lifecycleEnvelope(input, kind, message);
    if (input.channel === 'whatsapp') {
      const entry = completionPorts.get(input.sessionKey);
      if (!entry || entry.expiresAt < Date.now() || !input.conversationId
        || (input.accountId && entry.accountId !== input.accountId) || entry.conversationId !== input.conversationId) throw new Error('image_lifecycle_route_unavailable');
      await entry.send(envelope);
      return;
    }
    if (!input.conversationId) throw new Error('image_lifecycle_route_unavailable');
    await settleTelegramDelivery(api, envelope, {
      ...(input.accountId ? { accountId: input.accountId } : {}), conversationId: input.conversationId!,
      ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
    });
  };

  const boundary = {
    async acceptImageGeneration(input: ImageGenerationLifecycleInput): Promise<void> {
      if (!validLifecycleInput(input)) return;
      // A failed acknowledgement is observable but cannot escape into the
      // already-scheduled OpenClaw background generation.
      try {
        await lifecycle.accepted(input.taskId, async () => {
          const message = await lifecycleMessageEnricher(lifecycleSemanticInput(input, 'accepted'));
          await sendLifecycleNotice(input, 'accepted', message);
        });
      } catch {
        api.logger.warn(`amadeus image lifecycle ${JSON.stringify({ task_id: input.taskId, stage: 'accepted', final_status: 'notification_failed' })}`);
      }
    },
    async failImageGeneration(input: ImageGenerationLifecycleInput): Promise<void> {
      if (!validLifecycleInput(input)) throw new Error('image_lifecycle_identity_invalid');
      const failed = await lifecycle.failed(input.taskId, async () => {
        const message = await rememberLifecycleMessage(input);
        await sendLifecycleNotice(input, 'failed', message);
      });
      if (failed) taskRequestContexts.delete(input.taskId);
    },
    async settleWhatsAppCompletion(envelope: DeliveryEnvelope): Promise<void> {
      if (!deliveryRuns.owns(envelope) || envelope.origin !== 'media_completion' || envelope.channel !== 'whatsapp') throw new Error('image_completion_envelope_invalid');
      const entry = completionPorts.get(envelope.sessionKey);
      if (!entry || entry.expiresAt < Date.now()) throw new Error('image_completion_route_missing');
      await entry.send(envelope);
    },
    async completeImageGeneration(input: ImageGenerationLifecycleInput & { attachments: readonly GeneratedCompletionAttachment[] }): Promise<void> {
      if (!validLifecycleInput(input)) throw new Error('image_completion_identity_invalid');
      const completed = await lifecycle.succeeded(input.taskId, async () => {
        const envelope = await lifecycle.artifacts(input.taskId, async () => {
          const requestContext = lifecycleRequestContext(input);
          const parts = await importGeneratedCompletionAssets(api, input.attachments, {
            taskId: input.taskId, agentId: input.requesterAgentId, sessionKey: input.sessionKey, channel: input.channel,
            ...requestContext,
            captionEnricher,
          });
          const runId = `image_generate:${input.taskId}:typed-completion`;
          deliveryRuns.start({ runId, sessionKey: input.sessionKey, channel: input.channel, origin: 'media_completion', deliveryId: `image-completion:${input.taskId}` });
          deliveryRuns.addAssets(runId, Promise.resolve(parts));
          return await deliveryRuns.prepareToolOnly(runId);
        });
        if (input.channel === 'whatsapp') await boundary.settleWhatsAppCompletion(envelope);
        else await settleTelegramDelivery(api, envelope, { ...(input.accountId ? { accountId: input.accountId } : {}), conversationId: input.conversationId!, ...(input.threadId !== undefined ? { threadId: input.threadId } : {}) });
      });
      if (!completed) throw new Error('image_generation_terminal_failed');
      taskRequestContexts.delete(input.taskId);
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
      completionPorts.set(port.sessionKey, { accountId: port.accountId, conversationId: port.conversationId, send: settleTyped, expiresAt: Date.now() + 30 * 60_000 });
      if (completionPorts.size > 1024) completionPorts.delete(completionPorts.keys().next().value!);
      return {
        dispatcherOptions: {
          onReplyStart: () => port.start(),
          onSettled: () => { port.stop(); return { visibleReplySent: visible }; },
        },
        delivery: {
          observeMessageSent: true,
          durable: () => false,
          preparePayload: prepare,
          deliver: async (payload: unknown, info: { kind: string }) => {
            if (info.kind !== 'final') return { visibleReplySent: false };
            // OpenClaw 2026.9.4 has a final delivery callback path that may
            // bypass preparePayload. Re-run the exact same typed preparation
            // here rather than letting raw model text reach a native sender.
            const candidate = await prepare(payload, info);
            const row = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : {};
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
