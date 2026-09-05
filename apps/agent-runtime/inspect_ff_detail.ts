import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { DEFAULT_TEAM } from './src/config/team.js';
import type { NormalizedMatch, NormalizedPlayer } from './src/data/model.js';
import { normalizeTelemetryEvents } from './src/review/telemetry-events.js';
const fixturePath = process.env.PUBG_REAL_MATCH_FIXTURE;
if (!fixturePath) throw new Error('Set PUBG_REAL_MATCH_FIXTURE to a local telemetry fixture.');
const raw = JSON.parse(gunzipSync(readFileSync(fixturePath)).toString('utf8')) as unknown;
const ids = new Set(DEFAULT_TEAM.players.map(p => p.id));
const canon = (v: string | null) => {
  if (!v) return v;
  const low = v.toLowerCase();
  const p = DEFAULT_TEAM.players.find(x => x.id.toLowerCase() === low || x.name.toLowerCase() === low || x.aliases.some(a => a.toLowerCase() === low));
  return p ? p.id : v;
};
const match: NormalizedMatch = {
  schemaVersion: 3, matchId: 'm', shard: 'steam', createdAt: '2026-09-02T13:10:29Z', timestamp: 1,
  matchType: 'competitive', gameMode: 'squad', isCompetitive: true, mapName: 'x', duration: 100, patchVersion: '',
  players: DEFAULT_TEAM.players.map((c): NormalizedPlayer => ({ accountId: c.id, playerName: c.name, displayName: c.name, rank: null, kills: 0, assists: 0, damage: 0, dbnos: 0, revives: 0, headshotKills: 0, survivalTime: 0, longestKill: 0, deaths: 1, deathSemantics: 'explicit' })),
};
const events = normalizeTelemetryEvents(raw, match);
let meleeHits = 0, teamDamageEvents = 0, punchEvents = 0, vehicleFf = 0;
const samples: unknown[] = [];
for (const e of events) {
  const a = canon(e.actorId), v = canon(e.victimId);
  const w = (e.weaponId ?? e.itemId ?? '').toLowerCase();
  const c = (e.damageTypeCategory ?? '').toLowerCase();
  const isPunch = /fist|punch|barehand|unarmed/.test(w) || /damage[_-]?punch/.test(c) || /playermale|playerfemale/.test(w) && /melee|punch/.test(c);
  const isMeleeish = /fist|punch|pan|pickaxe|sickle|crowbar|machete|melee/.test(w) || /damage[_-]?melee/.test(c);
  if (e.type === 'DAMAGE' && a && v && a !== v && ids.has(a) && ids.has(v)) {
    teamDamageEvents++;
    if (isPunch) punchEvents++;
    if (isMeleeish) meleeHits++;
    if (samples.length < 20) samples.push({ id: e.id, a, v, w, c, dmg: e.damage, hit: e.hit, raw: e.rawType, attack: e.attackId, phase: e.phase });
  }
  if (e.type !== 'DAMAGE' && (e.type === 'KNOCK' || e.type === 'KILL') && a && v && a !== v && ids.has(a) && ids.has(v)) {
    teamDamageEvents++;
    if (samples.length < 20) samples.push({ id: e.id, a, v, w, c, raw: e.rawType, phase: e.phase });
  }
}
console.log('team-vs-team hit/knock/kill count:', teamDamageEvents);
console.log('punch events:', punchEvents, 'melee-ish hits:', meleeHits);
console.log('samples:', JSON.stringify(samples, null, 2));
