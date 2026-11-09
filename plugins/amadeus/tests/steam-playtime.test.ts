import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlayerSummary } from '../src/steam/client.js';
import { steamPlaytimeSection } from '../src/steam/daily.js';
import { PresencePoller } from '../src/steam/poller.js';
import { SteamStore } from '../src/steam/store.js';
import { aggregatePlay, businessDayLabel, businessDayStart, playtimeWindow, steamGetPlaytime, type SteamCaller, type SteamToolDependencies } from '../src/steam/tools.js';

const MIN = 60_000;
const HOUR = 3_600_000;
const ID1 = '76561190000000001';
const ID2 = '76561190000000002';
const GROUP = '120363000000000000@g.us';
// Singapore 06:00 on 2026-11-09 (= 2026-11-08T22:00Z): the start of business day 2026-11-09.
const D9 = Date.parse('2026-11-08T22:00:00Z');

test('the business day starts at 06:00 Singapore time and is labelled by its start date', () => {
  assert.equal(businessDayStart(D9 + 5 * HOUR), D9);
  assert.equal(businessDayStart(D9 - 1), D9 - 24 * HOUR);
  assert.equal(businessDayLabel(D9), '2026-11-09');
  assert.equal(businessDayLabel(D9 - 1), '2026-11-08'); // 05:59 still belongs to the previous day
  const now = D9 + 3 * HOUR; // 09:00 on the 9th
  assert.deepEqual([playtimeWindow('today', undefined, now)!.from, playtimeWindow('yesterday', undefined, now)!.from], [D9, D9 - 24 * HOUR]);
  assert.equal(playtimeWindow('date', '2026-11-05', now)!.from, D9 - 4 * 24 * HOUR);
  assert.equal(playtimeWindow('date', '2026-02-31', now), undefined);
  // 2026-11-09 is a Monday: the week starts that business day; a Wednesday looks back to the same Monday.
  assert.equal(playtimeWindow('this_week', undefined, now)!.from, D9);
  assert.equal(playtimeWindow('this_week', undefined, D9 + 2 * 24 * HOUR + 3 * HOUR)!.from, D9);
});

test('sessions: one per game, a game change or leaving closes it, and a long gap ends it at the last sighting', () => {
  const store = new SteamStore(':memory:');
  const t0 = D9 + 10 * HOUR;
  store.recordPlay(ID1, { appId: '10', name: 'Game A' }, t0);
  store.recordPlay(ID1, { appId: '10', name: 'Game A' }, t0 + MIN);
  store.recordPlay(ID1, { appId: '10', name: 'Game A' }, t0 + 2 * MIN);
  store.recordPlay(ID1, { appId: '20', name: 'Game B' }, t0 + 3 * MIN);   // switch
  store.recordPlay(ID1, undefined, t0 + 5 * MIN);                           // stopped
  const sessions = store.playSessions([ID1], t0 - HOUR, t0 + HOUR, t0 + 6 * MIN);
  assert.deepEqual(sessions.map((s) => [s.appId, s.start - t0, s.end - t0]), [['10', 0, 3 * MIN], ['20', 3 * MIN, 5 * MIN]]);
  // an outage: next sighting 30 minutes later ends the old session at its last sighting, not at the new time
  store.recordPlay(ID2, { appId: '10' }, t0);
  store.recordPlay(ID2, { appId: '10' }, t0 + MIN);
  store.recordPlay(ID2, { appId: '10' }, t0 + 31 * MIN);
  const two = store.playSessions([ID2], t0 - HOUR, t0 + 2 * HOUR, t0 + 32 * MIN);
  assert.deepEqual(two.map((s) => [s.start - t0, s.end - t0]), [[0, MIN], [31 * MIN, 32 * MIN]]);
  // restart: a session left open ends where it was last seen
  store.recordPlay('3', { appId: '30' }, t0);
  store.recordPlay('3', { appId: '30' }, t0 + 2 * MIN);
  assert.equal(store.closeStalePlaySessions() >= 1, true);
  assert.equal(store.playSessions(['3'], t0 - HOUR, t0 + 2 * HOUR, t0 + HOUR)[0]!.end, t0 + 2 * MIN);
});

test('a session crossing 06:00 is split between the two business days; a game filter and totals work', () => {
  const sessions = [{ appId: '10', gameName: 'Game A', start: D9 - HOUR, end: D9 + 2 * HOUR }, { appId: '20', gameName: 'Game B', start: D9 + 3 * HOUR, end: D9 + 3 * HOUR + 30 * MIN }];
  const day9 = aggregatePlay(sessions, D9, D9 + 24 * HOUR);
  assert.deepEqual(day9.games.map((g) => [g.name, g.minutes]), [['Game A', 120], ['Game B', 30]]);
  assert.equal(day9.totalMinutes, 150);
  const day8 = aggregatePlay(sessions, D9 - 24 * HOUR, D9);
  assert.deepEqual(day8.games.map((g) => [g.name, g.minutes]), [['Game A', 60]]);
  const week = aggregatePlay(sessions, D9 - 24 * HOUR, D9 + 24 * HOUR);
  assert.deepEqual(week.days.map((d) => [d.date, d.minutes]), [['2026-11-08', 60], ['2026-11-09', 150]]);
  assert.deepEqual(aggregatePlay(sessions, D9, D9 + 24 * HOUR, 'game b').games.map((g) => g.name), ['Game B']);
});

function toolEnv(now: number) {
  const store = new SteamStore(':memory:');
  store.link({ senderKey: 'whatsapp:1', steamId: ID1, personaName: 'Main', personId: 'p1', now: 1 });
  store.link({ senderKey: 'whatsapp:1', steamId: ID2, personaName: 'Alt', personId: 'p1', now: 2 });
  store.enroll(GROUP, 'whatsapp:1');
  const deps = { store, now: () => now, client: { hasKey: async () => true } } as unknown as SteamToolDependencies;
  const caller: SteamCaller = { senderKey: 'whatsapp:1', groupId: GROUP, isOwner: false, mentions: [], selfPerson: () => 'p1' };
  return { store, deps, caller };
}

/** Records a play the way the poller does: one sighting a minute, then one without the game. */
function play(store: SteamStore, id: string, game: { appId: string; name: string }, start: number, minutes: number): void {
  for (let minute = 0; minute <= minutes; minute += 1) store.recordPlay(id, minute === minutes ? undefined : game, start + minute * MIN);
}

test('the tool answers per game and in total for yesterday, merging a person\'s accounts, and says when there is no data', async () => {
  const now = D9 + 3 * HOUR;
  const { store, deps, caller } = toolEnv(now);
  const startedTracking = store.playTrackingStartedAt();
  // tracking began before yesterday: backdate the meta so yesterday is fully covered
  (store as unknown as { db: { prepare(sql: string): { run(...args: unknown[]): unknown } } }).db.prepare(`UPDATE steam_meta SET value = ? WHERE key = 'play_tracking_started_at'`).run(String(D9 - 3 * 24 * HOUR));
  play(store, ID1, { appId: '578080', name: 'PUBG' }, D9 - 10 * HOUR, 200);
  play(store, ID2, { appId: '271590', name: 'GTA5' }, D9 - 8 * HOUR, 65);
  const answer = await steamGetPlaytime(deps, caller, { person: { reference: 'self' }, period: 'yesterday' }) as { known: boolean; games: Array<{ name: string; text: string }>; totalText: string; dayBoundary: string; accountCount: number };
  assert.equal(answer.known, true);
  assert.deepEqual(answer.games.map((g) => [g.name, g.text]), [['PUBG', '3小时20分钟'], ['GTA5', '1小时5分钟']]);
  assert.equal(answer.totalText, '4小时25分钟');
  assert.match(answer.dayBoundary, /06:00/u);
  assert.equal(answer.accountCount, 2);
  // a day before tracking began is reported as such, never as zero
  const early = await steamGetPlaytime(deps, caller, { person: { reference: 'self' }, period: 'date', date: '2026-11-01' }) as { known: boolean; reason: string };
  assert.deepEqual([early.known, early.reason], [false, 'before_tracking']);
  // a partial window says so
  (store as unknown as { db: { prepare(sql: string): { run(...args: unknown[]): unknown } } }).db.prepare(`UPDATE steam_meta SET value = ? WHERE key = 'play_tracking_started_at'`).run(String(D9 - 12 * HOUR));
  const partial = await steamGetPlaytime(deps, caller, { person: { reference: 'self' }, period: 'yesterday' }) as { partial?: boolean; note?: string };
  assert.equal(partial.partial, true);
  assert.match(partial.note ?? '', /没有数据/u);
  assert.ok(startedTracking > 0);
  assert.deepEqual(await steamGetPlaytime(deps, caller, { person: { reference: 'self' }, period: 'date', date: 'nope' }), { status: 'invalid_date', reason: 'date_must_be_YYYY-MM-DD' });
});

test('others can be asked about when their announcements are on; switching them off hides the numbers', async () => {
  const now = D9 + 3 * HOUR;
  const { store, deps } = toolEnv(now);
  const other: SteamCaller = { senderKey: 'whatsapp:9', groupId: GROUP, isOwner: false, mentions: ['whatsapp:1'] };
  const ask = () => steamGetPlaytime(deps, other, { person: { reference: 'mention' }, period: 'today' }) as Promise<{ status: string; reason?: string }>;
  assert.equal((await ask()).status, 'ok');
  store.setBroadcast(ID1, false);
  store.setBroadcast(ID2, false);
  assert.deepEqual(await ask(), { status: 'refused', reason: 'sharing_off' });
});

test('the poller records the play sessions it observes, including a first sighting already in progress', async () => {
  const store = new SteamStore(':memory:');
  store.link({ senderKey: 'whatsapp:1', steamId: ID1, personaName: 'Main', personId: 'p1', now: D9 });
  store.enroll(GROUP, 'whatsapp:1');
  // The presence ledger already knows the game began 20 minutes ago: the first session is backdated to it.
  store.savePresence(ID1, { state: 'in_game', since: D9 + 100 * MIN, gameId: '10', gameName: 'Game A' });
  let now = D9 + 120 * MIN;
  let game: { id: string; name: string } | undefined = { id: '10', name: 'Game A' };
  const poller = new PresencePoller({
    store,
    client: { playerSummaries: async (ids) => new Map(ids.map((id): [string, PlayerSummary] => [id, { steamId: id, name: 'x', profilePublic: true, personaState: 1, ...(game ? { gameId: game.id, gameName: game.name } : {}) }])) },
    compose: async () => 'x', send: async () => undefined, now: () => now,
  });
  await poller.tick(); now += MIN; await poller.tick();
  game = undefined; now += MIN; await poller.tick();
  const sessions = store.playSessions([ID1], D9, D9 + 24 * HOUR, now);
  assert.deepEqual(sessions.map((s) => [s.appId, s.start - D9, s.end - D9]), [['10', 100 * MIN, 122 * MIN]]);
});

test('the morning section: per person per game and total, idle members named, honest about the start of tracking', () => {
  const store = new SteamStore(':memory:');
  store.link({ senderKey: 'whatsapp:1', steamId: ID1, personaName: 'MainNick', personId: 'p1', now: 1 });
  store.link({ senderKey: 'whatsapp:1', steamId: ID2, personaName: 'AltNick', personId: 'p1', now: 2 });
  store.link({ senderKey: 'whatsapp:2', steamId: '76561190000000003', personaName: 'IdleNick', personId: 'p2', now: 3 });
  store.enroll(GROUP, 'whatsapp:1'); store.enroll(GROUP, 'whatsapp:2');
  const db = (store as unknown as { db: { prepare(sql: string): { run(...args: unknown[]): unknown } } }).db;
  const window = { startMs: D9 - 24 * HOUR, endMs: D9 };
  db.prepare(`UPDATE steam_meta SET value = ? WHERE key = 'play_tracking_started_at'`).run(String(D9 - 5 * 24 * HOUR));
  play(store, ID1, { appId: '578080', name: 'PUBG' }, D9 - 10 * HOUR, 200);
  play(store, ID2, { appId: '271590', name: 'GTA5' }, D9 - 5 * HOUR, 65);
  const names = (personId: string | undefined, fallback: string) => (personId === 'p1' ? 'Arthur' : personId === 'p2' ? 'Nori' : fallback);
  const text = steamPlaytimeSection(store, window, D9 + 4 * HOUR, names)!;
  assert.match(text, /^🎮 Steam 游戏时长（业务日 2026-11-08，新加坡时间 06:00 → 次日 06:00）$/mu);
  assert.match(text, /^- Arthur：PUBG 3小时20分钟、GTA5 1小时5分钟（合计 4小时25分钟）$/mu);
  assert.match(text, /没有记录到游戏时长：Nori/u);
  // tracking began mid-window: say so
  db.prepare(`UPDATE steam_meta SET value = ? WHERE key = 'play_tracking_started_at'`).run(String(D9 - 12 * HOUR));
  assert.match(steamPlaytimeSection(store, window, D9 + 4 * HOUR, names)!, /记录从 .* 起，之前的部分没有数据/u);
  // tracking began after the window: no invented numbers
  db.prepare(`UPDATE steam_meta SET value = ? WHERE key = 'play_tracking_started_at'`).run(String(D9 + HOUR));
  assert.match(steamPlaytimeSection(store, window, D9 + 4 * HOUR, names)!, /才开始记录的，这一天没有数据/u);
  // nobody linked: no section at all
  assert.equal(steamPlaytimeSection(new SteamStore(':memory:'), window, D9, names), undefined);
});
