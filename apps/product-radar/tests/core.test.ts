import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ProductRadarService } from '../src/core/application.js';
import { RadarError, SensorUnavailableError } from '../src/core/errors.js';
import type { Listing } from '../src/core/listing/model.js';
import type { ImageMatcher, ImageMatchResult, ImageSource, PreparedImageReference } from '../src/core/matching/image.js';
import { NotificationDispatcher } from '../src/core/notification/dispatcher.js';
import { matchListing } from '../src/core/matching/matcher.js';
import type { NotificationChannel, NotificationMessage } from '../src/core/notification/ports.js';
import type { ProductWatchRules, SellerWatchRules, WatchTarget } from '../src/core/watch/model.js';
import type { SearchFeed } from '../src/core/search/model.js';
import type { ListingSourceAdapter, SourceCapabilities, ValidatedTarget } from '../src/sources/registry.js';
import { SourceAdapterRegistry } from '../src/sources/registry.js';
import type { SensorClient, SensorHealth, SensorWatch, SensorWatchInput } from '../src/sensors/sensor.js';
import { SqliteRadarStore } from '../src/storage/sqlite.js';

const capabilities: SourceCapabilities = {
  sellerWatch: true,
  productWatch: true,
  similarityWatch: true,
  searchWatch: false,
  categoryWatch: false,
  supportsPrice: true,
  supportsImages: true,
  supportsSeller: true,
  supportsProductStatus: true,
};

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    source: 'fake',
    externalId: 'p1',
    title: 'Plain item',
    url: 'https://fake.test/products/p1',
    imageUrls: ['https://fake.test/p1.jpg'],
    price: { amount: 100, currency: 'USD' },
    status: 'ACTIVE',
    seller: { externalId: 'seller-1', name: 'Seller One', url: 'https://fake.test/sellers/seller-1' },
    discoveredAt: new Date().toISOString(),
    ...overrides,
  };
}

class FakeSourceAdapter implements ListingSourceAdapter {
  readonly id = 'fake';
  readonly displayName = 'Fake Source';
  readonly capabilities = capabilities;
  currentListings: Listing[] = [];
  currentProduct = listing();
  fail = false;

  async validateTarget(type: 'seller' | 'product' | 'similarity' | 'search' | 'category' | 'smart', target: WatchTarget): Promise<ValidatedTarget> {
    const externalId = String(target.sellerExternalId ?? target.productExternalId ?? 'seller-1');
    const url = String(target.sellerUrl ?? target.productUrl ?? `https://fake.test/${type}/${externalId}`);
    return { ...target, externalId, url };
  }

  async fetchSellerListings(): Promise<unknown[]> {
    if (this.fail) throw new Error('fake source failure');
    return this.currentListings;
  }

  async fetchSearchListings(): Promise<unknown[]> {
    if (this.fail) throw new Error('fake source failure');
    return this.currentListings;
  }

  async fetchProduct(): Promise<unknown> {
    if (this.fail) throw new Error('fake source failure');
    return this.currentProduct;
  }

  normalizeListing(raw: unknown): Listing {
    return { ...(raw as Listing), discoveredAt: new Date().toISOString() };
  }

  normalizeProductState(raw: unknown): Listing {
    return { ...(raw as Listing), discoveredAt: new Date().toISOString() };
  }
}

class FakeImageMatcher implements ImageMatcher {
  async prepareReference(_source: ImageSource): Promise<PreparedImageReference> {
    return { id: 'reference-image-1', contentHash: 'reference-hash-1' };
  }

  async match(_referenceId: string, candidateImageUrls: string[]): Promise<ImageMatchResult> {
    const bestImageUrl = candidateImageUrls.find((url) => url.includes('similar'));
    return {
      score: bestImageUrl ? 0.82 : 0.32,
      comparedImages: candidateImageUrls.length,
      ...(bestImageUrl === undefined ? {} : { bestImageUrl }),
    };
  }
}

class FakeSensor implements SensorClient {
  readonly id = 'fake-sensor';
  readonly created: SensorWatchInput[] = [];
  readonly deleted: string[] = [];
  unavailable = false;
  missing = false;

  async createWatch(input: SensorWatchInput): Promise<SensorWatch> {
    if (this.unavailable) throw new SensorUnavailableError('fake sensor unavailable');
    this.created.push(input);
    return { id: `sensor-${input.radarWatchId}`, url: input.url };
  }
  async updateWatch(sensorId: string): Promise<SensorWatch> { return { id: sensorId }; }
  async pauseWatch(): Promise<void> { /* noop */ }
  async resumeWatch(): Promise<void> { /* noop */ }
  async deleteWatch(sensorId: string): Promise<void> { this.deleted.push(sensorId); }
  async getWatch(sensorId: string): Promise<SensorWatch | undefined> { return this.missing ? undefined : { id: sensorId }; }
  async health(): Promise<SensorHealth> { return { ok: true, status: 'ok' }; }
}

class FakeChannel implements NotificationChannel {
  readonly calls: NotificationMessage[] = [];
  constructor(readonly id: string, readonly recipient: string, private readonly shouldFail = false) {}
  async send(message: NotificationMessage): Promise<void> {
    this.calls.push(message);
    if (this.shouldFail) throw new Error(`${this.id} down`);
  }
}

function build(source: FakeSourceAdapter, options: { store?: SqliteRadarStore; sensor?: FakeSensor; channels?: NotificationChannel[]; imageMatcher?: ImageMatcher; now?: () => string } = {}) {
  const store = options.store ?? new SqliteRadarStore(':memory:');
  const sensor = options.sensor ?? new FakeSensor();
  const registry = new SourceAdapterRegistry();
  registry.register(source);
  const notifications = new NotificationDispatcher(store, options.channels ?? [], { displayName: (id) => registry.get(id)?.displayName ?? id });
  const service = new ProductRadarService({ store, sources: registry, sensor, notifications, webhookUrl: 'http://radar.test/webhook', ...(options.imageMatcher === undefined ? {} : { imageMatcher: options.imageMatcher }), ...(options.now === undefined ? {} : { now: options.now }) });
  return { service, store, sensor, registry };
}

async function createSeller(service: ProductRadarService, rules: Partial<SellerWatchRules> = {}) {
  return service.createWatch({
    source: 'fake',
    type: 'seller',
    target: { sellerExternalId: 'seller-1', sellerUrl: 'https://fake.test/sellers/seller-1' },
    rules,
  });
}

async function createProduct(service: ProductRadarService, rules: Partial<ProductWatchRules> = {}) {
  return service.createWatch({
    source: 'fake',
    type: 'product',
    target: { productExternalId: 'p1', productUrl: 'https://fake.test/products/p1' },
    rules,
  });
}

async function createSimilarity(service: ProductRadarService, rules: { similarityThreshold?: number; candidateLimit?: number } = {}) {
  return service.createWatch({
    source: 'fake',
    type: 'similarity',
    target: { referenceImageUrl: 'https://fake.test/reference.jpg', searchQuery: '의류' },
    rules,
    intervalSeconds: 120,
  });
}

test('source registry describes capabilities and rejects unsupported capability', () => {
  const source = new FakeSourceAdapter();
  const registry = new SourceAdapterRegistry();
  registry.register(source);
  assert.equal(registry.get('FAKE'), source);
  assert.deepEqual(registry.describe(source).unsupportedWatchTypes, ['search', 'category', 'smart']);
  assert.throws(() => registry.requireCapability(source, 'search'), (error: unknown) => error instanceof RadarError && error.code === 'UNSUPPORTED_CAPABILITY');
});

test('seller matcher performs Unicode NFKC and case-insensitive matching', () => {
  const result = matchListing(listing({ title: 'Ｃｈｒｏｍｅ Ｈｅａｒｔｓ Hoodie' }), {
    keywords: ['chrome hearts'],
    keywordMode: 'any',
    excludeKeywords: [],
  });
  assert.equal(result.matched, true);
  assert.deepEqual(result.matchedKeywords, ['chrome hearts']);
});

test('seller baseline is persisted without notification, and restart keeps baseline/seen state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'product-radar-'));
  const path = join(directory, 'radar.sqlite');
  try {
    const source = new FakeSourceAdapter();
    source.currentListings = [listing({ externalId: 'old', title: 'Old item' })];
    const first = build(source, { store: new SqliteRadarStore(path) });
    const created = await createSeller(first.service, { keywords: ['new'] });
    assert.equal(first.store.listEvents().length, 0);
    assert.equal(created.baselineCount, 1);
    first.store.close();

    source.currentListings = [listing({ externalId: 'old', title: 'Old item' }), listing({ externalId: 'new', title: 'New item' })];
    const second = build(source, { store: new SqliteRadarStore(path) });
    const result = await second.service.runWatch(created.watch.id);
    assert.equal(result.newListings, 1);
    assert.equal(second.store.listEvents().length, 1);
    assert.equal(second.store.listEvents()[0]?.type, 'ListingMatchedEvent');
    assert.equal(second.store.hasSeenListing(created.watch.id, 'fake', 'old'), true);
    assert.equal(second.store.hasSeenListing(created.watch.id, 'fake', 'new'), true);
    second.store.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('product snapshot baseline survives a process restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'product-radar-product-'));
  const path = join(directory, 'radar.sqlite');
  try {
    const source = new FakeSourceAdapter();
    source.currentProduct = listing({ title: 'Persistent product', price: { amount: 650, currency: 'USD' } });
    const first = build(source, { store: new SqliteRadarStore(path) });
    const created = await createProduct(first.service);
    assert.equal(first.store.getLatestProductSnapshot(created.watch.id)?.state.price?.amount, 650);
    first.store.close();

    source.currentProduct = listing({ title: 'Persistent product', price: { amount: 590, currency: 'USD' } });
    const second = build(source, { store: new SqliteRadarStore(path) });
    await second.service.runWatch(created.watch.id);
    assert.equal(second.store.listEvents().length, 1);
    assert.equal(second.store.listEvents()[0]?.type, 'ProductPriceChangedEvent');
    second.store.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('seller matcher supports ANY, ALL, exclude and price bounds', async () => {
  const source = new FakeSourceAdapter();
  source.currentListings = [listing({ externalId: 'baseline', title: 'baseline' })];
  const { service, store } = build(source);
  const created = await createSeller(service, { keywords: ['Chrome Hearts', 'Hoodie'], keywordMode: 'any', excludeKeywords: ['fake'], minPrice: 90, maxPrice: 200, currency: 'USD' });
  source.currentListings = [
    listing({ externalId: 'any', title: 'Chrome Hearts tee', price: { amount: 100, currency: 'USD' } }),
    listing({ externalId: 'exclude', title: 'Chrome Hearts fake tee', price: { amount: 100, currency: 'USD' } }),
    listing({ externalId: 'low', title: 'Chrome Hearts low', price: { amount: 50, currency: 'USD' } }),
    listing({ externalId: 'high', title: 'Chrome Hearts high', price: { amount: 300, currency: 'USD' } }),
  ];
  await service.runWatch(created.watch.id);
  assert.deepEqual(store.listEvents().map((event) => (event.after as Listing).externalId), ['any']);

  const allSource = new FakeSourceAdapter();
  allSource.currentListings = [listing({ externalId: 'baseline', title: 'baseline' })];
  const all = build(allSource);
  const allWatch = await createSeller(all.service, { keywords: ['Chrome Hearts', 'Hoodie'], keywordMode: 'all' });
  allSource.currentListings = [listing({ externalId: 'only-one', title: 'Chrome Hearts tee' }), listing({ externalId: 'both', title: 'Chrome Hearts Hoodie' })];
  await all.service.runWatch(allWatch.watch.id);
  assert.deepEqual(all.store.listEvents().map((event) => (event.after as Listing).externalId), ['both']);
});

test('unmatched listings are still seen and duplicate listings do not notify twice', async () => {
  const source = new FakeSourceAdapter();
  source.currentListings = [listing({ externalId: 'baseline', title: 'baseline' })];
  const channel = new FakeChannel('test', 'recipient');
  const { service, store } = build(source, { channels: [channel] });
  const created = await createSeller(service, { keywords: ['match'] });
  source.currentListings = [listing({ externalId: 'unmatched', title: 'nothing here' }), listing({ externalId: 'matched', title: 'match here' }), listing({ externalId: 'matched', title: 'match here' })];
  const first = await service.runWatch(created.watch.id);
  const second = await service.runWatch(created.watch.id);
  assert.equal(first.newListings, 2);
  assert.equal(second.newListings, 0);
  assert.equal(store.hasSeenListing(created.watch.id, 'fake', 'unmatched'), true);
  assert.equal(store.listEvents().length, 1);
  assert.equal(channel.calls.length, 1);
});

test('similarity watch silently baselines candidates, matches new listings at threshold, and deduplicates', async () => {
  const source = new FakeSourceAdapter();
  source.currentListings = [listing({ externalId: 'baseline', title: 'baseline', imageUrls: ['https://fake.test/baseline.jpg'] })];
  const matcher = new FakeImageMatcher();
  const channel = new FakeChannel('test', 'recipient');
  const { service, store, sensor } = build(source, { imageMatcher: matcher, channels: [channel] });
  const created = await createSimilarity(service);
  assert.equal(created.baselineCount, 1);
  assert.equal(store.listEvents().length, 0);
  assert.equal(sensor.created[0]?.intervalSeconds, 120);
  assert.equal(sensor.created[0]?.url, 'https://fake.test/similarity/seller-1');

  source.currentListings = [
    listing({ externalId: 'baseline', title: 'baseline', imageUrls: ['https://fake.test/baseline.jpg'] }),
    listing({ externalId: 'similar', title: 'similar hoodie', imageUrls: ['https://fake.test/similar.jpg'] }),
    listing({ externalId: 'different', title: 'different item', imageUrls: ['https://fake.test/different.jpg'] }),
  ];
  const first = await service.runWatch(created.watch.id);
  const second = await service.runWatch(created.watch.id);
  assert.equal(first.newListings, 2);
  assert.equal(first.matchedListings, 1);
  assert.equal(second.newListings, 0);
  assert.equal(store.listEvents().length, 1);
  assert.equal(store.listEvents()[0]?.type, 'SimilarListingMatchedEvent');
  assert.equal((store.listEvents()[0]?.payload.similarity as number) > 0.6, true);
  assert.equal(store.getSimilarityMatch(created.watch.id, 'fake', 'different')?.matched, false);
  assert.equal(channel.calls.length, 1);
});

test('product baseline, price decrease/increase, status and title/seller changes produce real diff events', async () => {
  const source = new FakeSourceAdapter();
  source.currentProduct = listing({ title: 'Original', price: { amount: 650, currency: 'USD' }, status: 'ACTIVE' });
  const channel = new FakeChannel('test', 'recipient');
  const { service, store } = build(source, { channels: [channel] });
  const created = await createProduct(service);
  assert.equal(store.listEvents().length, 0);

  source.currentProduct = listing({ title: 'Original', price: { amount: 590, currency: 'USD' }, status: 'ACTIVE' });
  await service.runWatch(created.watch.id);
  source.currentProduct = listing({ title: 'Original', price: { amount: 700, currency: 'USD' }, status: 'ACTIVE' });
  await service.runWatch(created.watch.id);
  source.currentProduct = listing({ title: 'Renamed', price: { amount: 700, currency: 'USD' }, status: 'SOLD', seller: { externalId: 'seller-2', name: 'Seller Two' } });
  await service.runWatch(created.watch.id);

  const events = store.listEvents();
  assert.deepEqual(events.map((event) => event.type), [
    'ProductPriceChangedEvent',
    'ProductPriceChangedEvent',
    'ProductStatusChangedEvent',
    'ProductUpdatedEvent',
  ]);
  assert.equal((events[0]?.before as { amount: number }).amount, 650);
  assert.equal((events[0]?.after as { amount: number }).amount, 590);
  assert.equal((events[2]?.before as string), 'ACTIVE');
  assert.equal((events[2]?.after as string), 'SOLD');
  assert.equal(channel.calls.length, 4);
});

test('identical snapshot and unknown status never create a false SOLD event', async () => {
  const source = new FakeSourceAdapter();
  source.currentProduct = listing({ title: 'Stable', status: 'ACTIVE' });
  const { service, store } = build(source);
  const created = await createProduct(service);
  source.currentProduct = listing({ title: 'Stable', status: 'ACTIVE' });
  await service.runWatch(created.watch.id);
  source.currentProduct = listing({ title: 'Stable', status: 'UNKNOWN' });
  await service.runWatch(created.watch.id);
  assert.equal(store.listEvents().length, 0);
  source.currentProduct = listing({ title: 'Stable', status: 'SOLD' });
  await service.runWatch(created.watch.id);
  assert.equal(store.listEvents().length, 1);
  assert.equal(store.listEvents()[0]?.type, 'ProductStatusChangedEvent');
  assert.equal(store.listEvents()[0]?.before, 'UNKNOWN');
});

test('duplicate webhook is idempotent, malformed webhook is rejected, and fetch failure creates no event', async () => {
  const source = new FakeSourceAdapter();
  source.currentProduct = listing({ status: 'ACTIVE' });
  const { service, store } = build(source);
  const created = await createProduct(service);
  source.currentProduct = listing({ status: 'SOLD' });
  const payload = { radarWatchId: created.watch.id, sensorWatchId: created.watch.sensorId, eventId: 'sensor-event-1' };
  const first = await service.handleSensorWebhook(payload);
  const second = await service.handleSensorWebhook(payload);
  assert.equal(first.accepted, true);
  assert.equal(second.status, 'duplicate');
  assert.equal(store.listEvents().length, 1);
  const nested = await service.handleSensorWebhook({ body: JSON.stringify({ radarWatchId: created.watch.id, sensorWatchId: created.watch.sensorId, eventId: 'sensor-event-nested' }) });
  assert.equal(nested.accepted, true);
  assert.equal(nested.status, 'succeeded');
  await assert.rejects(() => service.handleSensorWebhook({ radarWatchId: created.watch.id }), (error: unknown) => error instanceof RadarError && error.code === 'MALFORMED_WEBHOOK');

  source.currentProduct = listing({ status: 'ACTIVE' });
  source.fail = true;
  const failed = await service.handleSensorWebhook({ radarWatchId: created.watch.id, sensorWatchId: created.watch.sensorId, eventId: 'sensor-event-2' });
  assert.equal(failed.fetchFailed, true);
  assert.equal(store.listEvents().length, 1);
  assert.equal(store.listPollRuns(created.watch.id).at(-1)?.status, 'failed');
});

test('changedetection unavailable fails watch creation without persisting a fake baseline', async () => {
  const source = new FakeSourceAdapter();
  source.currentListings = [listing()];
  const sensor = new FakeSensor();
  sensor.unavailable = true;
  const { service, store } = build(source, { sensor });
  await assert.rejects(() => createSeller(service), (error: unknown) => error instanceof SensorUnavailableError);
  assert.equal(store.listWatches().length, 0);
  assert.equal(store.listEvents().length, 0);
});


test('a sensor webhook with no source state change produces no notification', async () => {
  const source = new FakeSourceAdapter();
  source.currentProduct = listing({ status: 'ACTIVE' });
  const channel = new FakeChannel('test', 'recipient');
  const { service } = build(source, { channels: [channel] });
  const created = await createProduct(service);
  const result = await service.handleSensorWebhook({ radarWatchId: created.watch.id, sensorWatchId: created.watch.sensorId, eventId: 'noise-only' });
  assert.equal(result.accepted, true);
  assert.equal(channel.calls.length, 0);
});

test('externally deleted sensor watch is recorded and cannot create source events', async () => {
  const source = new FakeSourceAdapter();
  source.currentListings = [listing({ externalId: 'baseline' })];
  const sensor = new FakeSensor();
  const { service, store } = build(source, { sensor });
  const created = await createSeller(service, { keywords: ['new'] });
  sensor.missing = true;
  source.currentListings = [listing({ externalId: 'new', title: 'new item' })];
  await assert.rejects(() => service.runWatch(created.watch.id), (error: unknown) => error instanceof RadarError && error.code === 'SENSOR_UNAVAILABLE');
  assert.equal(store.listEvents().length, 0);
  const runtime = store.getWatchRuntimeStats(created.watch.id);
  assert.equal(runtime.failedRuns, 1);
  assert.equal(runtime.status, 'ERROR');
  assert.match(runtime.lastError ?? '', /sensor watch was deleted externally/);
});

test('migration backfills SearchFeed counters from persisted run history', () => {
  const store = new SqliteRadarStore(':memory:');
  const feed: SearchFeed = {
    id: 'migration-feed', source: 'fake', target: 'https://fake.test/search', query: 'jacket', canonicalKey: 'fake:jacket',
    intervalSeconds: 900, jitterSeconds: 0, state: 'DEGRADED', runCount: 0, successCount: 0,
    failureCount: 0, currentBackoff: 0, potentialCandidateGap: false, degradedReason: 'FETCH_FAILED',
    createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z',
  };
  store.createSearchFeed(feed);
  const failed = store.beginFeedRun(feed.id, 'historical-failure', '2026-09-09T00:01:00.000Z');
  assert.ok(failed);
  store.finishFeedRun(failed.id, 'failed', '2026-09-09T00:02:00.000Z', { error: 'historical failure' });
  const succeeded = store.beginFeedRun(feed.id, 'historical-success', '2026-09-09T00:03:00.000Z');
  assert.ok(succeeded);
  store.finishFeedRun(succeeded.id, 'succeeded', '2026-09-09T00:04:00.000Z');
  store.db.prepare('UPDATE search_feeds SET run_count = 0, success_count = 0, last_run_at = NULL, last_success_at = NULL, last_successful_run_at = NULL, last_error = NULL, failure_count = 0 WHERE id = ?').run(feed.id);
  store.migrate();
  const restored = store.getSearchFeed(feed.id);
  assert.equal(restored?.runCount, 2);
  assert.equal(restored?.successCount, 1);
  assert.equal(restored?.lastRunAt, '2026-09-09T00:03:00.000Z');
  assert.equal(restored?.lastSuccessAt, '2026-09-09T00:04:00.000Z');
  assert.equal(restored?.failureCount, 0);
  assert.equal(restored?.lastError, undefined);
  store.close();
});

test('notification delivery is idempotent and Telegram failure does not block KOOK', async () => {
  const source = new FakeSourceAdapter();
  source.currentListings = [listing({ externalId: 'baseline' })];
  const telegram = new FakeChannel('telegram', 'tg-admin', true);
  const kook = new FakeChannel('kook', 'kook-admin');
  const { service, store } = build(source, { channels: [telegram, kook] });
  const created = await createSeller(service, { keywords: ['new'] });
  source.currentListings = [listing({ externalId: 'new', title: 'new item' })];
  await service.runWatch(created.watch.id);
  const outbox = store.listPendingNotifications();
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0]?.channelId, 'telegram');
  assert.equal(kook.calls.length, 1);
  await service.runWatch(created.watch.id);
  assert.equal(kook.calls.length, 1);
});

test('runtime stats count real similarity executions, notifications, and degraded failures', async () => {
  const source = new FakeSourceAdapter();
  source.currentListings = [listing({ externalId: 'baseline', title: 'baseline' })];
  const channel = new FakeChannel('telegram', 'recipient');
  const { service, store } = build(source, { channels: [channel], imageMatcher: new FakeImageMatcher() });
  const created = await createSimilarity(service);
  assert.equal(store.getWatchRuntimeStats(created.watch.id).feedRuns, 1);
  assert.equal(store.getWatchRuntimeStats(created.watch.id).successfulRuns, 1);

  source.currentListings = [listing({ externalId: 'baseline', title: 'baseline' }), listing({ externalId: 'similar', title: 'similar', imageUrls: ['https://fake.test/similar.jpg'] })];
  const succeeded = await service.runWatch(created.watch.id, 'runtime-success');
  assert.equal(succeeded.status, 'succeeded');
  const healthy = store.getWatchRuntimeStats(created.watch.id);
  assert.equal(healthy.feedRuns, 2);
  assert.equal(healthy.successfulRuns, 2);
  assert.equal(healthy.failedRuns, 0);
  assert.equal(healthy.newListings, 1);
  assert.equal(healthy.candidatesProcessed, 1);
  assert.equal(healthy.imageComparisons, 1);
  assert.equal(healthy.aboveThreshold, 1);
  assert.equal(healthy.notificationsSent, 1);
  assert.equal(healthy.bestScore, 0.82);
  assert.equal(service.getWatchObservability(created.watch.id).status, 'HEALTHY');

  source.fail = true;
  const degraded = await service.runWatch(created.watch.id, 'runtime-failure');
  assert.equal(degraded.status, 'succeeded');
  const failed = store.getWatchRuntimeStats(created.watch.id);
  assert.equal(failed.failedRuns, 1);
  assert.equal(failed.status, 'DEGRADED');
  assert.equal(store.getSearchFeed(store.listSearchFeeds()[0]!.id)?.runCount, 3);
  assert.equal(store.getSearchFeed(store.listSearchFeeds()[0]!.id)?.successCount, 2);
  assert.equal(store.getSearchFeed(store.listSearchFeeds()[0]!.id)?.failureCount, 1);
  assert.equal(service.getWatchObservability(created.watch.id).status, 'DEGRADED');
});

test('zero-match similarity remains healthy and persists usage through restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'product-radar-observability-'));
  const path = join(directory, 'radar.sqlite');
  try {
    const source = new FakeSourceAdapter();
    source.currentListings = [listing({ externalId: 'baseline' })];
    const first = build(source, { store: new SqliteRadarStore(path), imageMatcher: new FakeImageMatcher() });
    const created = await createSimilarity(first.service, { similarityThreshold: 0.9 });
    source.currentListings = [listing({ externalId: 'baseline' }), listing({ externalId: 'different', imageUrls: ['https://fake.test/different.jpg'] })];
    await first.service.runWatch(created.watch.id, 'zero-match');
    first.store.recordUsage({ watchId: created.watch.id, provider: 'langbot', model: 'luna', operation: 'intent_target_profile', inputTokens: 10, outputTokens: 4, totalTokens: 14, timestamp: '2026-09-09T00:00:00.000Z', inferenceCount: 1, imagesProcessed: 1, latencyMs: 25 });
    assert.equal(first.service.getWatchObservability(created.watch.id).status, 'HEALTHY');
    assert.equal(first.store.getWatchRuntimeStats(created.watch.id).aboveThreshold, 0);
    first.store.close();

    const second = build(source, { store: new SqliteRadarStore(path), imageMatcher: new FakeImageMatcher() });
    const observation = second.service.getWatchObservability(created.watch.id);
    assert.equal(observation.runtime.successfulRuns, 2);
    assert.equal(observation.usage.totalTokens, 14);
    assert.equal(observation.usage.imagesProcessed, 1);
    assert.equal(second.store.tableCounts().usage_ledger, 1);
    second.store.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('heartbeat digest is due once, includes no-match status, and keeps channels independent', async () => {
  const source = new FakeSourceAdapter();
  source.currentListings = [listing({ externalId: 'baseline' })];
  let now = '2026-09-09T00:00:00.000Z';
  const telegram = new FakeChannel('telegram', 'tg-admin', true);
  const kook = new FakeChannel('kook', 'kook-admin');
  const { service, store } = build(source, { channels: [telegram, kook], imageMatcher: new FakeImageMatcher(), now: () => now });
  const created = await service.createWatch({ source: 'fake', type: 'similarity', target: { referenceImageUrl: 'https://fake.test/reference.jpg', searchQuery: '패딩' }, rules: { similarityThreshold: 0.9 }, intervalSeconds: 120, heartbeatIntervalSeconds: 300 });
  now = '2026-09-09T00:05:01.000Z';
  const first = await service.runHeartbeatSweep();
  assert.equal(first, 2);
  assert.equal(telegram.calls.length, 1);
  assert.equal(kook.calls.length, 1);
  assert.match(kook.calls[0]!.text, /暂无匹配/);
  assert.equal(store.getWatchRuntimeStats(created.watch.id).notificationsSent, 1);
  assert.equal(await service.runHeartbeatSweep(), 0);
  assert.equal(store.listPendingHeartbeats().length, 1);
  assert.equal(store.getWatchRuntimeStats(created.watch.id).notificationsSent, 1);
});
