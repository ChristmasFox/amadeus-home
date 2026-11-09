import assert from 'node:assert/strict';
import test from 'node:test';
import {
  announcementKey, applyObservation, DEFAULT_POLICY, normalizeState, parseSteamReference, planBroadcast, POLL_INTERVAL_MS,
  type PresenceObservation, type StoredPresence,
} from '../src/steam/domain.js';

const DAY = Date.parse('2026-11-09T04:00:00Z'); // 12:00 Asia/Shanghai
const NIGHT = Date.parse('2026-11-08T17:00:00Z'); // 01:00 Asia/Shanghai
const ID = '76561190000000001';
const obs = (state: PresenceObservation['state'], extra: Partial<PresenceObservation> = {}): PresenceObservation => ({ steamId: ID, state, personaState: state === 'offline' ? 0 : 1, profilePublic: true, ...extra });

test('references: id, profile links and vanity names; garbage is rejected', () => {
  assert.deepEqual(parseSteamReference('76561190000000001'), { kind: 'steamid', steamId: ID });
  assert.deepEqual(parseSteamReference('https://steamcommunity.com/profiles/76561190000000001/'), { kind: 'steamid', steamId: ID });
  assert.deepEqual(parseSteamReference('steamcommunity.com/id/some_name'), { kind: 'vanity', vanity: 'some_name' });
  assert.deepEqual(parseSteamReference('some_name'), { kind: 'vanity', vanity: 'some_name' });
  for (const bad of ['', ' ', 'a', 'https://example.com/id/x', 'has space', 'https://steamcommunity.com/profiles/123']) assert.equal(parseSteamReference(bad), undefined, bad);
});

test('persona states normalise to the four presence states', () => {
  assert.equal(normalizeState(undefined, undefined), 'offline');
  assert.equal(normalizeState(0, undefined), 'offline');
  assert.equal(normalizeState(1, undefined), 'online');
  assert.equal(normalizeState(1, '730'), 'in_game');
  assert.equal(normalizeState(3, undefined), 'away');
  assert.equal(normalizeState(4, '730'), 'away');
  assert.equal(normalizeState(6, undefined), 'online');
});

test('the first observation is a baseline and never an event', () => {
  const result = applyObservation(undefined, obs('online'), DAY);
  assert.equal(result.event, undefined);
  assert.equal(result.next.state, 'online');
});

/** Feed one observation per minute; returns every event. */
function run(start: StoredPresence | undefined, steps: PresenceObservation[], from = DAY): { record: StoredPresence | undefined; events: Array<NonNullable<ReturnType<typeof applyObservation>['event']>> } {
  let record = start;
  const events: Array<NonNullable<ReturnType<typeof applyObservation>['event']>> = [];
  steps.forEach((step, index) => {
    const result = applyObservation(record, step, from + index * 60_000);
    record = result.next;
    if (result.event) events.push(result.event);
  });
  return { record, events };
}

test('there is no debounce: one observation of a change is an event', () => {
  const base = applyObservation(undefined, obs('offline'), DAY).next;
  const result = applyObservation(base, obs('in_game', { gameId: '730', gameName: 'Some Game' }), DAY + 60_000);
  assert.deepEqual(result.event, { steamId: ID, kind: 'came_online', gameId: '730', gameName: 'Some Game', at: DAY + 60_000 });
  assert.equal(result.next.state, 'in_game');
  assert.equal(applyObservation(result.next, obs('in_game', { gameId: '730' }), DAY + 120_000).event, undefined);
});

test('the four event types: came online, started playing, switched game, back from away', () => {
  const kinds = (steps: PresenceObservation[], start?: StoredPresence) => run(start, steps).events.map((event) => event.kind);
  assert.deepEqual(kinds([obs('offline'), obs('online')]), ['came_online']);
  assert.deepEqual(kinds([obs('online'), obs('in_game', { gameId: '1', gameName: 'G1' })]), ['started_playing']);
  assert.deepEqual(kinds([obs('in_game', { gameId: '1' }), obs('in_game', { gameId: '2' }), obs('in_game', { gameId: '1' })]), ['switched_game', 'switched_game']);
  assert.deepEqual(kinds([obs('away'), obs('online')]), ['back_from_away']);
  assert.deepEqual(kinds([obs('away'), obs('in_game', { gameId: '3' })]), ['back_from_away']);
});

test('stopping a game, going away or going offline are not announced; the first observation is silent', () => {
  assert.deepEqual(run(undefined, [obs('in_game', { gameId: '1' }), obs('online'), obs('away'), obs('offline')]).events, []);
  assert.deepEqual(run(undefined, [obs('in_game', { gameId: '1' })]).events, []);
});

test('polling is every 30 seconds around the clock, and nothing else limits announcements', () => {
  assert.equal(POLL_INTERVAL_MS, 30_000);
  assert.deepEqual(DEFAULT_POLICY, { mergeWindowMs: 3 * 60_000 });
});

test('planning: events inside the merge window wait, then everything queued goes out in one batch, at any hour', () => {
  const a = { steamId: 'a', kind: 'came_online' as const, at: DAY };
  const b = { steamId: 'b', kind: 'switched_game' as const, at: DAY + 60_000 };
  assert.deepEqual(planBroadcast([a, b], DAY + 60_000).waiting, ['a', 'b']);
  assert.deepEqual(planBroadcast([a, b], DAY + 200_000).send?.map((entry) => entry.steamId), ['a', 'b']);
  const night = { steamId: 'n', kind: 'came_online' as const, at: NIGHT };
  assert.equal(planBroadcast([night], NIGHT + 600_000).send?.length, 1);
  const many = Array.from({ length: 20 }, (_, index) => ({ steamId: `p${index}`, kind: 'came_online' as const, at: DAY }));
  assert.equal(planBroadcast(many, DAY + 200_000).send?.length, 20);
});

test('announcement keys are stable regardless of order', () => {
  const x = { steamId: 'a', kind: 'came_online' as const, at: 1 };
  const y = { steamId: 'b', kind: 'came_online' as const, at: 2 };
  assert.equal(announcementKey('g', [x, y]), announcementKey('g', [y, x]));
});
