import { randomUUID } from 'node:crypto';
import { ProductRadarService } from '../src/core/application.js';
import { NotificationDispatcher } from '../src/core/notification/dispatcher.js';
import { BunjangSourceAdapter } from '../src/sources/bunjang/adapter.js';
import { SourceAdapterRegistry } from '../src/sources/registry.js';
import type { SensorClient, SensorHealth, SensorWatch, SensorWatchInput } from '../src/sensors/sensor.js';
import { SqliteRadarStore } from '../src/storage/sqlite.js';

class SmokeSensor implements SensorClient {
  readonly id = 'smoke-sensor';
  async createWatch(input: SensorWatchInput): Promise<SensorWatch> { return { id: `smoke-sensor-${randomUUID()}`, url: input.url }; }
  async updateWatch(sensorId: string): Promise<SensorWatch> { return { id: sensorId }; }
  async pauseWatch(): Promise<void> {}
  async resumeWatch(): Promise<void> {}
  async deleteWatch(): Promise<void> {}
  async getWatch(sensorId: string): Promise<SensorWatch> { return { id: sensorId }; }
  async health(): Promise<SensorHealth> { return { ok: true, status: 'fake-smoke-sensor' }; }
}

const sellerUrl = process.env.BUNJANG_SMOKE_SELLER_URL ?? 'https://m.bunjang.co.kr/shops/4771473/products';
const productUrl = process.env.BUNJANG_SMOKE_PRODUCT_URL ?? 'https://m.bunjang.co.kr/products/418123655';
const adapter = new BunjangSourceAdapter();
const registry = new SourceAdapterRegistry();
registry.register(adapter);
const store = new SqliteRadarStore(':memory:');
const sensor = new SmokeSensor();
const notifications = new NotificationDispatcher(store, [], { displayName: (source) => registry.get(source)?.displayName ?? source });
const service = new ProductRadarService({ store, sources: registry, sensor, notifications, webhookUrl: 'http://smoke.invalid/webhook' });

const output: Record<string, unknown> = { seller: {}, product: {} };
try {
  try {
    const result = await service.createWatch({ source: 'bunjang', type: 'seller', target: { sellerUrl }, rules: { keywords: ['Chrome Hearts'] } });
    output.seller = { status: 'ok', watchId: result.watch.id, baselineCount: result.baselineCount, baselineNotifications: result.baselineNotifications };
  } catch (error) {
    output.seller = { status: 'blocked', reason: error instanceof Error ? error.message : String(error) };
  }
  try {
    const result = await service.createWatch({ source: 'bunjang', type: 'product', target: { productUrl } });
    const state = store.getLatestProductSnapshot(result.watch.id)?.state;
    output.product = {
      status: 'ok',
      watchId: result.watch.id,
      baselineCount: result.baselineCount,
      baselineNotifications: result.baselineNotifications,
      title: state?.title,
      price: state?.price,
      statusValue: state?.status,
      imageCount: state?.imageUrls.length ?? 0,
      seller: state?.seller,
      snapshotPersisted: Boolean(state),
    };
  } catch (error) {
    output.product = { status: 'blocked', reason: error instanceof Error ? error.message : String(error) };
  }
  output.notificationCount = store.listEvents().length;
  console.log(JSON.stringify(output, null, 2));
} finally {
  store.close();
}
