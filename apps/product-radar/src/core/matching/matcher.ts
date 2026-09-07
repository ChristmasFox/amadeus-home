import type { Listing } from '../listing/model.js';
import type { SellerWatchRules } from '../watch/model.js';

export interface MatchResult {
  matched: boolean;
  matchedKeywords: string[];
  reason: string;
}

export function normalizeSearchText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

function searchableText(listing: Listing): string {
  const attributes = listing.attributes ? Object.values(listing.attributes).flatMap((value) => {
    if (Array.isArray(value)) return value;
    return [value];
  }) : [];
  return normalizeSearchText([
    listing.title,
    listing.description ?? '',
    ...attributes.map((value) => String(value ?? '')),
  ].join(' '));
}

export function matchListing(listing: Listing, rules: SellerWatchRules): MatchResult {
  const haystack = searchableText(listing);
  const excluded = rules.excludeKeywords.map(normalizeSearchText).filter(Boolean);
  const excludedKeyword = excluded.find((keyword) => haystack.includes(keyword));
  if (excludedKeyword) {
    return { matched: false, matchedKeywords: [], reason: `excluded keyword: ${excludedKeyword}` };
  }

  const keywords = rules.keywords.map(normalizeSearchText).filter(Boolean);
  const matchedKeywords = keywords.filter((keyword) => haystack.includes(keyword));
  if (rules.keywordMode === 'all' && matchedKeywords.length !== keywords.length) {
    return { matched: false, matchedKeywords, reason: 'not all keywords matched' };
  }
  if (rules.keywordMode === 'any' && keywords.length > 0 && matchedKeywords.length === 0) {
    return { matched: false, matchedKeywords, reason: 'no keyword matched' };
  }

  if (rules.currency && listing.price?.currency.toUpperCase() !== rules.currency.toUpperCase()) {
    return { matched: false, matchedKeywords, reason: 'currency mismatch' };
  }
  if (rules.minPrice !== undefined && (listing.price === undefined || listing.price.amount < rules.minPrice)) {
    return { matched: false, matchedKeywords, reason: 'below minimum price' };
  }
  if (rules.maxPrice !== undefined && (listing.price === undefined || listing.price.amount > rules.maxPrice)) {
    return { matched: false, matchedKeywords, reason: 'above maximum price' };
  }

  return { matched: true, matchedKeywords, reason: 'matched' };
}
