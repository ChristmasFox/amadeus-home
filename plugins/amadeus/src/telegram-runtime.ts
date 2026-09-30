import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { configFor } from './config.js';
import { bindImageDelivery, resolveRegisteredImageAsset } from './image-assets.js';
import { deliverySettlementState, settleDelivery } from './delivery-settlement.js';
import { createDeliverySpeech } from './delivery-speech.js';
import { createTelegramAttachmentSender } from './telegram-delivery.js';
import type { DeliveryEnvelope } from './delivery-envelope.js';
const settlement = deliverySettlementState;

/** Telegram primitive adapter owned by the same settlement, not a queued sender. */
export async function settleTelegramDelivery(api: OpenClawPluginApi, envelope: DeliveryEnvelope, route: { accountId?: string; conversationId?: string; replyToId?: string; threadId?: string | number }, testTransport?: typeof fetch) {
  // Native source API, not the deprecated synchronous SDK facade. No source
  // mutation or channel fork: account and network policy stay upstream-owned.
  const sdkRoot = dirname(createRequire(import.meta.url).resolve('openclaw/plugin-sdk/core'));
  const host = JSON.parse(await readFile(resolve(sdkRoot, '../../package.json'), 'utf8')) as { version?: string };
  if (host.version !== '2026.9.4') throw new Error('telegram_host_version_mismatch');
  const native = await import(pathToFileURL(resolve(sdkRoot, '../extensions/telegram/api.js')).href) as {
    resolveTelegramAccount(params: unknown): { enabled: boolean; token: string; accountId: string; config: { proxy?: string; apiRoot?: string; network?: unknown } };
    resolveTelegramChatLookupFetch(params: unknown): typeof fetch;
  };
  const account = native.resolveTelegramAccount({ cfg: api.config, accountId: route.accountId ?? null });
  const transportFetch = testTransport ?? native.resolveTelegramChatLookupFetch({ proxyUrl: account.config.proxy, network: account.config.network });
  if (!account.enabled || !account.token || !route.conversationId) throw new Error('telegram_route_unavailable');
  // Use the host's native text sender for existing formatting/network policy.
  const sendText = async (text: string) => {
    await api.runtime.gateway.request('send', { channel: 'telegram', to: route.conversationId, accountId: account.accountId, message: text, ...(route.replyToId ? { replyToId: route.replyToId } : {}), ...(route.threadId ? { threadId: route.threadId } : {}) });
    return {};
  };
  const upload = async (primitive: 'sendPhoto' | 'sendDocument' | 'sendAudio', field: string, bytes: Buffer, mimeType: string, fileName: string) => {
    const form = new FormData(); form.set('chat_id', route.conversationId!);
    if (route.threadId) form.set('message_thread_id', String(route.threadId));
    if (route.replyToId) form.set('reply_parameters', JSON.stringify({ message_id: Number(route.replyToId), allow_sending_without_reply: true }));
    form.set(field, new Blob([new Uint8Array(bytes)], { type: mimeType }), fileName);
    const response = await transportFetch(`${(account.config.apiRoot ?? 'https://api.telegram.org').replace(/\/$/u, '')}/bot${account.token}/${primitive}`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
    const body = await response.json() as { ok?: boolean; result?: { message_id?: number } };
    if (!response.ok || body.ok !== true || !body.result?.message_id) throw new Error('telegram_provider_rejected');
    return { messageId: String(body.result.message_id) };
  };
  const config = configFor(api);
  const attachment = createTelegramAttachmentSender((part) => resolveRegisteredImageAsset(config, part), {
    sendPhoto: async (asset, caption) => {
      // Telegram's native sendPhoto accepts caption in the same media message.
      const form = new FormData(); form.set('chat_id', route.conversationId!);
      if (route.threadId) form.set('message_thread_id', String(route.threadId));
      if (route.replyToId) form.set('reply_parameters', JSON.stringify({ message_id: Number(route.replyToId), allow_sending_without_reply: true }));
      form.set('photo', new Blob([new Uint8Array(asset.bytes)], { type: asset.mimeType }), asset.fileName);
      if (caption) form.set('caption', caption);
      const response = await transportFetch(`${(account.config.apiRoot ?? 'https://api.telegram.org').replace(/\/$/u, '')}/bot${account.token}/sendPhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
      const body = await response.json() as { ok?: boolean; result?: { message_id?: number } };
      if (!response.ok || body.ok !== true || !body.result?.message_id) throw new Error('telegram_provider_rejected');
      return { messageId: String(body.result.message_id) };
    },
    sendDocument: (asset) => upload('sendDocument', 'document', asset.bytes, asset.mimeType, asset.fileName),
  });
  const result = await settleDelivery(envelope, {
    sendText: (part) => sendText(part.text), synthesize: createDeliverySpeech(api),
    sendVoice: (_part, audio) => upload('sendAudio', 'audio', audio.audio, audio.mimeType, 'kurisu.mp3'),
    sendAttachment: async (part) => {
      const receipt = await attachment(part);
      if (receipt.messageId) { try { await bindImageDelivery(config, part.assetId, receipt.messageId, { channel: 'telegram', conversationId: route.conversationId!, runId: envelope.runId }); } catch { api.logger.warn('amadeus Telegram asset correlation failed'); } }
      return receipt;
    }, record: (event) => api.logger.info(`amadeus delivery ${JSON.stringify(event)}`),
  }, settlement);
  if (result.final_status === 'failed') throw new Error('telegram_delivery_failed');
}
