import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import type { Listing } from '../core/listing/model.js';
import type { RadarEvent } from '../core/events/events.js';
import type { NotificationChannel, NotificationMessage } from '../core/notification/ports.js';
import type { Watch, WatchRules, WatchTarget, ImplementedWatchType } from '../core/watch/model.js';
import type { FeedListingEvent, SearchFeed, WatchFeedSubscription } from '../core/search/model.js';
import type { TargetProfile } from '../core/target-profile/model.js';
import type { UsageLedgerEntry, UsageSummary, WatchRuntimeRunMetrics, WatchRuntimeStats, WatchRuntimeStatus } from '../core/observability/model.js';

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

export interface HeartbeatDeliveryRow {
  id: string;
  watchId: string;
  periodKey: string;
  channelId: string;
  recipient: string;
  message: NotificationMessage;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  lastError?: string;
  createdAt: string;
  sentAt?: string;
}


export interface FeedRunResult {
  id: string;
  feedId: string;
  triggerKey: string;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: string;
  finishedAt?: string;
  error?: string;
  listingsCount?: number;
  changesCount?: number;
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

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function rowToWatch(row: Record<string, unknown>): Watch {
  const sensorId = optionalString(row.sensor_id);
  const persistedTarget = jsonParse<WatchTarget & { targetProfile?: TargetProfile; searchPlan?: Watch['searchPlan'] }>(row.target_json, {});
  const { targetProfile, searchPlan, ...target } = persistedTarget;
  return {
    id: String(row.id),
    source: String(row.source),
    type: String(row.type) as ImplementedWatchType,
    target,
    rules: jsonParse<WatchRules>(row.rules_json, {} as WatchRules),
    enabled: bool(row.enabled),
    intervalSeconds: Number(row.interval_seconds),
    heartbeatEnabled: row.heartbeat_enabled === undefined ? row.type === 'similarity' : bool(row.heartbeat_enabled),
    heartbeatIntervalSeconds: Number(row.heartbeat_interval_seconds ?? 86_400),
    ...(sensorId === undefined ? {} : { sensorId }),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ...(targetProfile === undefined ? {} : { targetProfile }),
    ...(searchPlan === undefined ? {} : { searchPlan }),
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
        heartbeat_enabled INTEGER NOT NULL DEFAULT 1,
        heartbeat_interval_seconds INTEGER NOT NULL DEFAULT 86400,
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

      CREATE TABLE IF NOT EXISTS target_profiles (
        watch_id TEXT PRIMARY KEY,
        profile_json TEXT NOT NULL,
        provider TEXT NOT NULL,
        extracted_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(watch_id) REFERENCES watches(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS search_feeds (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        target TEXT NOT NULL,
        query TEXT NOT NULL,
        canonical_key TEXT NOT NULL UNIQUE,
        interval_seconds INTEGER NOT NULL,
        jitter_seconds INTEGER NOT NULL DEFAULT 120,
        sensor_watch_id TEXT UNIQUE,
        state TEXT NOT NULL DEFAULT 'ACTIVE',
        run_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        last_run_at TEXT,
        last_success_at TEXT,
        last_error TEXT,
        current_backoff INTEGER NOT NULL DEFAULT 0,
        last_successful_run_at TEXT,
        watermark TEXT,
        failure_count INTEGER NOT NULL DEFAULT 0,
        degraded_reason TEXT,
        potential_candidate_gap INTEGER NOT NULL DEFAULT 0,
        backoff_until TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_search_feeds_state ON search_feeds(state);

      CREATE TABLE IF NOT EXISTS watch_feed_subscriptions (
        watch_id TEXT NOT NULL,
        feed_id TEXT NOT NULL,
        start_after_event_id TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY(watch_id, feed_id),
        FOREIGN KEY(watch_id) REFERENCES watches(id) ON DELETE CASCADE,
        FOREIGN KEY(feed_id) REFERENCES search_feeds(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_feed_subscriptions_feed ON watch_feed_subscriptions(feed_id);

      CREATE TABLE IF NOT EXISTS feed_listing_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        feed_id TEXT NOT NULL,
        source TEXT NOT NULL,
        external_id TEXT NOT NULL,
        listing_identity TEXT NOT NULL,
        listing_json TEXT NOT NULL,
        discovered_at TEXT NOT NULL,
        UNIQUE(feed_id, source, external_id),
        FOREIGN KEY(feed_id) REFERENCES search_feeds(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_feed_events_feed_sequence ON feed_listing_events(feed_id, sequence ASC);

      CREATE TABLE IF NOT EXISTS search_feed_runs (
        id TEXT PRIMARY KEY,
        feed_id TEXT NOT NULL,
        trigger_key TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error TEXT,
        listings_count INTEGER,
        changes_count INTEGER,
        UNIQUE(feed_id, trigger_key),
        FOREIGN KEY(feed_id) REFERENCES search_feeds(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_search_feed_runs_feed ON search_feed_runs(feed_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS watch_runtime_stats (
        watch_id TEXT PRIMARY KEY,
        feed_runs INTEGER NOT NULL DEFAULT 0,
        successful_runs INTEGER NOT NULL DEFAULT 0,
        failed_runs INTEGER NOT NULL DEFAULT 0,
        new_listings INTEGER NOT NULL DEFAULT 0,
        candidates_processed INTEGER NOT NULL DEFAULT 0,
        image_comparisons INTEGER NOT NULL DEFAULT 0,
        above_threshold INTEGER NOT NULL DEFAULT 0,
        notifications_sent INTEGER NOT NULL DEFAULT 0,
        best_score REAL,
        last_run_at TEXT,
        last_success_at TEXT,
        last_error_at TEXT,
        last_error TEXT,
        status TEXT NOT NULL DEFAULT 'HEALTHY',
        FOREIGN KEY(watch_id) REFERENCES watches(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS watch_runtime_runs (
        id TEXT PRIMARY KEY,
        watch_id TEXT NOT NULL,
        feed_id TEXT,
        run_type TEXT NOT NULL,
        trigger_key TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error TEXT,
        new_listings INTEGER NOT NULL DEFAULT 0,
        candidates_processed INTEGER NOT NULL DEFAULT 0,
        image_comparisons INTEGER NOT NULL DEFAULT 0,
        above_threshold INTEGER NOT NULL DEFAULT 0,
        best_score REAL,
        UNIQUE(watch_id, run_type, trigger_key, feed_id),
        FOREIGN KEY(watch_id) REFERENCES watches(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_watch_runtime_runs_watch_time ON watch_runtime_runs(watch_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS usage_ledger (
        id TEXT PRIMARY KEY,
        watch_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        operation TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        timestamp TEXT NOT NULL,
        inference_count INTEGER NOT NULL DEFAULT 0,
        images_processed INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER,
        FOREIGN KEY(watch_id) REFERENCES watches(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_usage_ledger_watch_time ON usage_ledger(watch_id, timestamp DESC);

      CREATE TABLE IF NOT EXISTS heartbeat_deliveries (
        id TEXT PRIMARY KEY,
        watch_id TEXT NOT NULL,
        period_key TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        recipient TEXT NOT NULL,
        message_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        sent_at TEXT,
        UNIQUE(watch_id, period_key, channel_id, recipient),
        FOREIGN KEY(watch_id) REFERENCES watches(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_heartbeat_deliveries_pending ON heartbeat_deliveries(status, created_at);

      CREATE TABLE IF NOT EXISTS watch_contexts (
        context_key TEXT PRIMARY KEY,
        watch_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(watch_id) REFERENCES watches(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_watch_contexts_watch ON watch_contexts(watch_id);
    `);

    this.ensureColumn('watches', 'heartbeat_enabled', 'INTEGER NOT NULL DEFAULT 1');
    this.ensureColumn('watches', 'heartbeat_interval_seconds', 'INTEGER NOT NULL DEFAULT 86400');
    this.ensureColumn('search_feeds', 'run_count', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('search_feeds', 'success_count', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('search_feeds', 'last_run_at', 'TEXT');
    this.ensureColumn('search_feeds', 'last_success_at', 'TEXT');
    this.ensureColumn('search_feeds', 'last_error', 'TEXT');
    this.ensureColumn('search_feeds', 'current_backoff', 'INTEGER NOT NULL DEFAULT 0');
    this.db.exec('INSERT OR IGNORE INTO watch_runtime_stats (watch_id) SELECT id FROM watches');
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((item) => String(item.name) === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
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

  private persistedTarget(watch: Watch): WatchTarget {
    return {
      ...watch.target,
      ...(watch.targetProfile === undefined ? {} : { targetProfile: watch.targetProfile }),
      ...(watch.searchPlan === undefined ? {} : { searchPlan: watch.searchPlan }),
    };
  }

  createWatch(watch: Watch): void {
    this.db.prepare(`INSERT INTO watches
      (id, source, type, target_json, rules_json, enabled, interval_seconds, heartbeat_enabled, heartbeat_interval_seconds, sensor_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(watch.id, watch.source, watch.type, JSON.stringify(this.persistedTarget(watch)), JSON.stringify(watch.rules), watch.enabled ? 1 : 0, watch.intervalSeconds, watch.heartbeatEnabled ? 1 : 0, watch.heartbeatIntervalSeconds, watch.sensorId ?? null, watch.createdAt, watch.updatedAt);
    this.ensureWatchRuntimeStats(watch.id);
    if (watch.targetProfile) this.upsertTargetProfile(watch.id, watch.targetProfile, watch.updatedAt);
  }

  updateWatch(watch: Watch): void {
    this.db.prepare(`UPDATE watches SET source = ?, type = ?, target_json = ?, rules_json = ?, enabled = ?, interval_seconds = ?, heartbeat_enabled = ?, heartbeat_interval_seconds = ?, sensor_id = ?, updated_at = ? WHERE id = ?`)
      .run(watch.source, watch.type, JSON.stringify(this.persistedTarget(watch)), JSON.stringify(watch.rules), watch.enabled ? 1 : 0, watch.intervalSeconds, watch.heartbeatEnabled ? 1 : 0, watch.heartbeatIntervalSeconds, watch.sensorId ?? null, watch.updatedAt, watch.id);
    this.ensureWatchRuntimeStats(watch.id);
    if (watch.targetProfile) this.upsertTargetProfile(watch.id, watch.targetProfile, watch.updatedAt);
  }

  ensureWatchRuntimeStats(watchId: string, status: WatchRuntimeStatus = 'HEALTHY'): void {
    this.db.prepare(`INSERT OR IGNORE INTO watch_runtime_stats (watch_id, status) VALUES (?, ?)`).run(watchId, status);
  }

  getWatchRuntimeStats(watchId: string): WatchRuntimeStats {
    this.ensureWatchRuntimeStats(watchId);
    const row = this.db.prepare('SELECT * FROM watch_runtime_stats WHERE watch_id = ?').get(watchId);
    if (!row) throw new Error(`watch runtime stats missing: ${watchId}`);
    return {
      watchId,
      feedRuns: Number(row.feed_runs ?? 0),
      successfulRuns: Number(row.successful_runs ?? 0),
      failedRuns: Number(row.failed_runs ?? 0),
      newListings: Number(row.new_listings ?? 0),
      candidatesProcessed: Number(row.candidates_processed ?? 0),
      imageComparisons: Number(row.image_comparisons ?? 0),
      aboveThreshold: Number(row.above_threshold ?? 0),
      notificationsSent: Number(row.notifications_sent ?? 0),
      bestScore: numberOrNull(row.best_score),
      ...(optionalString(row.last_run_at) === undefined ? {} : { lastRunAt: String(row.last_run_at) }),
      ...(optionalString(row.last_success_at) === undefined ? {} : { lastSuccessAt: String(row.last_success_at) }),
      ...(optionalString(row.last_error_at) === undefined ? {} : { lastErrorAt: String(row.last_error_at) }),
      ...(optionalString(row.last_error) === undefined ? {} : { lastError: String(row.last_error) }),
      status: String(row.status ?? 'HEALTHY') as WatchRuntimeStatus,
    };
  }

  beginWatchRuntimeRun(watchId: string, runType: 'feed' | 'poll', triggerKey: string, startedAt: string, feedId?: string): string {
    this.ensureWatchRuntimeStats(watchId);
    const id = `${watchId}:${runType}:${feedId ?? ''}:${triggerKey}`;
    const result = this.db.prepare(`INSERT OR IGNORE INTO watch_runtime_runs
      (id, watch_id, feed_id, run_type, trigger_key, status, started_at)
      VALUES (?, ?, ?, ?, ?, 'running', ?)`).run(id, watchId, feedId ?? null, runType, triggerKey, startedAt);
    if (integer(result.changes) === 0) return id;
    if (runType === 'feed') {
      this.db.prepare(`UPDATE watch_runtime_stats SET feed_runs = feed_runs + 1, last_run_at = ? WHERE watch_id = ?`).run(startedAt, watchId);
    } else {
      this.db.prepare(`UPDATE watch_runtime_stats SET last_run_at = ? WHERE watch_id = ?`).run(startedAt, watchId);
    }
    return id;
  }

  finishWatchRuntimeRun(id: string, watchId: string, status: 'succeeded' | 'failed', finishedAt: string, metrics: WatchRuntimeRunMetrics = {}, error?: string, runtimeStatus: WatchRuntimeStatus = status === 'succeeded' ? 'HEALTHY' : 'DEGRADED'): void {
    const values = {
      newListings: metrics.newListings ?? 0,
      candidatesProcessed: metrics.candidatesProcessed ?? 0,
      imageComparisons: metrics.imageComparisons ?? 0,
      aboveThreshold: metrics.aboveThreshold ?? 0,
      bestScore: metrics.bestScore ?? null,
    };
    const runUpdate = this.db.prepare(`UPDATE watch_runtime_runs SET status = ?, finished_at = ?, error = ?, new_listings = ?, candidates_processed = ?, image_comparisons = ?, above_threshold = ?, best_score = ? WHERE id = ? AND status = 'running'`)
      .run(status, finishedAt, error ?? null, values.newListings, values.candidatesProcessed, values.imageComparisons, values.aboveThreshold, values.bestScore, id);
    if (integer(runUpdate.changes) === 0) return;
    if (status === 'succeeded') {
      this.db.prepare(`UPDATE watch_runtime_stats SET successful_runs = successful_runs + 1, new_listings = new_listings + ?, candidates_processed = candidates_processed + ?, image_comparisons = image_comparisons + ?, above_threshold = above_threshold + ?, best_score = CASE WHEN best_score IS NULL OR (? IS NOT NULL AND ? > best_score) THEN ? ELSE best_score END, last_success_at = ?, last_error_at = NULL, last_error = NULL, status = ? WHERE watch_id = ?`)
        .run(values.newListings, values.candidatesProcessed, values.imageComparisons, values.aboveThreshold, values.bestScore, values.bestScore, values.bestScore, finishedAt, runtimeStatus, watchId);
    } else {
      this.db.prepare(`UPDATE watch_runtime_stats SET failed_runs = failed_runs + 1, last_error_at = ?, last_error = ?, status = ? WHERE watch_id = ?`)
        .run(finishedAt, error ?? 'watch run failed', runtimeStatus, watchId);
    }
  }

  setWatchRuntimeStatus(watchId: string, status: WatchRuntimeStatus): void {
    this.ensureWatchRuntimeStats(watchId);
    this.db.prepare('UPDATE watch_runtime_stats SET status = ? WHERE watch_id = ?').run(status, watchId);
  }

  incrementWatchNotifications(watchId: string, count = 1): void {
    this.ensureWatchRuntimeStats(watchId);
    this.db.prepare('UPDATE watch_runtime_stats SET notifications_sent = notifications_sent + ? WHERE watch_id = ?').run(count, watchId);
  }

  listWatchRuntimeRunsSince(watchId: string, since: string): Array<{ status: string; startedAt: string; newListings: number; candidatesProcessed: number; imageComparisons: number; aboveThreshold: number; bestScore: number | null }> {
    return this.db.prepare(`SELECT status, started_at, new_listings, candidates_processed, image_comparisons, above_threshold, best_score
      FROM watch_runtime_runs WHERE watch_id = ? AND started_at >= ? ORDER BY started_at ASC`).all(watchId, since).map((row) => ({
      status: String(row.status), startedAt: String(row.started_at), newListings: Number(row.new_listings ?? 0), candidatesProcessed: Number(row.candidates_processed ?? 0), imageComparisons: Number(row.image_comparisons ?? 0), aboveThreshold: Number(row.above_threshold ?? 0), bestScore: numberOrNull(row.best_score),
    }));
  }

  recordUsage(entry: Omit<UsageLedgerEntry, 'id'> & { id?: string }): UsageLedgerEntry {
    const id = entry.id ?? randomUUID();
    this.db.prepare(`INSERT OR IGNORE INTO usage_ledger
      (id, watch_id, provider, model, operation, input_tokens, output_tokens, total_tokens, timestamp, inference_count, images_processed, latency_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, entry.watchId, entry.provider, entry.model, entry.operation, entry.inputTokens, entry.outputTokens, entry.totalTokens, entry.timestamp, entry.inferenceCount, entry.imagesProcessed, entry.latencyMs ?? null);
    return { ...entry, id };
  }

  summarizeUsage(watchId: string): UsageSummary {
    const row = this.db.prepare(`SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(inference_count), 0) AS inference_count, COALESCE(SUM(images_processed), 0) AS images_processed, COALESCE(SUM(latency_ms), 0) AS latency_ms FROM usage_ledger WHERE watch_id = ?`).get(watchId);
    return { calls: Number(row?.calls ?? 0), inputTokens: Number(row?.input_tokens ?? 0), outputTokens: Number(row?.output_tokens ?? 0), totalTokens: Number(row?.total_tokens ?? 0), inferenceCount: Number(row?.inference_count ?? 0), imagesProcessed: Number(row?.images_processed ?? 0), latencyMs: Number(row?.latency_ms ?? 0) };
  }

  listUsage(watchId: string): UsageLedgerEntry[] {
    return this.db.prepare('SELECT * FROM usage_ledger WHERE watch_id = ? ORDER BY timestamp ASC, id ASC').all(watchId).map((row) => ({
      id: String(row.id), watchId: String(row.watch_id), provider: String(row.provider), model: String(row.model), operation: String(row.operation), inputTokens: Number(row.input_tokens ?? 0), outputTokens: Number(row.output_tokens ?? 0), totalTokens: Number(row.total_tokens ?? 0), timestamp: String(row.timestamp), inferenceCount: Number(row.inference_count ?? 0), imagesProcessed: Number(row.images_processed ?? 0), ...(row.latency_ms === null ? {} : { latencyMs: Number(row.latency_ms) }),
    }));
  }

  upsertTargetProfile(watchId: string, profile: TargetProfile, now: string): void {
    this.db.prepare(`INSERT INTO target_profiles (watch_id, profile_json, provider, extracted_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(watch_id) DO UPDATE SET profile_json = excluded.profile_json, provider = excluded.provider, extracted_at = excluded.extracted_at, updated_at = excluded.updated_at`)
      .run(watchId, JSON.stringify(profile), profile.provider, profile.extractedAt, now);
  }

  getTargetProfile(watchId: string): TargetProfile | undefined {
    const row = this.db.prepare('SELECT profile_json FROM target_profiles WHERE watch_id = ?').get(watchId);
    return row ? jsonParse<TargetProfile | undefined>(row.profile_json, undefined) : undefined;
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

  setWatchContext(contextKey: string, watchId: string, now: string): void {
    this.db.prepare(`INSERT INTO watch_contexts (context_key, watch_id, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(context_key) DO UPDATE SET watch_id = excluded.watch_id, updated_at = excluded.updated_at`)
      .run(contextKey, watchId, now, now);
  }

  getWatchContext(contextKey: string): string | undefined {
    const row = this.db.prepare('SELECT watch_id FROM watch_contexts WHERE context_key = ?').get(contextKey);
    return optionalString(row?.watch_id);
  }

  clearWatchContext(contextKey: string, watchId?: string): void {
    if (watchId === undefined) this.db.prepare('DELETE FROM watch_contexts WHERE context_key = ?').run(contextKey);
    else this.db.prepare('DELETE FROM watch_contexts WHERE context_key = ? AND watch_id = ?').run(contextKey, watchId);
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

  listSeenListings(watchId: string): Array<{ source: string; externalId: string; firstSeenAt: string; baseline: boolean; matched: boolean }> {
    return this.db.prepare('SELECT * FROM watch_seen_listings WHERE watch_id = ? ORDER BY first_seen_at ASC, external_id ASC').all(watchId).map((row) => ({
      source: String(row.source), externalId: String(row.external_id), firstSeenAt: String(row.first_seen_at), baseline: bool(row.baseline), matched: bool(row.matched),
    }));
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
    const row = this.db.prepare(`SELECT e.watch_id AS watch_id
      FROM notification_outbox n JOIN events e ON e.id = n.event_id WHERE n.id = ?`).get(id);
    const result = this.db.prepare(`UPDATE notification_outbox SET status = 'sent', attempts = attempts + 1, last_error = NULL, sent_at = ? WHERE id = ? AND status IN ('pending', 'failed')`).run(now, id);
    if (integer(result.changes) > 0 && row?.watch_id !== undefined) this.incrementWatchNotifications(String(row.watch_id));
  }

  markNotificationFailed(id: string, error: string): void {
    this.db.prepare(`UPDATE notification_outbox SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?`).run(error.slice(0, 1000), id);
  }

  enqueueHeartbeat(watchId: string, periodKey: string, channel: NotificationChannel, message: NotificationMessage, now: string): boolean {
    const id = `${watchId}:${periodKey}:${channel.id}:${channel.recipient}`;
    const result = this.db.prepare(`INSERT OR IGNORE INTO heartbeat_deliveries
      (id, watch_id, period_key, channel_id, recipient, message_json, status, attempts, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?)`).run(id, watchId, periodKey, channel.id, channel.recipient, JSON.stringify(message), now);
    return integer(result.changes) > 0;
  }

  listPendingHeartbeats(): HeartbeatDeliveryRow[] {
    return this.db.prepare(`SELECT * FROM heartbeat_deliveries WHERE status IN ('pending', 'failed') ORDER BY created_at ASC, id ASC`).all().map((row) => ({
      id: String(row.id), watchId: String(row.watch_id), periodKey: String(row.period_key), channelId: String(row.channel_id), recipient: String(row.recipient),
      message: jsonParse<NotificationMessage>(row.message_json, { event: {} as RadarEvent, text: '', recipient: String(row.recipient) }),
      status: String(row.status) as HeartbeatDeliveryRow['status'], attempts: Number(row.attempts),
      ...(optionalString(row.last_error) === undefined ? {} : { lastError: String(row.last_error) }), createdAt: String(row.created_at),
      ...(optionalString(row.sent_at) === undefined ? {} : { sentAt: String(row.sent_at) }),
    }));
  }

  markHeartbeatSent(id: string, now: string): void {
    const row = this.db.prepare('SELECT watch_id FROM heartbeat_deliveries WHERE id = ?').get(id);
    const result = this.db.prepare(`UPDATE heartbeat_deliveries SET status = 'sent', attempts = attempts + 1, last_error = NULL, sent_at = ? WHERE id = ? AND status IN ('pending', 'failed')`).run(now, id);
    if (integer(result.changes) > 0 && row?.watch_id !== undefined) this.incrementWatchNotifications(String(row.watch_id));
  }

  markHeartbeatFailed(id: string, error: string): void {
    this.db.prepare(`UPDATE heartbeat_deliveries SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?`).run(error.slice(0, 1000), id);
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


  createSearchFeed(feed: SearchFeed): void {
    this.db.prepare(`INSERT INTO search_feeds
      (id, source, target, query, canonical_key, interval_seconds, jitter_seconds, sensor_watch_id, state, run_count, success_count, last_run_at, last_success_at, last_error, current_backoff, last_successful_run_at, watermark, failure_count, degraded_reason, potential_candidate_gap, backoff_until, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(feed.id, feed.source, feed.target, feed.query, feed.canonicalKey, feed.intervalSeconds, feed.jitterSeconds, feed.sensorWatchId ?? null, feed.state, feed.runCount, feed.successCount, feed.lastRunAt ?? null, feed.lastSuccessAt ?? null, feed.lastError ?? null, feed.currentBackoff, feed.lastSuccessfulRunAt ?? null, feed.watermark ?? null, feed.failureCount, feed.degradedReason ?? null, feed.potentialCandidateGap ? 1 : 0, feed.backoffUntil ?? null, feed.createdAt, feed.updatedAt);
  }

  updateSearchFeed(feed: SearchFeed): void {
    this.db.prepare(`UPDATE search_feeds SET source = ?, target = ?, query = ?, canonical_key = ?, interval_seconds = ?, jitter_seconds = ?, sensor_watch_id = ?, state = ?, run_count = ?, success_count = ?, last_run_at = ?, last_success_at = ?, last_error = ?, current_backoff = ?, last_successful_run_at = ?, watermark = ?, failure_count = ?, degraded_reason = ?, potential_candidate_gap = ?, backoff_until = ?, updated_at = ? WHERE id = ?`)
      .run(feed.source, feed.target, feed.query, feed.canonicalKey, feed.intervalSeconds, feed.jitterSeconds, feed.sensorWatchId ?? null, feed.state, feed.runCount, feed.successCount, feed.lastRunAt ?? null, feed.lastSuccessAt ?? null, feed.lastError ?? null, feed.currentBackoff, feed.lastSuccessfulRunAt ?? null, feed.watermark ?? null, feed.failureCount, feed.degradedReason ?? null, feed.potentialCandidateGap ? 1 : 0, feed.backoffUntil ?? null, feed.updatedAt, feed.id);
  }

  getSearchFeed(id: string): SearchFeed | undefined {
    const row = this.db.prepare('SELECT * FROM search_feeds WHERE id = ?').get(id);
    return row ? this.rowToSearchFeed(row) : undefined;
  }

  findSearchFeed(source: string, canonicalKey: string): SearchFeed | undefined {
    const row = this.db.prepare('SELECT * FROM search_feeds WHERE source = ? AND canonical_key = ?').get(source, canonicalKey);
    return row ? this.rowToSearchFeed(row) : undefined;
  }

  listSearchFeeds(): SearchFeed[] {
    return this.db.prepare('SELECT * FROM search_feeds ORDER BY created_at ASC, id ASC').all().map((row) => this.rowToSearchFeed(row));
  }

  deleteSearchFeed(id: string): void {
    this.db.prepare('DELETE FROM search_feeds WHERE id = ?').run(id);
  }

  private rowToSearchFeed(row: Record<string, unknown>): SearchFeed {
    const optional = (value: unknown): string | undefined => optionalString(value);
    return {
      id: String(row.id), source: String(row.source), target: String(row.target), query: String(row.query), canonicalKey: String(row.canonical_key),
      intervalSeconds: Number(row.interval_seconds), jitterSeconds: Number(row.jitter_seconds),
      ...(optional(row.sensor_watch_id) === undefined ? {} : { sensorWatchId: String(row.sensor_watch_id) }),
      state: String(row.state) as SearchFeed['state'],
      runCount: Number(row.run_count ?? 0),
      successCount: Number(row.success_count ?? 0),
      ...(optional(row.last_run_at) === undefined ? {} : { lastRunAt: String(row.last_run_at) }),
      ...(optional(row.last_success_at) === undefined ? {} : { lastSuccessAt: String(row.last_success_at) }),
      ...(optional(row.last_error) === undefined ? {} : { lastError: String(row.last_error) }),
      currentBackoff: Number(row.current_backoff ?? 0),
      ...(optional(row.last_successful_run_at) === undefined ? {} : { lastSuccessfulRunAt: String(row.last_successful_run_at) }),
      ...(optional(row.watermark) === undefined ? {} : { watermark: String(row.watermark) }),
      failureCount: Number(row.failure_count),
      ...(optional(row.degraded_reason) === undefined ? {} : { degradedReason: String(row.degraded_reason) }),
      potentialCandidateGap: bool(row.potential_candidate_gap),
      ...(optional(row.backoff_until) === undefined ? {} : { backoffUntil: String(row.backoff_until) }),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }

  upsertWatchFeedSubscription(subscription: WatchFeedSubscription): void {
    this.db.prepare(`INSERT INTO watch_feed_subscriptions (watch_id, feed_id, start_after_event_id, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(watch_id, feed_id) DO UPDATE SET start_after_event_id = excluded.start_after_event_id`)
      .run(subscription.watchId, subscription.feedId, subscription.startAfterEventId ?? null, subscription.createdAt);
  }

  getWatchFeedSubscription(watchId: string, feedId: string): WatchFeedSubscription | undefined {
    const row = this.db.prepare('SELECT * FROM watch_feed_subscriptions WHERE watch_id = ? AND feed_id = ?').get(watchId, feedId);
    if (!row) return undefined;
    return { watchId: String(row.watch_id), feedId: String(row.feed_id), ...(optionalString(row.start_after_event_id) === undefined ? {} : { startAfterEventId: String(row.start_after_event_id) }), createdAt: String(row.created_at) };
  }

  listWatchFeedSubscriptions(filters: { watchId?: string; feedId?: string } = {}): WatchFeedSubscription[] {
    if (filters.watchId !== undefined && filters.feedId !== undefined) {
      const row = this.getWatchFeedSubscription(filters.watchId, filters.feedId);
      return row ? [row] : [];
    }
    const rows = filters.watchId !== undefined
      ? this.db.prepare('SELECT * FROM watch_feed_subscriptions WHERE watch_id = ? ORDER BY feed_id ASC').all(filters.watchId)
      : filters.feedId !== undefined
        ? this.db.prepare('SELECT * FROM watch_feed_subscriptions WHERE feed_id = ? ORDER BY watch_id ASC').all(filters.feedId)
        : this.db.prepare('SELECT * FROM watch_feed_subscriptions ORDER BY watch_id ASC, feed_id ASC').all();
    return rows.map((row) => ({ watchId: String(row.watch_id), feedId: String(row.feed_id), ...(optionalString(row.start_after_event_id) === undefined ? {} : { startAfterEventId: String(row.start_after_event_id) }), createdAt: String(row.created_at) }));
  }

  deleteWatchFeedSubscription(watchId: string, feedId: string): void {
    this.db.prepare('DELETE FROM watch_feed_subscriptions WHERE watch_id = ? AND feed_id = ?').run(watchId, feedId);
  }

  countFeedSubscribers(feedId: string): number {
    return integer(this.db.prepare('SELECT COUNT(*) AS count FROM watch_feed_subscriptions WHERE feed_id = ?').get(feedId)?.count as number | bigint | undefined);
  }

  insertFeedListingEvent(feedId: string, listing: Listing, discoveredAt: string): FeedListingEvent | undefined {
    const eventId = `${feedId}:${listing.source}:${listing.externalId}`;
    const result = this.db.prepare(`INSERT OR IGNORE INTO feed_listing_events
      (event_id, feed_id, source, external_id, listing_identity, listing_json, discovered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(eventId, feedId, listing.source, listing.externalId, `${listing.source}:${listing.externalId}`, JSON.stringify(listing), discoveredAt);
    if (integer(result.changes) === 0) return undefined;
    return { eventId, feedId, source: listing.source, externalId: listing.externalId, listingIdentity: `${listing.source}:${listing.externalId}`, discoveredAt };
  }

  getFeedListingEvent(eventId: string): { event: FeedListingEvent; listing: Listing; sequence: number } | undefined {
    const row = this.db.prepare('SELECT * FROM feed_listing_events WHERE event_id = ?').get(eventId);
    if (!row) return undefined;
    return { event: { eventId: String(row.event_id), feedId: String(row.feed_id), source: String(row.source), externalId: String(row.external_id), listingIdentity: String(row.listing_identity), discoveredAt: String(row.discovered_at) }, listing: jsonParse<Listing>(row.listing_json, {} as Listing), sequence: Number(row.sequence) };
  }

  getLatestFeedListingEvent(feedId: string): FeedListingEvent | undefined {
    const row = this.db.prepare('SELECT * FROM feed_listing_events WHERE feed_id = ? ORDER BY sequence DESC LIMIT 1').get(feedId);
    if (!row) return undefined;
    return { eventId: String(row.event_id), feedId: String(row.feed_id), source: String(row.source), externalId: String(row.external_id), listingIdentity: String(row.listing_identity), discoveredAt: String(row.discovered_at) };
  }

  hasFeedListing(feedId: string, source: string, externalId: string): boolean {
    return this.db.prepare('SELECT 1 AS present FROM feed_listing_events WHERE feed_id = ? AND source = ? AND external_id = ?').get(feedId, source, externalId) !== undefined;
  }

  listFeedListingEventsAfter(feedId: string, startAfterEventId?: string): Array<{ event: FeedListingEvent; listing: Listing }> {
    const boundary = startAfterEventId ? this.getFeedListingEvent(startAfterEventId) : undefined;
    const rows = boundary
      ? this.db.prepare('SELECT * FROM feed_listing_events WHERE feed_id = ? AND sequence > ? ORDER BY sequence ASC').all(feedId, boundary.sequence)
      : this.db.prepare('SELECT * FROM feed_listing_events WHERE feed_id = ? ORDER BY sequence ASC').all(feedId);
    return rows.map((row) => ({ event: { eventId: String(row.event_id), feedId: String(row.feed_id), source: String(row.source), externalId: String(row.external_id), listingIdentity: String(row.listing_identity), discoveredAt: String(row.discovered_at) }, listing: jsonParse<Listing>(row.listing_json, {} as Listing) }));
  }

  beginFeedRun(feedId: string, triggerKey: string, now: string): FeedRunResult | undefined {
    const id = `${feedId}:${triggerKey}`;
    const result = this.db.prepare(`INSERT OR IGNORE INTO search_feed_runs (id, feed_id, trigger_key, status, started_at) VALUES (?, ?, ?, 'running', ?)`).run(id, feedId, triggerKey, now);
    if (integer(result.changes) === 0) return undefined;
    this.db.prepare('UPDATE search_feeds SET run_count = run_count + 1, last_run_at = ?, updated_at = ? WHERE id = ?').run(now, now, feedId);
    return { id, feedId, triggerKey, status: 'running', startedAt: now };
  }

  finishFeedRun(id: string, status: 'succeeded' | 'failed', now: string, details: { error?: string; listingsCount?: number; changesCount?: number } = {}): void {
    const row = this.db.prepare('SELECT feed_id FROM search_feed_runs WHERE id = ?').get(id);
    const result = this.db.prepare('UPDATE search_feed_runs SET status = ?, finished_at = ?, error = ?, listings_count = ?, changes_count = ? WHERE id = ? AND status = \'running\'').run(status, now, details.error ?? null, details.listingsCount ?? null, details.changesCount ?? null, id);
    if (integer(result.changes) === 0 || row?.feed_id === undefined) return;
    const feedId = String(row.feed_id);
    if (status === 'succeeded') {
      this.db.prepare(`UPDATE search_feeds SET success_count = success_count + 1, last_success_at = ?, last_successful_run_at = ?, last_error = NULL, current_backoff = 0, updated_at = ? WHERE id = ?`).run(now, now, now, feedId);
    } else {
      this.db.prepare('UPDATE search_feeds SET last_error = ?, updated_at = ? WHERE id = ?').run(details.error ?? 'feed run failed', now, feedId);
    }
  }

  tableCounts(): Record<string, number> {
    const names = ['watches', 'listings', 'watch_seen_listings', 'product_snapshots', 'similarity_matches', 'sensor_watches', 'events', 'notification_outbox', 'poll_runs', 'target_profiles', 'search_feeds', 'watch_feed_subscriptions', 'feed_listing_events', 'search_feed_runs', 'watch_runtime_stats', 'watch_runtime_runs', 'usage_ledger', 'heartbeat_deliveries', 'watch_contexts'];
    return Object.fromEntries(names.map((name) => [name, Number(this.db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get()?.count ?? 0)]));
  }

  close(): void {
    this.db.close();
  }
}
