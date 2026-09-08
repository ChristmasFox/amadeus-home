import type { TargetProfile } from '../target-profile/model.js';

export type SearchQueryTier = 'specific' | 'medium' | 'broad' | 'explicit';

export interface SearchQuery {
  query: string;
  canonicalQuery: string;
  tier: SearchQueryTier;
  source: 'user' | 'planner' | 'inferred';
}

export interface SearchPlan {
  source: string;
  queries: SearchQuery[];
  generatedAt: string;
  profileProvider?: string;
}

export type SearchFeedState = 'ACTIVE' | 'DEGRADED' | 'DISABLED';

export interface SearchFeed {
  id: string;
  source: string;
  target: string;
  query: string;
  canonicalKey: string;
  intervalSeconds: number;
  jitterSeconds: number;
  sensorWatchId?: string;
  state: SearchFeedState;
  lastSuccessfulRunAt?: string;
  watermark?: string;
  failureCount: number;
  degradedReason?: string;
  potentialCandidateGap: boolean;
  backoffUntil?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WatchFeedSubscription {
  watchId: string;
  feedId: string;
  startAfterEventId?: string;
  createdAt: string;
}

export interface FeedListingEvent {
  eventId: string;
  feedId: string;
  source: string;
  externalId: string;
  listingIdentity: string;
  discoveredAt: string;
}

export interface SearchPage {
  items: unknown[];
  nextCursor?: string;
  raw?: unknown;
}

export interface SearchPageTarget {
  searchQuery: string;
  searchUrl?: string;
  cursor?: string;
  pageSize?: number;
  [key: string]: unknown;
}

export interface SourceSearchPlanner {
  readonly source: string;
  plan(profile: TargetProfile): SearchPlan;
}
