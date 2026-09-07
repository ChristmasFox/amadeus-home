import type { RadarEvent } from '../events/events.js';
import type { Listing, Price, ProductStatus } from '../listing/model.js';

function formatNumber(amount: number): string {
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(amount);
}

function formatPrice(price: Price | null | undefined): string {
  if (!price) return '价格未知';
  const currency = price.currency.toUpperCase() === 'KRW' ? '₩' : `${price.currency.toUpperCase()} `;
  return `${currency}${formatNumber(price.amount)}`;
}

function formatStatus(status: ProductStatus | null | undefined): string {
  switch (status) {
    case 'ACTIVE': return '在售';
    case 'SOLD': return '已售出';
    case 'RESERVED': return '已预订';
    case 'UNAVAILABLE': return '不可用';
    default: return '未知';
  }
}

function listingSeller(listing: Listing): string {
  return listing.seller?.name || listing.seller?.externalId || '未知';
}

export function formatNotification(event: RadarEvent, sourceDisplayName: string): string {
  if (event.type === 'ListingMatchedEvent') {
    const listing = event.after as Listing;
    const keywords = Array.isArray(event.payload.matchedKeywords) ? event.payload.matchedKeywords.join('、') : '';
    return [
      `🆕 ${sourceDisplayName} 新商品`,
      '',
      listing.title,
      formatPrice(listing.price),
      '',
      `卖家：${listingSeller(listing)}`,
      keywords ? `命中：${keywords}` : '命中：无关键词限制',
      '',
      `查看商品：${listing.url}`,
    ].join('\n');
  }
  if (event.type === 'ProductPriceChangedEvent') {
    const before = event.before as Price | null;
    const after = event.after as Price | null;
    const beforeAmount = before?.amount ?? 0;
    const afterAmount = after?.amount ?? 0;
    const direction = afterAmount < beforeAmount ? '降价' : '涨价';
    const delta = Math.abs(beforeAmount - afterAmount);
    const listing = (event.payload as { listing?: Listing }).listing;
    const title = listing?.title ?? `商品 ${event.payload.productExternalId}`;
    return [
      `💰 ${sourceDisplayName} 商品${direction}`,
      '',
      title,
      '',
      formatPrice(before),
      afterAmount < beforeAmount ? '↓' : '↑',
      formatPrice(after),
      '',
      `${direction}：${formatPrice(after ? { amount: delta, currency: after.currency } : null)}`,
      ...(listing?.url ? ['', `查看商品：${listing.url}`] : []),
    ].join('\n');
  }
  if (event.type === 'ProductStatusChangedEvent') {
    const listing = (event.payload as { listing?: Listing }).listing;
    return [
      '⚠️ 商品状态变化',
      '',
      listing?.title ?? `商品 ${event.payload.productExternalId}`,
      '',
      `${formatStatus(event.before as ProductStatus | null)}\n→ ${formatStatus(event.after as ProductStatus)}`,
      ...(listing?.url ? ['', `查看商品：${listing.url}`] : []),
    ].join('\n');
  }
  const listing = event.after as Listing;
  const fields = Array.isArray(event.payload.fields) ? event.payload.fields.join('、') : '商品信息';
  return [
    `✏️ ${sourceDisplayName} 商品信息更新`,
    '',
    listing.title,
    `变化：${fields}`,
    ...(listing.url ? ['', `查看商品：${listing.url}`] : []),
  ].join('\n');
}
