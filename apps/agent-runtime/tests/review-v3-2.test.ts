import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { DEFAULT_TEAM } from '../src/config/team.js';
import type { Coverage, SourceInfo } from '../src/schema/status.js';
import { buildDeterministicQuery } from '../src/planner/deterministic-planner.js';
import { FixtureDataProvider } from '../src/data/provider.js';
import { InMemoryContextStore, sessionIdForMessage } from '../src/context/context-store.js';
import { PubgMastraRuntime } from '../src/runtime/workflow.js';
import { TelegramAdapter } from '../src/platform/telegram/adapter.js';
import { extractMatchReviewFacts } from '../src/review/review-facts.js';
import { InMemoryTelemetryFeatureStore, JsonTelemetryFeatureStore, PubgApiTelemetryDownloader, TelemetryWorker, type TelemetryDownloader } from '../src/review/telemetry.js';
import { normalizeTelemetryEvents, parseTelemetryPayload } from '../src/review/telemetry-events.js';
import { analyzeMatchReview } from '../src/review/review-analyzer.js';
import { generateFunCandidates } from '../src/review/fun-candidate-generator.js';
import { buildReviewPresentation } from '../src/review/presentation.js';
import type { MatchReviewResult } from '../src/review/types.js';
import type { NormalizedMatch } from '../src/data/model.js';
import { FIXTURE_RECORDS, TEST_NOW } from './fixtures.js';

const REVIEW_NOW = new Date('2026-08-31T16:00:00.000Z');
const M2 = FIXTURE_RECORDS.find((match) => match.matchId === 'm2')!;
const M1 = FIXTURE_RECORDS.find((match) => match.matchId === 'm1')!;
const coverage: Coverage = {
  status: 'OK',
  complete: true,
  coverageStart: '2026-08-01T00:00:00.000Z',
  coverageEnd: TEST_NOW.toISOString(),
  checkedAt: TEST_NOW.toISOString(),
  failedMatchIds: [],
  sourceUnavailable: false,
  freshness: 'fresh',
};
const source: SourceInfo = {
  store: 'fixture',
  syncInvoked: false,
  playerApiCalls: 0,
  matchApiCalls: 0,
  localMatchCount: FIXTURE_RECORDS.length,
};

const player007 = DEFAULT_TEAM.players[0]!.id;
const player008 = DEFAULT_TEAM.players[1]!.id;
const player004 = DEFAULT_TEAM.players[2]!.id;
const enemy = (accountId: string) => ({ accountId });
const character = (accountId: string) => ({ accountId, name: accountId });
const rocket = { itemId: 'Item_Weapon_PanzerFaust100M_C' };
const matchStart = Date.parse(M2.createdAt!);

function at(seconds: number): string {
  return new Date(matchStart + seconds * 1000).toISOString();
}

function event(type: string, seconds: number, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { _T: type, _D: at(seconds), ...fields };
}

function eventFor(match: NormalizedMatch, type: string, seconds: number, fields: Record<string, unknown> = {}): Record<string, unknown> {
  const start = Date.parse(match.createdAt ?? '');
  return { _T: type, _D: Number.isFinite(start) ? new Date(start + seconds * 1000).toISOString() : undefined, ...fields };
}

const REVIEW_TELEMETRY: unknown[] = [
  event('LogItemPickup', 10, { character: character(player007), item: rocket }),
  event('LogItemPickup', 11, { character: character(player007), item: rocket }),
  event('LogItemPickup', 12, { character: character(player007), item: rocket }),
  event('LogPlayerAttack', 100, { attacker: character(player007), weapon: rocket, vehicle: { id: 'vehicle-1' }, attackId: 'rocket-1' }),
  event('LogPlayerTakeDamage', 101, { attacker: character(player007), victim: enemy('enemy-1'), damage: 120, damageCauserName: 'WeapPanzerFaust100M_C', attackId: 'rocket-1' }),
  event('LogPlayerMakeGroggy', 102, { attacker: character(player007), victim: enemy('enemy-1'), damageCauserName: 'WeapPanzerFaust100M_C', attackId: 'rocket-1' }),
  event('LogPlayerMakeGroggy', 103, { attacker: character(player008), victim: enemy('enemy-2'), damageCauserName: 'WeapM416_C' }),
  event('LogVehicleDestroy', 104, { attacker: character(player007), vehicle: { id: 'vehicle-1' }, weapon: rocket, attackId: 'rocket-1' }),
  event('LogPlayerKill', 105, { killer: character(player007), victim: enemy('enemy-1'), weapon: rocket, vehicleId: 'vehicle-1', attackId: 'rocket-1' }),
  event('LogPlayerKill', 106, { killer: character(player007), victim: enemy('enemy-2'), weapon: rocket, vehicleId: 'vehicle-1', attackId: 'rocket-1' }),
  event('LogPlayerRevive', 108, { reviver: character(player004), victim: character(player007) }),
  event('LogPlayerAttack', 200, { attacker: character(player007), weapon: rocket, attackId: 'rocket-2' }),
  event('LogPlayerTakeDamage', 201, { attacker: character(player007), victim: enemy('enemy-3'), damage: 100, damageCauserName: 'WeapPanzerFaust100M_C', attackId: 'rocket-2' }),
  event('LogVehicleRide', 299, { character: character(player007), vehicle: { vehicleType: 'Dacia' }, seatIndex: 0 }),
  event('LogPlayerPosition', 300, { character: character(player007), vehicle: { vehicleType: 'Dacia' }, seatIndex: 0, speed: 90, location: { x: 0, y: 0, z: 0 }, elapsedTime: 300 }),
  event('LogPlayerPosition', 305, { character: character(player007), vehicle: { vehicleType: 'Dacia' }, seatIndex: 0, speed: 112, location: { x: 380000, y: 0, z: 0 }, elapsedTime: 305 }),
];

class MockTelemetryDownloader implements TelemetryDownloader {
  calls = 0;

  async download(_match: NormalizedMatch): Promise<unknown> {
    this.calls += 1;
    return REVIEW_TELEMETRY;
  }
}

function telegramMessage(userId: number, chatId: number, text: string, date = REVIEW_NOW): ReturnType<TelegramAdapter['normalize']> {
  return new TelegramAdapter('test-telegram').normalize({
    update_id: 1,
    message: {
      message_id: Math.floor(Math.random() * 100000),
      date: Math.floor(date.getTime() / 1000),
      text,
      from: { id: userId, first_name: 'Test' },
      chat: { id: chatId, type: 'group', title: 'PUBG' },
    },
  });
}

function callbackMessage(userId: number, chatId: number, data: string): ReturnType<TelegramAdapter['normalize']> {
  return new TelegramAdapter('test-telegram').normalize({
    update_id: 2,
    callback_query: {
      id: 'callback-1',
      data,
      from: { id: userId, first_name: 'Clicker' },
      message: {
        message_id: 200,
        date: Math.floor(REVIEW_NOW.getTime() / 1000),
        text: '🎬 PUBG · 今日复盘',
        from: { id: 999, first_name: 'Bot' },
        chat: { id: chatId, type: 'group', title: 'PUBG' },
      },
    },
  });
}

function makeRuntime(
  downloader: TelemetryDownloader,
  store = new InMemoryContextStore(),
  records: NormalizedMatch[] = FIXTURE_RECORDS,
): PubgMastraRuntime {
  return new PubgMastraRuntime({
    provider: new FixtureDataProvider(records, coverage, { ...source, localMatchCount: records.length }),
    contextStore: store,
    team: DEFAULT_TEAM,
    telemetryWorker: new TelemetryWorker({
      team: DEFAULT_TEAM,
      downloader,
      store: new InMemoryTelemetryFeatureStore(),
    }),
  });
}

test('review intent branches separately and match selectors are explicit', () => {
  const picker = buildDeterministicQuery({ text: '帮我复盘今天', now: REVIEW_NOW });
  assert.equal(picker.operation, 'review_match');
  assert.equal(picker.matchSelector, null);

  const latest = buildDeterministicQuery({ text: '复盘今天最后一把', now: REVIEW_NOW });
  assert.equal(latest.operation, 'review_match');
  assert.deepEqual(latest.matchSelector, { type: 'latest', recent: false });
  const recent = buildDeterministicQuery({ text: '复盘刚才那把', now: REVIEW_NOW });
  assert.deepEqual(recent.matchSelector, { type: 'latest', recent: true });
  const ranked = buildDeterministicQuery({ text: '复盘今天伤害最高那把', now: REVIEW_NOW });
  assert.deepEqual(ranked.matchSelector, { type: 'ranked', metric: 'teamDamage', direction: 'desc' });

  const ordinal = buildDeterministicQuery({ text: '复盘昨天第二把', now: TEST_NOW });
  assert.deepEqual(ordinal.matchSelector, { type: 'ordinal', ordinal: 2 });
  assert.equal(buildDeterministicQuery({ text: '今天战绩', now: REVIEW_NOW }).operation, 'report');
  assert.equal(buildDeterministicQuery({ text: '昨天谁最强', now: TEST_NOW }).operation, 'strongest');
});

test('picker is ordered ASC, contains summary fields only, and does not fetch telemetry', async () => {
  const downloader = new MockTelemetryDownloader();
  const runtime = makeRuntime(downloader);
  const result = await runtime.handle({
    text: '帮我复盘今天',
    message: telegramMessage(100, -500, '帮我复盘今天'),
    now: REVIEW_NOW.toISOString(),
  });

  assert.equal(result.status, 'MATCH_SELECTION_REQUIRED');
  assert.equal(downloader.calls, 0);
  assert.equal(result.presentation?.type, 'review_match_picker');
  assert.deepEqual(result.data?.summary.candidateCount, 2);
  assert.deepEqual(result.presentation?.metadata.picker, true);
  assert.ok(result.presentation?.fallbackText.includes('Erangel'));
  assert.ok(result.presentation?.fallbackText.includes('Miramar'));
  assert.ok(result.presentation?.fallbackText.includes('伤害'));
  assert.equal(result.presentation?.fallbackText.includes('Telemetry'), false);
  const buttons = result.messages[0]?.buttons ?? [];
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0]?.callbackData.includes('m1'), false);
  assert.equal(buttons[1]?.callbackData.includes('m2'), false);
});

test('telegram callback deterministically resumes one match and enforces chat binding', async () => {
  const downloader = new MockTelemetryDownloader();
  const store = new InMemoryContextStore();
  const runtime = makeRuntime(downloader, store);
  const pickerMessage = telegramMessage(100, -501, '帮我复盘今天');
  const picker = await runtime.handle({ text: pickerMessage.message.text, message: pickerMessage, now: REVIEW_NOW.toISOString() });
  const callbackData = picker.messages[1]?.buttons?.[0]?.callbackData ?? picker.messages[0]?.buttons?.[0]?.callbackData;
  assert.ok(callbackData);
  assert.equal(callbackData.includes('m1'), false);
  assert.ok(callbackData.startsWith('pubg:m:'));

  const invalid = await runtime.handle({
    text: '',
    callbackData,
    message: callbackMessage(100, -999, callbackData),
    now: REVIEW_NOW.toISOString(),
  });
  assert.equal(invalid.status, 'INVALID_QUERY');
  assert.equal(downloader.calls, 0);

  const callback = await runtime.handle({
    text: '',
    callbackData,
    message: callbackMessage(100, -501, callbackData),
    now: REVIEW_NOW.toISOString(),
  });
  assert.equal(callback.status, 'OK');
  assert.equal(downloader.calls, 1);
  assert.equal(callback.query?.operation, 'review_match');
  assert.equal(callback.data?.summary.selectedMatchId, 'm1');
  assert.equal(callback.data?.summary.selectedOrdinal, 1);
  assert.equal(callback.presentation?.type, 'review_match');
  assert.ok(callback.response.includes('Panzerfaust'));
  assert.ok(callback.response.includes('乘车'));
  assert.equal(callback.response.includes('驾驶'), false);
  assert.equal(callback.normalizedMessage.user.platformUserId, '100');
  assert.equal(callback.callbackAnswer?.text, '已选择第1场');

  const context = await store.getContext(sessionIdForMessage(callbackMessage(100, -501, callbackData)));
  assert.equal(context?.activeMatchId, 'm1');
  assert.equal(context?.sourceMatchResultSetId !== null, true);
});

test('telegram callback preserves the source Picker ordinal for a non-first match', async () => {
  const downloader = new MockTelemetryDownloader();
  const thirdMatch: NormalizedMatch = {
    ...M1,
    matchId: 'm6',
    createdAt: '2026-08-31T23:30:00+08:00',
    timestamp: Date.parse('2026-08-31T23:30:00+08:00'),
    mapName: 'Taego',
  };
  const runtime = makeRuntime(downloader, new InMemoryContextStore(), [...FIXTURE_RECORDS, thirdMatch]);
  const pickerMessage = telegramMessage(100, -504, '帮我复盘今天');
  const picker = await runtime.handle({ text: pickerMessage.message.text, message: pickerMessage, now: REVIEW_NOW.toISOString() });
  const pickerMessageWithButtons = picker.messages.find((message) => message.buttons);
  const callbackData = pickerMessageWithButtons?.buttons?.[2]?.callbackData;
  assert.ok(callbackData);

  const callback = await runtime.handle({
    text: '',
    callbackData,
    message: callbackMessage(100, -504, callbackData),
    now: REVIEW_NOW.toISOString(),
  });

  assert.equal(callback.status, 'OK');
  assert.equal(callback.data?.summary.selectedMatchId, 'm6');
  assert.equal(callback.data?.summary.selectedOrdinal, 3);
  assert.equal(callback.presentation?.sections.some((section) => section.title === 'overview'), true);
  assert.equal(callback.callbackAnswer?.text, '已选择第3场');
});

test('telegram ordinal replies resume the pending Picker without an LLM route', async () => {
  const thirdMatch: NormalizedMatch = {
    ...M1,
    matchId: 'm6',
    createdAt: '2026-08-31T23:30:00+08:00',
    timestamp: Date.parse('2026-08-31T23:30:00+08:00'),
    mapName: 'Taego',
  };

  for (const input of ['3', '③', '第3场']) {
    const downloader = new MockTelemetryDownloader();
    const runtime = makeRuntime(downloader, new InMemoryContextStore(), [...FIXTURE_RECORDS, thirdMatch]);
    const pickerMessage = telegramMessage(100, -505, '复盘今天');
    const picker = await runtime.handle({
      text: pickerMessage.message.text,
      message: pickerMessage,
      now: REVIEW_NOW.toISOString(),
    });
    assert.equal(picker.status, 'MATCH_SELECTION_REQUIRED');

    const selectionMessage = telegramMessage(100, -505, input);
    const selection = await runtime.handle({
      text: selectionMessage.message.text,
      message: selectionMessage,
      now: REVIEW_NOW.toISOString(),
    });

    assert.equal(selection.status, 'OK');
    assert.equal(selection.query?.operation, 'review_match');
    assert.deepEqual(selection.query?.matchSelector, { type: 'ordinal', ordinal: 3 });
    assert.equal(selection.data?.summary.selectedMatchId, 'm6');
    assert.equal(selection.data?.summary.selectedOrdinal, 3);
    assert.equal(selection.trace.find((entry) => entry.stage === 'domain_router')?.details.reason, 'pending_match_selection');
    assert.equal(downloader.calls, 1);
  }
});

test('direct selector, active follow-ups, previous/next, and feature cache work', async () => {
  const downloader = new MockTelemetryDownloader();
  const store = new InMemoryContextStore();
  const runtime = makeRuntime(downloader, store);
  const message = telegramMessage(101, -502, '复盘今天最后一把');
  const direct = await runtime.handle({ text: message.message.text, message, now: REVIEW_NOW.toISOString() });
  assert.equal(direct.status, 'OK');
  assert.equal(direct.data?.summary.selectedMatchId, 'm2');
  assert.equal(direct.data?.summary.selectedOrdinal, 2);
  assert.equal(downloader.calls, 1);

  const strongest = await runtime.handle({ text: '这把谁最C', message: telegramMessage(101, -502, '这把谁最C'), now: REVIEW_NOW.toISOString() });
  assert.equal(strongest.query?.operation, 'review_match');
  assert.equal(strongest.query?.matchSelector?.type, 'active_match');
  assert.equal(strongest.data?.summary.selectedMatchId, 'm2');
  assert.equal(downloader.calls, 1);

  const personal = await runtime.handle({ text: 'SG_LabmemNo007这把怎么样', message: telegramMessage(101, -502, 'SG_LabmemNo007这把怎么样'), now: REVIEW_NOW.toISOString() });
  assert.equal(personal.query?.subject.type, 'player');
  assert.equal(personal.data?.summary.selectedMatchId, 'm2');

  const weapon = await runtime.handle({ text: '火箭筒呢', message: telegramMessage(101, -502, '火箭筒呢'), now: REVIEW_NOW.toISOString() });
  assert.equal(weapon.query?.presentation.profile, 'weapon');
  assert.equal(weapon.data?.summary.selectedMatchId, 'm2');

  const previous = await runtime.handle({ text: '上一把', message: telegramMessage(101, -502, '上一把'), now: REVIEW_NOW.toISOString() });
  assert.equal(previous.query?.matchSelector?.type, 'previous');
  assert.equal(previous.data?.summary.selectedMatchId, 'm1');
  assert.equal(previous.data?.summary.selectedOrdinal, 1);

  const next = await runtime.handle({ text: '下一把', message: telegramMessage(101, -502, '下一把'), now: REVIEW_NOW.toISOString() });
  assert.equal(next.query?.matchSelector?.type, 'next');
  assert.equal(next.data?.summary.selectedMatchId, 'm2');
  assert.equal(next.data?.summary.selectedOrdinal, 2);
  assert.equal(downloader.calls, 2);
});

test('ordinary V3 queries never enter ReviewSubgraph or download telemetry', async () => {
  const downloader = new MockTelemetryDownloader();
  const runtime = makeRuntime(downloader);
  const result = await runtime.handle({ text: '今天战绩', platform: 'kook', launcherType: 'group', launcherId: 'v3', senderId: 'user', now: REVIEW_NOW.toISOString() });
  assert.equal(result.query?.operation, 'report');
  assert.equal(result.status, 'OK');
  assert.equal(downloader.calls, 0);
  assert.equal(result.trace.some((entry) => entry.stage === 'operation_router' && entry.details.target === 'ReviewSubgraph'), false);

  const strongest = await runtime.handle({ text: '昨天谁最强', platform: 'kook', launcherType: 'group', launcherId: 'v3', senderId: 'user', now: TEST_NOW.toISOString() });
  assert.equal(strongest.query?.operation, 'strongest');
  assert.equal(downloader.calls, 0);
});

test('telemetry failure returns REVIEW_PARTIAL with the base match summary', async () => {
  let calls = 0;
  const runtime = makeRuntime({
    async download() {
      calls += 1;
      throw new Error('telemetry_http_503');
    },
  });
  const message = telegramMessage(102, -503, '复盘今天最后一把');
  const result = await runtime.handle({ text: message.message.text, message, now: REVIEW_NOW.toISOString() });

  assert.equal(result.status, 'REVIEW_PARTIAL');
  assert.equal(calls, 1);
  assert.equal(result.data?.summary.selectedMatchId, 'm2');
  assert.equal(result.data?.summary.selectedOrdinal, 2);
  assert.equal(result.response.includes('基础战绩已经找到'), true);
  assert.equal(result.response.includes('没有找到可复盘的比赛'), false);
});

test('facts aggregate fights and expose evidence-backed player, vehicle, and heavy weapon intelligence', () => {
  const facts = extractMatchReviewFacts(M2, REVIEW_TELEMETRY, DEFAULT_TEAM, 2);
  assert.equal(facts.match.ordinal, 2);
  assert.ok(facts.fights.length >= 2);
  assert.ok(facts.fights.some((fight) => fight.knocks >= 2 && fight.kills >= 2));
  assert.ok(facts.fights.every((fight) => fight.evidenceIds.length > 0));
  assert.equal(facts.combat.events.find((item) => item.type === 'DAMAGE')?.victimId, 'enemy-1');

  const operations = facts.players.flatMap((player) => player.keyOperations);
  assert.ok(operations.length > 0);
  assert.equal(new Set(operations.map((operation) => operation.id)).size, operations.length);
  assert.ok(facts.players.every((player) => player.keyOperations.length <= 3));
  assert.ok(facts.players.find((player) => player.playerId === player007)?.keyOperations.every((operation) => operation.evidenceIds.length > 0));

  const vehicle = facts.vehicles.find((item) => item.playerId === player007)!;
  assert.ok(vehicle.rideDistance >= 380000 / 100);
  assert.equal(vehicle.driveDistance, 0);
  assert.equal(vehicle.driver, false);
  assert.ok(vehicle.maxSpeed >= 112);
  assert.equal(vehicle.vehiclesDestroyed, 1);

  const heavy = facts.heavyWeapons.find((item) => item.playerId === player007)!;
  assert.equal(heavy.weapon, 'Panzerfaust');
  assert.equal(heavy.pickupEvents, 3);
  assert.ok(heavy.shots >= 2);
  assert.ok(heavy.hits >= 1);
  assert.equal(heavy.vehiclesDestroyed, 1);
  assert.ok(facts.specialEvents.some((item) => item.type === 'ROCKET_VEHICLE_MULTI_KILL'));
  assert.ok(facts.specialEvents.some((item) => item.type === 'ROCKET_MULTI_KILL'));
});

test('rocket special events require explicit evidence and distinguish unused or miss cases', () => {
  const unused = extractMatchReviewFacts(M1, [
    event('LogItemPickup', 10, { character: character(player007), item: rocket }),
    event('LogItemPickup', 11, { character: character(player007), item: rocket }),
    event('LogItemPickup', 12, { character: character(player007), item: rocket }),
  ], DEFAULT_TEAM);
  const unusedEvent = unused.specialEvents.find((item) => item.type === 'ROCKET_UNUSED');
  assert.equal(unusedEvent?.facts.pickupEvents, 3);
  assert.equal(unusedEvent?.facts.shots, 0);

  const miss = extractMatchReviewFacts(M1, [
    event('LogPlayerAttack', 10, { attacker: character(player007), weapon: rocket, attackId: 'miss' }),
  ], DEFAULT_TEAM);
  assert.equal(miss.specialEvents.some((item) => item.type === 'ROCKET_HIT'), false);
  const vehicleHit = extractMatchReviewFacts(M1, [
    event('LogPlayerAttack', 10, { attacker: character(player007), weapon: rocket, attackId: 'vehicle-hit', vehicle: { id: 'vehicle-hit' } }),
    event('LogVehicleDamage', 11, { attacker: character(player007), weapon: rocket, attackId: 'vehicle-hit', vehicle: { id: 'vehicle-hit' }, vehicleDamage: 250 }),
  ], DEFAULT_TEAM);
  assert.equal(vehicleHit.specialEvents.some((item) => item.type === 'ROCKET_MISS'), false);

  const insufficient = extractMatchReviewFacts(M1, [
    event('LogItemPickup', 10, { character: character(player007), item: rocket }),
    event('LogVehicleDestroy', 11, { attacker: character(player007), vehicle: { id: 'vehicle-unproven' } }),
    event('LogPlayerKill', 12, { killer: character(player007), victim: enemy('enemy-a'), vehicleId: 'vehicle-unproven' }),
    event('LogPlayerKill', 13, { killer: character(player007), victim: enemy('enemy-b'), vehicleId: 'vehicle-unproven' }),
    event('LogPlayerKill', 14, { killer: character(player007), victim: enemy('enemy-c'), vehicleId: 'vehicle-unproven' }),
    event('LogPlayerKill', 15, { killer: character(player007), victim: enemy('enemy-d'), vehicleId: 'vehicle-unproven' }),
  ], DEFAULT_TEAM);
  assert.equal(insufficient.specialEvents.some((item) => item.type === 'ROCKET_VEHICLE_MULTI_KILL'), false);
  assert.equal(insufficient.specialEvents.some((item) => item.type === 'ROCKET_MULTI_KILL'), false);

  const proximityOnly = extractMatchReviewFacts(M1, [
    event('LogPlayerAttack', 10, { attacker: character(player007), weapon: rocket, vehicle: { id: 'vehicle-proximity' }, attackId: 'rocket-other' }),
    event('LogVehicleDestroy', 11, { attacker: character(player007), vehicle: { id: 'vehicle-proximity' }, weapon: rocket, attackId: 'rocket-destroy' }),
    event('LogPlayerKill', 12, { killer: character(player007), victim: enemy('enemy-e'), vehicleId: 'vehicle-proximity' }),
    event('LogPlayerKill', 13, { killer: character(player007), victim: enemy('enemy-f'), vehicleId: 'vehicle-proximity' }),
  ], DEFAULT_TEAM);
  assert.equal(proximityOnly.specialEvents.some((item) => item.type === 'ROCKET_VEHICLE_MULTI_KILL'), false);
});

test('feature cache rebinds ordinal without reparsing the same match', async () => {
  const downloader = new MockTelemetryDownloader();
  const worker = new TelemetryWorker({ team: DEFAULT_TEAM, downloader, store: new InMemoryTelemetryFeatureStore() });
  const first = await worker.ensure(M2, 2);
  const second = await worker.ensure(M2, 1);
  assert.equal(first.status, 'MISS');
  assert.equal(second.status, 'HIT');
  assert.equal(first.facts?.match.ordinal, 2);
  assert.equal(second.facts?.match.ordinal, 1);
  assert.equal(downloader.calls, 1);
});

test('JSON feature store persists derived facts without the normalized event stream', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pubg-review-features-'));
  const filePath = path.join(directory, 'features.json');
  try {
    const facts = extractMatchReviewFacts(M2, REVIEW_TELEMETRY, DEFAULT_TEAM, 2);
    const store = new JsonTelemetryFeatureStore(filePath);
    await store.set({
      matchId: M2.matchId,
      parserVersion: 'parser-test',
      featureVersion: 'features-test',
      facts,
      createdAt: REVIEW_NOW.toISOString(),
    });

    const persisted = JSON.parse(await readFile(filePath, 'utf8')) as { features: Record<string, { facts: typeof facts }> };
    const record = Object.values(persisted.features)[0];
    assert.ok(record);
    assert.equal(record.facts.combat.events.length, 0);
    assert.ok(record.facts.evidence.length < facts.evidence.length);

    const cached = await store.get({ matchId: M2.matchId, parserVersion: 'parser-test', featureVersion: 'features-test' });
    assert.equal(cached?.facts.combat.events.length, 0);
    assert.equal(cached?.facts.specialEvents.some((item) => item.type === 'ROCKET_VEHICLE_MULTI_KILL'), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('PUBG API telemetry downloader resolves the asset and decodes gzip payloads', async () => {
  const payload = JSON.stringify([{ _T: 'LogPlayerAttack', _D: at(10), attacker: character(player007) }]);
  const urls: string[] = [];
  const authorizations: string[] = [];
  const downloader = new PubgApiTelemetryDownloader({
    apiKey: 'test-key',
    fetchImpl: async (input, init) => {
      const url = String(input);
      urls.push(url);
      authorizations.push(String(new Headers(init?.headers).get('authorization')));
      if (url.includes('/matches/')) {
        return new Response(JSON.stringify({
          data: { relationships: { assets: { data: [{ id: 'asset-1' }] } } },
          included: [{ type: 'asset', id: 'asset-1', attributes: { URL: 'https://telemetry.example/asset.gz' } }],
        }), { status: 200, headers: { 'content-type': 'application/vnd.api+json' } });
      }
      return new Response(gzipSync(Buffer.from(payload)) as unknown as BodyInit, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    },
  });

  const raw = await downloader.download(M2);
  assert.deepEqual(parseTelemetryPayload(raw), JSON.parse(payload));
  assert.ok(urls[0]?.includes('/shards/steam/matches/m2'));
  assert.equal(urls[1], 'https://telemetry.example/asset.gz');
  assert.equal(authorizations[0], 'Bearer test-key');
  assert.equal(authorizations[1], 'null');
});

test('PUBG API downloader preserves a credential that already contains Bearer', async () => {
  const authorizations: string[] = [];
  const downloader = new PubgApiTelemetryDownloader({
    apiKey: 'Bearer prefixed-key',
    fetchImpl: async (_url, init) => {
      authorizations.push(String(new Headers(init?.headers).get('authorization')));
      return authorizations.length === 1
        ? new Response(JSON.stringify({
            data: { relationships: { assets: { data: [{ id: 'asset-1', type: 'asset' }] } } },
            included: [{ type: 'asset', id: 'asset-1', attributes: { URL: 'https://telemetry.test/asset' } }],
          }), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify({ telemetry: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  await downloader.download({
    schemaVersion: 1,
    matchId: 'm1',
    shard: 'steam',
    matchType: 'official',
    patchVersion: 'unknown',
    timestamp: Date.parse('2026-09-02T10:00:00Z'),
    createdAt: '2026-09-02T10:00:00Z',
    mapName: 'Erangel',
    gameMode: 'squad-fpp',
    duration: 100,
    isCompetitive: true,
    players: [],
  });
  assert.deepEqual(authorizations, ['Bearer prefixed-key', 'null']);
});

test('fight analytics stays in tracked-team scope, de-duplicates final events, and splits inactive gaps', () => {
  const telemetry = [
    eventFor(M1, 'LogPlayerTakeDamage', 10, { attacker: character(player007), victim: { accountId: 'enemy-a', teamId: 'opponent-a' }, damage: 100, attackId: 'attack-a' }),
    eventFor(M1, 'LogPlayerMakeGroggy', 11, { attacker: character(player007), victim: { accountId: 'enemy-a', teamId: 'opponent-a' }, dBNOId: 'dbno-a', attackId: 'attack-a' }),
    eventFor(M1, 'LogPlayerMakeGroggy', 11, { attacker: character(player007), victim: { accountId: 'enemy-a', teamId: 'opponent-a' }, dBNOId: 'dbno-a', attackId: 'attack-a' }),
    eventFor(M1, 'LogPlayerKill', 12, { killer: character(player007), victim: { accountId: 'enemy-a', teamId: 'opponent-a' }, dBNOId: 'dbno-a', attackId: 'attack-a' }),
    eventFor(M1, 'LogPlayerKill', 13, { killer: character(player007), finisher: character(player007), victim: { accountId: 'enemy-a', teamId: 'opponent-a' }, dBNOId: 'dbno-a', attackId: 'attack-a' }),
    eventFor(M1, 'LogPlayerTakeDamage', 14, { attacker: { accountId: 'enemy-x', teamId: 'opponent-b' }, victim: { accountId: 'enemy-y', teamId: 'opponent-b' }, damage: 999 }),
    eventFor(M1, 'LogPlayerTakeDamage', 15, { attacker: { accountId: 'enemy-x', teamId: 'opponent-b' }, victim: character(player008), damage: 50 }),
    eventFor(M1, 'LogPlayerTakeDamage', 50, { attacker: character(player007), victim: { accountId: 'enemy-b', teamId: 'opponent-c' }, damage: 100, attackId: 'attack-b' }),
  ];
  const facts = extractMatchReviewFacts(M1, telemetry, DEFAULT_TEAM);

  assert.equal(facts.fights.length, 2);
  assert.equal(facts.combat.kills, 1);
  assert.equal(facts.combat.knocks, 1);
  assert.equal(facts.fights[0]?.teamKills, 1);
  assert.equal(facts.fights[0]?.teamKnocks, 1);
  assert.equal(facts.fights[0]?.teamDamage, 100);
  assert.equal(facts.fights[0]?.receivedDamage, 50);
  assert.equal(facts.fights[1]?.teamDamage, 100);
  assert.equal(facts.fights.some((fight) => fight.end - fight.start > 28), false);
  assert.equal(facts.fightIntegrity.pass, true);
  assert.ok(facts.fightIntegrity.diagnostics.candidateCombatEvents > facts.fightIntegrity.diagnostics.trackedRelevantEvents);
  assert.ok(facts.fightIntegrity.diagnostics.ignoredGlobalEvents >= 1);
  const globalEvent = facts.combat.events.find((eventItem) => eventItem.victimId === 'enemy-y');
  assert.ok(globalEvent);
  assert.equal(facts.fights.some((fight) => fight.evidenceIds.includes(globalEvent!.id)), false);
  assert.deepEqual(facts.fights.map((fight) => fight.opponentTeamIds), [['opponent-a', 'opponent-b'], ['opponent-c']]);
});

test('integrity failure suppresses invalid fight output and keeps diagnostics', () => {
  const telemetry = [1, 2, 3, 4].map((index) => eventFor(M2, 'LogPlayerKill', index, {
    killer: character(player007),
    victim: enemy(`over-count-${index}`),
    attackId: `over-count-attack-${index}`,
  }));
  const facts = extractMatchReviewFacts(M2, telemetry, DEFAULT_TEAM, 2);
  assert.equal(facts.fightIntegrity.pass, false);
  assert.ok(facts.fightIntegrity.errors.includes(`fight_player_kills_exceed_match:${player007}`));
  assert.equal(facts.fightIntegrity.diagnostics.fightCount, 1);

  const review: MatchReviewResult = {
    schemaVersion: 1,
    match: facts.match,
    facts,
    analysis: analyzeMatchReview(facts),
    telemetry: { status: 'MISS', parserVersion: 'test-parser', featureVersion: 'test-features' },
  };
  const query = buildDeterministicQuery({ text: '复盘今天最后一把', now: REVIEW_NOW });
  const presentation = buildReviewPresentation(review, query, null);
  const fightSection = presentation.sections.find((section) => section.type === 'key_fights');
  assert.ok(fightSection);
  assert.ok(fightSection?.text?.includes('详细团战数据未通过一致性校验，暂不展示'));
  assert.equal(fightSection?.text?.includes('4杀'), false);
  assert.equal(review.analysis.keyFights.length, 0);
});

test('vehicle facts distinguish riding from confirmed driving and omit unreliable time', () => {
  const rideOnlyTelemetry = [
    eventFor(M1, 'LogVehicleRide', 10, { character: character(player007), vehicle: { id: 'car-ride', vehicleType: 'Dacia' }, seatIndex: 0 }),
    eventFor(M1, 'LogVehicleLeave', 20, { character: character(player007), vehicle: { id: 'car-ride', vehicleType: 'Dacia' }, seatIndex: 0, rideDistance: 7900 }),
    { _T: 'LogPlayerTakeDamage', _D: 'not-a-timestamp', elapsedTime: 0, attacker: character(player007), victim: enemy('timestamp-enemy'), damage: 100 },
  ];
  const normalized = normalizeTelemetryEvents(rideOnlyTelemetry, M1);
  const ride = normalized.find((eventItem) => eventItem.type === 'VEHICLE_RIDE');
  const invalidTime = normalized.find((eventItem) => eventItem.type === 'DAMAGE');
  assert.equal(ride?.seatIndex, 0);
  assert.equal(invalidTime?.timeSeconds, null);

  const facts = extractMatchReviewFacts(M1, rideOnlyTelemetry, DEFAULT_TEAM);
  const vehicle = facts.vehicles.find((item) => item.playerId === player007)!;
  assert.equal(vehicle.rideDistance, 7900);
  assert.equal(vehicle.driveDistance, 0);
  assert.equal(vehicle.driverConfirmed, false);
  assert.equal(vehicle.driver, false);
  assert.equal(facts.players.find((player) => player.playerId === player007)?.keyOperations.some((operation) => operation.type === 'VEHICLE'), false);
  assert.equal(facts.players.find((player) => player.playerId === player007)?.keyOperations.some((operation) => operation.time === 0), false);

  const review: MatchReviewResult = {
    schemaVersion: 1,
    match: facts.match,
    facts,
    analysis: analyzeMatchReview(facts),
    telemetry: { status: 'MISS', parserVersion: 'test-parser', featureVersion: 'test-features' },
  };
  const presentation = buildReviewPresentation(review, buildDeterministicQuery({ text: '复盘今天最后一把', now: REVIEW_NOW }), null);
  assert.ok(presentation.fallbackText.includes('乘车7.9km'));
  assert.equal(presentation.fallbackText.includes('驾驶'), false);
  assert.equal(presentation.fallbackText.includes('00:00'), false);

  const confirmedDriver = extractMatchReviewFacts(M1, [
    eventFor(M1, 'LogVehicleRide', 10, { character: character(player007), vehicle: { id: 'car-driver' }, seatIndex: 2, driverConfirmed: true }),
    eventFor(M1, 'LogVehicleLeave', 20, { character: character(player007), vehicle: { id: 'car-driver' }, seatIndex: 2, driverConfirmed: true, rideDistance: 3800 }),
  ], DEFAULT_TEAM);
  const driver = confirmedDriver.vehicles.find((item) => item.playerId === player007)!;
  assert.equal(driver.driverConfirmed, true);
  assert.equal(driver.driveDistance, 3800);
});

test('player commentary can be neutral or negative without inventing a role', () => {
  const quietMatch: NormalizedMatch = {
    ...M1,
    players: M1.players.map((player) => player.accountId === player007
      ? { ...player, kills: 0, assists: 0, damage: 0, dbnos: 0, revives: 0 }
      : player),
  };
  const facts = extractMatchReviewFacts(quietMatch, [], DEFAULT_TEAM);
  const commentary = analyzeMatchReview(facts).playerCommentary.find((item) => item.playerId === player007)!;
  assert.ok(commentary.text.includes('未检测到有效关键贡献'));
  assert.equal(commentary.role, undefined);
  assert.equal(commentary.roleConfidence, 'none');
  assert.equal(commentary.operationIds.length, 0);

  const teammate = analyzeMatchReview(facts).playerCommentary.find((item) => item.playerId === player004)!;
  assert.equal(teammate.text.includes('未检测到有效关键贡献'), false);
});

test('fun candidates use facts/evidence and dynamic rocket labels', () => {
  const facts = extractMatchReviewFacts(M1, REVIEW_TELEMETRY, DEFAULT_TEAM, 1);
  const candidates = generateFunCandidates(facts, 20);
  const vehicleMulti = candidates.find((candidate) => candidate.type === 'ROCKET_VEHICLE_MULTI_KILL');
  assert.ok(vehicleMulti);
  assert.equal(vehicleMulti?.title.includes('一炮四响'), false);
  assert.ok(vehicleMulti?.title.includes('一炮2响'));
  assert.ok(candidates.some((candidate) => candidate.type === 'ROCKET_MULTI_KILL'));
  for (const candidate of candidates) {
    assert.ok(candidate.evidenceIds.length > 0);
    assert.equal(candidate.evidenceIds.every((id) => facts.evidence.some((evidence) => evidence.id === id)), true);
  }

  const noShot = extractMatchReviewFacts(M1, [
    eventFor(M1, 'LogItemPickup', 10, { character: character(player007), item: rocket }),
    eventFor(M1, 'LogItemPickup', 11, { character: character(player007), item: rocket }),
    eventFor(M1, 'LogItemPickup', 12, { character: character(player007), item: rocket }),
    eventFor(M1, 'LogWeaponFireCount', 13, { character: character(player007), weapon: rocket, fireCount: 99 }),
  ], DEFAULT_TEAM);
  const unused = noShot.specialEvents.find((eventItem) => eventItem.type === 'ROCKET_UNUSED');
  assert.equal(unused?.facts.shots, 0);
  assert.equal(noShot.specialEvents.some((eventItem) => eventItem.type === 'ROCKET_HIT'), false);
  assert.ok(generateFunCandidates(noShot, 20).some((candidate) => candidate.type === 'ROCKET_UNUSED'));
});

test('multi-knock special events are attributed to the player with knock evidence', () => {
  const match: NormalizedMatch = {
    ...M1,
    players: M1.players.map((player) => player.accountId === player008 ? { ...player, damage: 1000 } : player),
  };
  const facts = extractMatchReviewFacts(match, [
    eventFor(match, 'LogPlayerTakeDamage', 10, { attacker: character(player008), victim: enemy('damage-target'), damage: 1000 }),
    eventFor(match, 'LogPlayerMakeGroggy', 11, { attacker: character(player007), victim: enemy('knock-target-1'), dBNOId: 'special-dbno-1' }),
    eventFor(match, 'LogPlayerMakeGroggy', 12, { attacker: character(player007), victim: enemy('knock-target-2'), dBNOId: 'special-dbno-2' }),
  ], DEFAULT_TEAM);
  assert.equal(facts.fightIntegrity.pass, true);
  assert.equal(facts.fights[0]?.keyPlayers[0], player008);
  const multiKnock = facts.specialEvents.find((eventItem) => eventItem.type === 'MULTI_KNOCK');
  assert.equal(multiKnock?.playerId, player007);
  assert.equal(multiKnock?.facts.knocks, 2);
  assert.equal(multiKnock?.evidenceIds.length, 2);
});
