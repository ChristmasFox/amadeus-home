import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlayerSummary } from '../src/steam/client.js';
import { runDailyPlaytime, steamPlaytimeSection } from '../src/steam/daily.js';
import { PresencePoller } from '../src/steam/poller.js';
import { SteamStore } from '../src/steam/store.js';
import { renderSteamNotifications } from '../src/steam/notify.js';
import { BUSINESS_DAY_START, DEFAULT_TIMEZONE, businessCalendar, businessCalendarFromConfig, DAILY_PLAYTIME_CLOCK } from '../src/steam/business-day.js';
import { aggregatePlay, playtimeWindow, steamGetPlaytime, type SteamCaller, type SteamToolDependencies } from '../src/steam/tools.js';

const CAL = businessCalendar();
const MIN = 60_000;
const HOUR = 3_600_000;
const ID1 = '76561190000000001';
const ID2 = '76561190000000002';
const GROUP = '120363000000000000@g.us';
// Singapore 06:00 on 2026-11-09 (= 2026-11-08T22:00Z): the start of business day 2026-11-09.
const D9 = Date.parse('2026-11-08T22:00:00Z');

test('the business day starts at 06:00 Asia/Shanghai (PUBG\'s own) and is labelled by its start date', () => {
  assert.equal(CAL.windowAt(D9 + 5 * HOUR).startMs, D9);
  assert.equal(CAL.windowAt(D9 - 1).startMs, D9 - 24 * HOUR);
  assert.equal(CAL.label(D9), '2026-11-09');
  assert.equal(CAL.label(D9 - 1), '2026-11-08'); // 05:59 still belongs to the previous day
  const now = D9 + 3 * HOUR; // 09:00 on the 9th
  assert.deepEqual([playtimeWindow(CAL, 'today', undefined, now)!.from, playtimeWindow(CAL, 'yesterday', undefined, now)!.from], [D9, D9 - 24 * HOUR]);
  assert.equal(playtimeWindow(CAL, 'date', '2026-11-05', now)!.from, D9 - 4 * 24 * HOUR);
  assert.equal(playtimeWindow(CAL, 'date', '2026-02-31', now), undefined);
  // 2026-11-09 is a Monday: the week starts that business day; a Wednesday looks back to the same Monday.
  assert.equal(playtimeWindow(CAL, 'this_week', undefined, now)!.from, D9);
  assert.equal(playtimeWindow(CAL, 'this_week', undefined, D9 + 2 * 24 * HOUR + 3 * HOUR)!.from, D9);
});

test('Steam and PUBG share one business day: same defaults, same configuration, same day arithmetic, same clock', async () => {
  const { readFileSync } = await import('node:fs');
  const pubgIndex = readFileSync(new URL('../../pubg/src/index.ts', import.meta.url), 'utf8');
  const pubgService = readFileSync(new URL('../../pubg/src/daily-review-service.ts', import.meta.url), 'utf8');
  const pubgReview = readFileSync(new URL('../../pubg/src/daily-review.ts', import.meta.url), 'utf8');
  // PUBG's fallbacks are literal in its sources; Steam must resolve to exactly those when nothing is configured.
  assert.match(pubgIndex, new RegExp(`'timezone', 'PUBG_TIMEZONE'\\) \\?\\? '${DEFAULT_TIMEZONE}'`, 'u'));
  assert.match(pubgIndex, new RegExp(`'businessDayStart', 'PUBG_BUSINESS_DAY_START'\\) \\?\\? '${BUSINESS_DAY_START}'`, 'u'));
  assert.match(pubgService, new RegExp(`config\\.timezone \\?\\? '${DEFAULT_TIMEZONE}'`, 'u'));
  assert.match(pubgReview, new RegExp(`DAILY_REVIEW_TIME = '${DAILY_PLAYTIME_CLOCK}'`, 'u'));
  assert.deepEqual([DEFAULT_TIMEZONE, BUSINESS_DAY_START, DAILY_PLAYTIME_CLOCK], ['Asia/Shanghai', '06:00', '09:30']);
  const bare = businessCalendarFromConfig({}, {});
  assert.deepEqual([bare.timezone, bare.start], ['Asia/Shanghai', '06:00']);
  // the pubg plugin's configuration (and its environment fallbacks) drive Steam too
  const configured = businessCalendarFromConfig({ plugins: { entries: { pubg: { config: { timezone: 'Asia/Tokyo', businessDayStart: '05:00' } } } } }, {});
  assert.deepEqual([configured.timezone, configured.start], ['Asia/Tokyo', '05:00']);
  const fromEnv = businessCalendarFromConfig({}, { PUBG_TIMEZONE: 'Europe/Paris', PUBG_BUSINESS_DAY_START: '04:30' } as NodeJS.ProcessEnv);
  assert.deepEqual([fromEnv.timezone, fromEnv.start], ['Europe/Paris', '04:30']);
  // the same business day boundaries as the PUBG domain gives the daily review for the same instants
  const domain = await import('@rine-kit/pubg-domain/core');
  for (const at of [D9 - 1, D9, D9 + 3 * HOUR, D9 + 20 * HOUR, D9 + 30 * HOUR]) {
    assert.equal(CAL.label(at), domain.businessDayLabel(at, 'Asia/Shanghai', '06:00'));
    const window = domain.businessDayWindow(CAL.label(at), 'Asia/Shanghai', '06:00');
    assert.deepEqual(CAL.windowAt(at), { startMs: window.startMs, endMs: window.endMs });
  }
  assert.equal(CAL.latestComplete(D9 + 3 * HOUR + 30 * MIN), domain.latestCompleteBusinessDay(new Date(D9 + 3 * HOUR + 30 * MIN), 'Asia/Shanghai', '06:00'));
  assert.equal(CAL.dueAt('2026-11-08'), D9 + 3 * HOUR + 30 * MIN, '09:30 local on the morning after the business day');
  // no leftover hard-coded Singapore anywhere in the Steam wording or code
  const { readdirSync } = await import('node:fs');
  const dir = new URL('../src/steam/', import.meta.url);
  for (const file of readdirSync(dir)) assert.doesNotMatch(readFileSync(new URL(file, dir), 'utf8'), /Singapore|新加坡/u, file);
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
  const day9 = aggregatePlay(CAL, sessions, D9, D9 + 24 * HOUR);
  assert.deepEqual(day9.games.map((g) => [g.name, g.minutes]), [['Game A', 120], ['Game B', 30]]);
  assert.equal(day9.totalMinutes, 150);
  const day8 = aggregatePlay(CAL, sessions, D9 - 24 * HOUR, D9);
  assert.deepEqual(day8.games.map((g) => [g.name, g.minutes]), [['Game A', 60]]);
  const week = aggregatePlay(CAL, sessions, D9 - 24 * HOUR, D9 + 24 * HOUR);
  assert.deepEqual(week.days.map((d) => [d.date, d.minutes]), [['2026-11-08', 60], ['2026-11-09', 150]]);
  assert.deepEqual(aggregatePlay(CAL, sessions, D9, D9 + 24 * HOUR, 'game b').games.map((g) => g.name), ['Game B']);
});

function toolEnv(now: number) {
  const store = new SteamStore(':memory:');
  store.link({ senderKey: 'whatsapp:1', steamId: ID1, personaName: 'Main', personId: 'p1', now: 1 });
  store.link({ senderKey: 'whatsapp:1', steamId: ID2, personaName: 'Alt', personId: 'p1', now: 2 });
  store.enroll(GROUP, 'whatsapp:1');
  const deps = { store, calendar: CAL, now: () => now, client: { hasKey: async () => true } } as unknown as SteamToolDependencies;
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

function dailyEnv() {
  const store = new SteamStore(':memory:');
  store.link({ senderKey: 'whatsapp:1', steamId: ID1, personaName: 'MainNick', personId: 'p1', now: 1 });
  store.link({ senderKey: 'whatsapp:1', steamId: ID2, personaName: 'AltNick', personId: 'p1', now: 2 });
  store.link({ senderKey: 'whatsapp:2', steamId: '76561190000000003', personaName: 'IdleNick', personId: 'p2', now: 3 });
  store.link({ senderKey: 'whatsapp:3', steamId: '76561190000000004', personaName: 'Other', personId: 'p3', now: 4 });
  store.enroll(GROUP, 'whatsapp:1'); store.enroll(GROUP, 'whatsapp:2');
  store.enroll('120363000000000999@g.us', 'whatsapp:3');            // a different group with its own member
  const db = (store as unknown as { db: { prepare(sql: string): { run(...args: unknown[]): unknown } } }).db;
  const setTracking = (at: number) => db.prepare(`UPDATE steam_meta SET value = ? WHERE key = 'play_tracking_started_at'`).run(String(at));
  setTracking(D9 - 5 * 24 * HOUR);
  const names = (personId: string | undefined, fallback: string) => (personId === 'p1' ? 'Arthur' : personId === 'p2' ? 'Nori' : personId === 'p3' ? 'Zed' : fallback);
  return { store, setTracking, names };
}

test('the standalone morning message: Amadeus shape, one line per person with per-game times and a total for several games', () => {
  const { store, setTracking, names } = dailyEnv();
  const window = { startMs: D9 - 24 * HOUR, endMs: D9 };
  const links = store.broadcastMembers(GROUP);
  assert.equal(steamPlaytimeSection(CAL, store, links, window, D9 + 4 * HOUR, names), undefined, 'nobody played: nothing is sent');
  play(store, ID1, { appId: '578080', name: 'PUBG' }, D9 - 10 * HOUR, 130);
  play(store, ID2, { appId: '271590', name: 'GTA5' }, D9 - 5 * HOUR, 95);
  play(store, '76561190000000003', { appId: '578080', name: 'PUBG' }, D9 - 4 * HOUR, 40);
  assert.equal(steamPlaytimeSection(CAL, store, links, window, D9 + 4 * HOUR, names), [
    'Amadeus • 世界线观测 · Steam 昨日游戏时长',
    '',
    '业务日 2026-11-08（Asia/Shanghai 06:00 → 次日 06:00）各成员的游戏时长。',
    '',
    '- Arthur：PUBG 2 小时 10 分钟，GTA5 1 小时 35 分钟（合计 3 小时 45 分钟）',
    '- Nori：PUBG 40 分钟',
    '',
    'El Psy Kongroo.',
  ].join('\n'));
  setTracking(D9 - 12 * HOUR);
  assert.match(steamPlaytimeSection(CAL, store, links, window, D9 + 4 * HOUR, names)!, /记录从 .* 起，之前的部分没有数据/u);
  setTracking(D9 + HOUR);
  assert.equal(steamPlaytimeSection(CAL, store, links, window, D9 + 4 * HOUR, names), undefined, 'recording began after the day: nothing invented');
  assert.equal(steamPlaytimeSection(CAL, new SteamStore(':memory:'), [], window, D9, names), undefined);
});

test('the 09:30 Singapore job: once per group per day, only that group\'s members, skipped when nobody played, no old days after a late start', async () => {
  const { store, names } = dailyEnv();
  const sent: Array<{ group: string; text: string }> = [];
  const run = (now: number) => runDailyPlaytime({ store, calendar: CAL, now, nameOf: names, send: async (group, text) => { sent.push({ group, text }); } });
  play(store, ID1, { appId: '578080', name: 'PUBG' }, D9 - 10 * HOUR, 130);                    // yesterday (business day 2026-11-08)
  const other = '76561190000000004';
  play(store, other, { appId: '271590', name: 'GTA5' }, D9 - 6 * HOUR, 60);
  const at0930 = D9 + 3 * HOUR + 30 * MIN;                                                       // 09:30 on the 9th
  assert.deepEqual(await run(at0930 - MIN), { sent: 0, skipped: 0, failed: 0 });                 // 09:29: not yet
  assert.deepEqual(await run(at0930), { sent: 2, skipped: 0, failed: 0 });
  assert.equal(sent.length, 2);
  const mine = sent.find((entry) => entry.group === GROUP)!.text;
  assert.match(mine, /- Arthur：PUBG 2 小时 10 分钟$/mu);
  assert.doesNotMatch(mine, /Zed|GTA5/u, 'another group\'s member does not leak into this group');
  assert.match(sent.find((entry) => entry.group !== GROUP)!.text, /- Zed：GTA5 1 小时/u);
  assert.deepEqual(await run(at0930 + 5 * MIN), { sent: 0, skipped: 0, failed: 0 });             // already done today
  // the next day nobody played: skipped once, not sent
  const next = at0930 + 24 * HOUR;
  assert.deepEqual(await run(next), { sent: 0, skipped: 2, failed: 0 });
  assert.deepEqual(await run(next + MIN), { sent: 0, skipped: 0, failed: 0 });
  // a start 4 hours after 09:30 does not send anything for an old day
  assert.deepEqual(await run(at0930 + 48 * HOUR + 4 * HOUR), { sent: 0, skipped: 0, failed: 0 });
  // a failing send is recorded once and not retried in a loop
  const failing = dailyEnv();
  play(failing.store, ID1, { appId: '578080', name: 'PUBG' }, D9 - 10 * HOUR, 130);
  const result = await runDailyPlaytime({ store: failing.store, calendar: CAL, now: at0930, nameOf: failing.names, send: async () => { throw new Error('down'); } });
  assert.deepEqual(result, { sent: 0, skipped: 1, failed: 1 });
  assert.deepEqual(await runDailyPlaytime({ store: failing.store, calendar: CAL, now: at0930 + MIN, nameOf: failing.names, send: async () => undefined }), { sent: 0, skipped: 0, failed: 0 });
});

function stopEnv(people: Array<[string, string]> = [[ID1, 'p1']]) {
  const store = new SteamStore(':memory:');
  for (const [id, person] of people) store.link({ senderKey: `whatsapp:${person}`, steamId: id, personaName: 'nick', personId: person, now: D9 });
  store.enroll(GROUP, 'whatsapp:p1');
  let now = D9 + 10 * HOUR;
  let game: { id: string; name: string } | undefined;
  const sent: string[] = [];
  const poller = new PresencePoller({
    store,
    client: { playerSummaries: async (ids) => new Map(ids.map((id): [string, PlayerSummary] => [id, { steamId: id, name: 'nick', profilePublic: true, personaState: 1, ...(game ? { gameId: game.id, gameName: game.name } : {}) }])) },
    compose: (facts) => renderSteamNotifications(facts, new Date(now)),
    send: async (_group, text) => { sent.push(text); },
    displayName: () => 'kim',
    now: () => now,
  });
  const run = async (minutes: number, next: typeof game) => { game = next; for (let i = 0; i < minutes; i += 1) { await poller.tick(); now += MIN; } };
  return { store, sent, run, setNow: (value: number) => { now = value; }, getNow: () => now, poller };
}

test('stopped_playing: a real stop of a long session is announced once with the length; short ones and switches are not doubled', async () => {
  const { sent, run } = stopEnv();
  await run(1, undefined);                                   // baseline: offline-ish (online, no game)
  await run(90, { id: '578080', name: 'PUBG: BATTLEGROUNDS' });
  await run(5, undefined);                                   // stops; merge window then flush
  const stops = sent.filter((text) => text.includes('Steam 收束'));
  assert.equal(stops.length, 1);
  assert.match(stops[0]!, /kim 结束了 PUBG: BATTLEGROUNDS。/u);
  assert.match(stops[0]!, /- 本局时长：1 小时 3\d 分钟/u);                // 90 observations minus the baseline minute, within a minute of what the poller saw
  // a 3-minute session never produces a stop notice
  const before = sent.length;
  await run(3, { id: '10', name: 'Quick Game' });
  await run(6, undefined);
  assert.equal(sent.filter((text) => text.includes('Quick Game')).filter((text) => text.includes('Steam 收束')).length, 0);
  assert.ok(sent.length >= before);
});

test('switching games sends only the switch notice, carrying the length of the game just left', async () => {
  const { sent, run } = stopEnv();
  await run(1, undefined);
  await run(40, { id: '10', name: 'Game A' });
  await run(40, { id: '20', name: 'Game B' });
  await run(5, { id: '20', name: 'Game B' });
  const switches = sent.filter((text) => text.includes('世界线变动'));
  assert.equal(switches.length, 1);
  assert.match(switches[0]!, /kim 从 Game A 切换到 Game B。/u);
  assert.match(switches[0]!, /- 上一局：Game A，\d+ 分钟/u);
  assert.equal(sent.filter((text) => text.includes('Steam 收束')).length, 0, 'no stop notice for leaving a game to start another');
});

test('an outage or a restart that closes a session is not announced as the player stopping', async () => {
  const env = stopEnv();
  await env.run(1, undefined);
  await env.run(40, { id: '10', name: 'Game A' });
  // 30 minutes of nothing observed, then the game is gone: the old session ends where it was last seen, no stop notice
  env.setNow(env.getNow() + 30 * MIN);
  await env.run(8, undefined);
  assert.equal(env.sent.filter((text) => text.includes('Steam 收束')).length, 0);
  // a restart closes whatever was left open without any notice either
  await env.run(40, { id: '30', name: 'Game C' });
  const restarted = new PresencePoller({ store: env.store, client: { playerSummaries: async () => new Map() }, compose: () => 'x', send: async () => undefined, now: () => env.getNow() });
  assert.ok(restarted);
  assert.equal(env.sent.filter((text) => text.includes('Steam 收束')).length, 0);
});
