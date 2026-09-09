import { createHash, randomUUID } from 'node:crypto';
import { RadarError, SensorUnavailableError, SourceFetchError } from './errors.js';
import type { Listing, ProductStatus } from './listing/model.js';
import type { RadarEvent } from './events/events.js';
import { detectProductChanges, hasMeaningfulProductDiff, productStateFingerprint } from './detection/comparator.js';
import { matchListing } from './matching/matcher.js';
import type { ImageMatcher, ImageSource } from './matching/image.js';
import { NotificationDispatcher } from './notification/dispatcher.js';
import type { SensorClient, SensorWatch } from '../sensors/sensor.js';
import { SearchFeedCoordinator } from './search/feed-service.js';
import type { SearchPlan, SearchQuery } from './search/model.js';
import { BunjangSearchPlanner } from '../sources/bunjang/search-planner.js';
import { TargetProfileExtractor } from './target-profile/extractor.js';
import type { TargetProfile, TargetProfileExtractionInput, VisionProfile } from './target-profile/model.js';
import type { SqliteRadarStore } from '../storage/sqlite.js';
import { SourceAdapterRegistry, type ListingSourceAdapter, type ValidatedTarget } from '../sources/registry.js';
import { isSellerRules, isSimilarityRules, type ImplementedWatchType, type Watch, type WatchTarget } from './watch/model.js';
import { applyWatchPatch, parseWatchCreateInput, parseWatchPatch } from './watch/validation.js';

export interface RadarServiceOptions {
  store: SqliteRadarStore;
  sources: SourceAdapterRegistry;
  sensor: SensorClient;
  notifications: NotificationDispatcher;
  webhookUrl: string;
  imageMatcher?: ImageMatcher;
  targetProfileExtractor?: TargetProfileExtractor;
  searchPlanners?: Record<string, { plan(profile: TargetProfile): SearchPlan }>;
  maxPagesPerRun?: number;
  maxListingsPerRun?: number;
  now?: () => string;
}

export interface WatchRunResult {
  watchId: string;
  status: 'succeeded' | 'duplicate' | 'disabled';
  triggerKey: string;
  newListings: number;
  matchedListings: number;
  changes: number;
  eventIds: string[];
}

export interface WatchCreationResult {
  watch: Watch;
  baselineCount: number;
  baselineNotifications: number;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex').slice(0, 32);
}

function webhookCandidates(value: Record<string, unknown>): Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = [value];
  for (const key of ['payload', 'data', 'message', 'body']) {
    const nested = value[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) candidates.push(nested as Record<string, unknown>);
    if (typeof nested === 'string') {
      try {
        const parsed = JSON.parse(nested) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) candidates.push(parsed as Record<string, unknown>);
      } catch { /* not a JSON wrapper */ }
    }
  }
  return candidates;
}

function webhookString(value: Record<string, unknown>, keys: string[]): string {
  for (const candidate of webhookCandidates(value)) {
    for (const key of keys) {
      const result = String(candidate[key] ?? '').trim();
      if (result) return result;
    }
  }
  return '';
}

function ensureListing(listing: Listing, source: string, expectedExternalId?: string): Listing {
  if (listing.source !== source || !listing.externalId || !listing.title || !listing.url || !Array.isArray(listing.imageUrls)) {
    throw new SourceFetchError('source adapter returned an invalid generic listing', { source, listing });
  }
  if (expectedExternalId !== undefined && listing.externalId !== expectedExternalId) {
    throw new SourceFetchError('source adapter returned a different product than requested', { expectedExternalId, actual: listing.externalId });
  }
  return listing;
}

function statusOrNull(value: ProductStatus | undefined): ProductStatus | null {
  return value ?? null;
}

function referenceInput(target: WatchTarget): ImageSource {
  const base64 = typeof target.referenceImageBase64 === 'string' && target.referenceImageBase64.trim() ? target.referenceImageBase64 : undefined;
  const url = typeof target.referenceImageUrl === 'string' && target.referenceImageUrl.trim() ? target.referenceImageUrl : undefined;
  if (base64 !== undefined) return { base64 };
  if (url !== undefined) return { url };
  throw new RadarError('similarity watch requires a reference image', 'INVALID_REFERENCE_IMAGE', 400);
}

function persistedSimilarityTarget(target: ValidatedTarget, referenceId: string): WatchTarget {
  const { referenceImageBase64: _referenceImageBase64, referenceImageUrl: _referenceImageUrl, ...withoutInput } = target;
  return { ...withoutInput, referenceImageId: referenceId };
}

export class ProductRadarService {
  private readonly now: () => string;
  private readonly store: SqliteRadarStore;
  private readonly sources: SourceAdapterRegistry;
  private readonly sensor: SensorClient;
  private readonly notifications: NotificationDispatcher;
  private readonly webhookUrl: string;
  private readonly imageMatcher: ImageMatcher | undefined;
  private readonly targetProfileExtractor: TargetProfileExtractor;
  private readonly searchPlanners: Record<string, { plan(profile: TargetProfile): SearchPlan }>;
  private readonly searchFeeds: SearchFeedCoordinator;

  constructor(options: RadarServiceOptions) {
    this.store = options.store;
    this.sources = options.sources;
    this.sensor = options.sensor;
    this.notifications = options.notifications;
    this.webhookUrl = options.webhookUrl;
    this.imageMatcher = options.imageMatcher;
    this.targetProfileExtractor = options.targetProfileExtractor ?? new TargetProfileExtractor(options.now === undefined ? {} : { now: options.now });
    this.searchPlanners = options.searchPlanners ?? { bunjang: new BunjangSearchPlanner(options.now === undefined ? undefined : options.now) };
    this.now = options.now ?? (() => new Date().toISOString());
    const feedOptions = {
      store: this.store, sources: this.sources, sensor: this.sensor, notifications: this.notifications,
      ...(this.imageMatcher === undefined ? {} : { imageMatcher: this.imageMatcher }), webhookUrl: this.webhookUrl, now: this.now,
      ...(options.maxPagesPerRun === undefined ? {} : { maxPagesPerRun: options.maxPagesPerRun }),
      ...(options.maxListingsPerRun === undefined ? {} : { maxListingsPerRun: options.maxListingsPerRun }),
    };
    this.searchFeeds = new SearchFeedCoordinator(feedOptions);
  }

  listWatches(): Watch[] {
    return this.store.listWatches();
  }

  getWatch(id: string): Watch | undefined {
    return this.store.getWatch(id);
  }

  listSearchFeeds() {
    return this.searchFeeds.listFeeds();
  }

  async previewWatch(input: unknown): Promise<Record<string, unknown>> {
    const parsed = parseWatchCreateInput(input);
    const adapter = this.sources.require(parsed.source);
    this.sources.requireCapability(adapter, parsed.type);
    if (parsed.type !== 'similarity') {
      const validatedTarget = await adapter.validateTarget(parsed.type, parsed.target);
      const normalized = await this.fetchNormalized(adapter, parsed.type, validatedTarget);
      const first = normalized[0];
      return {
        source: adapter.id,
        sourceDisplayName: adapter.displayName,
        type: parsed.type,
        target: validatedTarget,
        rules: parsed.rules,
        baselineCount: normalized.length,
        ...(parsed.type === 'seller'
          ? { seller: first?.seller ?? { externalId: validatedTarget.externalId, url: validatedTarget.url }, listings: normalized.slice(0, 10) }
          : { product: first }),
      };
    }

    const context = await this.similarityContext(parsed.source, parsed.target, parsed.targetProfile, parsed.searchPlan);
    const normalizedByIdentity = new Map<string, Listing>();
    const searchWarnings: Array<{ query: string; message: string }> = [];
    const referenceTarget = await adapter.validateTarget('similarity', (() => {
      const { searchUrl: _searchUrl, ...base } = parsed.target;
      return { ...base, searchQuery: context.plan.queries[0]?.query ?? '패션' };
    })());
    const preparedTargetPromise = this.prepareSimilarityTarget(referenceTarget);
    const queryResultsPromise = Promise.allSettled(context.plan.queries.map(async (query) => {
      const validated = await adapter.validateTarget('similarity', (() => { const { searchUrl: _searchUrl, ...base } = parsed.target; return { ...base, searchQuery: query.query }; })());
      const target = { ...validated, candidateLimit: (parsed.rules as { candidateLimit: number }).candidateLimit };
      return { query: query.query, rows: await this.fetchSimilarityPreviewNormalized(adapter, target) };
    }));
    const [queryResults, preparedTarget] = await Promise.all([queryResultsPromise, preparedTargetPromise]);
    for (const [index, result] of queryResults.entries()) {
      if (result.status === 'fulfilled') {
        for (const listing of result.value.rows) normalizedByIdentity.set(`${listing.source}:${listing.externalId}`, listing);
      } else {
        const query = context.plan.queries[index]?.query ?? 'unknown';
        searchWarnings.push({ query, message: result.reason instanceof Error ? result.reason.message : String(result.reason) });
      }
    }
    const normalized = [...normalizedByIdentity.values()];
    const previewRules = { ...(parsed.rules as { similarityThreshold: number; candidateLimit: number }), candidateLimit: Math.min((parsed.rules as { candidateLimit: number }).candidateLimit, 12) };
    const scores = await this.scoreSimilarity(preparedTarget.referenceImageId ?? '', normalized, previewRules);
    return {
      source: adapter.id,
      sourceDisplayName: adapter.displayName,
      type: parsed.type,
      target: this.publicTarget(preparedTarget),
      targetProfile: context.profile,
      searchPlan: context.plan,
      rules: parsed.rules,
      baselineCount: normalized.length,
      similarity: {
        threshold: (parsed.rules as { similarityThreshold: number }).similarityThreshold,
        candidateCount: normalized.length,
        topMatches: scores.slice(0, 5),
      },
      ...(searchWarnings.length === 0 ? {} : { searchWarnings }),
    };
  }

  async createWatch(input: unknown): Promise<WatchCreationResult> {
    const parsed = parseWatchCreateInput(input);
    const adapter = this.sources.require(parsed.source);
    this.sources.requireCapability(adapter, parsed.type);
    if (parsed.type === 'similarity') return this.createSimilarityWatch(parsed, adapter);

    const validatedTarget = await adapter.validateTarget(parsed.type, parsed.target);
    const id = parsed.id ?? randomUUID();
    if (this.store.getWatch(id)) throw new RadarError(`watch already exists: ${id}`, 'CONFLICT', 409);
    const now = this.now();
    const watch: Watch = {
      id, source: adapter.id, type: parsed.type, target: validatedTarget, rules: parsed.rules,
      enabled: parsed.enabled ?? true, intervalSeconds: parsed.intervalSeconds, createdAt: now, updatedAt: now,
    };
    const baseline = await this.fetchNormalized(adapter, watch.type, validatedTarget);
    let sensorWatch: SensorWatch | undefined;
    try {
      sensorWatch = await this.sensor.createWatch({
        radarWatchId: watch.id, url: validatedTarget.url, title: `${adapter.displayName} ${watch.type} watch ${validatedTarget.externalId}`,
        intervalSeconds: watch.intervalSeconds, webhookUrl: this.webhookUrl,
      });
      if (!watch.enabled) await this.sensor.pauseWatch(sensorWatch.id);
      const persistedWatch: Watch = { ...watch, sensorId: sensorWatch.id };
      this.store.transaction(() => {
        this.store.createWatch(persistedWatch);
        this.store.upsertSensorWatch(persistedWatch.id, sensorWatch!.id, this.sensor.id, validatedTarget.url, persistedWatch.enabled ? 'active' : 'paused', now);
        if (watch.type === 'seller') {
          for (const listing of baseline) {
            this.store.upsertListing(listing);
            this.store.recordSeenListing(watch.id, listing, now, true, false);
          }
        } else {
          const state = baseline[0];
          if (!state) throw new SourceFetchError('product source returned no state');
          this.store.upsertListing(state);
          this.store.insertProductSnapshot(watch.id, state, productStateFingerprint(state), now, true);
        }
      });
      return { watch: persistedWatch, baselineCount: baseline.length, baselineNotifications: 0 };
    } catch (error) {
      if (sensorWatch?.id) {
        try { await this.sensor.deleteWatch(sensorWatch.id); } catch { /* best-effort compensation */ }
      }
      throw error;
    }
  }

  private async createSimilarityWatch(parsed: ReturnType<typeof parseWatchCreateInput>, adapter: ListingSourceAdapter): Promise<WatchCreationResult> {
    const context = await this.similarityContext(parsed.source, parsed.target, parsed.targetProfile, parsed.searchPlan);
    const firstQuery = context.plan.queries[0]?.query ?? '패션';
    const validated = await adapter.validateTarget('similarity', (() => {
      const { searchUrl: _searchUrl, ...base } = parsed.target;
      return { ...base, searchQuery: firstQuery };
    })());
    const prepared = await this.prepareSimilarityTarget(validated);
    const id = parsed.id ?? randomUUID();
    if (this.store.getWatch(id)) throw new RadarError(`watch already exists: ${id}`, 'CONFLICT', 409);
    const now = this.now();
    const target: WatchTarget = {
      ...prepared,
      searchQuery: firstQuery,
      searchUrl: validated.url,
      searchQueries: context.plan.queries.map((query) => query.query),
      ...(parsed.target.userText === undefined ? {} : { userText: parsed.target.userText }),
      ...(parsed.target.explicitSearchTerms === undefined ? {} : { explicitSearchTerms: parsed.target.explicitSearchTerms }),
    };
    const watch: Watch = {
      id, source: adapter.id, type: 'similarity', target, rules: parsed.rules, enabled: parsed.enabled ?? true,
      intervalSeconds: parsed.intervalSeconds, createdAt: now, updatedAt: now, targetProfile: context.profile, searchPlan: context.plan,
    };
    this.store.createWatch(watch);
    try {
      const preparedFeeds = await this.searchFeeds.prepareWatch(watch, context.plan, parsed.intervalSecondsExplicit ? 0 : undefined);
      if (!watch.enabled) {
        for (const feed of preparedFeeds.feeds) if (feed.sensorWatchId) await this.sensor.pauseWatch(feed.sensorWatchId).catch(() => undefined);
      }
      return { watch, baselineCount: preparedFeeds.baselineCount, baselineNotifications: 0 };
    } catch (error) {
      await this.searchFeeds.cleanupWatch(watch.id);
      this.store.deleteWatch(watch.id);
      throw error;
    }
  }

  async patchWatch(id: string, input: unknown): Promise<Watch> {
    const current = this.store.getWatch(id);
    if (!current) throw new RadarError(`watch not found: ${id}`, 'NOT_FOUND', 404);
    const patch = parseWatchPatch(input);
    let updated = applyWatchPatch(current, patch, this.now());
    const targetChanged = patch.target !== undefined || patch.targetProfile !== undefined || patch.reanalyze === true;
    if (current.type === 'similarity' && targetChanged) {
      const context = await this.similarityContext(current.source, updated.target, patch.targetProfile, undefined, false);
      const profile = this.mergeTargetProfiles(current.targetProfile, context.profile);
      const firstQuery = context.plan.queries[0]?.query ?? '패션';
      const adapter = this.sources.require(current.source);
      const validated = await adapter.validateTarget('similarity', { ...updated.target, searchQuery: firstQuery });
      const prepared = updated.target.referenceImageBase64 || updated.target.referenceImageUrl
        ? await this.prepareSimilarityTarget(validated)
        : current.target.referenceImageId
          ? { ...validated, referenceImageId: current.target.referenceImageId }
          : await this.prepareSimilarityTarget(validated);
      updated = {
        ...updated,
        target: { ...updated.target, ...prepared, searchQuery: firstQuery, searchUrl: validated.url, searchQueries: context.plan.queries.map((query) => query.query) },
        targetProfile: profile,
        searchPlan: context.plan,
      };
      this.store.updateWatch(updated);
      await this.searchFeeds.updateWatchPlan(updated, context.plan);
      await this.searchFeeds.syncWatch(updated, current);
      return updated;
    }
    if (current.sensorId !== undefined) {
      if (current.enabled !== updated.enabled) {
        if (updated.enabled) await this.sensor.resumeWatch(current.sensorId);
        else await this.sensor.pauseWatch(current.sensorId);
        this.store.updateSensorState(id, updated.enabled ? 'active' : 'paused', updated.updatedAt);
      }
      if (current.intervalSeconds !== updated.intervalSeconds) await this.sensor.updateWatch(current.sensorId, { intervalSeconds: updated.intervalSeconds });
    }
    this.store.updateWatch(updated);
    if (current.type === 'similarity') await this.searchFeeds.syncWatch(updated, current);
    return updated;
  }

  private mergeTargetProfiles(previous: TargetProfile | undefined, next: TargetProfile): TargetProfile {
    if (!previous) return next;
    return {
      ...previous,
      ...next,
      colors: [...new Set([...previous.colors, ...next.colors])],
      materials: [...new Set([...previous.materials, ...next.materials])],
      features: [...new Set([...previous.features, ...next.features])],
      detectedText: [...new Set([...previous.detectedText, ...next.detectedText])],
      userHints: [...new Set([...previous.userHints, ...next.userHints])],
      userSearchTerms: [...new Set([...(previous.userSearchTerms ?? []), ...(next.userSearchTerms ?? [])])],
      explicitSearchTerms: [...new Set([...previous.explicitSearchTerms, ...next.explicitSearchTerms])],
      includeKeywords: [...new Set([...previous.includeKeywords, ...next.includeKeywords])],
      excludeKeywords: [...new Set([...previous.excludeKeywords, ...next.excludeKeywords])],
      hardConstraints: [...previous.hardConstraints, ...next.hardConstraints],
      softHints: [...previous.softHints, ...next.softHints],
      provenance: { ...previous.provenance, ...next.provenance },
    };
  }

  async pauseWatch(id: string): Promise<Watch> {
    return this.patchWatch(id, { enabled: false });
  }

  async resumeWatch(id: string): Promise<Watch> {
    return this.patchWatch(id, { enabled: true });
  }

  async deleteWatch(id: string): Promise<void> {
    const watch = this.store.getWatch(id);
    if (!watch) throw new RadarError(`watch not found: ${id}`, 'NOT_FOUND', 404);
    // Modern similarity sensors belong to the shared feed, so the feed
    // coordinator must decide whether the last subscriber is gone. A legacy
    // watch may still carry a direct sensorId; only delete that sensor when it
    // is not also managed by a shared feed.
    const sharedSensor = watch.type === 'similarity' && watch.sensorId !== undefined
      && this.searchFeeds.listFeeds().some((feed) => feed.sensorWatchId === watch.sensorId);
    if (watch.type === 'similarity') await this.searchFeeds.cleanupWatch(id);
    if (watch.sensorId && !sharedSensor) {
      try { await this.sensor.deleteWatch(watch.sensorId); } catch { /* local deletion remains authoritative */ }
    }
    this.store.deleteWatch(id);
  }

  async runWatch(id: string, triggerKey = `manual:${randomUUID()}`): Promise<WatchRunResult> {
    const watch = this.store.getWatch(id);
    if (!watch) throw new RadarError(`watch not found: ${id}`, 'NOT_FOUND', 404);
    if (!watch.enabled) return { watchId: id, status: 'disabled', triggerKey, newListings: 0, matchedListings: 0, changes: 0, eventIds: [] };
    if (watch.type === 'similarity') {
      const prepared = await this.searchFeeds.ensureLegacyWatchFeed(watch);
      const results = [];
      for (const feed of prepared.feeds) results.push(await this.searchFeeds.runFeed(feed.id, triggerKey));
      const status = results.some((result) => result.status === 'degraded') ? 'succeeded' : results.some((result) => result.status === 'duplicate') ? 'duplicate' : 'succeeded';
      return {
        watchId: id, status, triggerKey,
        newListings: results.reduce((sum, result) => sum + result.newListings, 0),
        matchedListings: results.reduce((sum, result) => sum + result.matchedListings, 0),
        changes: results.reduce((sum, result) => sum + result.newListings, 0),
        eventIds: results.flatMap((result) => result.eventIds),
      };
    }
    if (watch.sensorId !== undefined) {
      const sensorWatch = await this.sensor.getWatch(watch.sensorId);
      if (!sensorWatch) {
        this.store.updateSensorState(id, 'deleted', this.now());
        throw new SensorUnavailableError(`sensor watch was deleted externally: ${watch.sensorId}`, { watchId: id, sensorId: watch.sensorId });
      }
    }
    const pollRun = this.store.beginPollRun(id, watch.sensorId, triggerKey, this.now());
    if (!pollRun) return { watchId: id, status: 'duplicate', triggerKey, newListings: 0, matchedListings: 0, changes: 0, eventIds: [] };
    try {
      const adapter = this.sources.require(watch.source);
      const validatedTarget = await adapter.validateTarget(watch.type, watch.target);
      const normalized = await this.fetchNormalized(adapter, watch.type, validatedTarget);
      const result = watch.type === 'seller' ? await this.processSellerWatch(watch, normalized) : await this.processProductWatch(watch, normalized[0]);
      this.store.finishPollRun(pollRun.id, 'succeeded', this.now(), { listingsCount: normalized.length, changesCount: result.changes });
      await this.notifications.deliverPending();
      return { ...result, watchId: id, status: 'succeeded', triggerKey };
    } catch (error) {
      this.store.finishPollRun(pollRun.id, 'failed', this.now(), { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  async handleSensorWebhook(payload: unknown): Promise<Record<string, unknown>> {
    const value = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
    const radarId = webhookString(value, ['feedId', 'feed_id', 'radarWatchId', 'radar_watch_id']);
    const sensorWatchId = webhookString(value, ['sensorWatchId', 'sensor_watch_id', 'watch_uuid']);
    if (!radarId || !sensorWatchId) throw new RadarError('webhook requires radarWatchId/feedId and sensorWatchId', 'MALFORMED_WEBHOOK', 400);
    const eventId = webhookString(value, ['eventId', 'event_id', 'triggerId', 'trigger_id', 'diff_id', 'id']);
    const triggerKey = eventId || `sensor:${hash({ radarId, sensorWatchId, payload: value })}`;
    const feed = this.store.getSearchFeed(radarId);
    if (feed) {
      try { return await this.searchFeeds.handleWebhook(feed.id, sensorWatchId, triggerKey); }
      catch (error) { return { accepted: true, feedId: feed.id, sensorWatchId, fetchFailed: true, error: error instanceof Error ? error.message : String(error) }; }
    }
    const watch = this.store.getWatch(radarId);
    if (!watch) throw new RadarError(`watch not found: ${radarId}`, 'NOT_FOUND', 404);
    if (!watch.sensorId || watch.sensorId !== sensorWatchId) throw new RadarError('webhook sensor watch does not match radar watch', 'MALFORMED_WEBHOOK', 400);
    if (!watch.enabled) return { accepted: true, ignored: 'watch_disabled', radarWatchId: radarId, sensorWatchId };
    try {
      const result = await this.runWatch(radarId, triggerKey);
      return { accepted: true, ...result };
    } catch (error) {
      return { accepted: true, radarWatchId: radarId, sensorWatchId, fetchFailed: true, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async similarityContext(source: string, target: WatchTarget, providedProfile?: TargetProfile, providedPlan?: SearchPlan, preserveTargetQueries = true): Promise<{ profile: TargetProfile; plan: SearchPlan }> {
    const imageSource = target.referenceImageBase64
      ? { base64: target.referenceImageBase64 }
      : target.referenceImageUrl
        ? { url: target.referenceImageUrl }
        : undefined;
    const visionProfile = target.visionProfile as VisionProfile | undefined;
    const profile = providedProfile ?? await this.targetProfileExtractor.extract({
      ...(imageSource === undefined ? {} : { referenceImage: imageSource }),
      ...(target.userText === undefined ? {} : { userText: target.userText }),
      ...(target.explicitSearchTerms === undefined ? {} : { explicitSearchTerms: target.explicitSearchTerms }),
      ...(visionProfile === undefined ? {} : { visionProfile, ...(visionProfile.provider === undefined ? {} : { visionProvider: visionProfile.provider }) }),
    } as TargetProfileExtractionInput);
    const planner = this.searchPlanners[source] ?? (source === 'bunjang' ? this.searchPlanners.bunjang : undefined);
    let plan = providedPlan ?? (planner ? planner.plan(profile) : this.fallbackSearchPlan(target, profile));
    const explicitQueries = preserveTargetQueries ? [...(target.searchQueries ?? []), ...(target.searchQuery ? [target.searchQuery] : [])] : [];
    if (explicitQueries.length > 0) {
      const seen = new Set(plan.queries.map((query) => query.canonicalQuery || query.query.normalize('NFKC').toLocaleLowerCase().replace(/[\s\-_/]+/gu, ' ').trim()));
      const preserved: SearchQuery[] = [];
      for (const query of explicitQueries) {
        const canonicalQuery = query.normalize('NFKC').toLocaleLowerCase().replace(/[\s\-_/]+/gu, ' ').trim();
        if (!canonicalQuery || seen.has(canonicalQuery)) continue;
        seen.add(canonicalQuery);
        preserved.push({ query, canonicalQuery, tier: 'explicit', source: 'user' });
      }
      if (preserved.length > 0) plan = { ...plan, queries: [...preserved, ...plan.queries].slice(0, 4) };
    }
    return { profile, plan };
  }

  private fallbackSearchPlan(target: WatchTarget, profile: TargetProfile): SearchPlan {
    const queries = [...(target.searchQueries ?? []), ...(target.searchQuery ? [target.searchQuery] : []), ...(profile.userSearchTerms ?? []), ...profile.explicitSearchTerms];
    const unique = [...new Set(queries.map((query) => query.trim()).filter(Boolean))];
    const values = unique.length > 0 ? unique : [profile.category ?? '패션'];
    return { source: 'bunjang', queries: values.slice(0, 4).map((query, index) => ({ query, canonicalQuery: query.normalize('NFKC').toLocaleLowerCase(), tier: index === 0 ? 'explicit' : 'broad', source: index === 0 ? 'user' : 'inferred' })), generatedAt: this.now(), ...(profile.provider ? { profileProvider: profile.provider } : {}) };
  }

  private async prepareSimilarityTarget(target: ValidatedTarget): Promise<ValidatedTarget> {
    if (!this.imageMatcher) throw new RadarError('image matcher is unavailable', 'IMAGE_MATCHER_UNAVAILABLE', 503);
    let reference;
    try {
      reference = await this.imageMatcher.prepareReference(referenceInput(target));
    } catch (error) {
      throw new RadarError(`reference image could not be prepared: ${error instanceof Error ? error.message : String(error)}`, 'INVALID_REFERENCE_IMAGE', 400);
    }
    return { ...persistedSimilarityTarget(target, reference.id), externalId: target.externalId, url: target.url } as ValidatedTarget;
  }

  private publicTarget(target: WatchTarget): WatchTarget {
    const { referenceImageBase64: _referenceImageBase64, referenceImageUrl: _referenceImageUrl, ...publicTarget } = target;
    return publicTarget;
  }

  private async scoreSimilarity(referenceId: string, listings: Listing[], rules: { similarityThreshold: number; candidateLimit: number }): Promise<Array<{ externalId: string; title: string; url: string; score: number; bestImageUrl?: string }>> {
    if (!this.imageMatcher || !referenceId) throw new RadarError('image matcher reference is unavailable', 'IMAGE_MATCHER_UNAVAILABLE', 503);
    const scores: Array<{ externalId: string; title: string; url: string; score: number; bestImageUrl?: string }> = [];
    for (const listing of listings.slice(0, rules.candidateLimit)) {
      try {
        const result = await this.imageMatcher.match(referenceId, listing.imageUrls);
        scores.push({ externalId: listing.externalId, title: listing.title, url: listing.url, score: result.score, ...(result.bestImageUrl === undefined ? {} : { bestImageUrl: result.bestImageUrl }) });
      } catch {
        // Candidate image failures are not a reason to reject the complete preview.
      }
    }
    return scores.sort((a, b) => b.score - a.score);
  }

  private async fetchSimilarityPreviewNormalized(adapter: ListingSourceAdapter, target: ValidatedTarget): Promise<Listing[]> {
    if (!adapter.fetchSearchPage) return this.fetchNormalized(adapter, 'similarity', target);
    const page = await adapter.fetchSearchPage({
      ...target,
      searchQuery: target.searchQuery ?? '',
      pageSize: 60,
    });
    return this.normalizeListingCollection(adapter, page.items, target);
  }

  private async fetchNormalized(adapter: ListingSourceAdapter, type: ImplementedWatchType, target: ValidatedTarget): Promise<Listing[]> {
    try {
      if (type === 'seller') {
        const rawListings = await adapter.fetchSellerListings(target);
        return this.normalizeListingCollection(adapter, rawListings, target);
      }
      if (type === 'similarity') {
        const rawListings = await adapter.fetchSearchListings(target);
        return this.normalizeListingCollection(adapter, rawListings, target);
      }
      const raw = await adapter.fetchProduct(target);
      return [ensureListing(adapter.normalizeProductState(raw, { target }), adapter.id, target.externalId)];
    } catch (error) {
      if (error instanceof RadarError) throw error;
      throw new SourceFetchError(`source ${adapter.id} fetch failed: ${error instanceof Error ? error.message : String(error)}`, { source: adapter.id });
    }
  }

  private normalizeListingCollection(adapter: ListingSourceAdapter, rawListings: unknown[], target: ValidatedTarget): Listing[] {
    const result: Listing[] = [];
    const seen = new Set<string>();
    for (const raw of rawListings) {
      const listing = ensureListing(adapter.normalizeListing(raw, { target }), adapter.id);
      const identity = `${listing.source}:${listing.externalId}`;
      if (!seen.has(identity)) {
        result.push(listing);
        seen.add(identity);
      }
    }
    return result;
  }

  private async processSellerWatch(watch: Watch, listings: Listing[]): Promise<Omit<WatchRunResult, 'watchId' | 'status' | 'triggerKey'>> {
    if (!isSellerRules(watch.rules)) throw new RadarError('seller watch has invalid rules', 'INVALID_STATE', 500);
    let newListings = 0;
    let matchedListings = 0;
    const eventIds: string[] = [];
    for (const listing of listings) {
      this.store.upsertListing(listing);
      const isNew = this.store.recordSeenListing(watch.id, listing, this.now(), false, false);
      if (!isNew) continue;
      newListings += 1;
      const result = matchListing(listing, watch.rules);
      if (!result.matched) continue;
      matchedListings += 1;
      this.store.markSeenMatched(watch.id, listing);
      const eventKey = `${watch.id}:ListingMatchedEvent:${listing.source}:${listing.externalId}`;
      const event: RadarEvent = {
        id: eventKey,
        eventKey,
        watchId: watch.id,
        source: listing.source,
        type: 'ListingMatchedEvent',
        occurredAt: this.now(),
        before: null,
        after: listing,
        payload: { matchedKeywords: result.matchedKeywords, reason: result.reason },
      };
      if (this.store.insertEvent(event)) {
        eventIds.push(event.id);
        await this.notifications.dispatch(event);
      }
    }
    return { newListings, matchedListings, changes: newListings, eventIds };
  }

  private async processSimilarityWatch(watch: Watch, listings: Listing[]): Promise<Omit<WatchRunResult, 'watchId' | 'status' | 'triggerKey'>> {
    if (!isSimilarityRules(watch.rules)) throw new RadarError('similarity watch has invalid rules', 'INVALID_STATE', 500);
    const referenceId = typeof watch.target.referenceImageId === 'string' ? watch.target.referenceImageId : '';
    if (!this.imageMatcher || !referenceId) throw new RadarError('similarity watch reference is unavailable', 'IMAGE_MATCHER_UNAVAILABLE', 503);
    let newListings = 0;
    let matchedListings = 0;
    const eventIds: string[] = [];
    for (const listing of listings.slice(0, watch.rules.candidateLimit)) {
      this.store.upsertListing(listing);
      const isNew = this.store.recordSeenListing(watch.id, listing, this.now(), false, false);
      if (!isNew) continue;
      newListings += 1;
      let result;
      try {
        result = await this.imageMatcher.match(referenceId, listing.imageUrls);
      } catch {
        continue;
      }
      const matched = result.comparedImages > 0 && result.score >= watch.rules.similarityThreshold;
      this.store.recordSimilarityMatch(watch.id, listing, result.score, result.bestImageUrl, matched, this.now());
      if (!matched) continue;
      matchedListings += 1;
      this.store.markSeenMatched(watch.id, listing);
      const eventKey = `${watch.id}:SimilarListingMatchedEvent:${listing.source}:${listing.externalId}`;
      const event: RadarEvent = {
        id: eventKey,
        eventKey,
        watchId: watch.id,
        source: listing.source,
        type: 'SimilarListingMatchedEvent',
        occurredAt: this.now(),
        before: null,
        after: listing,
        payload: {
          similarity: result.score,
          threshold: watch.rules.similarityThreshold,
          ...(result.bestImageUrl === undefined ? {} : { bestImageUrl: result.bestImageUrl }),
        },
      };
      if (this.store.insertEvent(event)) {
        eventIds.push(event.id);
        await this.notifications.dispatch(event);
      }
    }
    return { newListings, matchedListings, changes: newListings, eventIds };
  }

  private async processProductWatch(watch: Watch, after: Listing | undefined): Promise<Omit<WatchRunResult, 'watchId' | 'status' | 'triggerKey'>> {
    if (!after) throw new SourceFetchError('product source returned no state');
    const beforeSnapshot = this.store.getLatestProductSnapshot(watch.id);
    const fingerprint = productStateFingerprint(after);
    this.store.upsertListing(after);
    if (!beforeSnapshot) {
      this.store.insertProductSnapshot(watch.id, after, fingerprint, this.now(), true);
      return { newListings: 0, matchedListings: 0, changes: 0, eventIds: [] };
    }
    this.store.insertProductSnapshot(watch.id, after, fingerprint, this.now(), false);
    if (!('trackPrice' in watch.rules)) throw new RadarError('product watch has invalid rules', 'INVALID_STATE', 500);
    const diff = detectProductChanges(beforeSnapshot.state, after, watch.rules);
    if (!hasMeaningfulProductDiff(diff)) return { newListings: 0, matchedListings: 0, changes: 0, eventIds: [] };
    const eventIds: string[] = [];
    const base = `${watch.id}:${after.source}:${after.externalId}`;
    if (diff.priceChanged) {
      const eventKey = `${base}:ProductPriceChangedEvent:${hash({ before: beforeSnapshot.state.price, after: after.price })}`;
      const event: RadarEvent = {
        id: eventKey,
        eventKey,
        watchId: watch.id,
        source: after.source,
        type: 'ProductPriceChangedEvent',
        occurredAt: this.now(),
        before: beforeSnapshot.state.price ?? null,
        after: after.price ?? null,
        payload: { productExternalId: after.externalId, listing: after },
      };
      if (this.store.insertEvent(event)) {
        eventIds.push(event.id);
        await this.notifications.dispatch(event);
      }
    }
    if (diff.statusChanged && after.status !== undefined && after.status !== 'UNKNOWN') {
      const eventKey = `${base}:ProductStatusChangedEvent:${hash({ before: beforeSnapshot.state.status ?? null, after: after.status })}`;
      const event: RadarEvent = {
        id: eventKey,
        eventKey,
        watchId: watch.id,
        source: after.source,
        type: 'ProductStatusChangedEvent',
        occurredAt: this.now(),
        before: statusOrNull(beforeSnapshot.state.status),
        after: after.status,
        payload: { productExternalId: after.externalId, listing: after },
      };
      if (this.store.insertEvent(event)) {
        eventIds.push(event.id);
        await this.notifications.dispatch(event);
      }
    }
    const fields: Array<'title' | 'seller' | 'images'> = [];
    if (diff.titleChanged) fields.push('title');
    if (diff.sellerChanged) fields.push('seller');
    if (diff.imagesChanged) fields.push('images');
    if (fields.length > 0) {
      const eventKey = `${base}:ProductUpdatedEvent:${hash({ before: productStateFingerprint(beforeSnapshot.state), after: fingerprint, fields })}`;
      const event: RadarEvent = {
        id: eventKey,
        eventKey,
        watchId: watch.id,
        source: after.source,
        type: 'ProductUpdatedEvent',
        occurredAt: this.now(),
        before: beforeSnapshot.state,
        after,
        payload: { productExternalId: after.externalId, fields },
      };
      if (this.store.insertEvent(event)) {
        eventIds.push(event.id);
        await this.notifications.dispatch(event);
      }
    }
    return { newListings: 0, matchedListings: 0, changes: eventIds.length, eventIds };
  }
}
