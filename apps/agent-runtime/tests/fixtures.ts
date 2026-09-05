import { DEFAULT_TEAM, type TeamConfig } from '../src/config/team.js';
import type { NormalizedMatch, NormalizedPlayer } from '../src/data/model.js';

export const TEST_NOW = new Date('2026-09-01T04:00:00.000Z');

function player(id: string, name: string, rank: number, kills: number, damage: number, assists = 1): NormalizedPlayer {
  return {
    accountId: id,
    playerName: name,
    displayName: name,
    rank,
    kills,
    assists,
    damage,
    dbnos: Math.max(0, Math.floor(kills / 2)),
    revives: rank <= 3 ? 1 : 0,
    headshotKills: kills > 3 ? 1 : 0,
    survivalTime: 600 + rank * 20,
    longestKill: damage / 5,
    deaths: rank > 1 ? 1 : 0,
    deathSemantics: 'placement_proxy',
  };
}

function match(id: string, createdAt: string, values: Array<[number, number, number]>): NormalizedMatch {
  return {
    schemaVersion: 3,
    matchId: id,
    shard: 'steam',
    createdAt,
    timestamp: Date.parse(createdAt),
    matchType: 'competitive',
    gameMode: 'squad-fpp',
    isCompetitive: true,
    mapName: id.includes('m2') ? 'Miramar' : 'Erangel',
    duration: 1200,
    patchVersion: 'fixture',
    players: DEFAULT_TEAM.players.map((configured, index) => {
      const value = values[index] ?? [10, 0, 0];
      return player(configured.id, configured.name, value[0], value[1], value[2], index + 1);
    }),
  };
}

export const FIXTURE_RECORDS: NormalizedMatch[] = [
  match('m1', '2026-08-31T08:00:00+08:00', [[2, 5, 500], [3, 2, 200], [1, 7, 700], [4, 1, 100]]),
  match('m2', '2026-08-31T23:00:00+08:00', [[1, 3, 300], [1, 6, 650], [2, 4, 400], [2, 2, 200]]),
  match('m3', '2026-08-30T12:00:00+08:00', [[5, 1, 100], [4, 4, 350], [3, 3, 300], [8, 0, 50]]),
  match('m4', '2026-08-29T22:00:00+08:00', [[1, 8, 800], [2, 4, 300], [6, 1, 80], [7, 0, 20]]),
  match('m5', '2026-08-28T20:00:00+08:00', [[3, 2, 200], [5, 1, 80], [2, 4, 450], [4, 1, 100]]),
];

export const TEST_TEAM: TeamConfig = DEFAULT_TEAM;
