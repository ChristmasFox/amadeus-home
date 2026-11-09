import assert from 'node:assert/strict';
import test from 'node:test';
import {
  announcementKey, applyObservation, DEFAULT_POLICY, inQuietHours, normalizeState, parseSteamReference, planBroadcast, pollIntervalMs,
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

test('a change needs two consecutive observations; a flap is absorbed', () => {
  let record: StoredPresence = applyObservation(undefined, obs('offline'), DAY).next;
  const first = applyObservation(record, obs('online'), DAY + 60_000);
  assert.equal(first.event, undefined);
  assert.equal(first.next.state, 'offline');
  const flapBack = applyObservation(first.next, obs('offline'), DAY + 120_000);
  assert.equal(flapBack.event, undefined);
  assert.equal(flapBack.next.pending, undefined);
  record = flapBack.next;
  const a = applyObservation(record, obs('in_game', { gameId: '730', gameName: 'Some Game' }), DAY + 180_000);
  const b = applyObservation(a.next, obs('in_game', { gameId: '730', gameName: 'Some Game' }), DAY + 240_000);
  assert.deepEqual(b.event, { steamId: ID, kind: 'came_online', gameId: '730', gameName: 'Some Game', at: DAY + 180_000 });
  assert.equal(b.next.state, 'in_game');
});

/** Feed observations one minute apart; returns every confirmed event. */
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

test('online -> in_game is started_playing after two observations; one is not enough', () => {
  const base = applyObservation(undefined, obs('online'), DAY).next;
  assert.deepEqual(run(base, [obs('in_game', { gameId: '1', gameName: 'G1' })], DAY + 60_000).events, []);
  const { events } = run(base, [obs('in_game', { gameId: '1', gameName: 'G1' }), obs('in_game', { gameId: '1', gameName: 'G1' })], DAY + 60_000);
  assert.deepEqual(events.map((event) => [event.kind, event.gameName]), [['started_playing', 'G1']]);
});

test('switching games is announced after two observations; a one-poll blip and stopping a game are not', () => {
  const playing = run(undefined, [obs('in_game', { gameId: '1', gameName: 'G1' })]).record;
  const blip = run(playing, [obs('in_game', { gameId: '2', gameName: 'G2' }), obs('in_game', { gameId: '1', gameName: 'G1' }), obs('in_game', { gameId: '1', gameName: 'G1' })], DAY + 60_000);
  assert.deepEqual(blip.events, []);
  assert.equal(blip.record?.gameId, '1');
  const swap = run(playing, [obs('in_game', { gameId: '2', gameName: 'G2' }), obs('in_game', { gameId: '2', gameName: 'G2' })], DAY + 60_000);
  assert.deepEqual(swap.events.map((event) => [event.kind, event.gameName]), [['switched_game', 'G2']]);
  assert.deepEqual(run(playing, [obs('online'), obs('online')], DAY + 60_000).events, []);
});

test('coming back from away is back_from_away and carries how long the away lasted', () => {
  const online = applyObservation(undefined, obs('online'), DAY).next;
  const away = run(online, [obs('away'), obs('away')], DAY + 60_000).record;
  assert.equal(away?.state, 'away');
  const back = run(away, [obs('in_game', { gameId: '3', gameName: 'G3' }), obs('in_game', { gameId: '3', gameName: 'G3' })], DAY + 20 * 60_000);
  assert.equal(back.events[0]?.kind, 'back_from_away');
  assert.equal(back.events[0]?.gameName, 'G3');
  assert.deepEqual(run(away, [obs('offline'), obs('offline')], DAY + 20 * 60_000).events, []);
});

test('there is no per-person cooldown: events of one person are all planned, only quiet hours and the group cap drop them', () => {
  const events = ['came_online', 'started_playing', 'switched_game', 'back_from_away'] as const;
  const plan = planBroadcast(events.map((kind, index) => ({ steamId: `p${index}`, kind, at: DAY })), DAY + 200_000, 0);
  assert.equal(plan.send?.length, 4);
  assert.deepEqual(plan.skipped, []);
  assert.equal('cooldownMs' in DEFAULT_POLICY, false);
});

test('polling is once a minute around the clock; quiet hours silence announcements only', () => {
  assert.equal(pollIntervalMs(DAY), 60_000);
  assert.equal(pollIntervalMs(NIGHT), 60_000);
  assert.equal(inQuietHours(NIGHT), true);
});

test('quiet hours 00:00-09:00 Asia/Shanghai and the matching poll interval', () => {
  assert.equal(inQuietHours(NIGHT), true);
  assert.equal(inQuietHours(DAY), false);
  assert.equal(inQuietHours(Date.parse('2026-11-08T16:00:00Z')), true); // 00:00 sharp
  assert.equal(inQuietHours(Date.parse('2026-11-09T00:59:59Z')), true); // 08:59
  assert.equal(inQuietHours(Date.parse('2026-11-09T01:00:00Z')), false); // 09:00
  assert.equal(pollIntervalMs(DAY), 60_000);
  assert.equal(pollIntervalMs(NIGHT), 60_000);
});

test('planning: quiet-hour and cooldown drops are final, simultaneous arrivals wait then merge', () => {
  const a = { steamId: 'a', kind: 'came_online' as const, at: DAY };
  const b = { steamId: 'b', kind: 'came_online' as const, at: DAY + 60_000 };
  assert.deepEqual(planBroadcast([a], DAY, 0).skipped, []);
  assert.deepEqual(planBroadcast([a, b], DAY + 60_000, 0).waiting, ['a', 'b']);
  const merged = planBroadcast([a, b], DAY + 200_000, 0);
  assert.deepEqual(merged.send?.map((entry) => entry.steamId), ['a', 'b']);
  assert.deepEqual(planBroadcast([{ steamId: 'n', kind: 'came_online', at: NIGHT }], NIGHT + 600_000, 0).skipped, [{ steamId: 'n', reason: 'quiet_hours' }]);
});

test('planning: at most six announcements per group per hour', () => {
  const plan = planBroadcast([{ steamId: 'a', kind: 'came_online', at: DAY }], DAY + 200_000, DEFAULT_POLICY.maxPerGroupPerHour);
  assert.equal(plan.send, undefined);
  assert.deepEqual(plan.skipped, [{ steamId: 'a', reason: 'rate_limited' }]);
});

test('announcement keys are stable regardless of order', () => {
  const x = { steamId: 'a', kind: 'came_online' as const, at: 1 };
  const y = { steamId: 'b', kind: 'came_online' as const, at: 2 };
  assert.equal(announcementKey('g', [x, y]), announcementKey('g', [y, x]));
});
