import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import type { Coverage, SourceInfo } from '../schema/status.js';
import type { NormalizedMatch, NormalizedPlayer, ResultSetRecord, SessionContextRecord } from '../data/model.js';
import { normalizeRecords } from '../data/model.js';
import type { TelemetryFeatureKey, TelemetryFeatureRecord, TelemetryFeatureStore } from '../review/telemetry.js';

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

export interface MatchWriteMetadata {
  fetchedAt?: string;
  source?: string;
  parserVersion?: string;
  rawJson?: unknown;
  checkedPlayerIds?: string[];
}

export interface UpsertMatchesResult {
  inserted: number;
  updated: number;
  duplicateInputs: number;
  invalidInputs: number;
}

export interface SyncState {
  key: string;
  checkedAt: string;
  coverage: Coverage;
  source: SourceInfo;
  discoveredMatchIds: string[];
  failedMatchIds: string[];
  error?: string;
}

function numeric(value: unknown, fallback = 0): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function jsonValue<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToPlayer(row: Record<string, unknown>): NormalizedPlayer {
  return {
    accountId: String(row.account_id),
    playerName: String(row.player_name ?? row.account_id),
    displayName: String(row.display_name ?? row.player_name ?? row.account_id),
    rank: nullableNumber(row.rank),
    kills: numeric(row.kills),
    assists: numeric(row.assists),
    damage: numeric(row.damage),
    dbnos: numeric(row.dbnos),
    revives: numeric(row.revives),
    headshotKills: numeric(row.headshot_kills),
    survivalTime: numeric(row.survival_time),
    longestKill: numeric(row.longest_kill),
    deaths: nullableNumber(row.deaths),
    deathSemantics: String(row.death_semantics ?? 'unknown') as NormalizedPlayer['deathSemantics'],
  };
}

function rowToMatch(row: Record<string, unknown>, players: NormalizedPlayer[]): NormalizedMatch {
  return {
    schemaVersion: numeric(row.schema_version, 3),
    matchId: String(row.match_id),
    shard: String(row.shard ?? 'steam'),
    createdAt: row.created_at === null || row.created_at === undefined ? null : String(row.created_at),
    timestamp: numeric(row.timestamp_ms),
    matchType: String(row.match_type ?? ''),
    gameMode: String(row.game_mode ?? ''),
    isCompetitive: bool(row.is_competitive),
    mapName: String(row.map_name ?? ''),
    duration: numeric(row.duration),
    patchVersion: String(row.patch_version ?? ''),
    players,
    telemetryUrl: row.telemetry_url ? String(row.telemetry_url) : null,
  };
}

function keyForFeature(key: TelemetryFeatureKey): string {
  return key.matchId + ':' + key.parserVersion + ':' + key.featureVersion;
}

export class SqlitePubgRepository implements TelemetryFeatureStore {
  readonly db: SqliteDatabase;

  constructor(readonly filename = ':memory:') {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
    this.migrate();
  }

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS matches (
        match_id TEXT PRIMARY KEY,
        shard TEXT NOT NULL,
        created_at TEXT,
        timestamp_ms INTEGER NOT NULL,
        match_type TEXT NOT NULL,
        game_mode TEXT NOT NULL,
        is_competitive INTEGER NOT NULL,
        map_name TEXT NOT NULL,
        duration REAL NOT NULL,
        patch_version TEXT NOT NULL,
        telemetry_url TEXT,
        schema_version INTEGER NOT NULL,
        parser_version TEXT,
        fetched_at TEXT NOT NULL,
        source TEXT NOT NULL,
        checked_player_ids_json TEXT NOT NULL DEFAULT '[]',
        raw_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pubg_matches_timestamp ON matches(timestamp_ms DESC);
      CREATE INDEX IF NOT EXISTS idx_pubg_matches_mode_map ON matches(game_mode, map_name);

      CREATE TABLE IF NOT EXISTS match_players (
        match_id TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
        account_id TEXT NOT NULL,
        player_name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        rank REAL,
        kills REAL NOT NULL,
        assists REAL NOT NULL,
        damage REAL NOT NULL,
        dbnos REAL NOT NULL,
        revives REAL NOT NULL,
        headshot_kills REAL NOT NULL,
        survival_time REAL NOT NULL,
        longest_kill REAL NOT NULL,
        deaths REAL,
        death_semantics TEXT NOT NULL,
        PRIMARY KEY(match_id, account_id)
      );
      CREATE INDEX IF NOT EXISTS idx_pubg_match_players_account ON match_players(account_id, match_id);

      CREATE TABLE IF NOT EXISTS sync_state (
        state_key TEXT PRIMARY KEY,
        checked_at TEXT NOT NULL,
        state_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS telemetry_features (
        match_id TEXT NOT NULL,
        parser_version TEXT NOT NULL,
        feature_version TEXT NOT NULL,
        facts_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(match_id, parser_version, feature_version)
      );

      CREATE TABLE IF NOT EXISTS result_sets (
        session_id TEXT NOT NULL,
        result_set_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        result_json TEXT NOT NULL,
        PRIMARY KEY(session_id, result_set_id)
      );
      CREATE INDEX IF NOT EXISTS idx_pubg_result_sets_expiry ON result_sets(expires_at);

      CREATE TABLE IF NOT EXISTS session_contexts (
        session_id TEXT PRIMARY KEY,
        expires_at TEXT NOT NULL,
        context_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS migration_runs (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        report_json TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  countMatches(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM matches').get();
    return numeric(row?.count);
  }

  getMatch(matchId: string): NormalizedMatch | null {
    const row = this.db.prepare('SELECT * FROM matches WHERE match_id = ?').get(matchId);
    if (!row) return null;
    const players = this.db.prepare('SELECT * FROM match_players WHERE match_id = ? ORDER BY account_id').all(matchId).map(rowToPlayer);
    return rowToMatch(row, players);
  }

  listMatches(options: { fromMs?: number; toMs?: number; limit?: number } = {}): NormalizedMatch[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.fromMs !== undefined) {
      clauses.push('timestamp_ms >= ?');
      params.push(options.fromMs);
    }
    if (options.toMs !== undefined) {
      clauses.push('timestamp_ms < ?');
      params.push(options.toMs);
    }
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 10000), 1), 10000);
    params.push(limit);
    const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
    const rows = this.db.prepare('SELECT * FROM matches' + where + ' ORDER BY timestamp_ms ASC, match_id ASC LIMIT ?').all(...params);
    const players = this.db.prepare('SELECT * FROM match_players').all();
    const byMatch = new Map<string, NormalizedPlayer[]>();
    for (const player of players) {
      const id = String(player.match_id);
      const bucket = byMatch.get(id) ?? [];
      bucket.push(rowToPlayer(player));
      byMatch.set(id, bucket);
    }
    return rows.map((row) => rowToMatch(row, byMatch.get(String(row.match_id)) ?? []));
  }

  upsertMatches(input: unknown[], metadata: MatchWriteMetadata = {}): UpsertMatchesResult {
    const normalizedInputs = input.flatMap((item) => normalizeRecords([item]));
    const records = normalizeRecords(input).filter((match) => match.matchId && Number.isFinite(match.timestamp));
    const duplicateInputs = Math.max(0, normalizedInputs.length - records.length);
    const invalidInputs = Math.max(0, input.length - normalizedInputs.length);
    const unique = records;
    const now = metadata.fetchedAt ?? new Date().toISOString();
    let inserted = 0;
    let updated = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const match of unique) {
        const existing = this.db.prepare('SELECT match_id FROM matches WHERE match_id = ?').get(match.matchId);
        this.db.prepare(`
          INSERT INTO matches (
            match_id, shard, created_at, timestamp_ms, match_type, game_mode,
            is_competitive, map_name, duration, patch_version, telemetry_url,
            schema_version, parser_version, fetched_at, source, checked_player_ids_json, raw_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(match_id) DO UPDATE SET
            shard=excluded.shard, created_at=excluded.created_at, timestamp_ms=excluded.timestamp_ms,
            match_type=excluded.match_type, game_mode=excluded.game_mode,
            is_competitive=excluded.is_competitive, map_name=excluded.map_name,
            duration=excluded.duration, patch_version=excluded.patch_version,
            telemetry_url=excluded.telemetry_url, schema_version=excluded.schema_version,
            parser_version=excluded.parser_version, fetched_at=excluded.fetched_at,
            source=excluded.source, checked_player_ids_json=excluded.checked_player_ids_json,
            raw_json=excluded.raw_json
        `).run(
          match.matchId,
          match.shard,
          match.createdAt,
          match.timestamp,
          match.matchType,
          match.gameMode,
          match.isCompetitive ? 1 : 0,
          match.mapName,
          match.duration,
          match.patchVersion,
          match.telemetryUrl ?? null,
          match.schemaVersion,
          metadata.parserVersion ?? null,
          now,
          metadata.source ?? 'unknown',
          JSON.stringify(metadata.checkedPlayerIds ?? match.players.map((player) => player.accountId)),
          metadata.rawJson === undefined ? null : JSON.stringify(metadata.rawJson),
        );
        this.db.prepare('DELETE FROM match_players WHERE match_id = ?').run(match.matchId);
        const playerStatement = this.db.prepare(`
          INSERT INTO match_players (
            match_id, account_id, player_name, display_name, rank, kills, assists,
            damage, dbnos, revives, headshot_kills, survival_time, longest_kill,
            deaths, death_semantics
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const player of match.players) {
          playerStatement.run(
            match.matchId,
            player.accountId,
            player.playerName,
            player.displayName,
            player.rank,
            player.kills,
            player.assists,
            player.damage,
            player.dbnos,
            player.revives,
            player.headshotKills,
            player.survivalTime,
            player.longestKill,
            player.deaths,
            player.deathSemantics,
          );
        }
        if (existing) updated += 1;
        else inserted += 1;
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { inserted, updated, duplicateInputs, invalidInputs };
  }

  setSyncState(state: SyncState): void {
    this.db.prepare(`
      INSERT INTO sync_state(state_key, checked_at, state_json) VALUES (?, ?, ?)
      ON CONFLICT(state_key) DO UPDATE SET checked_at=excluded.checked_at, state_json=excluded.state_json
    `).run(state.key, state.checkedAt, JSON.stringify(state));
  }

  getSyncState(key: string): SyncState | null {
    const row = this.db.prepare('SELECT state_json FROM sync_state WHERE state_key = ?').get(key);
    return row ? jsonValue<SyncState | null>(row.state_json, null) : null;
  }

  async get(key: TelemetryFeatureKey): Promise<TelemetryFeatureRecord | null> {
    const row = this.db.prepare(`
      SELECT facts_json, created_at FROM telemetry_features
      WHERE match_id = ? AND parser_version = ? AND feature_version = ?
    `).get(key.matchId, key.parserVersion, key.featureVersion);
    if (!row) return null;
    const facts = jsonValue<unknown>(row.facts_json, null);
    if (!facts || typeof facts !== 'object') return null;
    return {
      ...key,
      facts: facts as TelemetryFeatureRecord['facts'],
      createdAt: String(row.created_at),
    };
  }

  async set(record: TelemetryFeatureRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO telemetry_features(match_id, parser_version, feature_version, facts_json, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(match_id, parser_version, feature_version) DO UPDATE SET
        facts_json=excluded.facts_json, created_at=excluded.created_at
    `).run(record.matchId, record.parserVersion, record.featureVersion, JSON.stringify(record.facts), record.createdAt);
  }

  setResultSet(result: ResultSetRecord): void {
    this.db.prepare(`
      INSERT INTO result_sets(session_id, result_set_id, expires_at, result_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id, result_set_id) DO UPDATE SET
        expires_at=excluded.expires_at, result_json=excluded.result_json
    `).run(result.sessionId, result.id, result.expiresAt, JSON.stringify(result));
  }

  getResultSet(sessionId: string, resultSetId: string, now = new Date()): ResultSetRecord | null {
    const row = this.db.prepare('SELECT expires_at, result_json FROM result_sets WHERE session_id = ? AND result_set_id = ?').get(sessionId, resultSetId);
    if (!row || Date.parse(String(row.expires_at)) <= now.getTime()) return null;
    return jsonValue<ResultSetRecord | null>(row.result_json, null);
  }

  setContext(context: SessionContextRecord): void {
    this.db.prepare(`
      INSERT INTO session_contexts(session_id, expires_at, context_json)
      VALUES (?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        expires_at=excluded.expires_at, context_json=excluded.context_json
    `).run(context.sessionId, context.expiresAt, JSON.stringify(context));
  }

  getContext(sessionId: string, now = new Date()): SessionContextRecord | null {
    const row = this.db.prepare('SELECT expires_at, context_json FROM session_contexts WHERE session_id = ?').get(sessionId);
    if (!row || Date.parse(String(row.expires_at)) <= now.getTime()) return null;
    return jsonValue<SessionContextRecord | null>(row.context_json, null);
  }

  cleanupExpired(now = new Date()): void {
    const iso = now.toISOString();
    this.db.prepare('DELETE FROM result_sets WHERE expires_at <= ?').run(iso);
    this.db.prepare('DELETE FROM session_contexts WHERE expires_at <= ?').run(iso);
  }

  recordMigration(id: string, source: string, report: unknown, startedAt: string, finishedAt: string): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO migration_runs(id, source, started_at, finished_at, report_json) VALUES (?, ?, ?, ?, ?)',
    ).run(id, source, startedAt, finishedAt, JSON.stringify(report));
  }

  getMigration(id: string): Record<string, unknown> | null {
    const row = this.db.prepare('SELECT * FROM migration_runs WHERE id = ?').get(id);
    return row ?? null;
  }

  snapshot(): { matches: number; players: number; features: number; resultSets: number; contexts: number } {
    const count = (table: string): number => numeric(this.db.prepare('SELECT COUNT(*) AS count FROM ' + table).get()?.count);
    return {
      matches: count('matches'),
      players: count('match_players'),
      features: count('telemetry_features'),
      resultSets: count('result_sets'),
      contexts: count('session_contexts'),
    };
  }
}
