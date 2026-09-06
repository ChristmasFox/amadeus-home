import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TEAM } from '../src/config/team.js';
import type { NormalizedMatch, NormalizedPlayer } from '../src/data/model.js';
import { buildDeterministicQuery } from '../src/planner/deterministic-planner.js';
import { analyzeMatchReview } from '../src/review/review-analyzer.js';
import { extractMatchReviewFacts } from '../src/review/review-facts.js';
import { buildReviewPresentation } from '../src/review/presentation.js';
import { normalizeTelemetryEvents } from '../src/review/telemetry-events.js';

const player007 = DEFAULT_TEAM.players[0]!.id;
const player008 = DEFAULT_TEAM.players[1]!.id;
const player004 = DEFAULT_TEAM.players[2]!.id;
const matchId = 'd8c41c10-de9f-40b4-ac88-ede0ab554a31';
const createdAt = '2026-09-05T08:54:40.000Z';

function character(accountId: string, teamId = '6'): Record<string, unknown> {
  return { accountId, name: accountId, teamId };
}

function event(type: string, seconds: number, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { _T: type, _D: new Date(Date.parse(createdAt) + seconds * 1000).toISOString(), common: { isGame: 1 }, ...fields };
}

function player(accountId: string, values: Partial<NormalizedPlayer> = {}): NormalizedPlayer {
  return {
    accountId,
    playerName: accountId,
    displayName: accountId,
    rank: 4,
    kills: 0,
    assists: 0,
    damage: 0,
    dbnos: 0,
    revives: 0,
    headshotKills: 0,
    survivalTime: 500,
    longestKill: 0,
    deaths: 1,
    deathSemantics: 'explicit',
    ...values,
  };
}

function targetMatch(): NormalizedMatch {
  return {
    schemaVersion: 3,
    matchId,
    shard: 'steam',
    createdAt,
    timestamp: Date.parse(createdAt),
    matchType: 'competitive',
    gameMode: 'squad',
    isCompetitive: true,
    mapName: 'Neon_Main',
    duration: 900,
    patchVersion: 'fixture',
    // Deliberately omit the fourth configured player to verify that missing is
    // surfaced as not_recorded instead of being rendered as zero contribution.
    players: [
      player(player007, { kills: 1, dbnos: 2, damage: 136.96 }),
      player(player008),
      player(player004),
    ],
  };
}

function supplementalTelemetry(): unknown[] {
  return [
    event('LogPlayerTakeDamage', 10, { attacker: character(player007), victim: character(player004), weapon: { itemId: 'PlayerFemale_A_C' }, damageTypeCategory: 'Damage_Punch', damage: 11, attackId: 'punch-forward' }),
    event('LogPlayerTakeDamage', 11, { attacker: character(player004), victim: character(player007), weapon: { itemId: 'PlayerMale_A_C' }, damageTypeCategory: 'Damage_Punch', damage: 12, attackId: 'punch-reverse' }),
    event('LogPlayerTakeDamage', 12, { attacker: character(player008), victim: character(player007), weapon: { itemId: 'ProjGrenade_C' }, damageTypeCategory: 'Damage_Explosion_Grenade', damage: 22, attackId: 'team-grenade' }),
    event('LogItemPickup', 20, { character: character(player007), item: { itemId: 'Item_Weapon_StunGun_C', category: 'Weapon', subCategory: 'Handgun' } }),
    event('LogPlayerAttack', 21, { attacker: character(player007), weapon: { itemId: 'Item_Weapon_StunGun_C' }, attackId: 'stun-1' }),
    event('LogItemUse', 22, { character: character(player007), item: { itemId: 'Item_Heal_Bandage_C', category: 'Use', subCategory: 'Heal', stackCount: 3 } }),
    event('LogItemUse', 23, { character: character(player007), item: { itemId: 'Item_Boost_EnergyDrink_C', category: 'Use', subCategory: 'Boost', stackCount: 2 } }),
    event('LogItemUse', 24, { character: character(player007), item: { itemId: 'Item_Boost_PainKiller_C', category: 'Use', subCategory: 'Boost', stackCount: 1 } }),
    event('LogItemPickupFromLootBox', 25, { character: character(player007), item: { itemId: 'Item_Weapon_M24_C', category: 'Weapon', subCategory: 'Main' }, ownerTeamId: '2', creatorAccountId: 'enemy-loot' }),
    event('LogItemPutToVehicleTrunk', 26, { character: character(player008), vehicle: { vehicleId: 'car-1', vehicleType: 'WheeledVehicle' }, item: { itemId: 'Item_Weapon_PanzerFaust100M_C', category: 'Weapon', subCategory: 'Main', stackCount: 1 } }),
    event('LogItemPickupFromVehicleTrunk', 27, { character: character(player007), vehicle: { vehicleId: 'car-1', vehicleType: 'WheeledVehicle' }, item: { itemId: 'Item_Weapon_FlashBang_C', category: 'Equipment', subCategory: 'Throwable', stackCount: 2 } }),
    event('LogObjectInteraction', 28, { character: character(player004), objectType: 'Door', objectTypeStatus: 'Opening' }),
    event('LogObjectDestroy', 29, { character: character(player004), objectType: 'Window' }),
    event('LogVaultStart', 30, { character: character(player008), isLedgeGrab: true, isVaultOnVehicle: false }),
    event('LogArmorDestroy', 40, { attacker: character(player007), victim: character('enemy-armor', '2'), item: { itemId: 'Item_Head_G_01_Lv3_C', category: 'Equipment', subCategory: 'Headgear' }, damageCauserName: 'WeapM24_C', damageReason: 'HeadShot', distance: 800, attackId: 'armor-1' }),
    event('LogPlayerMakeGroggy', 40.1, { attacker: character(player007), victim: character('enemy-armor', '2'), damageCauserName: 'WeapM24_C', attackId: 'armor-1', dBNOId: 'dbno-armor' }),
    event('LogPlayerAttack', 50, { attacker: character(player007), weapon: { itemId: 'Item_Weapon_PanzerFaust100M_C' }, vehicle: { vehicleId: 'car-2', vehicleType: 'WheeledVehicle' }, attackId: 'rocket-1' }),
    ...[0, 1, 2, 3].map((wheelIndex) => event('LogWheelDestroy', 50.1, { attacker: character(player007), vehicle: { vehicleId: 'car-2', vehicleType: 'WheeledVehicle' }, wheelIndex, damageCauserName: 'PanzerFaust100M_Projectile_C', attackId: 'rocket-1' })),
    event('LogVehicleDamage', 50.2, { attacker: character(player007), vehicle: { vehicleId: 'car-2', vehicleType: 'WheeledVehicle' }, vehicleDamage: 800, damageCauserName: 'PanzerFaust100M_Projectile_C', attackId: 'rocket-1' }),
    event('LogPlayerTakeDamage', 50.3, { attacker: character(player007), victim: character('enemy-rocket', '2'), weapon: { itemId: 'PanzerFaust100M_Projectile_C' }, damage: 86.96, attackId: 'rocket-1' }),
    event('LogPlayerMakeGroggy', 50.4, { attacker: character(player007), victim: character('enemy-rocket', '2'), weapon: { itemId: 'PanzerFaust100M_Projectile_C' }, attackId: 'rocket-1', dBNOId: 'dbno-rocket' }),
    event('LogPlayerKillV2', 50.5, { killer: character(player007), victim: character('enemy-rocket', '2'), attackId: 'rocket-1' }),
    event('LogVehicleDestroy', 51, { attacker: character(player007), vehicle: { vehicleId: 'car-2', vehicleType: 'WheeledVehicle' }, attackId: 'rocket-1' }),
  ];
}

test('supplemental telemetry extracts interactions, utilities, loot, environment and vehicle chains', () => {
  const match = targetMatch();
  const raw = supplementalTelemetry();
  const normalized = normalizeTelemetryEvents(raw, match);
  assert.equal(normalized.some((eventItem) => eventItem.type === 'ITEM_USE'), true);
  assert.equal(normalized.some((eventItem) => eventItem.type === 'WHEEL_DESTROY'), true);
  const facts = extractMatchReviewFacts(match, raw, DEFAULT_TEAM, 1);

  assert.deepEqual(facts.teamDamage?.filter((item) => item.source === 'MELEE').map((item) => [item.actorPlayerId, item.victimPlayerId, item.hitCount]), [[player007, player004, 1], [player004, player007, 1]]);
  assert.equal(facts.stunGuns?.[0]?.pickups, 1);
  assert.equal(facts.stunGuns?.[0]?.shots, 1);
  assert.equal(facts.stunGuns?.[0]?.confirmedHits, 0);
  assert.equal(facts.recovery?.find((item) => item.playerId === player007)?.bandages, 1);
  assert.equal(facts.recovery?.find((item) => item.playerId === player007)?.energyDrinks, 1);
  assert.equal(facts.recovery?.find((item) => item.playerId === player007)?.painkillers, 1);
  assert.equal(facts.loot?.find((item) => item.playerId === player007)?.lootBoxPickups, 1);
  assert.equal(facts.vehicleTrunk?.length, 2);
  assert.equal(facts.environment?.find((item) => item.playerId === player004)?.windowsDestroyed, 1);
  assert.equal(facts.environment?.find((item) => item.playerId === player008)?.ledgeGrabs, 1);
  assert.equal(facts.armorBreaks?.[0]?.followUp, 'KNOCK');
  const impact = facts.vehicleImpacts?.find((item) => item.wheelsDestroyed === 4);
  assert.equal(impact?.vehicleDamage, 800);
  assert.equal(impact?.playerDamage, 86.96);
  assert.equal(impact?.knocks, 1);
  assert.equal(impact?.kills, 1);
  assert.equal(impact?.vehicleDestroyed, 1);
  assert.equal(facts.players.find((item) => item.playerId === DEFAULT_TEAM.players[3]!.id)?.matchPresence, 'not_recorded');
});

test('v1 review presentation includes approved report sections and fun combinations without circle output', () => {
  const facts = extractMatchReviewFacts(targetMatch(), supplementalTelemetry(), DEFAULT_TEAM, 1);
  const analysis = analyzeMatchReview(facts);
  const review = {
    schemaVersion: 1 as const,
    match: facts.match,
    facts,
    analysis,
    telemetry: { status: 'HIT' as const, parserVersion: 'test-parser', featureVersion: 'test-features' },
  };
  const query = buildDeterministicQuery({ text: '复盘这场比赛d8c41c10-de9f-40b4-ac88-ede0ab554a31' });
  const presentation = buildReviewPresentation(review, query, null);
  const text = presentation.fallbackText;
  assert.equal(text.includes('荣都'), true);
  assert.equal(text.includes('电击枪'), true);
  assert.equal(text.includes('武器信息'), true);
  assert.equal(text.includes('恢复物品与能量'), true);
  assert.equal(text.includes('搜包与物资搬运'), true);
  assert.equal(text.includes('环境动作'), true);
  assert.equal(text.includes('双向队友拳击'), true);
  assert.equal(text.includes('误伤三件套'), true);
  assert.equal(text.includes('一炮四轮'), true);
  assert.equal(text.includes('白圈'), false);
  assert.equal(text.includes('圈阶段'), false);
  assert.equal(presentation.sections.some((section) => section.type === 'turning_points'), true);
  assert.equal(presentation.sections.some((section) => section.type === 'interactions'), true);
  assert.equal(presentation.sections.some((section) => section.type === 'recovery'), true);
  assert.equal(presentation.sections.some((section) => section.type === 'loot'), true);
});

test('explicit match ID planning bypasses the default time selector', () => {
  const query = buildDeterministicQuery({ text: `复盘这场比赛${matchId}` });
  assert.equal(query.operation, 'review_match');
  assert.deepEqual(query.matchSelector, { type: 'match_id', matchId, label: '指定对局' });
  assert.deepEqual(query.selector, { type: 'last_n_matches', count: 1, offset: 0, label: '指定对局' });
});
