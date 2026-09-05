import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TEAM } from '../src/config/team.js';
import type { NormalizedMatch, NormalizedPlayer } from '../src/data/model.js';
import type { SessionContextRecord } from '../src/data/model.js';
import { buildDeterministicQuery } from '../src/planner/deterministic-planner.js';
import { classifyPubgRequest } from '../src/runtime/router.js';
import { extractMatchReviewFacts } from '../src/review/review-facts.js';
import { generateBaseFunEvents } from '../src/review/fun-event-generator.js';
import { generateFunEvents } from '../src/review/fun-intelligence.js';
import { FunRanker } from '../src/review/fun-ranker.js';
import type { FunEvent } from '../src/review/types.js';

const ids = DEFAULT_TEAM.players.map((player) => player.id);
const createdAt = '2026-09-03T10:00:00.000Z';

function player(accountId: string, values: Partial<NormalizedPlayer> = {}): NormalizedPlayer {
  return {
    accountId,
    playerName: accountId,
    displayName: accountId,
    rank: 2,
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

function match(values: Partial<Record<string, Partial<NormalizedPlayer>>> = {}): NormalizedMatch {
  return {
    schemaVersion: 3,
    matchId: 'fun-fixture',
    shard: 'steam',
    createdAt,
    timestamp: Date.parse(createdAt),
    matchType: 'competitive',
    gameMode: 'squad-fpp',
    isCompetitive: true,
    mapName: 'Erangel',
    duration: 900,
    patchVersion: 'fixture',
    players: ids.map((id) => player(id, values[id])),
  };
}

function event(type: string, seconds: number, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { _T: type, _D: new Date(Date.parse(createdAt) + seconds * 1000).toISOString(), ...fields };
}

function character(accountId: string, teamId?: string): Record<string, unknown> {
  return { accountId, name: accountId, ...(teamId ? { teamId } : {}) };
}

function factsFor(raw: unknown[], values: Partial<Record<string, Partial<NormalizedPlayer>>> = {}) {
  return extractMatchReviewFacts(match(values), raw, DEFAULT_TEAM);
}

function assertFunEvidence(facts: ReturnType<typeof factsFor>, events: FunEvent[]): void {
  const evidenceIds = new Set(facts.evidence.map((item) => item.id));
  for (const item of events) {
    assert.ok(item.factIds.length > 0, `${item.id} has no fact IDs`);
    assert.ok(item.evidenceIds.length > 0, `${item.id} has no evidence IDs`);
    assert.ok(item.evidenceIds.every((id) => evidenceIds.has(id)), `${item.id} references missing evidence`);
    assert.ok(item.funScore >= 0 && item.funScore <= 100, `${item.id} score is outside 0..100`);
  }
}

test('V3.3 aggregates confirmed teammate punches and combines low enemy damage', () => {
  const raw = ids.slice(1, 3).flatMap((victimId, targetIndex) => Array.from({ length: targetIndex === 0 ? 6 : 2 }, (_, index) => event(
    'LogPlayerTakeDamage',
    10 + index,
    {
      attacker: character(ids[0]!),
      victim: character(victimId!),
      weapon: { itemId: 'WeapFist_C' },
      damage: 1,
      attackId: `punch-${targetIndex}-${index}`,
    },
  )));
  const facts = factsFor(raw, { [ids[0]!]: { damage: 42 } });
  assert.equal(facts.teamDamage?.filter((item) => item.source === 'MELEE').reduce((sum, item) => sum + item.hitCount, 0), 8);
  const base = generateBaseFunEvents(facts);
  assert.equal(base.some((item) => item.type === 'TEAMMATE_PUNCHING'), true);
  const events = generateFunEvents(facts, 20);
  assert.equal(events.some((item) => item.title === '🥊 先礼后兵'), true);
  assert.equal(events.some((item) => item.type === 'TEAMMATE_PUNCHING'), false);
  assertFunEvidence(facts, events);
});

test('vehicle team damage attributes driver only when confirmed', () => {
  const confirmed = factsFor([
    event('LogVehicleRide', 10, { character: character(ids[0]!), vehicle: { id: 'car-1' }, driverConfirmed: true }),
    event('LogVehicleDamage', 11, { attacker: character(ids[0]!), victim: character(ids[1]!), vehicle: { id: 'car-1' }, vehicleDamage: 18 }),
  ]);
  assert.equal(confirmed.teamVehicleEvents?.[0]?.driverConfirmed, true);
  assert.equal(generateBaseFunEvents(confirmed).some((item) => item.title === '🚗 肇事司机'), true);

  const uncertain = factsFor([
    event('LogVehicleRide', 10, { character: character(ids[0]!), vehicle: { id: 'car-2' }, seatIndex: 0 }),
    event('LogVehicleDamage', 11, { attacker: character(ids[0]!), victim: character(ids[1]!), vehicle: { id: 'car-2' }, vehicleDamage: 18 }),
  ]);
  assert.equal(uncertain.teamVehicleEvents?.[0]?.driverConfirmed, false);
  assert.equal(generateBaseFunEvents(uncertain).some((item) => item.title === '🚗 肇事司机'), false);
  assert.equal(generateBaseFunEvents(uncertain).some((item) => item.type === 'TEAM_VEHICLE_DAMAGE'), true);
});

test('flash usage is counted while flash victims are not invented', () => {
  const facts = factsFor(Array.from({ length: 5 }, (_, index) => event('LogPlayerAttack', 20 + index, {
    attacker: character(ids[0]!),
    weapon: { itemId: 'Item_Weapon_FlashBang_C' },
    attackId: `flash-${index}`,
  })));
  assert.equal(facts.flash?.find((item) => item.playerId === ids[0])?.uses, 5);
  const events = generateBaseFunEvents(facts);
  const flash = events.find((item) => item.type === 'FLASH_USED');
  assert.ok(flash);
  assert.equal(events.some((item) => item.type === 'FLASH_TEAMMATE' || item.type === 'FLASH_ENEMY'), false);
  assertFunEvidence(facts, events);
});

test('rocket facts distinguish unused, all-miss and evidence-backed vehicle multi-kill', () => {
  const unused = factsFor(Array.from({ length: 3 }, (_, index) => event('LogItemPickup', 10 + index, {
    character: character(ids[0]!),
    item: { itemId: 'Item_Weapon_PanzerFaust100M_C' },
  })));
  const unusedEvents = generateFunEvents(unused, 20);
  assert.equal(unusedEvents.some((item) => item.title === '🎒 战略储备'), true);

  const miss = factsFor(Array.from({ length: 3 }, (_, index) => event('LogPlayerAttack', 20 + index, {
    attacker: character(ids[0]!),
    weapon: { itemId: 'Item_Weapon_PanzerFaust100M_C' },
    attackId: `miss-${index}`,
  })));
  assert.equal(miss.specialEvents.some((item) => item.type === 'ROCKET_MISS'), true);
  assert.equal(generateBaseFunEvents(miss).some((item) => item.type === 'ROCKET_ALL_MISS'), true);
  assert.equal(miss.specialEvents.some((item) => item.type === 'ROCKET_HIT'), false);

  const vehicleKills = factsFor([
    event('LogPlayerAttack', 30, { attacker: character(ids[0]!), weapon: { itemId: 'Item_Weapon_PanzerFaust100M_C' }, attackId: 'rocket-kill', vehicle: { id: 'rocket-car' } }),
    event('LogVehicleDamage', 31, { attacker: character(ids[0]!), weapon: { itemId: 'Item_Weapon_PanzerFaust100M_C' }, attackId: 'rocket-kill', vehicle: { id: 'rocket-car' }, vehicleDamage: 250 }),
    event('LogVehicleDestroy', 32, { attacker: character(ids[0]!), weapon: { itemId: 'Item_Weapon_PanzerFaust100M_C' }, attackId: 'rocket-kill', vehicle: { id: 'rocket-car' } }),
    ...['enemy-1', 'enemy-2', 'enemy-3', 'enemy-4'].map((victim, index) => event('LogPlayerKill', 33 + index, {
      killer: character(ids[0]!),
      victim: character(victim, 'enemy-team'),
      vehicleId: 'rocket-car',
      attackId: 'rocket-kill',
    })),
  ], { [ids[0]!]: { kills: 4, damage: 0 } });
  assert.equal(vehicleKills.specialEvents.some((item) => item.type === 'ROCKET_VEHICLE_MULTI_KILL'), true);
  assert.equal(generateFunEvents(vehicleKills, 20).some((item) => item.title === '☢️ 一炮4响'), true);
});

test('combat and support fun allow real negative reporting', () => {
  const values = {
    [ids[0]!]: { kills: 1, dbnos: 6, damage: 220, revives: 4 },
    [ids[1]!]: { kills: 0, damage: 0, assists: 0, dbnos: 0, revives: 0 },
  } satisfies Partial<Record<string, Partial<NormalizedPlayer>>>;
  const facts = factsFor([
    ...Array.from({ length: 4 }, (_, index) => event('LogPlayerRevive', 40 + index, { reviver: character(ids[0]!), victim: character(ids[1]!) })),
  ], values);
  const events = generateFunEvents(facts, 20);
  assert.equal(events.some((item) => item.title === '🫠 白打王'), true);
  assert.equal(events.some((item) => item.title === '👻 全场隐身'), true);
  assert.equal(events.some((item) => item.title === '🩺 人救麻了'), true);
  assertFunEvidence(facts, events);
});

test('FunRanker hides heuristic events and suppresses covered singles', () => {
  const event = (id: string, confidence: FunEvent['confidence'], score: number, type: string, suppresses: string[] = []): FunEvent => ({
    id,
    type,
    targetPlayerIds: [],
    factIds: [`fact-${id}`],
    evidenceIds: [`evidence-${id}`],
    confidence,
    funScore: score,
    category: 'test',
    title: id,
    text: id,
    facts: {},
    tags: [],
    suppresses,
  });
  const result = new FunRanker({ limit: 5 }).rank([
    event('combo', 'DERIVED', 85, 'COMBO', ['TEAMMATE_PUNCHING']),
    event('punch', 'CONFIRMED', 30, 'TEAMMATE_PUNCHING'),
    event('guess', 'HEURISTIC', 100, 'GUESS'),
  ]);
  assert.deepEqual(result.map((item) => item.id), ['combo']);
});

test('fun follow-ups inherit active review context deterministically', () => {
  const review = buildDeterministicQuery({ text: '复盘今天最后一把' });
  const context = { activeDomain: 'pubg', lastQuery: review, activeMatchId: 'match-1' } as unknown as SessionContextRecord;
  for (const text of ['这把还有什么整活', 'Arthur干了啥离谱的', '谁最像内鬼', '谁打队友了', '谁开车撞人了', '火箭筒有什么节目', '闪光弹呢']) {
    const query = buildDeterministicQuery({ text, context });
    assert.equal(query.operation, 'review_match', text);
    assert.equal(query.matchSelector?.type, 'active_match', text);
  }
  assert.equal(classifyPubgRequest('闪光弹呢', context).domain, 'pubg');
});


test('V3.3 combination engine emits friendly threat and suppresses covered singles', () => {
  const raw = [
    ...Array.from({ length: 6 }, (_, index) => event('LogPlayerTakeDamage', 10 + index, {
      attacker: character(ids[0]!),
      victim: character(ids[1]!),
      weapon: { itemId: 'WeapFist_C' },
      damage: 1,
      attackId: `punch-${index}`,
    })),
    event('LogVehicleRide', 20, { character: character(ids[0]!), vehicle: { id: 'car-threat' }, driverConfirmed: true }),
    event('LogVehicleDamage', 21, { attacker: character(ids[0]!), victim: character(ids[2]!), vehicle: { id: 'car-threat' }, vehicleDamage: 30 }),
  ];
  const facts = factsFor(raw, { [ids[0]!]: { damage: 42 } });
  const events = generateFunEvents(facts, 30);
  const threat = events.find((item) => item.title === '🚨 友军威胁');
  assert.ok(threat);
  assert.equal(events.some((item) => item.type === 'TEAMMATE_PUNCHING'), false);
  assert.equal(events.some((item) => item.type === 'VEHICLE_TEAM_HIT'), false);
  assertFunEvidence(facts, events);
});

test('V3.3 combination engine produces PUBG tourism when riding is the only activity', () => {
  const raw = [
    event('LogVehicleRide', 10, { character: character(ids[0]!), vehicle: { id: 'tour-bus' }, passengerConfirmed: true, distanceMeters: 5200 }),
    event('LogVehicleLeave', 15, { character: character(ids[0]!), vehicle: { id: 'tour-bus' }, passengerConfirmed: true, distanceMeters: 5200 }),
  ];
  const facts = factsFor(raw, { [ids[0]!]: { damage: 0 } });
  const events = generateFunEvents(facts, 30);
  assert.equal(events.some((item) => item.title === '🚌 PUBG旅游团'), true);
  assertFunEvidence(facts, events);
});

test('V3.3 combination engine flags attack direction when friendly fire dominates', () => {
  const raw = Array.from({ length: 2 }, (_, index) => event('LogPlayerTakeDamage', 10 + index, {
    attacker: character(ids[0]!),
    victim: character(ids[1]!),
    weapon: { itemId: 'WeapM16A4_C' },
    damage: 20,
    attackId: `ff-${index}`,
  }));
  const facts = factsFor(raw, { [ids[0]!]: { damage: 40 } });
  const events = generateFunEvents(facts, 30);
  assert.equal(events.some((item) => item.title === '🎯 攻击方向值得研究'), true);
  assertFunEvidence(facts, events);
});

test('V3.3 ignores missed punches and preserves pre-match vs in-match facts', () => {
  const raw = [
    event('LogPlayerAttack', 10, { attacker: character(ids[0]!), victim: character(ids[1]!), weapon: { itemId: 'WeapFist_C' }, attackId: 'missed-punch' }),
    event('LogPlayerTakeDamage', 12, { attacker: character(ids[0]!), victim: character(ids[1]!), weapon: { itemId: 'WeapFist_C' }, damage: 2, attackId: 'hit-punch' }),
  ];
  const facts = factsFor(raw);
  const punches = facts.teamDamage?.filter((item) => item.source === 'MELEE') ?? [];
  assert.equal(punches.reduce((sum, item) => sum + item.hitCount, 0), 1);
  assert.equal(punches[0]?.phase, 'in_match');
  const base = generateBaseFunEvents(facts);
  assert.equal(base.some((item) => item.type === 'TEAMMATE_PUNCHING'), true);
  assertFunEvidence(facts, base);
});

test('V3.3 heavy weapon shot count ignores LogWeaponFireCount aggregates', () => {
  const raw = [
    event('LogWeaponFireCount', 10, { character: character(ids[0]!), weapon: { itemId: 'Item_Weapon_PanzerFaust100M_C' }, fireCount: 99 }),
    event('LogPlayerAttack', 11, { attacker: character(ids[0]!), weapon: { itemId: 'Item_Weapon_PanzerFaust100M_C' }, attackId: 'rocket-shot' }),
  ];
  const facts = factsFor(raw);
  const rocket = facts.heavyWeapons.find((item) => item.weapon === 'Panzerfaust');
  assert.equal(rocket?.shots, 1);
});

test('V3.3 punch combination lists per-victim punch detail', () => {
  // SG_LabmemNo004 punches SG_LabmemNo007 6 times in match and has no enemy damage.
  const facts = factsFor(Array.from({ length: 6 }, (_, index) => event('LogPlayerTakeDamage', 10 + index, {
    attacker: character(ids[2]!),
    victim: character(ids[0]!),
    weapon: { itemId: 'PlayerMale_A_C' },
    damageTypeCategory: 'Damage_Punch',
    damage: 10,
    attackId: `punch-${index}`,
  })), { [ids[2]!]: { damage: 0 } });
  const events = generateFunEvents(facts, 20);
  const combo = events.find((item) => item.title === '🥊 先礼后兵');
  assert.ok(combo);
  assert.equal(combo?.text.includes('SG_LabmemNo007 6拳'), true);
  assertFunEvidence(facts, events);
});

test('V3.3 vehicle event shows victim and does not name unconfirmed driver', () => {
  const uncertain = factsFor([
    event('LogPlayerTakeDamage', 10, {
      attacker: character(ids[2]!),
      victim: character(ids[0]!),
      weapon: { itemId: 'BP_CoupeRB_C' },
      damageTypeCategory: 'Damage_VehicleHit',
      damage: 13,
      vehicleId: null,
    }),
  ]);
  const base = generateBaseFunEvents(uncertain);
  const hit = base.find((item) => item.type === 'VEHICLE_TEAM_HIT');
  assert.ok(hit);
  assert.equal(hit?.text.includes('SG_LabmemNo007'), true);
  assert.equal(hit?.text.includes('SG_LabmemNo004'), false);
});
