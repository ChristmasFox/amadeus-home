import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { BunjangSourceAdapter } from '../src/sources/bunjang/adapter.js';
import { SensorUnavailableError } from '../src/core/errors.js';
import { ChangedetectionSensorClient } from '../src/sensors/changedetection/client.js';
import type { RadarEvent } from '../src/core/events/events.js';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('Bunjang adapter validates public targets and normalizes product state generically', async () => {
  const adapter = new BunjangSourceAdapter({ fetchImpl: async () => response({
    data: {
      product: {
        pid: 418123655,
        name: '[XL] Chrome Hearts hoodie',
        description: 'Description',
        price: 1_400_000,
        saleStatus: 'SELLING',
        imageUrl: 'https://media.bunjang.co.kr/product/418123655_{cnt}_x_w{res}.jpg',
        imageCount: 2,
        describedAt: '2026-07-05T08:53:01Z',
        brand: { name: 'Chrome Hearts' },
        category: { name: 'Hoodie' },
      },
      shop: { uid: 4771473, name: 'seller' },
    },
  }) });
  const target = await adapter.validateTarget('product', { productUrl: 'https://m.bunjang.co.kr/products/418123655' });
  assert.equal(target.externalId, '418123655');
  assert.equal(target.productExternalId, '418123655');
  const raw = await adapter.fetchProduct(target);
  const normalized = adapter.normalizeProductState(raw, { target });
  assert.equal(normalized.source, 'bunjang');
  assert.equal(normalized.externalId, '418123655');
  assert.equal(normalized.price?.amount, 1_400_000);
  assert.equal(normalized.price?.currency, 'KRW');
  assert.equal(normalized.status, 'ACTIVE');
  assert.equal(normalized.seller?.externalId, '4771473');
  assert.equal(normalized.imageUrls.length, 2);
  assert.equal(normalized.imageUrls[0]?.includes('{cnt}'), false);
  assert.equal(normalized.publishedAt, '2026-07-05T08:53:01Z');
});

test('Bunjang seller adapter uses the public shop search response and normalizes summary listings', async () => {
  const adapter = new BunjangSourceAdapter({ fetchImpl: async (input) => {
    const url = String(input);
    if (url.includes('/shop-details')) return response({ data: { shop: { name: 'seller name' } } });
    return response({ data: { responses: { mainGrid: { searchResponse: { data: [{ pid: 99, name: 'new Chrome Hearts item', price: 650000, status: 'SELLING', productImage: 'https://media.bunjang.co.kr/product/99_1_w{res}.jpg', shop: { uid: 4771473 } }], totalCount: 1 } } } } });
  } });
  const target = await adapter.validateTarget('seller', { sellerUrl: 'https://m.bunjang.co.kr/shops/4771473/products' });
  const listings = await adapter.fetchSellerListings(target);
  assert.equal(listings.length, 1);
  const normalized = adapter.normalizeListing(listings[0], { target });
  assert.equal(normalized.externalId, '99');
  assert.equal(normalized.price?.amount, 650000);
  assert.equal(normalized.status, 'ACTIVE');
  assert.equal(normalized.seller?.name, 'seller name');
  assert.equal(normalized.imageUrls[0], 'https://media.bunjang.co.kr/product/99_1_w600.jpg');
});

test('Bunjang similarity target uses the keyword search feed and keeps image data source-agnostic', async () => {
  const adapter = new BunjangSourceAdapter({ fetchImpl: async () => response({ data: { responses: { mainGrid: { searchResponse: { data: [{ pid: 101, name: 'hoodie', price: 120000, status: 'SELLING', productImage: 'https://media.bunjang.co.kr/product/101_1_w{res}.jpg', shop: { uid: 7 } }], totalCount: 1 } } } } }) });
  const target = await adapter.validateTarget('similarity', { referenceImageUrl: 'https://image.test/reference.jpg', searchQuery: '후드티' });
  assert.equal(target.externalId, 'search:후드티');
  assert.equal(target.searchUrl, 'https://m.bunjang.co.kr/keywords/%ED%9B%84%EB%93%9C%ED%8B%B0');
  const listings = await adapter.fetchSearchListings(target);
  const normalized = adapter.normalizeListing(listings[0], { target });
  assert.equal(normalized.externalId, '101');
  assert.equal(normalized.imageUrls[0], 'https://media.bunjang.co.kr/product/101_1_w600.jpg');
});

test('Bunjang search parser tolerates nested result arrays and nextCursor response names', async () => {
  const requests: string[] = [];
  const adapter = new BunjangSourceAdapter({ fetchImpl: async (input) => {
    requests.push(String(input));
    return response({ data: { responses: { mainGrid: { searchResponse: { payload: { items: [{ pid: 202, name: 'nested item', productImage: 'https://media.bunjang.co.kr/product/202_1_w{res}.jpg' }] }, nextCursor: 'cursor-2' } } } } });
  } });
  const target = await adapter.validateTarget('similarity', { searchQuery: '후드티' });
  const page = await adapter.fetchSearchPage({ ...target, searchQuery: target.searchQuery ?? '후드티', pageSize: 60 });
  assert.equal(page.items.length, 1);
  assert.equal(page.nextCursor, 'cursor-2');
  assert.equal(requests[0]?.includes('q=%ED%9B%84%EB%93%9C%ED%8B%B0'), true);
});

test('Bunjang adapter maps explicit deleted product errors to UNAVAILABLE, never guessing from parser failure', async () => {
  const adapter = new BunjangSourceAdapter({ fetchImpl: async () => response({ errorCode: 'ERR_DELETED_PRODUCT', reason: 'deleted' }, 400) });
  const target = await adapter.validateTarget('product', { productExternalId: '123', productUrl: 'https://m.bunjang.co.kr/products/123' });
  const raw = await adapter.fetchProduct(target);
  const normalized = adapter.normalizeProductState(raw, { target });
  assert.equal(normalized.status, 'UNAVAILABLE');
  assert.equal(normalized.attributes?.partial, true);

  const unknown = new BunjangSourceAdapter({ fetchImpl: async () => response({ data: { product: { pid: 123, name: 'item', saleStatus: 'SOMETHING_NEW' } } }) });
  const unknownTarget = await unknown.validateTarget('product', { productExternalId: '123' });
  const unknownState = unknown.normalizeProductState(await unknown.fetchProduct(unknownTarget), { target: unknownTarget });
  assert.equal(unknownState.status, 'UNKNOWN');
});

test('Bunjang seller endpoint access failures are explicit and do not become an empty baseline', async () => {
  const adapter = new BunjangSourceAdapter({ fetchImpl: async () => response({ result: 'unauthorized' }) });
  const target = await adapter.validateTarget('seller', { sellerUrl: 'https://m.bunjang.co.kr/shops/4771473/products' });
  await assert.rejects(() => adapter.fetchSellerListings(target), (error: unknown) => {
    return error instanceof Error && error.message.includes('authenticated public endpoint');
  });
});

test('changedetection client creates a JSON webhook with both radar and sensor identifiers', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const client = new ChangedetectionSensorClient({
    baseUrl: 'http://changedetection.test',
    apiKey: 'test-key',
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return response({ uuid: 'sensor-1' });
    },
  });
  const created = await client.createWatch({ radarWatchId: 'radar-1', url: 'https://example.test/item', title: 'item', intervalSeconds: 300, webhookUrl: 'http://radar.test/webhook' });
  assert.equal(created.id, 'sensor-1');
  const body = JSON.parse(String(requests[0]?.init.body));
  assert.equal(body.url, 'https://example.test/item');
  assert.deepEqual(body.notification_urls, ['json://radar.test/webhook']);
  assert.equal(body.notification_format, 'text');
  assert.deepEqual(body.time_between_check, { seconds: 300 });
  assert.equal(body.time_between_check_use_default, false);
  assert.deepEqual(JSON.parse(body.notification_body), { radarWatchId: 'radar-1', sensorWatchId: 'pending' });
  assert.equal(requests.length, 2);
  const updateBody = JSON.parse(String(requests[1]!.init.body));
  assert.equal(updateBody.notification_format, 'text');
  assert.deepEqual(JSON.parse(updateBody.notification_body), { radarWatchId: 'radar-1', sensorWatchId: 'sensor-1' });
  assert.equal(new Headers(requests[0]!.init.headers).get('x-api-key'), 'test-key');
});

test('changedetection health and API errors are surfaced as unavailable', async () => {
  const client = new ChangedetectionSensorClient({
    baseUrl: 'http://changedetection.test',
    fetchImpl: async () => response({ error: 'down' }, 503),
  });
  const health = await client.health();
  assert.equal(health.ok, false);
  await assert.rejects(() => client.createWatch({ radarWatchId: 'radar-1', url: 'https://example.test', title: 'item', intervalSeconds: 300, webhookUrl: 'http://radar.test/webhook' }), (error: unknown) => error instanceof SensorUnavailableError);
});

test('owner notification channel writes a channel-free idempotent outbox event', async () => {
  const { OwnerNotificationChannel } = await import('../src/integrations/notifications/owner.js');
  const directory = await mkdtemp(join(tmpdir(), 'product-radar-owner-'));
  try {
    const channel = new OwnerNotificationChannel(directory);
    const event = { id: 'event', eventKey: 'event', watchId: 'watch', source: 'fake', type: 'ListingMatchedEvent' as const, occurredAt: new Date().toISOString(), before: null, after: null, payload: {} };
    await channel.send({ event, text: 'hello', recipient: 'owner' });
    await channel.send({ event, text: 'hello', recipient: 'owner' });
    const files = await readdir(directory);
    assert.equal(files.length, 1);
    const file = files[0]!;
    const body = JSON.parse(await readFile(join(directory, file), 'utf8')) as Record<string, unknown>;
    assert.equal(body.version, 1);
    assert.equal(body.type, 'owner_notification');
    assert.equal(body.eventKey, 'event');
    assert.equal(body.source, 'product-radar:ListingMatchedEvent');
    assert.equal(body.eventType, 'product_radar_ListingMatchedEvent');
    assert.equal(body.headline, 'Amadeus • 世界线观测 · Product Radar');
    assert.equal(body.summary, 'hello');
    assert.equal('message' in body, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('owner notification adapter preserves Radar facts and stays transport-neutral', async () => {
  const { OwnerNotificationChannel } = await import('../src/integrations/notifications/owner.js');
  const channel = new OwnerNotificationChannel('/tmp/product-radar-worldline-test');
  const listing = {
    source: 'fake',
    externalId: 'p1',
    title: 'Structured item',
    url: 'https://fake.test/products/p1',
    imageUrls: ['https://fake.test/p1.jpg'],
    price: { amount: 100, currency: 'USD' },
    status: 'ACTIVE',
    seller: { externalId: 'seller-1', name: 'Seller One' },
    discoveredAt: '2026-09-20T15:10:00.000Z',
  };
  const base: RadarEvent = {
    id: 'worldline-event',
    eventKey: 'worldline-event',
    watchId: 'watch',
    source: 'fake',
    type: 'ListingMatchedEvent',
    occurredAt: '2026-09-20T15:10:00.000Z',
    before: null,
    after: listing,
    payload: { matchedKeywords: ['chrome hearts'], reason: 'keyword' },
  };
  const cases: Array<{ event: RadarEvent; theme: string; labels: string[] }> = [
    { event: base, theme: 'worldline_observation', labels: ['商品标题', '卖家', '当前价格金额', '命中关键词'] },
    { event: { ...base, type: 'SimilarListingMatchedEvent', payload: { similarity: 0.91, threshold: 0.8 }, eventKey: 'similar', id: 'similar' }, theme: 'worldline_observation', labels: ['相似度', '相似度阈值'] },
    { event: { ...base, type: 'ProductPriceChangedEvent', before: { amount: 100, currency: 'USD' }, after: { amount: 80, currency: 'USD' }, payload: { listing } , eventKey: 'price', id: 'price' }, theme: 'worldline_divergence', labels: ['变化前价格金额', '变化后价格金额', '价格方向'] },
    { event: { ...base, type: 'ProductStatusChangedEvent', before: 'ACTIVE', after: 'SOLD', payload: { listing }, eventKey: 'status', id: 'status' }, theme: 'worldline_divergence', labels: ['变化前状态', '变化后状态'] },
    { event: { ...base, type: 'ProductUpdatedEvent', before: listing, after: { ...listing, title: 'Updated item' }, payload: { fields: ['title'] }, eventKey: 'updated', id: 'updated' }, theme: 'worldline_observation', labels: ['变化字段'] },
  ];
  for (const { event, theme, labels } of cases) {
    const message = channel.prepare!(event, 'Fake Source');
    assert.equal(message.recipient, 'owner');
    assert.equal(message.text, undefined);
    const payload = message.payload as Record<string, unknown>;
    assert.equal(payload.type, 'owner_notification');
    assert.equal(payload.theme, theme);
    const facts = payload.facts as Array<{ label: string; value: unknown }>;
    for (const label of labels) assert.equal(facts.some((item) => item.label === label), true, label);
    assert.equal((payload.links as Array<{ url: string }>)[0]?.url, listing.url);
  }
});
