import { createHash, randomUUID } from 'node:crypto';
import { RadarError, SensorUnavailableError, SourceFetchError } from '../errors.js';
import type { RadarEvent } from '../events/events.js';
import type { Listing } from '../listing/model.js';
import type { ImageMatcher } from '../matching/image.js';
import { isSimilarityRules, type Watch } from '../watch/model.js';
import type { NotificationDispatcher } from '../notification/dispatcher.js';
import type { SensorClient, SensorWatch } from '../../sensors/sensor.js';
import type { SqliteRadarStore } from '../../storage/sqlite.js';
import type { ListingSourceAdapter, SourceAdapterRegistry, ValidatedTarget } from '../../sources/registry.js';
import { normalizeSearchQuery } from '../../sources/bunjang/search-planner.js';
import type { SearchFeed, SearchPage, SearchPlan, SearchQuery, WatchFeedSubscription } from './model.js';
import { backoffIntervalSeconds, DEFAULT_SIMILARITY_JITTER_SECONDS, recoveryIntervalSeconds, retryAfterSeconds, scheduledIntervalSeconds } from './scheduling.js';

export interface SearchFeedCoordinatorOptions {
  store: SqliteRadarStore;
  sources: SourceAdapterRegistry;
  sensor: SensorClient;
  notifications: NotificationDispatcher;
  imageMatcher?: ImageMatcher;
  webhookUrl: string;
  now?: () => string;
  maxPagesPerRun?: number;
  maxListingsPerRun?: number;
}

export interface SearchFeedRunResult {
  feedId: string;
  status: 'succeeded' | 'duplicate' | 'degraded';
  triggerKey: string;
  pages: number;
  fetchedListings: number;
  newListings: number;
  matchedListings: number;
  eventIds: string[];
  potentialCandidateGap?: boolean;
}

export interface SearchFeedPreparationResult {
  feeds: SearchFeed[];
  baselineCount: number;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
  });
}

function feedIdFor(source: string, canonicalKey: string): string {
  return `feed-${createHash('sha256').update(`${source}:${canonicalKey}`).digest('hex').slice(0, 24)}`;
}

function ensureListing(adapter: ListingSourceAdapter, listing: Listing): Listing {
  if (listing.source !== adapter.id || !listing.externalId || !listing.title || !listing.url || !Array.isArray(listing.imageUrls)) {
    throw new SourceFetchError('source adapter returned an invalid generic listing', { source: adapter.id, listing });
  }
  return listing;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function feedUrl(target: Watch['target'], query: string): string {
  const searchUrl = typeof target.searchUrl === 'string' && target.searchUrl.trim() ? target.searchUrl : undefined;
  if (searchUrl) return searchUrl;
  return `https://m.bunjang.co.kr/keywords/${encodeURIComponent(query)}`;
}

function retryAfterFromError(error: unknown): number | undefined {
  if (!(error instanceof RadarError)) return undefined;
  const details = jsonObject(error.details);
  const nested = jsonObject(details.body);
  return retryAfterSeconds({
    retryAfterSeconds: details.retryAfterSeconds ?? details.retryAfter ?? nested.retryAfterSeconds ?? nested.retryAfter,
  });
}

function statusFromError(error: unknown): number | undefined {
  if (!(error instanceof RadarError)) return undefined;
  const status = jsonObject(error.details).status;
  return typeof status === 'number' ? status : undefined;
}

export class SearchFeedCoordinator {
  private readonly now: () => string;
  private readonly maxPagesPerRun: number;
  private readonly maxListingsPerRun: number;

  constructor(private readonly options: SearchFeedCoordinatorOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxPagesPerRun = Math.max(1, options.maxPagesPerRun ?? 10);
    this.maxListingsPerRun = Math.max(1, options.maxListingsPerRun ?? 500);
  }

  listFeeds(): SearchFeed[] {
    return this.options.store.listSearchFeeds();
  }

  subscriptions(watchId: string): WatchFeedSubscription[] {
    return this.options.store.listWatchFeedSubscriptions({ watchId });
  }

  async prepareWatch(watch: Watch, plan: SearchPlan, jitterSeconds = watch.intervalSeconds === 900 ? DEFAULT_SIMILARITY_JITTER_SECONDS : 0): Promise<SearchFeedPreparationResult> {
    const feeds: SearchFeed[] = [];
    let baselineCount = 0;
    for (const query of plan.queries) {
      const validated = await this.validateQueryTarget(watch, query.query);
      const feed = await this.ensureFeed(watch, query.query, validated.url, undefined, jitterSeconds);
      const existingSubscription = this.options.store.getWatchFeedSubscription(watch.id, feed.id);
      try {
        const result = await this.runFeed(feed.id, `baseline:${watch.id}:${feed.id}`, { route: true });
        baselineCount += result.fetchedListings;
      } catch {
        // A source/sensor outage leaves the feed degraded but must not turn into an empty baseline.
      }
      if (!existingSubscription) {
        const latest = this.options.store.getLatestFeedListingEvent(feed.id)?.eventId;
        this.options.store.upsertWatchFeedSubscription({ watchId: watch.id, feedId: feed.id, ...(latest === undefined ? {} : { startAfterEventId: latest }), createdAt: this.now() });
      }
      const stored = this.options.store.getSearchFeed(feed.id);
      if (stored) feeds.push(stored);
    }
    return { feeds, baselineCount };
  }

  async updateWatchPlan(watch: Watch, plan: SearchPlan): Promise<SearchFeedPreparationResult> {
    const desired = new Set(plan.queries.map((query) => `${watch.source}:${normalizeSearchQuery(query.query)}`));
    const current = this.options.store.listWatchFeedSubscriptions({ watchId: watch.id });
    const retained = current.filter((subscription) => {
      const feed = this.options.store.getSearchFeed(subscription.feedId);
      return feed !== undefined && desired.has(feed.canonicalKey);
    });
    for (const subscription of current) {
      if (retained.some((item) => item.feedId === subscription.feedId)) continue;
      this.options.store.deleteWatchFeedSubscription(watch.id, subscription.feedId);
      await this.cleanupIfUnused(subscription.feedId);
    }
    return this.prepareWatch(watch, plan);
  }

  async runFeed(feedId: string, triggerKey = `manual:${randomUUID()}`, options: { route?: boolean } = {}): Promise<SearchFeedRunResult> {
    const feed = this.options.store.getSearchFeed(feedId);
    if (!feed) throw new RadarError(`search feed not found: ${feedId}`, 'NOT_FOUND', 404);
    const poll = this.options.store.beginFeedRun(feedId, triggerKey, this.now());
    if (!poll) return { feedId, status: 'duplicate', triggerKey, pages: 0, fetchedListings: 0, newListings: 0, matchedListings: 0, eventIds: [] };
    try {
      const adapter = this.options.sources.require(feed.source);
      const validated = await adapter.validateTarget('similarity', { searchQuery: feed.query, searchUrl: feed.target });
      const pageResult = await this.fetchIncremental(adapter, validated, feed);
      if (!pageResult.watermarkReached) {
        const degraded = this.markFeedDegraded(feed, 'WATERMARK_NOT_REACHED', true);
        this.options.store.finishFeedRun(poll.id, 'failed', this.now(), { error: 'WATERMARK_NOT_REACHED', listingsCount: pageResult.fetchedListings, changesCount: pageResult.newListings });
        return { ...pageResult, feedId, status: 'degraded', triggerKey, potentialCandidateGap: degraded.potentialCandidateGap };
      }
      const updated = this.markFeedSuccess(feed, pageResult.watermark, pageResult.potentialCandidateGap);
      if (updated.sensorWatchId) await this.updateSensorInterval(updated).catch(() => undefined);
      const routed = options.route === false ? { matchedListings: 0, eventIds: [] as string[] } : await this.routeFeedEvents(updated);
      this.options.store.finishFeedRun(poll.id, 'succeeded', this.now(), { listingsCount: pageResult.fetchedListings, changesCount: pageResult.newListings });
      await this.options.notifications.deliverPending();
      return { ...pageResult, ...routed, feedId, status: 'succeeded', triggerKey };
    } catch (error) {
      const degraded = this.markFeedFailure(feed, error);
      this.options.store.finishFeedRun(poll.id, 'failed', this.now(), { error: error instanceof Error ? error.message : String(error) });
      return { feedId, status: 'degraded', triggerKey, pages: 0, fetchedListings: 0, newListings: 0, matchedListings: 0, eventIds: [], potentialCandidateGap: degraded.potentialCandidateGap };
    }
  }

  async handleWebhook(feedId: string, sensorWatchId: string, triggerKey: string): Promise<Record<string, unknown>> {
    const feed = this.options.store.getSearchFeed(feedId);
    if (!feed) throw new RadarError(`search feed not found: ${feedId}`, 'NOT_FOUND', 404);
    if (!feed.sensorWatchId || feed.sensorWatchId !== sensorWatchId) throw new RadarError('webhook sensor watch does not match search feed', 'MALFORMED_WEBHOOK', 400);
    return { accepted: true, ...(await this.runFeed(feedId, triggerKey)) };
  }

  async syncWatch(watch: Watch, previous: Watch): Promise<void> {
    const subscriptions = this.options.store.listWatchFeedSubscriptions({ watchId: watch.id });
    for (const subscription of subscriptions) {
      const feed = this.options.store.getSearchFeed(subscription.feedId);
      if (!feed) continue;
      const desiredInterval = Math.min(feed.intervalSeconds, watch.intervalSeconds);
      const updated = desiredInterval === feed.intervalSeconds ? feed : { ...feed, intervalSeconds: desiredInterval, updatedAt: this.now() };
      if (updated !== feed) this.options.store.updateSearchFeed(updated);
      if (updated.sensorWatchId) {
        if (previous.enabled !== watch.enabled) {
          if (watch.enabled) await this.options.sensor.resumeWatch(updated.sensorWatchId);
          else await this.options.sensor.pauseWatch(updated.sensorWatchId);
        }
        if (updated !== feed || previous.intervalSeconds !== watch.intervalSeconds) await this.updateSensorInterval(updated);
      }
    }
  }

  async cleanupWatch(watchId: string): Promise<void> {
    const subscriptions = this.options.store.listWatchFeedSubscriptions({ watchId });
    for (const subscription of subscriptions) {
      this.options.store.deleteWatchFeedSubscription(watchId, subscription.feedId);
      await this.cleanupIfUnused(subscription.feedId);
    }
  }

  async ensureLegacyWatchFeed(watch: Watch): Promise<SearchFeedPreparationResult> {
    const existing = this.options.store.listWatchFeedSubscriptions({ watchId: watch.id });
    if (existing.length > 0) {
      const feeds = existing.map((item) => this.options.store.getSearchFeed(item.feedId)).filter((item): item is SearchFeed => item !== undefined);
      for (const feed of feeds) {
        if (watch.sensorId && feed.sensorWatchId && watch.sensorId !== feed.sensorWatchId) {
          try { await this.options.sensor.deleteWatch(watch.sensorId); } catch { /* best effort migration cleanup */ }
          const { sensorId: _legacySensorId, ...watchWithoutSensor } = watch;
          this.options.store.updateWatch({ ...watchWithoutSensor, updatedAt: this.now() });
        }
      }
      return { feeds, baselineCount: 0 };
    }
    const query = typeof watch.target.searchQuery === 'string' && watch.target.searchQuery.trim() ? watch.target.searchQuery : '의류';
    const validated = await this.validateQueryTarget(watch, query);
    const feed = await this.ensureFeed(watch, query, validated.url, watch.sensorId, watch.intervalSeconds === 900 ? DEFAULT_SIMILARITY_JITTER_SECONDS : 0);
    // Preserve V0.2 seen state as a silent baseline before the first shared-feed run.
    for (const seen of this.options.store.listSeenListings(watch.id)) {
      const listing = this.options.store.getListing(seen.source, seen.externalId);
      if (listing) this.options.store.insertFeedListingEvent(feed.id, listing, seen.firstSeenAt);
    }
    const latest = this.options.store.getLatestFeedListingEvent(feed.id)?.eventId;
    this.options.store.upsertWatchFeedSubscription({ watchId: watch.id, feedId: feed.id, ...(latest === undefined ? {} : { startAfterEventId: latest }), createdAt: this.now() });
    return { feeds: [feed], baselineCount: 0 };
  }

  private async validateQueryTarget(watch: Watch, query: string): Promise<ValidatedTarget> {
    const adapter = this.options.sources.require(watch.source);
    return adapter.validateTarget('similarity', { ...watch.target, searchQuery: query, searchUrl: feedUrl(watch.target, query) });
  }

  private async ensureFeed(watch: Watch, query: string, url: string, existingSensorId?: string, jitterSeconds = DEFAULT_SIMILARITY_JITTER_SECONDS): Promise<SearchFeed> {
    const canonicalQuery = normalizeSearchQuery(query);
    const canonicalKey = `${watch.source}:${canonicalQuery}`;
    const existing = this.options.store.findSearchFeed(watch.source, canonicalKey);
    if (existing) {
      const desiredInterval = Math.min(existing.intervalSeconds, watch.intervalSeconds);
      const desiredJitter = jitterSeconds === 0 ? 0 : existing.jitterSeconds;
      const desiredSensorId = existing.sensorWatchId ?? existingSensorId;
      const changed = desiredInterval !== existing.intervalSeconds || desiredJitter !== existing.jitterSeconds || desiredSensorId !== existing.sensorWatchId;
      const updated = changed ? {
        ...existing, intervalSeconds: desiredInterval, jitterSeconds: desiredJitter,
        ...(desiredSensorId === undefined ? {} : { sensorWatchId: desiredSensorId }), updatedAt: this.now(),
      } : existing;
      if (changed) this.options.store.updateSearchFeed(updated);
      if (updated.sensorWatchId && changed) await this.updateSensorInterval(updated).catch(() => undefined);
      return updated;
    }
    const now = this.now();
    const feed: SearchFeed = {
      id: feedIdFor(watch.source, canonicalKey), source: watch.source, target: url, query,
      canonicalKey, intervalSeconds: watch.intervalSeconds, jitterSeconds,
      ...(existingSensorId === undefined ? {} : { sensorWatchId: existingSensorId }),
      state: 'ACTIVE', failureCount: 0, potentialCandidateGap: false, createdAt: now, updatedAt: now,
    };
    if (!feed.sensorWatchId) {
      try {
        const sensor = await this.options.sensor.createWatch({
          radarWatchId: feed.id, url, title: `${watch.source} shared search feed ${query}`,
          intervalSeconds: scheduledIntervalSeconds(feed.id, feed.intervalSeconds, feed.jitterSeconds), webhookUrl: this.options.webhookUrl,
        });
        feed.sensorWatchId = sensor.id;
      } catch (error) {
        feed.state = 'DEGRADED';
        feed.degradedReason = 'SENSOR_UNAVAILABLE';
      }
    }
    this.options.store.createSearchFeed(feed);
    return feed;
  }

  private async fetchIncremental(adapter: ListingSourceAdapter, validated: ValidatedTarget, feed: SearchFeed): Promise<SearchFeedRunResult & { watermarkReached: boolean; watermark?: string; potentialCandidateGap: boolean }> {
    let cursor: string | undefined;
    let pages = 0;
    let fetchedListings = 0;
    let newListings = 0;
    let watermarkReached = false;
    let watermark = feed.watermark;
    let firstListingId: string | undefined;
    let potentialCandidateGap = false;
    const seenCursors = new Set<string>();
    while (pages < this.maxPagesPerRun && fetchedListings < this.maxListingsPerRun) {
      const page = await this.fetchPage(adapter, validated, cursor);
      pages += 1;
      const normalized = this.normalizePage(adapter, page.items, validated);
      if (normalized[0] && firstListingId === undefined) firstListingId = normalized[0].externalId;
      let pageBoundary = false;
      for (const listing of normalized) {
        fetchedListings += 1;
        if (fetchedListings > this.maxListingsPerRun) {
          potentialCandidateGap = true;
          break;
        }
        if (feed.watermark !== undefined && (listing.externalId === feed.watermark || this.options.store.hasFeedListing(feed.id, listing.source, listing.externalId))) {
          watermarkReached = true;
          pageBoundary = true;
          continue;
        }
        this.options.store.upsertListing(listing);
        const event = this.options.store.insertFeedListingEvent(feed.id, listing, this.now());
        if (event) newListings += 1;
      }
      if (potentialCandidateGap || pageBoundary) break;
      const nextCursor = page.nextCursor;
      if (!nextCursor || normalized.length === 0 || seenCursors.has(nextCursor)) {
        watermarkReached = true;
        break;
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
    if (!watermarkReached && (pages >= this.maxPagesPerRun || fetchedListings >= this.maxListingsPerRun)) potentialCandidateGap = true;
    if (watermarkReached && firstListingId !== undefined) watermark = firstListingId;
    return {
      feedId: feed.id, status: watermarkReached ? 'succeeded' : 'degraded', triggerKey: '', pages, fetchedListings, newListings, matchedListings: 0, eventIds: [],
      ...(watermark === undefined ? {} : { watermark }), potentialCandidateGap, watermarkReached,
    };
  }

  private async fetchPage(adapter: ListingSourceAdapter, validated: ValidatedTarget, cursor: string | undefined): Promise<SearchPage> {
    if (adapter.fetchSearchPage) {
      return adapter.fetchSearchPage({
        ...validated,
        searchQuery: validated.searchQuery ?? '',
        ...(cursor === undefined ? {} : { cursor }),
        pageSize: 60,
      });
    }
    const items = await adapter.fetchSearchListings({ ...validated, candidateLimit: 60 });
    return { items };
  }

  private normalizePage(adapter: ListingSourceAdapter, raw: unknown[], target: ValidatedTarget): Listing[] {
    const seen = new Set<string>();
    const result: Listing[] = [];
    for (const item of raw) {
      const listing = ensureListing(adapter, adapter.normalizeListing(item, { target }));
      const key = `${listing.source}:${listing.externalId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(listing);
    }
    return result;
  }

  private markFeedSuccess(feed: SearchFeed, watermark: string | undefined, potentialCandidateGap: boolean): SearchFeed {
    const failureCount = Math.max(0, feed.failureCount - 1);
    const { degradedReason: _degradedReason, backoffUntil: _backoffUntil, ...cleanFeed } = feed;
    const updated: SearchFeed = {
      ...cleanFeed, state: feed.degradedReason === 'SENSOR_UNAVAILABLE' ? 'DEGRADED' : 'ACTIVE',
      ...(watermark === undefined ? {} : { watermark }), lastSuccessfulRunAt: this.now(), failureCount,
      ...(feed.degradedReason === 'SENSOR_UNAVAILABLE' ? { degradedReason: feed.degradedReason } : {}),
      potentialCandidateGap, updatedAt: this.now(),
    };
    this.options.store.updateSearchFeed(updated);
    return updated;
  }

  private markFeedDegraded(feed: SearchFeed, reason: string, potentialCandidateGap: boolean): SearchFeed {
    const updated: SearchFeed = { ...feed, state: 'DEGRADED', degradedReason: reason, potentialCandidateGap, updatedAt: this.now() };
    this.options.store.updateSearchFeed(updated);
    return updated;
  }

  private markFeedFailure(feed: SearchFeed, error: unknown): SearchFeed {
    const failureCount = feed.failureCount + 1;
    const status = statusFromError(error);
    const retryAfter = retryAfterFromError(error);
    const interval = backoffIntervalSeconds(feed.intervalSeconds, failureCount, retryAfter);
    const backoffUntil = new Date(Date.now() + interval * 1000).toISOString();
    const reason = status === 429 ? 'RATE_LIMITED' : error instanceof SensorUnavailableError ? 'SENSOR_UNAVAILABLE' : 'FETCH_FAILED';
    const updated: SearchFeed = { ...feed, state: 'DEGRADED', failureCount, degradedReason: reason, backoffUntil, updatedAt: this.now() };
    this.options.store.updateSearchFeed(updated);
    if (updated.sensorWatchId) void this.options.sensor.updateWatch(updated.sensorWatchId, { intervalSeconds: interval }).catch(() => undefined);
    return updated;
  }

  private async updateSensorInterval(feed: SearchFeed): Promise<void> {
    if (!feed.sensorWatchId) return;
    const interval = feed.failureCount > 0 ? recoveryIntervalSeconds(feed.intervalSeconds, feed.failureCount) : scheduledIntervalSeconds(feed.id, feed.intervalSeconds, feed.jitterSeconds);
    await this.options.sensor.updateWatch(feed.sensorWatchId, { intervalSeconds: interval });
  }

  private async routeFeedEvents(feed: SearchFeed): Promise<{ matchedListings: number; eventIds: string[] }> {
    let matchedListings = 0;
    const eventIds: string[] = [];
    const subscriptions = this.options.store.listWatchFeedSubscriptions({ feedId: feed.id });
    for (const subscription of subscriptions) {
      const watch = this.options.store.getWatch(subscription.watchId);
      if (!watch || !watch.enabled || watch.type !== 'similarity') continue;
      const events = this.options.store.listFeedListingEventsAfter(feed.id, subscription.startAfterEventId);
      let lastEventId = subscription.startAfterEventId;
      for (const item of events) {
        lastEventId = item.event.eventId;
        const result = await this.processListing(watch, item.listing);
        matchedListings += result.matched ? 1 : 0;
        if (result.eventId) eventIds.push(result.eventId);
      }
      this.options.store.upsertWatchFeedSubscription({ ...subscription, ...(lastEventId === undefined ? {} : { startAfterEventId: lastEventId }) });
    }
    return { matchedListings, eventIds };
  }

  private async processListing(watch: Watch, listing: Listing): Promise<{ matched: boolean; eventId?: string }> {
    if (!isSimilarityRules(watch.rules)) throw new RadarError('similarity watch has invalid rules', 'INVALID_STATE', 500);
    const isNewForWatch = this.options.store.recordSeenListing(watch.id, listing, this.now(), false, false);
    if (!isNewForWatch) return { matched: false };
    const referenceId = typeof watch.target.referenceImageId === 'string' ? watch.target.referenceImageId : '';
    if (!this.options.imageMatcher || !referenceId) return { matched: false };
    let result;
    try {
      result = await this.options.imageMatcher.match(referenceId, listing.imageUrls, { source: listing.source, externalId: listing.externalId, threshold: watch.rules.similarityThreshold });
    } catch {
      return { matched: false };
    }
    const score = result.matchScore ?? result.score;
    const matched = result.comparedImages > 0 && score >= watch.rules.similarityThreshold;
    this.options.store.recordSimilarityMatch(watch.id, listing, score, result.bestImageUrl, matched, this.now());
    if (!matched) return { matched: false };
    this.options.store.markSeenMatched(watch.id, listing);
    const eventKey = `${watch.id}:SimilarListingMatchedEvent:${listing.source}:${listing.externalId}`;
    const event: RadarEvent = {
      id: eventKey, eventKey, watchId: watch.id, source: listing.source, type: 'SimilarListingMatchedEvent', occurredAt: this.now(), before: null, after: listing,
      payload: { similarity: score, threshold: watch.rules.similarityThreshold, provider: result.provider ?? 'sharp', modelVersion: result.modelVersion ?? 'unknown', ...(result.bestImageUrl === undefined ? {} : { bestImageUrl: result.bestImageUrl }) },
    };
    if (!this.options.store.insertEvent(event)) return { matched: true };
    await this.options.notifications.dispatch(event);
    return { matched: true, eventId: event.id };
  }

  private async cleanupIfUnused(feedId: string): Promise<void> {
    if (this.options.store.countFeedSubscribers(feedId) > 0) return;
    const feed = this.options.store.getSearchFeed(feedId);
    if (!feed) return;
    if (feed.sensorWatchId) {
      try { await this.options.sensor.deleteWatch(feed.sensorWatchId); } catch { /* local cleanup remains authoritative */ }
    }
    this.options.store.deleteSearchFeed(feedId);
  }
}
