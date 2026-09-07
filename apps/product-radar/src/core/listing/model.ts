export const PRODUCT_STATUSES = ['ACTIVE', 'SOLD', 'RESERVED', 'UNAVAILABLE', 'UNKNOWN'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export interface Price {
  amount: number;
  currency: string;
}

export interface Seller {
  externalId?: string;
  name?: string;
  url?: string;
}

export interface Listing {
  source: string;
  externalId: string;
  title: string;
  description?: string;
  url: string;
  imageUrls: string[];
  seller?: Seller;
  price?: Price;
  status?: ProductStatus;
  publishedAt?: string;
  discoveredAt: string;
  attributes?: Record<string, unknown>;
  raw?: unknown;
}

export type ProductState = Listing;

export function listingIdentity(listing: Pick<Listing, 'source' | 'externalId'>): string {
  return `${listing.source}:${listing.externalId}`;
}

export function isReliableStatus(status: ProductStatus | undefined): status is Exclude<ProductStatus, 'UNKNOWN'> {
  return status !== undefined && status !== 'UNKNOWN';
}
