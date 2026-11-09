import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import type { StoredPresence } from './domain.js';

type Row = Record<string, unknown>;
interface Statement { run(...args: unknown[]): unknown; get(...args: unknown[]): Row | undefined; all(...args: unknown[]): Row[] }
interface Database { exec(sql: string): void; prepare(sql: string): Statement; close(): void }

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => Database };

export interface SteamLink {
  /** Stable key of the WhatsApp sender, from the host's trusted sender metadata (never message text). */
  senderKey: string;
  steamId: string;
  personaName: string;
  personId?: string;
  /** Default on: a linked account is announced until the owner of the account turns it off. */
  broadcast: boolean;
  linkedAt: number;
}

export interface GroupSettings {
  groupId: string;
  enabled: boolean;
}

/**
 * Steam state (links, group switches, the presence ledger and the announcement log). Account links are mirrored into
 * the identity store's external_accounts when the sender is a known person, but this database is what the poller reads.
 */
export class SteamStore {
  private readonly db: Database;

  constructor(filename = ':memory:') {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS steam_links (
        sender_key TEXT PRIMARY KEY,
        steam_id TEXT NOT NULL UNIQUE,
        persona_name TEXT NOT NULL,
        person_id TEXT,
        broadcast INTEGER NOT NULL DEFAULT 1,
        linked_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS steam_group_members (
        group_id TEXT NOT NULL,
        sender_key TEXT NOT NULL REFERENCES steam_links(sender_key) ON DELETE CASCADE,
        PRIMARY KEY (group_id, sender_key)
      );
      CREATE TABLE IF NOT EXISTS steam_group_settings (
        group_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS steam_presence (
        steam_id TEXT PRIMARY KEY,
        record TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS steam_announcements (
        idempotency_key TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        sent_at INTEGER NOT NULL,
        outcome TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_steam_announcements_group ON steam_announcements(group_id, sent_at);
    `);
  }

  close(): void { this.db.close(); }

  private linkFrom(row: Row): SteamLink {
    return {
      senderKey: String(row.sender_key), steamId: String(row.steam_id), personaName: String(row.persona_name),
      ...(typeof row.person_id === 'string' ? { personId: row.person_id } : {}),
      broadcast: row.broadcast === 1, linkedAt: Number(row.linked_at),
    };
  }

  /** Rebinding the same sender replaces their account; a SteamID already held by another sender is a conflict. */
  link(input: { senderKey: string; steamId: string; personaName: string; personId?: string; now: number }): { status: 'linked' | 'conflict'; link?: SteamLink } {
    const holder = this.db.prepare('SELECT sender_key FROM steam_links WHERE steam_id = ?').get(input.steamId);
    if (holder && holder.sender_key !== input.senderKey) return { status: 'conflict' };
    const existing = this.linkBySender(input.senderKey);
    this.db.prepare(`INSERT INTO steam_links (sender_key, steam_id, persona_name, person_id, broadcast, linked_at) VALUES (?, ?, ?, ?, 1, ?)
      ON CONFLICT(sender_key) DO UPDATE SET steam_id = excluded.steam_id, persona_name = excluded.persona_name, person_id = excluded.person_id`)
      .run(input.senderKey, input.steamId, input.personaName, input.personId ?? null, input.now);
    if (existing && existing.steamId !== input.steamId) this.db.prepare('DELETE FROM steam_presence WHERE steam_id = ?').run(existing.steamId);
    return { status: 'linked', link: this.linkBySender(input.senderKey)! };
  }

  unlink(senderKey: string): boolean {
    const link = this.linkBySender(senderKey);
    if (!link) return false;
    this.db.prepare('DELETE FROM steam_group_members WHERE sender_key = ?').run(senderKey);
    this.db.prepare('DELETE FROM steam_links WHERE sender_key = ?').run(senderKey);
    this.db.prepare('DELETE FROM steam_presence WHERE steam_id = ?').run(link.steamId);
    return true;
  }

  linkBySender(senderKey: string): SteamLink | undefined {
    const row = this.db.prepare('SELECT * FROM steam_links WHERE sender_key = ?').get(senderKey);
    return row ? this.linkFrom(row) : undefined;
  }

  linkByPerson(personId: string): SteamLink | undefined {
    const row = this.db.prepare('SELECT * FROM steam_links WHERE person_id = ? ORDER BY linked_at LIMIT 1').get(personId);
    return row ? this.linkFrom(row) : undefined;
  }

  linkBySteamId(steamId: string): SteamLink | undefined {
    const row = this.db.prepare('SELECT * FROM steam_links WHERE steam_id = ?').get(steamId);
    return row ? this.linkFrom(row) : undefined;
  }

  setBroadcast(senderKey: string, enabled: boolean): boolean {
    const changed = this.db.prepare('UPDATE steam_links SET broadcast = ? WHERE sender_key = ?').run(enabled ? 1 : 0, senderKey) as { changes?: number };
    return (changed.changes ?? 0) > 0;
  }

  enroll(groupId: string, senderKey: string): void {
    this.db.prepare('INSERT OR IGNORE INTO steam_group_members (group_id, sender_key) VALUES (?, ?)').run(groupId, senderKey);
  }

  leaveGroup(groupId: string, senderKey: string): void {
    this.db.prepare('DELETE FROM steam_group_members WHERE group_id = ? AND sender_key = ?').run(groupId, senderKey);
  }

  setGroup(groupId: string, enabled: boolean): void {
    this.db.prepare('INSERT INTO steam_group_settings (group_id, enabled) VALUES (?, ?) ON CONFLICT(group_id) DO UPDATE SET enabled = excluded.enabled').run(groupId, enabled ? 1 : 0);
  }

  groupEnabled(groupId: string): boolean {
    return this.db.prepare('SELECT enabled FROM steam_group_settings WHERE group_id = ?').get(groupId)?.enabled === 1;
  }

  enabledGroups(): GroupSettings[] {
    return this.db.prepare('SELECT group_id, enabled FROM steam_group_settings WHERE enabled = 1 ORDER BY group_id').all().map((row) => ({ groupId: String(row.group_id), enabled: true }));
  }

  /** Links announced in a group: enrolled in it and not switched off by their owner. */
  broadcastMembers(groupId: string): SteamLink[] {
    return this.db.prepare(`SELECT l.* FROM steam_links l JOIN steam_group_members m ON m.sender_key = l.sender_key WHERE m.group_id = ? AND l.broadcast = 1 ORDER BY l.linked_at`)
      .all(groupId).map((row) => this.linkFrom(row));
  }

  groupsOf(senderKey: string): string[] {
    return this.db.prepare('SELECT group_id FROM steam_group_members WHERE sender_key = ?').all(senderKey).map((row) => String(row.group_id));
  }

  /** Every SteamID that some enabled group may announce: what the poller needs to watch. */
  watchedSteamIds(): string[] {
    return this.db.prepare(`SELECT DISTINCT l.steam_id FROM steam_links l JOIN steam_group_members m ON m.sender_key = l.sender_key
      JOIN steam_group_settings g ON g.group_id = m.group_id AND g.enabled = 1 WHERE l.broadcast = 1`).all().map((row) => String(row.steam_id));
  }

  presence(steamId: string): StoredPresence | undefined {
    const row = this.db.prepare('SELECT record FROM steam_presence WHERE steam_id = ?').get(steamId);
    if (!row) return undefined;
    try { return JSON.parse(String(row.record)) as StoredPresence; } catch { return undefined; }
  }

  savePresence(steamId: string, record: StoredPresence): void {
    this.db.prepare('INSERT INTO steam_presence (steam_id, record) VALUES (?, ?) ON CONFLICT(steam_id) DO UPDATE SET record = excluded.record').run(steamId, JSON.stringify(record));
  }

  announcedInLastHour(groupId: string, now: number): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM steam_announcements WHERE group_id = ? AND outcome = 'sent' AND sent_at > ?`).get(groupId, now - 3_600_000);
    return Number(row?.n ?? 0);
  }

  alreadyAnnounced(key: string): boolean {
    return this.db.prepare('SELECT 1 AS x FROM steam_announcements WHERE idempotency_key = ?').get(key) !== undefined;
  }

  recordAnnouncement(key: string, groupId: string, now: number, outcome: 'sent' | 'compose_failed' | 'send_failed'): void {
    this.db.prepare('INSERT OR REPLACE INTO steam_announcements (idempotency_key, group_id, sent_at, outcome) VALUES (?, ?, ?, ?)').run(key, groupId, now, outcome);
  }
}
