import type { Listing } from '../listing/model.js';
import type { SearchPlan } from '../search/model.js';
import type { TargetProfile } from '../target-profile/model.js';

export const WATCH_TYPES = ['seller', 'product', 'similarity', 'search', 'category', 'smart'] as const;
export type WatchType = (typeof WATCH_TYPES)[number];
export type ImplementedWatchType = Extract<WatchType, 'seller' | 'product' | 'similarity'>;

export interface WatchTarget extends Record<string, unknown> {
  sellerExternalId?: string;
  sellerUrl?: string;
  productExternalId?: string;
  productUrl?: string;
  referenceImageUrl?: string;
  referenceImageBase64?: string;
  referenceImageId?: string;
  searchUrl?: string;
  searchQuery?: string;
  searchQueries?: string[];
  userText?: string;
  explicitSearchTerms?: string[];
  visionProfile?: Record<string, unknown>;
}

export interface SellerWatchRules {
  keywords: string[];
  keywordMode: 'any' | 'all';
  excludeKeywords: string[];
  minPrice?: number;
  maxPrice?: number;
  currency?: string;
}

export interface ProductWatchRules {
  trackPrice: boolean;
  trackStatus: boolean;
  trackTitle: boolean;
  trackSeller: boolean;
  trackImages: boolean;
}

export interface SimilarityWatchRules {
  similarityThreshold: number;
  candidateLimit: number;
}

export type WatchRules = SellerWatchRules | ProductWatchRules | SimilarityWatchRules;

export interface Watch {
  id: string;
  source: string;
  type: ImplementedWatchType;
  target: WatchTarget;
  rules: WatchRules;
  enabled: boolean;
  intervalSeconds: number;
  sensorId?: string;
  createdAt: string;
  updatedAt: string;
  targetProfile?: TargetProfile;
  searchPlan?: SearchPlan;
}

export interface WatchCreateInput {
  id?: string;
  source: string;
  type: WatchType;
  target: WatchTarget;
  rules?: Partial<SellerWatchRules & ProductWatchRules & SimilarityWatchRules>;
  enabled?: boolean;
  intervalSeconds?: number;
  targetProfile?: TargetProfile;
  searchPlan?: SearchPlan;
}

export interface WatchPatchInput {
  rules?: Partial<SellerWatchRules & ProductWatchRules & SimilarityWatchRules>;
  enabled?: boolean;
  intervalSeconds?: number;
  target?: Partial<WatchTarget>;
  targetProfile?: TargetProfile;
  reanalyze?: boolean;
}

export function isImplementedWatchType(type: unknown): type is ImplementedWatchType {
  return type === 'seller' || type === 'product' || type === 'similarity';
}

export function isSellerRules(rules: WatchRules): rules is SellerWatchRules {
  return 'keywords' in rules;
}

export function isProductRules(rules: WatchRules): rules is ProductWatchRules {
  return 'trackPrice' in rules;
}

export function isSimilarityRules(rules: WatchRules): rules is SimilarityWatchRules {
  return 'similarityThreshold' in rules;
}

export function defaultRules(type: ImplementedWatchType): WatchRules {
  if (type === 'seller') {
    return { keywords: [], keywordMode: 'any', excludeKeywords: [] };
  }
  if (type === 'product') {
    return {
      trackPrice: true,
      trackStatus: true,
      trackTitle: true,
      trackSeller: true,
      trackImages: false,
    };
  }
  return { similarityThreshold: 0.6, candidateLimit: 60 };
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field} must be a finite number`);
  return value;
}

export function normalizeRules(type: ImplementedWatchType, input: unknown): WatchRules {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  if (type === 'seller') {
    const keywordMode = value.keywordMode === undefined ? 'any' : value.keywordMode;
    if (keywordMode !== 'any' && keywordMode !== 'all') throw new Error('keywordMode must be any or all');
    const minPrice = optionalNumber(value.minPrice, 'minPrice');
    const maxPrice = optionalNumber(value.maxPrice, 'maxPrice');
    if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) throw new Error('minPrice cannot exceed maxPrice');
    const currency = typeof value.currency === 'string' && value.currency.trim() ? value.currency.trim().toUpperCase() : undefined;
    return {
      keywords: stringArray(value.keywords, 'keywords'),
      keywordMode,
      excludeKeywords: stringArray(value.excludeKeywords, 'excludeKeywords'),
      ...(minPrice === undefined ? {} : { minPrice }),
      ...(maxPrice === undefined ? {} : { maxPrice }),
      ...(currency === undefined ? {} : { currency }),
    };
  }
  if (type === 'product') {
    const booleanField = (name: keyof ProductWatchRules, fallback: boolean): boolean => {
      const candidate = value[name];
      if (candidate === undefined) return fallback;
      if (typeof candidate !== 'boolean') throw new Error(`${name} must be boolean`);
      return candidate;
    };
    return {
      trackPrice: booleanField('trackPrice', true),
      trackStatus: booleanField('trackStatus', true),
      trackTitle: booleanField('trackTitle', true),
      trackSeller: booleanField('trackSeller', true),
      trackImages: booleanField('trackImages', false),
    };
  }
  const threshold = value.similarityThreshold === undefined ? 0.6 : value.similarityThreshold;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('similarityThreshold must be a number between 0 and 1');
  }
  const candidateLimit = value.candidateLimit === undefined ? 60 : value.candidateLimit;
  if (typeof candidateLimit !== 'number' || !Number.isInteger(candidateLimit) || candidateLimit < 1 || candidateLimit > 500) {
    throw new Error('candidateLimit must be an integer between 1 and 500');
  }
  return { similarityThreshold: threshold, candidateLimit };
}

export function mergeRules(type: ImplementedWatchType, current: WatchRules, patch: unknown): WatchRules {
  const value = patch && typeof patch === 'object' ? patch as Record<string, unknown> : {};
  if (type === 'seller') {
    const rules = current as SellerWatchRules;
    return normalizeRules('seller', { ...rules, ...value });
  }
  if (type === 'product') {
    const rules = current as ProductWatchRules;
    return normalizeRules('product', { ...rules, ...value });
  }
  const rules = current as SimilarityWatchRules;
  return normalizeRules('similarity', { ...rules, ...value });
}

export function watchListingTarget(watch: Watch, listing: Listing): boolean {
  if (watch.type !== 'product') return true;
  const targetId = typeof watch.target.productExternalId === 'string' ? watch.target.productExternalId : undefined;
  return targetId === undefined || targetId === listing.externalId;
}
