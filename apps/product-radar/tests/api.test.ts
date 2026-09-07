import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { createRadarServer } from '../src/api/server.js';
import { ProductRadarService } from '../src/core/application.js';
import type { Listing } from '../src/core/listing/model.js';
import { NotificationDispatcher } from '../src/core/notification/dispatcher.js';
import type { ListingSourceAdapter, SourceCapabilities, ValidatedTarget } from '../src/sources/registry.js';
import { SourceAdapterRegistry } from '../src/sources/registry.js';
import type { SensorClient, SensorHealth, SensorWatch, SensorWatchInput } from '../src/sensors/sensor.js';
import { SqliteRadarStore } from '../src/storage/sqlite.js';

const caps: SourceCapabilities = { sellerWatch: true, productWatch: true, searchWatch: false, categoryWatch: false, supportsPrice: true, supportsImages: true, supportsSeller: true, supportsProductStatus: true };
const item = (id: string, title: string): Listing => ({ source: 'api-fake', externalId: id, title, url: `https://api-fake.test/${id}`, imageUrls: [], status: 'ACTIVE', discoveredAt: new Date().toISOString() });

class ApiSource implements ListingSourceAdapter {
  readonly id = 'api-fake';
  readonly displayName = 'API Fake';
  readonly capabilities = caps;
  listings: Listing[] = [item('initial', 'Initial')];
  async validateTarget(_type: 'seller' | 'product' | 'search' | 'category' | 'smart', target: Record<string, unknown>): Promise<ValidatedTarget> { return { ...target, externalId: 'seller-1', url: 'https://api-fake.test/seller-1' }; }
  async fetchSellerListings(): Promise<unknown[]> { return this.listings; }
  async fetchProduct(): Promise<unknown> { return item('product-1', 'Product'); }
  normalizeListing(raw: unknown): Listing { return { ...(raw as Listing), discoveredAt: new Date().toISOString() }; }
  normalizeProductState(raw: unknown): Listing { return { ...(raw as Listing), discoveredAt: new Date().toISOString() }; }
}
class ApiSensor implements SensorClient {
  readonly id = 'api-sensor';
  async createWatch(input: SensorWatchInput): Promise<SensorWatch> { return { id: `sensor-${input.radarWatchId}` }; }
  async updateWatch(sensorId: string): Promise<SensorWatch> { return { id: sensorId }; }
  async pauseWatch(): Promise<void> {}
  async resumeWatch(): Promise<void> {}
  async deleteWatch(): Promise<void> {}
  async getWatch(sensorId: string): Promise<SensorWatch> { return { id: sensorId }; }
  async health(): Promise<SensorHealth> { return { ok: true, status: 'ok' }; }
}

async function listen(server: ReturnType<typeof createRadarServer>): Promise<{ base: string; close: () => Promise<void> }> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return { base: `http://127.0.0.1:${address.port}`, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

test('HTTP API exposes source capabilities and watch lifecycle without platform coupling', async () => {
  const source = new ApiSource();
  const registry = new SourceAdapterRegistry();
  registry.register(source);
  const store = new SqliteRadarStore(':memory:');
  const sensor = new ApiSensor();
  const service = new ProductRadarService({ store, sources: registry, sensor, notifications: new NotificationDispatcher(store, [], { displayName: (id) => id }), webhookUrl: 'http://test/webhook' });
  const server = createRadarServer({ service, sources: registry, sensor, store });
  const runtime = await listen(server);
  try {
    const sources = await fetch(`${runtime.base}/api/sources`).then((response) => response.json());
    assert.equal(sources.sources[0].capabilities.sellerWatch, true);
    assert.equal(sources.sources[0].capabilities.searchWatch, false);

    const createdResponse = await fetch(`${runtime.base}/api/watches`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'api-fake', type: 'seller', target: { sellerExternalId: 'seller-1' }, rules: { keywords: ['new'] } }) });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.baselineNotifications, 0);

    const fetched = await fetch(`${runtime.base}/api/watches/${created.watch.id}`).then((response) => response.json());
    assert.equal(fetched.type, 'seller');
    const patched = await fetch(`${runtime.base}/api/watches/${created.watch.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) }).then((response) => response.json());
    assert.equal(patched.enabled, false);
    const runDisabled = await fetch(`${runtime.base}/api/watches/${created.watch.id}/run`, { method: 'POST' }).then((response) => response.json());
    assert.equal(runDisabled.status, 'disabled');
    await fetch(`${runtime.base}/api/watches/${created.watch.id}/resume`, { method: 'POST' });
    source.listings = [item('initial', 'Initial'), item('new', 'New')];
    const webhook = await fetch(`${runtime.base}/api/sensors/changedetection/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ radarWatchId: created.watch.id, sensorWatchId: created.watch.sensorId, eventId: 'api-sensor-event' }) }).then((response) => response.json());
    assert.equal(webhook.accepted, true);
    assert.equal(webhook.newListings, 1);

    const deleted = await fetch(`${runtime.base}/api/watches/${created.watch.id}`, { method: 'DELETE' }).then((response) => response.json());
    assert.equal(deleted.deleted, true);
    assert.equal((await fetch(`${runtime.base}/api/watches/${created.watch.id}`)).status, 404);
  } finally {
    await runtime.close();
    store.close();
  }
});
