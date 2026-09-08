import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BunjangSourceAdapter } from '../src/sources/bunjang/adapter.js';
import { SensorUnavailableError } from '../src/core/errors.js';
import { ChangedetectionSensorClient } from '../src/sensors/changedetection/client.js';

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

test('LangBot notification channel uses configured API header and always sends a person target', async () => {
  const { LangBotNotificationChannel } = await import('../src/integrations/notifications/langbot.js');
  let captured: { url: string; init: RequestInit } | undefined;
  const channel = new LangBotNotificationChannel({
    id: 'telegram',
    baseUrl: 'http://langbot.test',
    botId: 'telegram-bot',
    recipient: 'admin-id',
    apiToken: 'secret-token',
    apiHeaderName: 'X-API-Key',
    fetchImpl: async (url, init) => {
      captured = { url: String(url), init: init ?? {} };
      return response({ code: 0, data: { sent: true } });
    },
  });
  await channel.send({ event: { id: 'event', eventKey: 'event', watchId: 'watch', source: 'fake', type: 'ListingMatchedEvent', occurredAt: new Date().toISOString(), before: null, after: null, payload: {} }, text: 'hello', recipient: 'admin-id' });
  assert.ok(captured);
  assert.equal(new Headers(captured!.init.headers).get('X-API-Key'), 'secret-token');
  const body = JSON.parse(String(captured!.init.body));
  assert.equal(body.target_type, 'person');
  assert.equal(body.target_id, 'admin-id');
});
