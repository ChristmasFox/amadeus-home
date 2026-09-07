import { createHash, randomUUID } from 'node:crypto';
import { RadarError, SensorUnavailableError, SourceFetchError } from './errors.js';
import type { Listing, ProductStatus } from './listing/model.js';
import type { RadarEvent } from './events/events.js';
import { detectProductChanges, hasMeaningfulProductDiff, productStateFingerprint } from './detection/comparator.js';
import { matchListing } from './matching/matcher.js';
import type { ImageMatcher, ImageSource } from './matching/image.js';
import { NotificationDispatcher } from './notification/dispatcher.js';
import type { SensorClient, SensorWatch } from '../sensors/sensor.js';
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

  constructor(options: RadarServiceOptions) {
    this.store = options.store;
    this.sources = options.sources;
    this.sensor = options.sensor;
    this.notifications = options.notifications;
    this.webhookUrl = options.webhookUrl;
    this.imageMatcher = options.imageMatcher;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  listWatches(): Watch[] {
    return this.store.listWatches();
  }

  getWatch(id: string): Watch | undefined {
    return this.store.getWatch(id);
  }

  async previewWatch(input: unknown): Promise<Record<string, unknown>> {
    const parsed = parseWatchCreateInput(input);
    const adapter = this.sources.require(parsed.source);
    this.sources.requireCapability(adapter, parsed.type);
    const validatedTarget = await adapter.validateTarget(parsed.type, parsed.target);
    const fetchTarget = parsed.type === 'similarity'
      ? { ...validatedTarget, candidateLimit: (parsed.rules as { candidateLimit: number }).candidateLimit }
      : validatedTarget;
    const target = parsed.type === 'similarity'
      ? await this.prepareSimilarityTarget(fetchTarget)
      : validatedTarget;
    const normalized = await this.fetchNormalized(adapter, parsed.type, fetchTarget);
    const first = normalized[0];
    if (parsed.type === 'similarity') {
      const scores = await this.scoreSimilarity(target.referenceImageId ?? '', normalized, parsed.rules as { similarityThreshold: number; candidateLimit: number });
      return {
        source: adapter.id,
        sourceDisplayName: adapter.displayName,
        type: parsed.type,
        target: this.publicTarget(target),
        rules: parsed.rules,
        baselineCount: normalized.length,
        similarity: {
          threshold: (parsed.rules as { similarityThreshold: number }).similarityThreshold,
          candidateCount: normalized.length,
          topMatches: scores.slice(0, 5),
        },
      };
    }
    return {
      source: adapter.id,
      sourceDisplayName: adapter.displayName,
      type: parsed.type,
      target,
      rules: parsed.rules,
      baselineCount: normalized.length,
      ...(parsed.type === 'seller'
        ? { seller: first?.seller ?? { externalId: validatedTarget.externalId, url: validatedTarget.url }, listings: normalized.slice(0, 10) }
        : { product: first }),
    };
  }

  async createWatch(input: unknown): Promise<WatchCreationResult> {
    const parsed = parseWatchCreateInput(input);
    const adapter = this.sources.require(parsed.source);
    this.sources.requireCapability(adapter, parsed.type);
    const validatedTarget = await adapter.validateTarget(parsed.type, parsed.target);
    const fetchTarget = parsed.type === 'similarity'
      ? { ...validatedTarget, candidateLimit: (parsed.rules as { candidateLimit: number }).candidateLimit }
      : validatedTarget;
    let persistedTarget: WatchTarget = validatedTarget;
    if (parsed.type === 'similarity') persistedTarget = await this.prepareSimilarityTarget(fetchTarget);
    const id = parsed.id ?? randomUUID();
    if (this.store.getWatch(id)) throw new RadarError(`watch already exists: ${id}`, 'CONFLICT', 409);
    const now = this.now();
    const watch: Watch = {
      id,
      source: adapter.id,
      type: parsed.type,
      target: persistedTarget,
      rules: parsed.rules,
      enabled: parsed.enabled ?? true,
      intervalSeconds: parsed.intervalSeconds,
      createdAt: now,
      updatedAt: now,
    };
    const baseline = await this.fetchNormalized(adapter, watch.type, fetchTarget);
    let sensorWatch: SensorWatch | undefined;
    try {
      sensorWatch = await this.sensor.createWatch({
        radarWatchId: watch.id,
        url: validatedTarget.url,
        title: `${adapter.displayName} ${watch.type} watch ${validatedTarget.externalId}`,
        intervalSeconds: watch.intervalSeconds,
        webhookUrl: this.webhookUrl,
      });
      if (!watch.enabled) await this.sensor.pauseWatch(sensorWatch.id);
      const persistedWatch: Watch = { ...watch, sensorId: sensorWatch.id };
      this.store.transaction(() => {
        this.store.createWatch(persistedWatch);
        this.store.upsertSensorWatch(persistedWatch.id, sensorWatch!.id, this.sensor.id, validatedTarget.url, persistedWatch.enabled ? 'active' : 'paused', now);
        if (watch.type === 'seller' || watch.type === 'similarity') {
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

  async patchWatch(id: string, input: unknown): Promise<Watch> {
    const current = this.store.getWatch(id);
    if (!current) throw new RadarError(`watch not found: ${id}`, 'NOT_FOUND', 404);
    const patch = parseWatchPatch(input);
    const updated = applyWatchPatch(current, patch, this.now());
    if (current.sensorId !== undefined) {
      if (current.enabled !== updated.enabled) {
        if (updated.enabled) await this.sensor.resumeWatch(current.sensorId);
        else await this.sensor.pauseWatch(current.sensorId);
        this.store.updateSensorState(id, updated.enabled ? 'active' : 'paused', updated.updatedAt);
      }
      if (current.intervalSeconds !== updated.intervalSeconds) {
        await this.sensor.updateWatch(current.sensorId, { intervalSeconds: updated.intervalSeconds });
      }
    }
    this.store.updateWatch(updated);
    return updated;
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
    if (watch.sensorId) {
      try { await this.sensor.deleteWatch(watch.sensorId); } catch { /* local deletion remains authoritative */ }
    }
    this.store.deleteWatch(id);
  }

  async runWatch(id: string, triggerKey = `manual:${randomUUID()}`): Promise<WatchRunResult> {
    const watch = this.store.getWatch(id);
    if (!watch) throw new RadarError(`watch not found: ${id}`, 'NOT_FOUND', 404);
    if (!watch.enabled) return { watchId: id, status: 'disabled', triggerKey, newListings: 0, matchedListings: 0, changes: 0, eventIds: [] };
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
      const target = watch.type === 'similarity' && isSimilarityRules(watch.rules)
        ? { ...validatedTarget, candidateLimit: watch.rules.candidateLimit }
        : validatedTarget;
      const normalized = await this.fetchNormalized(adapter, watch.type, target);
      const result = watch.type === 'seller'
        ? await this.processSellerWatch(watch, normalized)
        : watch.type === 'similarity'
          ? await this.processSimilarityWatch(watch, normalized)
          : await this.processProductWatch(watch, normalized[0]);
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
    const radarWatchId = webhookString(value, ['radarWatchId', 'radar_watch_id']);
    const sensorWatchId = webhookString(value, ['sensorWatchId', 'sensor_watch_id', 'watch_uuid']);
    if (!radarWatchId || !sensorWatchId) throw new RadarError('webhook requires radarWatchId and sensorWatchId', 'MALFORMED_WEBHOOK', 400);
    const watch = this.store.getWatch(radarWatchId);
    if (!watch) throw new RadarError(`watch not found: ${radarWatchId}`, 'NOT_FOUND', 404);
    if (!watch.sensorId || watch.sensorId !== sensorWatchId) throw new RadarError('webhook sensor watch does not match radar watch', 'MALFORMED_WEBHOOK', 400);
    if (!watch.enabled) return { accepted: true, ignored: 'watch_disabled', radarWatchId, sensorWatchId };
    const eventId = webhookString(value, ['eventId', 'event_id', 'triggerId', 'trigger_id', 'diff_id', 'id']);
    const triggerKey = eventId || `sensor:${hash({ radarWatchId, sensorWatchId, payload: value })}`;
    try {
      const result = await this.runWatch(radarWatchId, triggerKey);
      return { accepted: true, ...result };
    } catch (error) {
      return {
        accepted: true,
        radarWatchId,
        sensorWatchId,
        fetchFailed: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
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
