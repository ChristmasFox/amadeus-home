import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedMatch } from '@agent/pubg-domain';
import { normalizeBattleTelemetry, reconstructBattleMatch } from '../src/battle.js';
import {
  analyzeCombatQuality, analyzeDeaths, buildCombatInsights, buildLandingPreference, buildPerformanceInsights, buildSquadAnalytics, emptyCombatQuality, INSIGHT_MAX, buildLineupAnalytics, buildMapAnalytics, buildMatchSeries, deathStageOf, extractLandings, gridCell,
  mapDisplayName, modeGroupOf, newcombeDifference, summarizeCombatQuality, summarizeDeaths, wilsonInterval,
} from '../src/index.js';

const start = Date.parse('2026-03-01T00:00:00.000Z');
function matchOf(id: string, mapName: string, rank: number, survival: number, damage = 100): NormalizedMatch {
  return {
    schemaVersion: 3, matchId: id, shard: 'steam', createdAt: new Date(start).toISOString(), timestamp: start, matchType: 'competitive',
    gameMode: 'squad-fpp', isCompetitive: true, mapName, duration: 1200, patchVersion: 'fixture',
    players: ['t1', 't2'].map((accountId) => ({
      accountId, playerName: accountId, displayName: accountId, rank, kills: 1, assists: 0, damage, dbnos: 1, revives: 0, headshotKills: 0,
      survivalTime: survival, longestKill: 0, deaths: 1, deathSemantics: 'explicit' as const,
    })),
  };
}

test('grid cells use one-kilometre squares and reject out-of-map or unknown maps', () => {
  assert.equal(gridCell(2500, 4200, 'Baltic_Main'), 'C5');
  assert.equal(gridCell(500, 500, 'Savage_Main'), 'A1');
  assert.equal(gridCell(9000, 100, 'Baltic_Main'), null);
  assert.equal(gridCell(100, 100, 'Mystery_Main'), null);
  assert.equal(mapDisplayName('Baltic_Main'), '艾伦格');
  assert.equal(mapDisplayName('Mystery_Main'), 'Mystery');
});

test('landing extraction keeps tracked members once, converts centimetres, and ignores others', () => {
  const landing = (accountId: string, x: number, y: number) => ({ _T: 'LogParachuteLanding', character: { accountId, location: { x, y, z: 1 } } });
  const samples = extractLandings(
    [landing('t1', 250_000, 420_000), landing('t1', 10, 10), landing('enemy', 1, 1), landing('t2', 260_000, 430_000)],
    { mapName: 'Baltic_Main' }, new Set(['t1', 't2']),
  );
  assert.equal(samples.length, 2);
  assert.equal(samples[0]!.cell, 'C5');
  assert.equal(samples[0]!.xMeters, 2500);
  const gz = extractLandings(JSON.parse(JSON.stringify([landing('t1', 100_000, 100_000)])), { mapName: 'Baltic_Main' }, new Set(['t1']));
  assert.equal(gz[0]!.cell, 'B2');
});

test('landing preference ranks cells by use and reports outcome per cell', () => {
  const members = new Set(['t1', 't2']);
  const at = (cell: [number, number]) => ['t1', 't2'].map((playerRef, index) => ({ playerRef, xMeters: cell[0] * 1000 + 100 + index * 50, yMeters: cell[1] * 1000 + 100, cell: gridCell(cell[0] * 1000 + 100, cell[1] * 1000 + 100, 'Baltic_Main') }));
  const result = buildLandingPreference([
    { match: matchOf('a', 'Baltic_Main', 1, 1500), landings: at([2, 4]), memberIds: members },
    { match: matchOf('b', 'Baltic_Main', 15, 200), landings: at([2, 4]), memberIds: members },
    { match: matchOf('c', 'Baltic_Main', 5, 900), landings: at([6, 1]), memberIds: members },
    { match: matchOf('d', 'Baltic_Main', 3, 900), landings: [], memberIds: members },
  ]);
  const map = result.maps[0]!;
  assert.equal(map.matches, 4);
  assert.equal(map.matchesWithLanding, 3);
  assert.equal(map.cells[0]!.cell, 'C5');
  assert.equal(map.cells[0]!.matches, 2);
  assert.equal(map.cells[0]!.earlyWipeRate, 0.5);
  assert.equal(map.cells[0]!.top10.successes, 1);
  assert.equal(map.topCellRepeatRate, 2 / 3);
  assert.ok(map.medianSpreadMeters! > 0 && map.medianSpreadMeters! < 100);
  assert.ok(result.notes.some((note) => note.includes('1 场没有可读的落地事件')));
});

test('map analytics groups by map with Wilson rates and a damage index', () => {
  const maps = buildMapAnalytics({
    matches: [matchOf('a', 'Baltic_Main', 1, 1500, 300), matchOf('b', 'Baltic_Main', 12, 500, 100), matchOf('c', 'Desert_Main', 4, 800, 100)],
    memberIds: ['t1', 't2'],
  });
  assert.equal(maps[0]!.mapName, 'Baltic_Main');
  assert.equal(maps[0]!.label, '艾伦格');
  assert.equal(maps[0]!.matches, 2);
  assert.equal(maps[0]!.win.successes, 1);
  assert.equal(maps[0]!.medianPlacement, 6.5);
  assert.equal(maps[0]!.damageIndex, null, 'fewer than five matches gives no index');
});

type Actor = { accountId: string; teamId: string };
function raw(type: string, seconds: number, actor: Actor, victim?: Actor, extra: Record<string, unknown> = {}) {
  const event: Record<string, unknown> = { _T: type, common: { isGame: true }, _D: new Date(start + seconds * 1000).toISOString(), ...extra };
  if (type.includes('Revive')) event.reviver = actor;
  else if (type.includes('Kill')) event.killer = actor;
  else event.attacker = actor;
  if (victim) event.victim = victim;
  return event;
}
const us = (accountId: string): Actor => ({ accountId, teamId: 'team-us' });
const them = (accountId: string, teamId = 'team-b'): Actor => ({ accountId, teamId });

test('combat quality measures first knock, finish and revive timing from reconstructed battles', () => {
  const telemetry = [
    raw('LogPlayerTakeDamage', 10, us('t1'), them('e1'), { damage: 25 }),
    raw('LogPlayerMakeGroggy', 28, us('t1'), them('e1'), { dBNOId: 'd1' }),
    raw('LogPlayerTakeDamage', 35, us('t1'), them('e1'), { damage: 20 }),
    raw('LogPlayerKill', 43, us('t2'), them('e1'), { dBNOId: 'd1' }),
    raw('LogPlayerTakeDamage', 300, them('e2', 'team-c'), us('t2'), { damage: 30 }),
    raw('LogPlayerMakeGroggy', 310, them('e2', 'team-c'), us('t2'), { dBNOId: 'd2' }),
    raw('LogPlayerRevive', 330, us('t1'), us('t2')),
  ];
  const match = matchOf('cq', 'Baltic_Main', 3, 900);
  const result = reconstructBattleMatch({ match, telemetry, trackedPlayerIds: ['t1', 't2'] });
  const stats = analyzeCombatQuality(result);
  assert.equal(stats.groups, 2);
  assert.equal(stats.firstKnockFor, 1);
  assert.equal(stats.firstKnockAgainst, 1);
  assert.equal(stats.downedFinished, 1);
  assert.deepEqual(stats.finishSeconds, [15]);
  assert.equal(stats.knockedRevived, 1);
  assert.deepEqual(stats.reviveSeconds, [20]);
  const summary = summarizeCombatQuality([stats, stats]);
  assert.equal(summary.revive.knocked, 2);
  assert.equal(summary.revive.reviveRate.rate, 1);
  assert.equal(summary.revive.medianSeconds, 20);
  assert.equal(summary.firstKnock.ourRate.rate, 0.5);
});

test('combat quality returns empty counts when no tracked team is observed', () => {
  const result = reconstructBattleMatch({ match: matchOf('none', 'Baltic_Main', 3, 900), telemetry: [], trackedPlayerIds: ['t1'] });
  const stats = analyzeCombatQuality(result);
  assert.equal(stats.groups, 0);
  assert.equal(summarizeCombatQuality([stats]).revive.reviveRate.rate, null);
});

test('mode groups keep team sizes apart', () => {
  assert.equal(modeGroupOf('squad-fpp'), 'squad');
  assert.equal(modeGroupOf('duo'), 'duo');
  assert.equal(modeGroupOf('solo-fpp'), 'solo');
  assert.equal(modeGroupOf('tdm'), 'other');
  assert.equal(modeGroupOf('zulu-fpp'), 'other');
});

test('newcombe difference flags only intervals that exclude zero', () => {
  const big = newcombeDifference(wilsonInterval(80, 100), wilsonInterval(20, 100));
  assert.equal(big.significant, true);
  assert.ok(big.low! > 0.3);
  const small = newcombeDifference(wilsonInterval(6, 10), wilsonInterval(5, 10));
  assert.equal(small.significant, false);
  assert.equal(newcombeDifference(wilsonInterval(0, 0), wilsonInterval(1, 2)).delta, null);
});

test('lineup analytics groups present members and compares with and without each one', () => {
  const make = (id: number, names: string[], rank: number) => ({
    ...matchOf(`l${id}`, 'Baltic_Main', rank, 900),
    timestamp: start + id * 1000,
    players: names.map((accountId) => ({ ...matchOf('x', 'Baltic_Main', rank, 900).players[0]!, accountId, playerName: accountId, displayName: accountId, rank })),
  });
  const matches = [
    ...Array.from({ length: 6 }, (_, index) => make(index, ['t1', 't2'], 3)),
    ...Array.from({ length: 6 }, (_, index) => make(10 + index, ['t1'], 25)),
  ];
  const result = buildLineupAnalytics({ matches, memberIds: ['t1', 't2'] });
  assert.equal(result.lineups.length, 2);
  assert.equal(result.lineups[0]!.size, 2);
  const t2 = result.members.find((member) => member.name === 't2')!;
  assert.equal(t2.withMatches, 6);
  assert.equal(t2.withoutMatches, 6);
  assert.equal(t2.withTop10.rate, 1);
  assert.equal(t2.withoutTop10.rate, 0);
  assert.equal(t2.difference.significant, true);
});

test('match series is chronological, per-player averaged and capped', () => {
  const matches = Array.from({ length: 200 }, (_, index) => ({ ...matchOf(`s${index}`, 'Desert_Main', index % 12 + 1, 900, 100 + index), timestamp: start + index * 1000 }));
  const series = buildMatchSeries({ matches: matches.reverse(), memberIds: ['t1', 't2'] });
  assert.equal(series.length, 150);
  assert.equal(series[0]!.matchId, 's50');
  assert.equal(series.at(-1)!.matchId, 's199');
  assert.equal(series.at(-1)!.damage, 299);
  assert.equal(series[0]!.mapLabel, '米拉玛');
});

test('death analysis stages deaths by teams alive, detects knock-then-kill and marks the squad wipe', () => {
  const telemetry = [
    raw('LogPlayerMakeGroggy', 100, them('e1'), us('t1'), { dBNOId: 'k1' }),
    raw('LogPlayerKill', 110, them('e1'), us('t1'), { dBNOId: 'k1', damageCauserName: 'WeapAUG_C' }),
    raw('LogPlayerKill', 600, them('e2', 'team-c'), us('t2'), { damageCauserName: 'WeapKar98k_C' }),
    { _T: 'LogGameStatePeriodic', common: { isGame: 1 }, _D: new Date(start + 90_000).toISOString(), gameState: { elapsedTime: 90, numAlivePlayers: 80, numAliveTeams: 22 } },
    { _T: 'LogGameStatePeriodic', common: { isGame: 5 }, _D: new Date(start + 500_000).toISOString(), gameState: { elapsedTime: 500, numAlivePlayers: 9, numAliveTeams: 3 } },
  ];
  const doc = normalizeBattleTelemetry(telemetry, matchOf('d', 'Baltic_Main', 4, 900));
  const records = analyzeDeaths(doc, ['t1', 't2']);
  assert.equal(records.length, 2);
  assert.equal(records[0]!.stage, '开局');
  assert.equal(records[0]!.afterKnock, true);
  assert.equal(records[0]!.squadWipe, false);
  assert.equal(records[1]!.stage, '决赛圈');
  assert.equal(records[1]!.squadWipe, true);
  const summary = summarizeDeaths(records);
  assert.equal(summary.deaths, 2);
  assert.equal(summary.afterKnock.count, 1);
  assert.deepEqual(summary.wipeStages, [{ stage: '决赛圈', wipes: 1 }]);
  assert.equal(deathStageOf(null), '未知');
});

test('performance insights only flag significant differences and always carry evidence', () => {
  const make = (id: number, names: string[], rank: number) => ({
    ...matchOf(`i${id}`, 'Baltic_Main', rank, 900),
    timestamp: start + id * 1000,
    players: names.map((accountId) => ({ ...matchOf('x', 'Baltic_Main', rank, 900).players[0]!, accountId, playerName: accountId, displayName: accountId, rank })),
  });
  const matches = [
    ...Array.from({ length: 30 }, (_, index) => make(index, ['t1', 't2'], 3)),
    ...Array.from({ length: 30 }, (_, index) => make(100 + index, ['t1'], 25)),
  ];
  const input = { matches, memberIds: ['t1', 't2'] };
  const insights = buildPerformanceInsights({
    squad: buildSquadAnalytics(input), maps: buildMapAnalytics(input), lineups: buildLineupAnalytics(input), series: buildMatchSeries(input),
  });
  const member = insights.find((item) => item.id.startsWith('member-'));
  assert.ok(member && member.tone === 'good' && member.title.includes('t2'));
  assert.ok(insights.every((item) => item.evidence.length > 0 && item.detail.length > 0));
  assert.ok(insights.length <= INSIGHT_MAX);
  const flat = buildPerformanceInsights({
    squad: buildSquadAnalytics({ matches: matches.slice(0, 6), memberIds: ['t1'] }), maps: [], lineups: { lineups: [], members: [], notes: [] }, series: [],
  });
  assert.equal(flat.length, 0);
});

test('combat insights flag a weak revive rate and post-knock deaths, and stay quiet on small samples', () => {
  const empty = emptyCombatQuality();
  const stats = { ...empty, groups: 40, knockedChains: 40, knockedRevived: 4, knockedKilled: 33, downedChains: 40, downedFinished: 30 };
  const combat = summarizeCombatQuality([stats]);
  const deathRecords = Array.from({ length: 40 }, (_, index) => ({ stage: '中期' as const, weapon: 'AUG', afterKnock: index < 30, squadWipe: false }));
  const insights = buildCombatInsights({ combat, deaths: summarizeDeaths(deathRecords), landing: { schemaVersion: 1, maps: [], notes: [] } });
  assert.ok(insights.some((item) => item.id === 'revive-weak' && item.tone === 'warn'));
  assert.ok(insights.some((item) => item.id === 'death-after-knock'));
  assert.ok(insights.some((item) => item.id === 'death-stage'));
  const quiet = buildCombatInsights({ combat: summarizeCombatQuality([{ ...empty, knockedChains: 3, knockedRevived: 0 }]), deaths: summarizeDeaths([]), landing: { schemaVersion: 1, maps: [], notes: [] } });
  assert.equal(quiet.length, 0);
});
