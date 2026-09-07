import { isReliableStatus, type Listing, type Price, type Seller } from '../listing/model.js';
import type { ProductWatchRules } from '../watch/model.js';

export interface ProductDiff {
  priceChanged: boolean;
  statusChanged: boolean;
  titleChanged: boolean;
  sellerChanged: boolean;
  imagesChanged: boolean;
  beforePrice?: Price;
  afterPrice?: Price;
  beforeStatus?: Listing['status'];
  afterStatus?: Listing['status'];
  beforeTitle?: string;
  afterTitle?: string;
  beforeSeller?: Seller;
  afterSeller?: Seller;
}

function textKey(value: unknown): string {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function priceKey(price: Price | undefined): string {
  return price ? `${price.currency.toUpperCase()}:${price.amount}` : '';
}

function sellerKey(seller: Seller | undefined): string {
  if (!seller) return '';
  return [seller.externalId, seller.name, seller.url].map(textKey).join('|');
}

function partialState(listing: Listing): boolean {
  return listing.attributes?.partial === true;
}

function imageKey(images: string[]): string {
  return images.map((image) => textKey(image)).filter(Boolean).join('|');
}

export function productStateFingerprint(listing: Listing): string {
  return JSON.stringify({
    source: listing.source,
    externalId: listing.externalId,
    title: textKey(listing.title),
    price: priceKey(listing.price),
    status: listing.status ?? 'UNKNOWN',
    seller: sellerKey(listing.seller),
    images: imageKey(listing.imageUrls),
  });
}

function reliableStatusChanged(before: Listing['status'], after: Listing['status']): boolean {
  if (!isReliableStatus(after)) return false;
  return before !== after;
}

export function detectProductChanges(before: Listing, after: Listing, rules: ProductWatchRules): ProductDiff {
  const priceChanged = !partialState(after) && rules.trackPrice && priceKey(before.price) !== priceKey(after.price) && before.price !== undefined && after.price !== undefined;
  const statusChanged = rules.trackStatus && reliableStatusChanged(before.status, after.status);
  const titleChanged = !partialState(after) && rules.trackTitle && textKey(before.title) !== textKey(after.title);
  const sellerChanged = !partialState(after) && rules.trackSeller && sellerKey(before.seller) !== sellerKey(after.seller);
  const imagesChanged = !partialState(after) && rules.trackImages && imageKey(before.imageUrls) !== imageKey(after.imageUrls);

  return {
    priceChanged,
    statusChanged,
    titleChanged,
    sellerChanged,
    imagesChanged,
    ...(before.price === undefined ? {} : { beforePrice: before.price }),
    ...(after.price === undefined ? {} : { afterPrice: after.price }),
    ...(before.status === undefined ? {} : { beforeStatus: before.status }),
    ...(after.status === undefined ? {} : { afterStatus: after.status }),
    ...(before.title ? { beforeTitle: before.title } : {}),
    ...(after.title ? { afterTitle: after.title } : {}),
    ...(before.seller ? { beforeSeller: before.seller } : {}),
    ...(after.seller ? { afterSeller: after.seller } : {}),
  };
}

export function hasMeaningfulProductDiff(diff: ProductDiff): boolean {
  return diff.priceChanged || diff.statusChanged || diff.titleChanged || diff.sellerChanged || diff.imagesChanged;
}
