import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
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

/** The old schema allowed one account per sender (sender_key was the primary key); copy the file aside before changing it. */
function backUpBeforeMigration(filename: string): void {
  if (!existsSync(filename)) return;
  let old = false;
  try {
    const probe = new DatabaseSync(filename);
    old = /sender_key\s+TEXT\s+PRIMARY\s+KEY/iu.test(String(probe.prepare(`SELECT sql FROM sqlite_master WHERE name = 'steam_links'`).get()?.sql ?? ''));
    if (old) probe.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    probe.close();
  } catch { return; }
  if (!old) return;
  const dir = join(dirname(filename), 'backups');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/gu, '').replace(/\..*/u, '');
  copyFileSync(filename, join(dir, `${basename(filename)}.before-multi-account-${stamp}`));
}

/**
 * Steam state (links, group switches, the presence ledger and the announcement log). Account links are mirrored into
 * the identity store's external_accounts when the sender is a known person, but this database is what the poller reads.
 */
export class SteamStore {
  private readonly db: Database;

  constructor(filename = ':memory:') {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    if (filename !== ':memory:') backUpBeforeMigration(filename);
    this.db = new DatabaseSync(filename);
    this.migrateSingleAccountSchema();
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS steam_links (
        steam_id TEXT PRIMARY KEY,
        sender_key TEXT NOT NULL,
        persona_name TEXT NOT NULL,
        person_id TEXT,
        broadcast INTEGER NOT NULL DEFAULT 1,
        linked_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_steam_links_sender ON steam_links(sender_key);
      CREATE INDEX IF NOT EXISTS idx_steam_links_person ON steam_links(person_id);
      CREATE TABLE IF NOT EXISTS steam_group_members (
        group_id TEXT NOT NULL,
        sender_key TEXT NOT NULL,
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

  /** One-time upgrade from "one account per sender" to many accounts per person; rows and group lists are kept as they are. */
  private migrateSingleAccountSchema(): void {
    const sql = String(this.db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'steam_links'`).get()?.sql ?? '');
    if (!/sender_key\s+TEXT\s+PRIMARY\s+KEY/iu.test(sql)) return;
    this.db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN IMMEDIATE;
      ALTER TABLE steam_links RENAME TO steam_links_old;
      ALTER TABLE steam_group_members RENAME TO steam_group_members_old;
      CREATE TABLE steam_links (
        steam_id TEXT PRIMARY KEY,
        sender_key TEXT NOT NULL,
        persona_name TEXT NOT NULL,
        person_id TEXT,
        broadcast INTEGER NOT NULL DEFAULT 1,
        linked_at INTEGER NOT NULL
      );
      INSERT INTO steam_links (steam_id, sender_key, persona_name, person_id, broadcast, linked_at)
        SELECT steam_id, sender_key, persona_name, person_id, broadcast, linked_at FROM steam_links_old;
      CREATE TABLE steam_group_members (group_id TEXT NOT NULL, sender_key TEXT NOT NULL, PRIMARY KEY (group_id, sender_key));
      INSERT INTO steam_group_members (group_id, sender_key) SELECT group_id, sender_key FROM steam_group_members_old;
      DROP TABLE steam_group_members_old;
      DROP TABLE steam_links_old;
      COMMIT;
      PRAGMA foreign_keys = ON;
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

  /** Adds an account (never replaces another one). A SteamID held under a different sender key is a conflict. */
  link(input: { senderKey: string; steamId: string; personaName: string; personId?: string; now: number }): { status: 'linked' | 'conflict'; link?: SteamLink } {
    const holder = this.linkBySteamId(input.steamId);
    if (holder && holder.senderKey !== input.senderKey) return { status: 'conflict' };
    this.db.prepare(`INSERT INTO steam_links (steam_id, sender_key, persona_name, person_id, broadcast, linked_at) VALUES (?, ?, ?, ?, 1, ?)
      ON CONFLICT(steam_id) DO UPDATE SET persona_name = excluded.persona_name, person_id = COALESCE(excluded.person_id, steam_links.person_id)`)
      .run(input.steamId, input.senderKey, input.personaName, input.personId ?? null, input.now);
    return { status: 'linked', link: this.linkBySteamId(input.steamId)! };
  }

  /** Removes one account, or every account of the sender when no SteamID is given. Returns how many were removed. */
  unlink(senderKey: string, steamId?: string): number {
    const links = this.linksBySender(senderKey).filter((link) => !steamId || link.steamId === steamId);
    for (const link of links) {
      this.db.prepare('DELETE FROM steam_links WHERE steam_id = ?').run(link.steamId);
      this.db.prepare('DELETE FROM steam_presence WHERE steam_id = ?').run(link.steamId);
    }
    if (links.length && this.linksBySender(senderKey).length === 0) this.db.prepare('DELETE FROM steam_group_members WHERE sender_key = ?').run(senderKey);
    return links.length;
  }

  linksBySender(senderKey: string): SteamLink[] {
    return this.db.prepare('SELECT * FROM steam_links WHERE sender_key = ? ORDER BY linked_at, steam_id').all(senderKey).map((row) => this.linkFrom(row));
  }

  linksByPerson(personId: string): SteamLink[] {
    return this.db.prepare('SELECT * FROM steam_links WHERE person_id = ? ORDER BY linked_at, steam_id').all(personId).map((row) => this.linkFrom(row));
  }

  linkBySteamId(steamId: string): SteamLink | undefined {
    const row = this.db.prepare('SELECT * FROM steam_links WHERE steam_id = ?').get(steamId);
    return row ? this.linkFrom(row) : undefined;
  }

  setBroadcast(steamId: string, enabled: boolean): boolean {
    const changed = this.db.prepare('UPDATE steam_links SET broadcast = ? WHERE steam_id = ?').run(enabled ? 1 : 0, steamId) as { changes?: number };
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
    // No row means the default: announcements are on until the owner switches the group off.
    return this.db.prepare('SELECT enabled FROM steam_group_settings WHERE group_id = ?').get(groupId)?.enabled !== 0;
  }

  /**
   * Enrols every linked person of `personIds` in the group, except those who switched their own announcements off.
   * Returns how many were newly added.
   */
  enrollPeople(groupId: string, personIds: string[]): number {
    let added = 0;
    for (const personId of new Set(personIds)) {
      for (const row of this.db.prepare('SELECT DISTINCT sender_key FROM steam_links WHERE person_id = ? AND broadcast = 1').all(personId)) {
        const changed = this.db.prepare('INSERT OR IGNORE INTO steam_group_members (group_id, sender_key) VALUES (?, ?)').run(groupId, String(row.sender_key)) as { changes?: number };
        added += changed.changes ?? 0;
      }
    }
    return added;
  }

  /** How many accounts the same person (or, without a person, the same sender) has linked. */
  accountCount(link: SteamLink): number {
    return link.personId ? this.linksByPerson(link.personId).length : this.linksBySender(link.senderKey).length;
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
      LEFT JOIN steam_group_settings g ON g.group_id = m.group_id WHERE l.broadcast = 1 AND COALESCE(g.enabled, 1) = 1`).all().map((row) => String(row.steam_id));
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
