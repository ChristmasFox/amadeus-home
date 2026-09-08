import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProductRadarService } from '../src/core/application.js';
import type { Listing } from '../src/core/listing/model.js';
import type { ImageMatcher, ImageMatchResult, ImageSource, PreparedImageReference } from '../src/core/matching/image.js';
import { NotificationDispatcher } from '../src/core/notification/dispatcher.js';
import type { NotificationChannel, NotificationMessage } from '../src/core/notification/ports.js';
import type { SensorClient, SensorHealth, SensorWatch, SensorWatchInput } from '../src/sensors/sensor.js';
import { SourceAdapterRegistry } from '../src/sources/registry.js';
import type { ListingSourceAdapter, SourceCapabilities, ValidatedTarget } from '../src/sources/registry.js';
import type { SearchPage, SearchPageTarget } from '../src/core/search/model.js';
import { SqliteRadarStore } from '../src/storage/sqlite.js';

const capabilities: SourceCapabilities = {
  sellerWatch: false, productWatch: false, similarityWatch: true, searchWatch: true, categoryWatch: false,
  supportsPrice: true, supportsImages: true, supportsSeller: true, supportsProductStatus: true,
};

function listing(id: string): Listing {
  return { source: 'fake', externalId: id, title: id, url: `https://fake.test/${id}`, imageUrls: [`https://fake.test/${id}.jpg`], discoveredAt: new Date().toISOString() };
}

class PaginatedSource implements ListingSourceAdapter {
  readonly id = 'fake';
  readonly displayName = 'Fake';
  readonly capabilities = capabilities;
  pages: unknown[][] = [[listing('baseline')]];
  calls = 0;

  async validateTarget(_type: 'seller' | 'product' | 'similarity' | 'search' | 'category' | 'smart', target: Record<string, unknown>): Promise<ValidatedTarget> {
    const query = String(target.searchQuery ?? 'outerwear');
    return { ...target, searchQuery: query, url: `https://fake.test/search/${encodeURIComponent(query)}`, externalId: `search:${query}` } as ValidatedTarget;
  }
  async fetchSellerListings(): Promise<unknown[]> { return []; }
  async fetchProduct(): Promise<unknown> { return listing('product'); }
  async fetchSearchListings(): Promise<unknown[]> { return this.pages[0] ?? []; }
  async fetchSearchPage(target: ValidatedTarget & SearchPageTarget): Promise<SearchPage> {
    const index = target.cursor ? Number(target.cursor) : 0;
    this.calls += 1;
    const items = this.pages[index] ?? [];
    return { items, ...(index + 1 < this.pages.length ? { nextCursor: String(index + 1) } : {}) };
  }
  normalizeListing(raw: unknown): Listing { return raw as Listing; }
  normalizeProductState(raw: unknown): Listing { return raw as Listing; }
}

class FakeImageMatcher implements ImageMatcher {
  async prepareReference(_source: ImageSource): Promise<PreparedImageReference> { return { id: 'ref', contentHash: 'ref' }; }
  async match(_referenceId: string, _candidateImageUrls: string[]): Promise<ImageMatchResult> { return { score: 0.9, comparedImages: 1, provider: 'sharp', modelVersion: 'test', rawScore: 0.9, matchScore: 0.9 }; }
}

class FakeSensor implements SensorClient {
  readonly id = 'fake-sensor';
  readonly created: SensorWatchInput[] = [];
  readonly deleted: string[] = [];
  async createWatch(input: SensorWatchInput): Promise<SensorWatch> { this.created.push(input); return { id: `sensor-${this.created.length}`, url: input.url }; }
  async updateWatch(sensorId: string, _input: Partial<SensorWatchInput>): Promise<SensorWatch> { return { id: sensorId }; }
  async pauseWatch(_sensorId: string): Promise<void> {}
  async resumeWatch(_sensorId: string): Promise<void> {}
  async deleteWatch(sensorId: string): Promise<void> { this.deleted.push(sensorId); }
  async getWatch(sensorId: string): Promise<SensorWatch> { return { id: sensorId }; }
  async health(): Promise<SensorHealth> { return { ok: true, status: 'ok' }; }
}

class FakeChannel implements NotificationChannel {
  readonly id = 'test';
  readonly recipient = 'recipient';
  readonly calls: NotificationMessage[] = [];
  async send(message: NotificationMessage): Promise<void> { this.calls.push(message); }
}

function build(source: PaginatedSource, options: { maxPagesPerRun?: number; maxListingsPerRun?: number } = {}) {
  const store = new SqliteRadarStore(':memory:');
  const sensors = new FakeSensor();
  const channels = [new FakeChannel()];
  const registry = new SourceAdapterRegistry();
  registry.register(source);
  const notifications = new NotificationDispatcher(store, channels, { displayName: () => 'Fake' });
  const service = new ProductRadarService({ store, sources: registry, sensor: sensors, notifications, webhookUrl: 'https://fake.test/webhook', imageMatcher: new FakeImageMatcher(), ...options });
  return { service, store, sensors, channel: channels[0]! };
}

function proposal(id: string, query = 'outerwear') {
  return { id, source: 'fake', type: 'similarity', target: { referenceImageBase64: 'data:image/png;base64,AA==', searchQuery: query }, rules: { similarityThreshold: 0.6, candidateLimit: 60 }, intervalSeconds: 900 };
}

test('same source/query reuses one SearchFeed and one sensor; cleanup waits for last subscriber', async () => {
  const source = new PaginatedSource();
  const { service, store, sensors } = build(source);
  const first = await service.createWatch(proposal('watch-a'));
  const second = await service.createWatch(proposal('watch-b'));
  const feeds = service.listSearchFeeds();
  assert.equal(feeds.length, 1);
  assert.equal(sensors.created.length, 1);
  assert.equal(store.listWatchFeedSubscriptions({ feedId: feeds[0]!.id }).length, 2);
  await service.deleteWatch(first.watch.id);
  assert.equal(service.listSearchFeeds().length, 1);
  assert.deepEqual(sensors.deleted, []);
  await service.deleteWatch(second.watch.id);
  assert.equal(service.listSearchFeeds().length, 0);
  assert.deepEqual(sensors.deleted, ['sensor-1']);
});

test('new subscriber starts after current feed event and only receives future listings', async () => {
  const source = new PaginatedSource();
  const { service, store, channel } = build(source);
  const first = await service.createWatch(proposal('watch-a'));
  source.pages = [[listing('baseline'), listing('future-1')]];
  await service.runWatch(first.watch.id);
  assert.equal(channel.calls.length, 1);
  const second = await service.createWatch(proposal('watch-b'));
  assert.equal(store.listWatchFeedSubscriptions({ watchId: second.watch.id })[0]?.startAfterEventId, store.getLatestFeedListingEvent(service.listSearchFeeds()[0]!.id)?.eventId);
  source.pages = [[listing('future-1'), listing('future-2')]];
  await service.runWatch(first.watch.id);
  assert.equal(channel.calls.length, 3);
  assert.equal(store.listEvents(second.watch.id).length, 1);
});

test('incremental pagination discovers more than 60 listings before the watermark', async () => {
  const source = new PaginatedSource();
  const { service } = build(source, { maxPagesPerRun: 10, maxListingsPerRun: 500 });
  const created = await service.createWatch(proposal('watch-a'));
  source.pages = [
    Array.from({ length: 60 }, (_, index) => listing(`new-${index + 1}`)),
    [...Array.from({ length: 60 }, (_, index) => listing(`new-${index + 61}`)), listing('baseline')],
  ];
  const result = await service.runWatch(created.watch.id);
  assert.equal(result.newListings, 120);
  assert.equal(result.matchedListings, 120);
  assert.equal(service.listSearchFeeds()[0]?.state, 'ACTIVE');
});

test('pagination safety cap degrades without advancing the watermark', async () => {
  const source = new PaginatedSource();
  const { service } = build(source, { maxPagesPerRun: 1, maxListingsPerRun: 500 });
  const created = await service.createWatch(proposal('watch-a'));
  const before = service.listSearchFeeds()[0]?.watermark;
  source.pages = [Array.from({ length: 60 }, (_, index) => listing(`new-${index}`)), Array.from({ length: 60 }, (_, index) => listing(`newer-${index}`)), [listing('baseline')]];
  const result = await service.runWatch(created.watch.id);
  assert.equal(result.status, 'succeeded');
  assert.equal(service.listSearchFeeds()[0]?.state, 'DEGRADED');
  assert.equal(service.listSearchFeeds()[0]?.degradedReason, 'WATERMARK_NOT_REACHED');
  assert.equal(service.listSearchFeeds()[0]?.watermark, before);
  assert.equal(result.newListings, 60);
});

test('duplicate feed webhook is idempotent', async () => {
  const source = new PaginatedSource();
  const { service, sensors, channel } = build(source);
  const created = await service.createWatch(proposal('watch-a'));
  const feed = service.listSearchFeeds()[0]!;
  source.pages = [[listing('baseline'), listing('webhook-new')]];
  const first = await service.handleSensorWebhook({ feedId: feed.id, sensorWatchId: feed.sensorWatchId ?? '', eventId: 'changedetection-1' });
  assert.equal((first as { accepted: boolean }).accepted, true);
  const count = channel.calls.length;
  const second = await service.handleSensorWebhook({ feedId: feed.id, sensorWatchId: feed.sensorWatchId, eventId: 'changedetection-1' });
  assert.equal((second as { status: string }).status, 'duplicate');
  assert.equal(channel.calls.length, count);
  assert.equal(created.watch.id, 'watch-a');
});
