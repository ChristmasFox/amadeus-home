import { createRequire } from 'node:module';
import type { Listing } from '../core/listing/model.js';
import type { RadarEvent } from '../core/events/events.js';
import type { NotificationChannel, NotificationMessage } from '../core/notification/ports.js';
import type { Watch, WatchRules, WatchTarget, ImplementedWatchType } from '../core/watch/model.js';

interface SqliteStatement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid?: number | bigint };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDatabase };

export interface ProductSnapshotRow {
  id: string;
  watchId: string;
  capturedAt: string;
  state: Listing;
  fingerprint: string;
  isBaseline: boolean;
}

export interface NotificationOutboxRow {
  id: string;
  eventId: string;
  channelId: string;
  recipient: string;
  message: NotificationMessage;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  lastError?: string;
  createdAt: string;
  sentAt?: string;
}

export interface PollRunResult {
  id: string;
  watchId: string;
  sensorId?: string;
  triggerKey: string;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: string;
  finishedAt?: string;
  error?: string;
  listingsCount?: number;
  changesCount?: number;
}

function jsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function bool(value: unknown): boolean {
  return value === 1 || value === true || value === '1';
}

function integer(value: number | bigint | undefined): number {
  return Number(value ?? 0);
}

function rowToWatch(row: Record<string, unknown>): Watch {
  const sensorId = optionalString(row.sensor_id);
  return {
    id: String(row.id),
    source: String(row.source),
    type: String(row.type) as ImplementedWatchType,
    target: jsonParse<WatchTarget>(row.target_json, {}),
    rules: jsonParse<WatchRules>(row.rules_json, {} as WatchRules),
    enabled: bool(row.enabled),
    intervalSeconds: Number(row.interval_seconds),
    ...(sensorId === undefined ? {} : { sensorId }),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class SqliteRadarStore {
  readonly db: SqliteDatabase;

  constructor(filename = ':memory:') {
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  migrate(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS watches (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        type TEXT NOT NULL,
        target_json TEXT NOT NULL,
        rules_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        interval_seconds INTEGER NOT NULL,
        sensor_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_watches_enabled ON watches(enabled);

      CREATE TABLE IF NOT EXISTS listings (
        source TEXT NOT NULL,
        external_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        url TEXT NOT NULL,
        image_urls_json TEXT NOT NULL,
        seller_json TEXT,
        price_amount REAL,
        price_currency TEXT,
        status TEXT,
        published_at TEXT,
        discovered_at TEXT NOT NULL,
        attributes_json TEXT,
        raw_json TEXT,
        PRIMARY KEY(source, external_id)
      );

      CREATE TABLE IF NOT EXISTS watch_seen_listings (
        watch_id TEXT NOT NULL,
        source TEXT NOT NULL,
        external_id TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        baseline INTEGER NOT NULL DEFAULT 0,
        matched INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(watch_id, source, external_id),
        FOREIGN KEY(watch_id) REFERENCES watches(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_seen_listing_identity ON watch_seen_listings(source, external_id);

      CREATE TABLE IF NOT EXISTS product_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        watch_id TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        state_json TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        is_baseline INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(watch_id) REFERENCES watches(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_product_snapshots_latest ON product_snapshots(watch_id, id DESC);

      CREATE TABLE IF NOT EXISTS similarity_matches (
        watch_id TEXT NOT NULL,
        source TEXT NOT NULL,
        external_id TEXT NOT NULL,
        score REAL NOT NULL,
        best_image_url TEXT,
        matched INTEGER NOT NULL DEFAULT 0,
        evaluated_at TEXT NOT NULL,
        PRIMARY KEY(watch_id, source, external_id),
        FOREIGN KEY(watch_id) REFERENCES watches(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_similarity_matches_watch ON similarity_matches(watch_id, score DESC);

      CREATE TABLE IF NOT EXISTS sensor_watches (
        radar_watch_id TEXT PRIMARY KEY,
        sensor_id TEXT NOT NULL UNIQUE,
        sensor_type TEXT NOT NULL,
        sensor_url TEXT,
        state TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(radar_watch_id) REFERENCES watches(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        event_key TEXT NOT NULL UNIQUE,
        watch_id TEXT NOT NULL,
        source TEXT NOT NULL,
        event_type TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        payload_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_watch ON events(watch_id, occurred_at DESC);

      CREATE TABLE IF NOT EXISTS notification_outbox (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        recipient TEXT NOT NULL,
        message_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        sent_at TEXT,
        UNIQUE(event_id, channel_id, recipient)
      );
      CREATE INDEX IF NOT EXISTS idx_notification_outbox_pending ON notification_outbox(status, created_at);

      CREATE TABLE IF NOT EXISTS poll_runs (
        id TEXT PRIMARY KEY,
        watch_id TEXT NOT NULL,
        sensor_id TEXT,
        trigger_key TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error TEXT,
        listings_count INTEGER,
        changes_count INTEGER,
        UNIQUE(watch_id, trigger_key)
      );
      CREATE INDEX IF NOT EXISTS idx_poll_runs_watch ON poll_runs(watch_id, started_at DESC);
    `);
  }

  transaction<T>(callback: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    }
  }

  createWatch(watch: Watch): void {
    this.db.prepare(`INSERT INTO watches
      (id, source, type, target_json, rules_json, enabled, interval_seconds, sensor_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(watch.id, watch.source, watch.type, JSON.stringify(watch.target), JSON.stringify(watch.rules), watch.enabled ? 1 : 0, watch.intervalSeconds, watch.sensorId ?? null, watch.createdAt, watch.updatedAt);
  }

  updateWatch(watch: Watch): void {
    this.db.prepare(`UPDATE watches SET source = ?, type = ?, target_json = ?, rules_json = ?, enabled = ?, interval_seconds = ?, sensor_id = ?, updated_at = ? WHERE id = ?`)
      .run(watch.source, watch.type, JSON.stringify(watch.target), JSON.stringify(watch.rules), watch.enabled ? 1 : 0, watch.intervalSeconds, watch.sensorId ?? null, watch.updatedAt, watch.id);
  }

  getWatch(id: string): Watch | undefined {
    const row = this.db.prepare('SELECT * FROM watches WHERE id = ?').get(id);
    return row ? rowToWatch(row) : undefined;
  }

  listWatches(): Watch[] {
    return this.db.prepare('SELECT * FROM watches ORDER BY created_at ASC, id ASC').all().map(rowToWatch);
  }

  deleteWatch(id: string): void {
    this.db.prepare('DELETE FROM watches WHERE id = ?').run(id);
  }

  upsertListing(listing: Listing): void {
    this.db.prepare(`INSERT INTO listings
      (source, external_id, title, description, url, image_urls_json, seller_json, price_amount, price_currency, status, published_at, discovered_at, attributes_json, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, external_id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        url = excluded.url,
        image_urls_json = excluded.image_urls_json,
        seller_json = excluded.seller_json,
        price_amount = excluded.price_amount,
        price_currency = excluded.price_currency,
        status = excluded.status,
        published_at = excluded.published_at,
        discovered_at = excluded.discovered_at,
        attributes_json = excluded.attributes_json,
        raw_json = excluded.raw_json`)
      .run(
        listing.source,
        listing.externalId,
        listing.title,
        listing.description ?? null,
        listing.url,
        JSON.stringify(listing.imageUrls),
        listing.seller === undefined ? null : JSON.stringify(listing.seller),
        listing.price?.amount ?? null,
        listing.price?.currency ?? null,
        listing.status ?? null,
        listing.publishedAt ?? null,
        listing.discoveredAt,
        listing.attributes === undefined ? null : JSON.stringify(listing.attributes),
        listing.raw === undefined ? null : JSON.stringify(listing.raw),
      );
  }

  getListing(source: string, externalId: string): Listing | undefined {
    const row = this.db.prepare('SELECT * FROM listings WHERE source = ? AND external_id = ?').get(source, externalId);
    if (!row) return undefined;
    const seller = row.seller_json === null ? undefined : jsonParse<Listing['seller'] | undefined>(row.seller_json, undefined);
    const priceAmount = row.price_amount === null ? undefined : Number(row.price_amount);
    const priceCurrency = optionalString(row.price_currency);
    const description = optionalString(row.description);
    const status = optionalString(row.status);
    const publishedAt = optionalString(row.published_at);
    const statusValue = status as Listing['status'] | undefined;
    return {
      source: String(row.source),
      externalId: String(row.external_id),
      title: String(row.title),
      ...(description === undefined ? {} : { description }),
      url: String(row.url),
      imageUrls: jsonParse<string[]>(row.image_urls_json, []),
      ...(seller === undefined ? {} : { seller }),
      ...(priceAmount === undefined || priceCurrency === undefined ? {} : { price: { amount: priceAmount, currency: priceCurrency } }),
      ...(statusValue === undefined ? {} : { status: statusValue }),
      ...(publishedAt === undefined ? {} : { publishedAt }),
      discoveredAt: String(row.discovered_at),
      ...(row.attributes_json === null ? {} : { attributes: jsonParse<Record<string, unknown>>(row.attributes_json, {}) }),
      ...(row.raw_json === null ? {} : { raw: jsonParse<unknown | undefined>(row.raw_json, undefined) }),
    };
  }

  hasSeenListing(watchId: string, source: string, externalId: string): boolean {
    const row = this.db.prepare('SELECT 1 AS present FROM watch_seen_listings WHERE watch_id = ? AND source = ? AND external_id = ?').get(watchId, source, externalId);
    return row !== undefined;
  }

  recordSeenListing(watchId: string, listing: Pick<Listing, 'source' | 'externalId'>, now: string, baseline: boolean, matched: boolean): boolean {
    const result = this.db.prepare(`INSERT OR IGNORE INTO watch_seen_listings
      (watch_id, source, external_id, first_seen_at, baseline, matched) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(watchId, listing.source, listing.externalId, now, baseline ? 1 : 0, matched ? 1 : 0);
    return integer(result.changes) > 0;
  }

  markSeenMatched(watchId: string, listing: Pick<Listing, 'source' | 'externalId'>): void {
    this.db.prepare('UPDATE watch_seen_listings SET matched = 1 WHERE watch_id = ? AND source = ? AND external_id = ?')
      .run(watchId, listing.source, listing.externalId);
  }

  insertProductSnapshot(watchId: string, state: Listing, fingerprint: string, capturedAt: string, isBaseline: boolean): ProductSnapshotRow {
    const result = this.db.prepare(`INSERT INTO product_snapshots
      (watch_id, captured_at, state_json, fingerprint, is_baseline) VALUES (?, ?, ?, ?, ?)`)
      .run(watchId, capturedAt, JSON.stringify(state), fingerprint, isBaseline ? 1 : 0);
    const id = String(result.lastInsertRowid ?? '');
    return { id, watchId, capturedAt, state, fingerprint, isBaseline };
  }

  getLatestProductSnapshot(watchId: string): ProductSnapshotRow | undefined {
    const row = this.db.prepare('SELECT * FROM product_snapshots WHERE watch_id = ? ORDER BY id DESC LIMIT 1').get(watchId);
    if (!row) return undefined;
    return {
      id: String(row.id),
      watchId: String(row.watch_id),
      capturedAt: String(row.captured_at),
      state: jsonParse<Listing>(row.state_json, {} as Listing),
      fingerprint: String(row.fingerprint),
      isBaseline: bool(row.is_baseline),
    };
  }

  recordSimilarityMatch(watchId: string, listing: Pick<Listing, 'source' | 'externalId'>, score: number, bestImageUrl: string | undefined, matched: boolean, evaluatedAt: string): void {
    this.db.prepare(`INSERT INTO similarity_matches
      (watch_id, source, external_id, score, best_image_url, matched, evaluated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(watch_id, source, external_id) DO UPDATE SET
        score = excluded.score,
        best_image_url = excluded.best_image_url,
        matched = excluded.matched,
        evaluated_at = excluded.evaluated_at`)
      .run(watchId, listing.source, listing.externalId, score, bestImageUrl ?? null, matched ? 1 : 0, evaluatedAt);
  }

  getSimilarityMatch(watchId: string, source: string, externalId: string): { score: number; bestImageUrl?: string; matched: boolean; evaluatedAt: string } | undefined {
    const row = this.db.prepare('SELECT * FROM similarity_matches WHERE watch_id = ? AND source = ? AND external_id = ?').get(watchId, source, externalId);
    if (!row) return undefined;
    return {
      score: Number(row.score),
      ...(optionalString(row.best_image_url) === undefined ? {} : { bestImageUrl: String(row.best_image_url) }),
      matched: bool(row.matched),
      evaluatedAt: String(row.evaluated_at),
    };
  }

  upsertSensorWatch(radarWatchId: string, sensorId: string, sensorType: string, sensorUrl: string, state: string, now: string): void {
    this.db.prepare(`INSERT INTO sensor_watches
      (radar_watch_id, sensor_id, sensor_type, sensor_url, state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(radar_watch_id) DO UPDATE SET sensor_id = excluded.sensor_id, sensor_type = excluded.sensor_type, sensor_url = excluded.sensor_url, state = excluded.state, updated_at = excluded.updated_at`)
      .run(radarWatchId, sensorId, sensorType, sensorUrl, state, now, now);
  }

  getSensorWatch(radarWatchId: string): { radarWatchId: string; sensorId: string; sensorType: string; sensorUrl?: string; state: string } | undefined {
    const row = this.db.prepare('SELECT * FROM sensor_watches WHERE radar_watch_id = ?').get(radarWatchId);
    if (!row) return undefined;
    return {
      radarWatchId: String(row.radar_watch_id),
      sensorId: String(row.sensor_id),
      sensorType: String(row.sensor_type),
      ...(optionalString(row.sensor_url) === undefined ? {} : { sensorUrl: String(row.sensor_url) }),
      state: String(row.state),
    };
  }

  updateSensorState(radarWatchId: string, state: string, now: string): void {
    this.db.prepare('UPDATE sensor_watches SET state = ?, updated_at = ? WHERE radar_watch_id = ?').run(state, now, radarWatchId);
  }

  insertEvent(event: RadarEvent): boolean {
    const result = this.db.prepare(`INSERT OR IGNORE INTO events
      (id, event_key, watch_id, source, event_type, before_json, after_json, payload_json, occurred_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(event.id, event.eventKey, event.watchId, event.source, event.type, event.before === null ? null : JSON.stringify(event.before), event.after === null ? null : JSON.stringify(event.after), JSON.stringify(event.payload), event.occurredAt, event.occurredAt);
    return integer(result.changes) > 0;
  }

  listEvents(watchId?: string): RadarEvent[] {
    const rows = watchId === undefined
      ? this.db.prepare('SELECT * FROM events ORDER BY occurred_at ASC, id ASC').all()
      : this.db.prepare('SELECT * FROM events WHERE watch_id = ? ORDER BY occurred_at ASC, id ASC').all(watchId);
    return rows.map((row) => ({
      id: String(row.id),
      eventKey: String(row.event_key),
      watchId: String(row.watch_id),
      source: String(row.source),
      type: String(row.event_type) as RadarEvent['type'],
      occurredAt: String(row.occurred_at),
      before: row.before_json === null ? null : jsonParse<unknown>(row.before_json, null),
      after: row.after_json === null ? null : jsonParse<unknown>(row.after_json, null),
      payload: jsonParse<Record<string, unknown>>(row.payload_json, {}),
    }));
  }

  enqueueNotification(event: RadarEvent, channel: NotificationChannel, message: NotificationMessage, now: string): boolean {
    const id = `${event.id}:${channel.id}:${channel.recipient}`;
    const result = this.db.prepare(`INSERT OR IGNORE INTO notification_outbox
      (id, event_id, channel_id, recipient, message_json, status, attempts, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', 0, ?)`)
      .run(id, event.id, channel.id, channel.recipient, JSON.stringify(message), now);
    return integer(result.changes) > 0;
  }

  listPendingNotifications(): NotificationOutboxRow[] {
    return this.db.prepare(`SELECT * FROM notification_outbox WHERE status IN ('pending', 'failed') ORDER BY created_at ASC, id ASC`).all().map((row) => ({
      id: String(row.id),
      eventId: String(row.event_id),
      channelId: String(row.channel_id),
      recipient: String(row.recipient),
      message: jsonParse<NotificationMessage>(row.message_json, { event: {} as RadarEvent, text: '', recipient: String(row.recipient) }),
      status: String(row.status) as NotificationOutboxRow['status'],
      attempts: Number(row.attempts),
      ...(optionalString(row.last_error) === undefined ? {} : { lastError: String(row.last_error) }),
      createdAt: String(row.created_at),
      ...(optionalString(row.sent_at) === undefined ? {} : { sentAt: String(row.sent_at) }),
    }));
  }

  markNotificationSent(id: string, now: string): void {
    this.db.prepare(`UPDATE notification_outbox SET status = 'sent', attempts = attempts + 1, last_error = NULL, sent_at = ? WHERE id = ?`).run(now, id);
  }

  markNotificationFailed(id: string, error: string): void {
    this.db.prepare(`UPDATE notification_outbox SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?`).run(error.slice(0, 1000), id);
  }

  beginPollRun(watchId: string, sensorId: string | undefined, triggerKey: string, now: string): PollRunResult | undefined {
    const id = `${watchId}:${triggerKey}`;
    const result = this.db.prepare(`INSERT OR IGNORE INTO poll_runs
      (id, watch_id, sensor_id, trigger_key, status, started_at) VALUES (?, ?, ?, ?, 'running', ?)`)
      .run(id, watchId, sensorId ?? null, triggerKey, now);
    if (integer(result.changes) === 0) return undefined;
    return { id, watchId, ...(sensorId === undefined ? {} : { sensorId }), triggerKey, status: 'running', startedAt: now };
  }

  finishPollRun(id: string, status: 'succeeded' | 'failed', now: string, details: { error?: string; listingsCount?: number; changesCount?: number } = {}): void {
    this.db.prepare('UPDATE poll_runs SET status = ?, finished_at = ?, error = ?, listings_count = ?, changes_count = ? WHERE id = ?')
      .run(status, now, details.error ?? null, details.listingsCount ?? null, details.changesCount ?? null, id);
  }

  listPollRuns(watchId?: string): PollRunResult[] {
    const rows = watchId === undefined
      ? this.db.prepare('SELECT * FROM poll_runs ORDER BY rowid ASC').all()
      : this.db.prepare('SELECT * FROM poll_runs WHERE watch_id = ? ORDER BY rowid ASC').all(watchId);
    return rows.map((row) => ({
      id: String(row.id),
      watchId: String(row.watch_id),
      ...(optionalString(row.sensor_id) === undefined ? {} : { sensorId: String(row.sensor_id) }),
      triggerKey: String(row.trigger_key),
      status: String(row.status) as PollRunResult['status'],
      startedAt: String(row.started_at),
      ...(optionalString(row.finished_at) === undefined ? {} : { finishedAt: String(row.finished_at) }),
      ...(optionalString(row.error) === undefined ? {} : { error: String(row.error) }),
      ...(row.listings_count === null ? {} : { listingsCount: Number(row.listings_count) }),
      ...(row.changes_count === null ? {} : { changesCount: Number(row.changes_count) }),
    }));
  }

  tableCounts(): Record<string, number> {
    const names = ['watches', 'listings', 'watch_seen_listings', 'product_snapshots', 'similarity_matches', 'sensor_watches', 'events', 'notification_outbox', 'poll_runs'];
    return Object.fromEntries(names.map((name) => [name, Number(this.db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get()?.count ?? 0)]));
  }

  close(): void {
    this.db.close();
  }
}
