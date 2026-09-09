import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ProductRadarService } from './core/application.js';
import { NotificationDispatcher } from './core/notification/dispatcher.js';
import { BunjangSourceAdapter } from './sources/bunjang/adapter.js';
import { SourceAdapterRegistry } from './sources/registry.js';
import { ChangedetectionSensorClient } from './sensors/changedetection/client.js';
import { SqliteRadarStore } from './storage/sqlite.js';
import { createRadarServer } from './api/server.js';
import { LangBotNotificationChannel, readOptionalToken } from './integrations/notifications/langbot.js';
import { PerceptualImageMatcher } from './integrations/images/perceptual-matcher.js';

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? '');
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function main(): Promise<void> {
  const port = numberEnv('PRODUCT_RADAR_PORT', 5315);
  const host = process.env.PRODUCT_RADAR_HOST?.trim() || '0.0.0.0';
  const databasePath = process.env.PRODUCT_RADAR_DATABASE_PATH?.trim() || '/data/product-radar.sqlite';
  if (databasePath !== ':memory:') await mkdir(dirname(databasePath), { recursive: true });

  const sources = new SourceAdapterRegistry();
  const bunjangOptions = { timeoutMs: numberEnv('BUNJANG_TIMEOUT_MS', 20_000), ...(process.env.BUNJANG_API_BASE_URL?.trim() ? { apiBaseUrl: process.env.BUNJANG_API_BASE_URL.trim() } : {}), ...(process.env.BUNJANG_WEB_BASE_URL?.trim() ? { webBaseUrl: process.env.BUNJANG_WEB_BASE_URL.trim() } : {}) };
  sources.register(new BunjangSourceAdapter(bunjangOptions));
  const store = new SqliteRadarStore(databasePath);
  const imageMatcher = new PerceptualImageMatcher({ dataDir: dirname(databasePath) });
  const sensorOptions = { baseUrl: process.env.CHANGEDETECTION_BASE_URL?.trim() || 'http://changedetection:5000', timeoutMs: numberEnv('CHANGEDETECTION_TIMEOUT_MS', 10_000), ...(process.env.CHANGEDETECTION_API_KEY?.trim() ? { apiKey: process.env.CHANGEDETECTION_API_KEY.trim() } : {}) };
  const sensor = new ChangedetectionSensorClient(sensorOptions);
  const langBotToken = await readOptionalToken(process.env.PRODUCT_RADAR_LANGBOT_API_TOKEN_FILE, process.env.PRODUCT_RADAR_LANGBOT_API_TOKEN);
  const langBotBaseUrl = process.env.LANGBOT_API_BASE_URL?.trim() || 'http://langbot:5300';
  const langBotApiHeader = process.env.PRODUCT_RADAR_LANGBOT_API_HEADER?.trim() || 'Authorization';
  const channels = [];
  const telegramRecipient = process.env.TELEGRAM_ADMIN_USER_ID?.trim();
  const telegramBotId = process.env.PRODUCT_RADAR_TELEGRAM_BOT_ID?.trim();
  if (telegramRecipient && telegramBotId) channels.push(new LangBotNotificationChannel({ id: 'telegram', baseUrl: langBotBaseUrl, botId: telegramBotId, recipient: telegramRecipient, apiHeaderName: langBotApiHeader, ...(langBotToken === undefined ? {} : { apiToken: langBotToken }) }));
  const kookRecipient = process.env.KOOK_ADMIN_USER_ID?.trim();
  const kookBotId = process.env.PRODUCT_RADAR_KOOK_BOT_ID?.trim();
  if (kookRecipient && kookBotId) channels.push(new LangBotNotificationChannel({ id: 'kook', baseUrl: langBotBaseUrl, botId: kookBotId, recipient: kookRecipient, apiHeaderName: langBotApiHeader, ...(langBotToken === undefined ? {} : { apiToken: langBotToken }) }));
  const notifications = new NotificationDispatcher(store, channels, { displayName: (source) => sources.get(source)?.displayName ?? source });
  const service = new ProductRadarService({
    store,
    sources,
    sensor,
    notifications,
    webhookUrl: process.env.PRODUCT_RADAR_WEBHOOK_URL?.trim() || `http://product-radar:${port}/api/sensors/changedetection/webhook`,
    imageMatcher,
  });
  const server = createRadarServer({
    service,
    sources,
    sensor,
    store,
    ...(process.env.PRODUCT_RADAR_API_KEY?.trim() ? { apiKey: process.env.PRODUCT_RADAR_API_KEY.trim() } : {}),
    maxBodyBytes: numberEnv('PRODUCT_RADAR_MAX_BODY_BYTES', 16 * 1024 * 1024),
  });
  const retrySeconds = numberEnv('PRODUCT_RADAR_OUTBOX_RETRY_SECONDS', 60);
  const outboxTimer = setInterval(() => {
    void notifications.deliverPending().catch((error: unknown) => console.error('notification outbox retry failed', error));
  }, retrySeconds * 1000);
  outboxTimer.unref();
  void notifications.deliverPending().catch((error: unknown) => console.error('notification outbox startup drain failed', error));
  const heartbeatSeconds = numberEnv('PRODUCT_RADAR_HEARTBEAT_CHECK_SECONDS', 60);
  const heartbeatTimer = setInterval(() => {
    void service.runHeartbeatSweep().catch((error: unknown) => console.error('heartbeat sweep failed', error));
  }, heartbeatSeconds * 1000);
  heartbeatTimer.unref();
  void service.runHeartbeatSweep().catch((error: unknown) => console.error('heartbeat startup sweep failed', error));
  const feedSweepSeconds = numberEnv('PRODUCT_RADAR_FEED_SWEEP_SECONDS', 30);
  let feedSweepInFlight = false;
  const runFeedSweep = async (): Promise<void> => {
    if (feedSweepInFlight) return;
    feedSweepInFlight = true;
    try {
      await service.runDueSimilarityFeeds();
    } catch (error) {
      console.error('similarity feed sweep failed', error);
    } finally {
      feedSweepInFlight = false;
    }
  };
  const feedSweepTimer = setInterval(() => { void runFeedSweep(); }, feedSweepSeconds * 1000);
  feedSweepTimer.unref();
  void runFeedSweep();
  server.listen(port, host, () => console.log(`Product Radar listening on ${host}:${port}`));
  const shutdown = (): void => {
    clearInterval(outboxTimer);
    clearInterval(heartbeatTimer);
    clearInterval(feedSweepTimer);
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
