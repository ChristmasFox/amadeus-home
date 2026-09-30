import type { AttachmentPart } from './delivery-envelope.js';
import type { ResolvedDeliveryAsset } from './delivery-assets.js';
import type { DeliveryReceipt } from './delivery-settlement.js';

/** Transport-only adapter. The supplied client is the native Telegram Bot API. */
export function createTelegramAttachmentSender(resolveAsset: (part: AttachmentPart) => Promise<ResolvedDeliveryAsset>, provider: {
  sendPhoto(asset: ResolvedDeliveryAsset): Promise<DeliveryReceipt>;
  sendDocument(asset: ResolvedDeliveryAsset): Promise<DeliveryReceipt>;
}) {
  return async (part: AttachmentPart) => {
    const asset = await resolveAsset(part);
    if (part.disposition === 'document') return { ...await provider.sendDocument(asset), providerPrimitive: 'document' as const };
    return { ...await provider.sendPhoto(asset), providerPrimitive: 'image' as const };
  };
}
