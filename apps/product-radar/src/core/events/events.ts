import type { Listing, Price, ProductStatus } from '../listing/model.js';

export const RADAR_EVENT_TYPES = [
  'ListingMatchedEvent',
  'ProductPriceChangedEvent',
  'ProductStatusChangedEvent',
  'ProductUpdatedEvent',
] as const;
export type RadarEventType = (typeof RADAR_EVENT_TYPES)[number];

export interface RadarEvent {
  id: string;
  eventKey: string;
  watchId: string;
  source: string;
  type: RadarEventType;
  occurredAt: string;
  before: unknown | null;
  after: unknown | null;
  payload: Record<string, unknown>;
}

export interface ListingMatchedEvent extends RadarEvent {
  type: 'ListingMatchedEvent';
  before: null;
  after: Listing;
  payload: {
    matchedKeywords: string[];
    reason: string;
  };
}

export interface ProductPriceChangedEvent extends RadarEvent {
  type: 'ProductPriceChangedEvent';
  before: Price | null;
  after: Price | null;
  payload: { productExternalId: string; listing?: Listing };
}

export interface ProductStatusChangedEvent extends RadarEvent {
  type: 'ProductStatusChangedEvent';
  before: ProductStatus | null;
  after: ProductStatus;
  payload: { productExternalId: string; listing?: Listing };
}

export interface ProductUpdatedEvent extends RadarEvent {
  type: 'ProductUpdatedEvent';
  before: Listing;
  after: Listing;
  payload: {
    productExternalId: string;
    fields: Array<'title' | 'seller' | 'images'>;
  };
}

export type TypedRadarEvent = ListingMatchedEvent | ProductPriceChangedEvent | ProductStatusChangedEvent | ProductUpdatedEvent;

export function eventId(eventKey: string): string {
  return eventKey;
}
