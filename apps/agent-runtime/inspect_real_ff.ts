import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { DEFAULT_TEAM } from './src/config/team.js';
import type { NormalizedMatch, NormalizedPlayer } from './src/data/model.js';
import { extractMatchReviewFacts } from './src/review/review-facts.js';
import { normalizeTelemetryEvents } from './src/review/telemetry-events.js';
import { isPunchWeapon, isMeleeWeapon, isVehicleWeapon } from './src/review/telemetry-events.js';

const fixturePath = process.env.PUBG_REAL_MATCH_FIXTURE;
if (!fixturePath) throw new Error('Set PUBG_REAL_MATCH_FIXTURE to a local telemetry fixture.');
const raw = JSON.parse(gunzipSync(readFileSync(fixturePath)).toString('utf8')) as unknown;

const values: Record<string, Partial<NormalizedPlayer>> = {
  [DEFAULT_TEAM.players[0]!.id]: { rank: 2, kills: 0, assists: 0, damage: 0, dbnos: 0, revives: 0 },
  [DEFAULT_TEAM.players[1]!.id]: { rank: null, kills: 0, assists: 0, damage: 0, dbnos: 0, revives: 0 },
  [DEFAULT_TEAM.players[2]!.id]: { rank: 2, kills: 3, assists: 1, damage: 256.24585, dbnos: 3, revives: 0 },
  [DEFAULT_TEAM.players[3]!.id]: { rank: null, kills: 0, assists: 0, damage: 0, dbnos: 0, revives: 0 },
};
const match: NormalizedMatch = {
  schemaVersion: 3,
  matchId: '226bb2d9-a83f-49db-ae85-965fcd9ec302',
  shard: 'steam',
  createdAt: '2026-09-02T13:10:29Z',
  timestamp: Date.parse('2026-09-02T13:10:29Z'),
  matchType: 'competitive',
  gameMode: 'squad',
  isCompetitive: true,
  mapName: 'Baltic_Main',
  duration: 1462,
  patchVersion: '',
  players: DEFAULT_TEAM.players.map((c) => ({
    accountId: c.id, playerName: c.name, displayName: c.name, rank: null, kills: 0, assists: 0, damage: 0, dbnos: 0, revives: 0, headshotKills: 0, survivalTime: 0, longestKill: 0, deaths: 1, deathSemantics: 'explicit' as const,
    ...values[c.id],
  })),
};

const events = normalizeTelemetryEvents(raw, match);
const teamIds = new Set(DEFAULT_TEAM.players.map(p => p.id));

// canonicalize accountId aliases to default team ids
const canon = (v: string | null) => {
  if (!v) return v;
  const low = v.toLowerCase();
  const p = DEFAULT_TEAM.players.find(x => x.id.toLowerCase() === low || x.name.toLowerCase() === low || x.aliases.some(a => a.toLowerCase() === low));
  return p ? p.id : v;
};

console.log('total normalized events:', events.length);
console.log('\n== DAMAGE events involving two tracked players ==');
for (const e of events) {
  const a = canon(e.actorId), v = canon(e.victimId);
  if (e.type === 'DAMAGE' && a && v && a !== v && teamIds.has(a) && teamIds.has(v)) {
    console.log(JSON.stringify({ id: e.id, type: e.type, actor: a, victim: v, weaponId: e.weaponId, dmg: e.damage, hit: e.hit, attackId: e.attackId, phase: e.phase, rawType: e.rawType, dmgCat: e.damageTypeCategory }));
  }
}

console.log('\n== KNOCK/KILL events between two tracked players ==');
for (const e of events) {
  const a = canon(e.actorId), v = canon(e.victimId);
  if ((e.type === 'KNOCK' || e.type === 'KILL') && a && v && a !== v && teamIds.has(a) && teamIds.has(v)) {
    console.log(JSON.stringify({ id: e.id, type: e.type, actor: a, victim: v, weaponId: e.weaponId, rawType: e.rawType }));
  }
}

console.log('\n== any MELEE / fist / punch labelled events ==');
for (const e of events) {
  const w = e.weaponId ?? e.itemId;
  if (isPunchWeapon(w, e.damageTypeCategory) || isMeleeWeapon(w, e.damageTypeCategory)) {
    const a = canon(e.actorId), v = canon(e.victimId);
    console.log(JSON.stringify({ id: e.id, type: e.type, rawType: e.rawType, actor: a, victim: v, weaponId: w, dmgCat: e.damageTypeCategory, dmg: e.damage, phase: e.phase }));
  }
}

console.log('\n== facts ==');
const facts = extractMatchReviewFacts(match, raw, DEFAULT_TEAM, 1);
console.log('teamDamage:', JSON.stringify(facts.teamDamage, null, 2));
console.log('teamVehicleEvents:', JSON.stringify(facts.teamVehicleEvents, null, 2));
console.log('funEvents:', JSON.stringify((facts as any).funEvents ?? 'n/a'));
