import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { DEFAULT_TEAM } from './src/config/team.js';
import type { NormalizedMatch, NormalizedPlayer } from './src/data/model.js';
import { normalizeTelemetryEvents } from './src/review/telemetry-events.js';
const fixturePath = process.env.PUBG_REAL_MATCH_FIXTURE;
if (!fixturePath) throw new Error('Set PUBG_REAL_MATCH_FIXTURE to a local telemetry fixture.');
const raw = JSON.parse(gunzipSync(readFileSync(fixturePath)).toString('utf8')) as unknown;
const canon = (v: string | null) => {
  if (!v) return v;
  const low = v.toLowerCase();
  const p = DEFAULT_TEAM.players.find(x => x.id.toLowerCase() === low || x.name.toLowerCase() === low || x.aliases.some(a => a.toLowerCase() === low));
  return p ? p.id : v;
};
const ids = new Set(DEFAULT_TEAM.players.map(p => p.id));
const match: NormalizedMatch = {
  schemaVersion: 3, matchId: 'm', shard: 'steam', createdAt: '2026-09-02T13:10:29Z', timestamp: 1,
  matchType: 'competitive', gameMode: 'squad', isCompetitive: true, mapName: 'x', duration: 100, patchVersion: '',
  players: DEFAULT_TEAM.players.map((c): NormalizedPlayer => ({ accountId: c.id, playerName: c.name, displayName: c.name, rank: null, kills: 0, assists: 0, damage: 0, dbnos: 0, revives: 0, headshotKills: 0, survivalTime: 0, longestKill: 0, deaths: 1, deathSemantics: 'explicit' })),
};
const events = normalizeTelemetryEvents(raw, match);
let count = 0;
for (const e of events) {
  if (e.phase !== 'pre_match') continue;
  const a = canon(e.actorId), v = canon(e.victimId);
  if (!a || !v || a === v || !ids.has(a) || !ids.has(v)) continue;
  console.log(e.type, a, '->', v, 'weapon:', e.weaponId ?? e.itemId, 'dmgCat:', e.damageTypeCategory, 'raw:', e.rawType);
  count++;
}
console.log('pre_match team-vs-team events:', count);
