import { DEFAULT_TEAM } from './src/config/team.js';
import { extractMatchReviewFacts } from './src/review/review-facts.js';
import { generateBaseFunEvents } from './src/review/fun-event-generator.js';
const ids = DEFAULT_TEAM.players.map(p => p.id);
const createdAt = '2026-09-03T10:00:00.000Z';
function event(type: string, seconds: number, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { _T: type, _D: new Date(Date.parse(createdAt) + seconds * 1000).toISOString(), ...fields };
}
function character(accountId: string): Record<string, unknown> { return { accountId, name: accountId }; }
const match: any = {
  schemaVersion: 3, matchId: 'scene', shard: 'steam', createdAt, timestamp: Date.parse(createdAt), matchType: 'competitive', gameMode: 'squad-fpp', isCompetitive: true, mapName: 'Erangel', duration: 900, patchVersion: 'fixture',
  players: ids.map(id => ({ accountId: id, playerName: id, displayName: id, rank: 2, kills: 0, assists: 0, damage: 0, dbnos: 0, revives: 0, headshotKills: 0, survivalTime: 500, longestKill: 0, deaths: 1, deathSemantics: 'explicit' })),
};
const raw = [event('LogPlayerTakeDamage', 10, {
  attacker: character(ids[2]!),
  victim: character(ids[0]!),
  weapon: { itemId: 'BP_CoupeRB_C' },
  damageTypeCategory: 'Damage_VehicleHit',
  damage: 13,
})];
const facts = extractMatchReviewFacts(match, raw, DEFAULT_TEAM);
console.log('teamDamage:', JSON.stringify(facts.teamDamage));
console.log('teamVehicleEvents:', JSON.stringify(facts.teamVehicleEvents));
console.log('combat events:', JSON.stringify(facts.combat.events.filter(e => e.type==='DAMAGE')));
const base = generateBaseFunEvents(facts);
console.log('base:', JSON.stringify(base, null, 2));
