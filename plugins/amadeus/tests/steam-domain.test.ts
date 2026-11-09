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
  assert.deepEqual(b.event, { steamId: ID, gameId: '730', gameName: 'Some Game', at: DAY + 180_000 });
  assert.equal(b.next.state, 'in_game');
});

test('starting a game while online and coming back from away are not arrivals', () => {
  const online = applyObservation(undefined, obs('online'), DAY).next;
  const g1 = applyObservation(online, obs('in_game', { gameId: '1' }), DAY + 60_000);
  const g2 = applyObservation(g1.next, obs('in_game', { gameId: '1' }), DAY + 120_000);
  assert.equal(g2.event, undefined);
  const away = applyObservation(applyObservation(g2.next, obs('away'), DAY + 180_000).next, obs('away'), DAY + 240_000).next;
  const back1 = applyObservation(away, obs('online'), DAY + 300_000);
  const back2 = applyObservation(back1.next, obs('online'), DAY + 360_000);
  assert.equal(back2.event, undefined);
});

test('quiet hours 00:00-09:00 Asia/Shanghai and the matching poll interval', () => {
  assert.equal(inQuietHours(NIGHT), true);
  assert.equal(inQuietHours(DAY), false);
  assert.equal(inQuietHours(Date.parse('2026-11-08T16:00:00Z')), true); // 00:00 sharp
  assert.equal(inQuietHours(Date.parse('2026-11-09T00:59:59Z')), true); // 08:59
  assert.equal(inQuietHours(Date.parse('2026-11-09T01:00:00Z')), false); // 09:00
  assert.equal(pollIntervalMs(DAY), 60_000);
  assert.equal(pollIntervalMs(NIGHT), 300_000);
});

test('planning: quiet-hour and cooldown drops are final, simultaneous arrivals wait then merge', () => {
  const a = { steamId: 'a', at: DAY };
  const b = { steamId: 'b', at: DAY + 60_000 };
  assert.deepEqual(planBroadcast([a], DAY, 0).skipped, []);
  assert.deepEqual(planBroadcast([a, b], DAY + 60_000, 0).waiting, ['a', 'b']);
  const merged = planBroadcast([a, b], DAY + 200_000, 0);
  assert.deepEqual(merged.send?.map((entry) => entry.steamId), ['a', 'b']);
  assert.deepEqual(planBroadcast([{ steamId: 'n', at: NIGHT }], NIGHT + 600_000, 0).skipped, [{ steamId: 'n', reason: 'quiet_hours' }]);
  assert.deepEqual(planBroadcast([{ ...a, lastNotifiedAt: DAY - 30 * 60_000 }], DAY + 200_000, 0).skipped, [{ steamId: 'a', reason: 'cooldown' }]);
  assert.equal(planBroadcast([{ ...a, lastNotifiedAt: DAY - 61 * 60_000 }], DAY + 200_000, 0).send?.length, 1);
});

test('planning: at most six announcements per group per hour', () => {
  const plan = planBroadcast([{ steamId: 'a', at: DAY }], DAY + 200_000, DEFAULT_POLICY.maxPerGroupPerHour);
  assert.equal(plan.send, undefined);
  assert.deepEqual(plan.skipped, [{ steamId: 'a', reason: 'rate_limited' }]);
});

test('announcement keys are stable regardless of order', () => {
  const x = { steamId: 'a', at: 1 };
  const y = { steamId: 'b', at: 2 };
  assert.equal(announcementKey('g', [x, y]), announcementKey('g', [y, x]));
});
