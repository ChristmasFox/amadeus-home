import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SteamStore } from '../src/steam/store.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => { exec(sql: string): void; close(): void } };

test('an old one-account-per-sender database is backed up, upgraded in place and keeps its rows and group lists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'steam-store-'));
  const file = join(dir, 'steam.sqlite');
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE steam_links (sender_key TEXT PRIMARY KEY, steam_id TEXT NOT NULL UNIQUE, persona_name TEXT NOT NULL, person_id TEXT, broadcast INTEGER NOT NULL DEFAULT 1, linked_at INTEGER NOT NULL);
    CREATE TABLE steam_group_members (group_id TEXT NOT NULL, sender_key TEXT NOT NULL REFERENCES steam_links(sender_key) ON DELETE CASCADE, PRIMARY KEY (group_id, sender_key));
    INSERT INTO steam_links VALUES ('whatsapp:1', '76561190000000001', 'Old', 'p1', 1, 5);
    INSERT INTO steam_group_members VALUES ('g@g.us', 'whatsapp:1');
  `);
  old.close();
  const store = new SteamStore(file);
  assert.deepEqual(store.linksBySender('whatsapp:1').map((link) => [link.steamId, link.personaName, link.personId]), [['76561190000000001', 'Old', 'p1']]);
  assert.equal(store.broadcastMembers('g@g.us').length, 1);
  store.link({ senderKey: 'whatsapp:1', steamId: '76561190000000002', personaName: 'Second', personId: 'p1', now: 6 });
  assert.equal(store.linksByPerson('p1').length, 2);
  store.close();
  assert.equal(existsSync(join(dir, 'backups')), true);
  assert.equal(readdirSync(join(dir, 'backups')).filter((name) => name.includes('before-multi-account')).length, 1);
  new SteamStore(file).close(); // already upgraded: no second backup
  assert.equal(readdirSync(join(dir, 'backups')).length, 1);
});
