import type { AttachmentPart } from './delivery-envelope.js';
import type { ResolvedDeliveryAsset } from './delivery-assets.js';
import type { DeliveryReceipt } from './delivery-settlement.js';

export type WhatsAppAttachmentProvider = Readonly<{
  sendImage(asset: ResolvedDeliveryAsset): Promise<DeliveryReceipt>;
  sendDocument(asset: ResolvedDeliveryAsset): Promise<DeliveryReceipt>;
}>;
/** Only disposition selects the primitive. Never downgrade on rejection. */
export function createWhatsAppAttachmentSender(resolveAsset: (part: AttachmentPart) => Promise<ResolvedDeliveryAsset>, provider: WhatsAppAttachmentProvider) {
  return async (part: AttachmentPart): Promise<DeliveryReceipt & { providerPrimitive: 'image' | 'document' }> => {
    const asset = await resolveAsset(part);
    if (part.disposition === 'document') return { ...await provider.sendDocument(asset), providerPrimitive: 'document' };
    return { ...await provider.sendImage(asset), providerPrimitive: 'image' };
  };
}
