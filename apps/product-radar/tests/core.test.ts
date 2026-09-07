import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ProductRadarService } from '../src/core/application.js';
import { RadarError, SensorUnavailableError } from '../src/core/errors.js';
import type { Listing } from '../src/core/listing/model.js';
import { NotificationDispatcher } from '../src/core/notification/dispatcher.js';
import { matchListing } from '../src/core/matching/matcher.js';
import type { NotificationChannel, NotificationMessage } from '../src/core/notification/ports.js';
import type { ProductWatchRules, SellerWatchRules, WatchTarget } from '../src/core/watch/model.js';
import type { ListingSourceAdapter, SourceCapabilities, ValidatedTarget } from '../src/sources/registry.js';
import { SourceAdapterRegistry } from '../src/sources/registry.js';
import type { SensorClient, SensorHealth, SensorWatch, SensorWatchInput } from '../src/sensors/sensor.js';
import { SqliteRadarStore } from '../src/storage/sqlite.js';

const capabilities: SourceCapabilities = {
  sellerWatch: true,
  productWatch: true,
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

  async validateTarget(type: 'seller' | 'product' | 'search' | 'category' | 'smart', target: WatchTarget): Promise<ValidatedTarget> {
    const externalId = String(target.sellerExternalId ?? target.productExternalId ?? 'seller-1');
    const url = String(target.sellerUrl ?? target.productUrl ?? `https://fake.test/${type}/${externalId}`);
    return { ...target, externalId, url };
  }

  async fetchSellerListings(): Promise<unknown[]> {
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

function build(source: FakeSourceAdapter, options: { store?: SqliteRadarStore; sensor?: FakeSensor; channels?: NotificationChannel[] } = {}) {
  const store = options.store ?? new SqliteRadarStore(':memory:');
  const sensor = options.sensor ?? new FakeSensor();
  const registry = new SourceAdapterRegistry();
  registry.register(source);
  const notifications = new NotificationDispatcher(store, options.channels ?? [], { displayName: (id) => registry.get(id)?.displayName ?? id });
  const service = new ProductRadarService({ store, sources: registry, sensor, notifications, webhookUrl: 'http://radar.test/webhook' });
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
