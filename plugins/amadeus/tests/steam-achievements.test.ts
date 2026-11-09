import assert from 'node:assert/strict';
import test from 'node:test';
import { AchievementCatalog, summariseAchievements } from '../src/steam/achievements.js';
import { SteamClient, type AchievementState, type PlayerSummary, type Unknown } from '../src/steam/client.js';
import { PresencePoller, type AnnouncementFacts } from '../src/steam/poller.js';
import { SteamStore } from '../src/steam/store.js';
import { steamGetAchievements, type SteamCaller, type SteamToolDependencies } from '../src/steam/tools.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ID = '76561190000000001';
const ID2 = '76561190000000002';
const GROUP = '120363000000000000@g.us';
const DAY = Date.parse('2026-11-09T04:00:00Z');

function client(handler: (url: URL) => Response) {
  return new SteamClient({ apiKey: 'TEST-KEY-PLACEHOLDER', baseUrl: 'https://steam.example', minIntervalMs: 0, sleep: async () => {}, fetchImpl: (async (input: URL) => handler(input)) as never });
}

test('player achievements: unlocked flags and times; a private profile or a game without stats is unknown, never zero', async () => {
  const ok = client(() => json({ playerstats: { success: true, achievements: [{ apiname: 'A1', achieved: 1, unlocktime: 1_700_000_000, name: 'First' }, { apiname: 'A2', achieved: 0, unlocktime: 0 }] } }));
  const result = await ok.playerAchievements(ID, '10') as { known: true; value: AchievementState[] };
  assert.deepEqual(result.value.map((entry) => [entry.apiName, entry.achieved, entry.unlockedAt]), [['A1', true, 1_700_000_000_000], ['A2', false, undefined]]);
  const priv = client(() => json({ playerstats: { success: false, error: 'Profile is not public' } }, 400));
  assert.deepEqual(await priv.playerAchievements(ID, '10'), { known: false, reason: 'profile_private' });
  const none = client(() => json({ playerstats: { success: false, error: 'Requested app has no stats' } }, 400));
  assert.deepEqual(await none.playerAchievements(ID, '10'), { known: false, reason: 'not_available' });
});

test('schema and global percentages are parsed; string percentages are accepted', async () => {
  const c = client((url) => (url.pathname.includes('GetSchemaForGame')
    ? json({ game: { availableGameStats: { achievements: [{ name: 'A1', displayName: 'First', description: 'd', hidden: 0 }, { name: 'A2', displayName: 'Secret', hidden: 1 }] } } })
    : json({ achievementpercentages: { achievements: [{ name: 'A1', percent: '45.678' }, { name: 'A2', percent: 1.04 }] } })));
  assert.deepEqual((await c.achievementSchema('10')).map((entry) => [entry.apiName, entry.name, entry.hidden]), [['A1', 'First', false], ['A2', 'Secret', true]]);
  assert.deepEqual([...(await c.achievementPercentages('10'))], [['A1', 45.7], ['A2', 1]]);
});

const states = (achieved: string[], all = ['A1', 'A2', 'A3', 'A4']): AchievementState[] => all.map((apiName, index) => ({ apiName, achieved: achieved.includes(apiName), ...(achieved.includes(apiName) ? { unlockedAt: DAY - index * 3_600_000 } : {}) }));
const catalogOf = () => new AchievementCatalog({
  achievementSchema: async () => [{ apiName: 'A1', name: 'First', hidden: false }, { apiName: 'A2', name: 'Rare One', hidden: false }, { apiName: 'A3', name: 'Easy', hidden: false }, { apiName: 'A4', name: 'Secret One', hidden: true }],
  achievementPercentages: async () => new Map([['A1', 60], ['A2', 2.5], ['A3', 80], ['A4', 1]]),
}, () => DAY);

test('summaries: counts, rarest first, recent first, easiest missing first; secret locked ones are never spelled out', async () => {
  const entry = await catalogOf().lookup('10');
  const data = states(['A1', 'A2']);
  assert.deepEqual(summariseAchievements(data, entry, 'summary', 5), {
    total: 4, unlocked: 2, completionPercent: 50, hiddenLocked: 1,
    rarestUnlocked: summariseAchievements(data, entry, 'rarest', 5).rarestUnlocked,
    recentlyUnlocked: summariseAchievements(data, entry, 'recent', 5).recentlyUnlocked,
  });
  const rarest = summariseAchievements(data, entry, 'rarest', 5).rarestUnlocked as Array<{ name: string }>;
  assert.deepEqual(rarest.map((item) => item.name), ['Rare One', 'First']);
  const recent = summariseAchievements(data, entry, 'recent', 1).recentlyUnlocked as Array<{ name: string }>;
  assert.deepEqual(recent.map((item) => item.name), ['First']);
  const missing = summariseAchievements(data, entry, 'missing', 5).easiestMissing as Array<{ name?: string; hidden: boolean }>;
  assert.deepEqual(missing.map((item) => item.name), ['Easy']); // the secret one (A4) is not listed
});

function toolSetup(options: { privateAchievements?: boolean } = {}) {
  const store = new SteamStore(':memory:');
  store.link({ senderKey: 'whatsapp:1', steamId: ID, personaName: 'Alpha', now: 1 });
  const calls: string[] = [];
  const deps: SteamToolDependencies = {
    store, now: () => DAY,
    client: {
      hasKey: async () => true,
      resolveVanity: async () => undefined,
      playerSummaries: async (ids) => new Map(ids.map((id): [string, PlayerSummary] => [id, { steamId: id, name: 'Alpha', profilePublic: true, personaState: 1, gameId: '10', gameName: 'Current Game' }])),
      ownedGames: async () => ({ known: true, value: [{ appId: 10, name: 'Current Game', totalMinutes: 600 }, { appId: 20, name: 'Other Game', totalMinutes: 60 }] }),
      recentGames: async () => ({ known: true, value: [{ appId: 20, name: 'Other Game', totalMinutes: 60 }] }),
      friendList: async () => ({ known: true, value: [] }),
      playerAchievements: async (_id, appId): Promise<Unknown<AchievementState[]>> => { calls.push(appId); return options.privateAchievements ? { known: false, reason: 'profile_private' } : { known: true, value: states(['A1', 'A2']) }; },
      achievementSchema: async () => (await catalogOf().lookup('10')).definitions.size ? [{ apiName: 'A1', name: 'First', hidden: false }, { apiName: 'A2', name: 'Rare One', hidden: false }, { apiName: 'A3', name: 'Easy', hidden: false }, { apiName: 'A4', name: 'Secret One', hidden: true }] : [],
      achievementPercentages: async () => new Map([['A1', 60], ['A2', 2.5], ['A3', 80], ['A4', 1]]),
    },
  };
  const caller = (extra: Partial<SteamCaller> = {}): SteamCaller => ({ senderKey: 'whatsapp:1', groupId: GROUP, isOwner: false, mentions: [], ...extra });
  return { store, deps, caller, calls };
}

test('the tool picks the named game, else the one being played, and answers with the summary', async () => {
  const { deps, caller, calls } = toolSetup();
  const now = await steamGetAchievements(deps, caller(), { person: { reference: 'self' } }) as { game: { appId: string; name: string }; achievements: { known: boolean; value: { unlocked: number; total: number } } };
  assert.deepEqual([now.game.appId, now.game.name, now.achievements.value.unlocked, now.achievements.value.total], ['10', 'Current Game', 2, 4]);
  const named = await steamGetAchievements(deps, caller(), { person: { reference: 'self' }, game: 'other', mode: 'recent' }) as { game: { appId: string } };
  assert.equal(named.game.appId, '20');
  assert.deepEqual(calls, ['10', '20']);
  assert.deepEqual(await steamGetAchievements(deps, caller(), { person: { reference: 'self' }, game: 'nonexistent' }), { status: 'not_found', reason: 'game_not_in_library' });
});

test('private achievements are unknown, and others cannot read them once the owner switched sharing off', async () => {
  const { store, deps, caller } = toolSetup({ privateAchievements: true });
  const answer = await steamGetAchievements(deps, caller(), { person: { reference: 'self' } }) as { achievements: { known: boolean; reason: string } };
  assert.deepEqual(answer.achievements, { known: false, reason: 'profile_private' });
  store.setBroadcast(ID, false);
  const other = caller({ senderKey: 'whatsapp:2', mentions: ['whatsapp:1'] });
  assert.deepEqual(await steamGetAchievements(deps, other, { person: { reference: 'mention' } }), { status: 'refused', reason: 'sharing_off' });
});

function pollerSetup(unlocked: { value: string[] }, extra: { unlockedAtOffset?: number } = {}) {
  const store = new SteamStore(':memory:');
  store.link({ senderKey: 'whatsapp:1', steamId: ID, personaName: 'Alpha', personId: 'p1', now: DAY });
  store.enroll(GROUP, 'whatsapp:1');
  let now = DAY;
  const facts: AnnouncementFacts[] = [];
  const poller = new PresencePoller({
    store,
    client: {
      playerSummaries: async (ids) => new Map(ids.map((id): [string, PlayerSummary] => [id, { steamId: id, name: 'Alpha', profilePublic: true, personaState: 1, gameId: '10', gameName: 'Current Game' }])),
      playerAchievements: async () => ({ known: true, value: states(unlocked.value).map((entry) => (entry.unlockedAt === undefined ? entry : { ...entry, unlockedAt: now - (extra.unlockedAtOffset ?? 60_000) })) }),
      achievementSchema: async () => [{ apiName: 'A1', name: 'First', hidden: false }, { apiName: 'A2', name: 'Rare One', hidden: false }, { apiName: 'A3', name: 'Easy', hidden: false }],
      achievementPercentages: async () => new Map([['A1', 60], ['A2', 2.5], ['A3', 80]]),
    },
    compose: async (value) => { facts.push(value); return 'x'; },
    send: async () => undefined,
    now: () => now,
  });
  return { store, poller, facts, advance: (ms: number) => { now += ms; } };
}

test('unlocks: the first sight is only a baseline; a later unlock is announced once, with name and rarity', async () => {
  const unlocked = { value: ['A1'] };
  const { poller, facts, advance } = pollerSetup(unlocked);
  await poller.tick();                       // baseline (also the presence baseline)
  advance(2 * 60_000);
  await poller.tick();
  advance(4 * 60_000);
  await poller.tick();
  assert.equal(facts.length, 0, 'nothing historic or unchanged is announced');
  unlocked.value = ['A1', 'A2'];
  advance(2 * 60_000);
  await poller.tick();
  advance(4 * 60_000);
  await poller.tick();
  assert.equal(facts.length, 1);
  const person = facts[0]!.people[0]!;
  assert.equal(person.kind, 'achievement_unlocked');
  assert.deepEqual(person.achievements, [{ apiName: 'A2', name: 'Rare One', globalPercent: 2.5 }]);
  advance(2 * 60_000);
  await poller.tick();
  advance(4 * 60_000);
  await poller.tick();
  assert.equal(facts.length, 1, 'the same unlock is not announced again');
});

test('several unlocks in one window are merged into one message; stale unlocks are absorbed silently', async () => {
  const unlocked = { value: [] as string[] };
  const merged = pollerSetup(unlocked);
  await merged.poller.tick();
  unlocked.value = ['A1'];
  merged.advance(60_000);
  await merged.poller.tick();
  unlocked.value = ['A1', 'A2'];
  merged.advance(60_000);
  await merged.poller.tick();
  merged.advance(4 * 60_000);
  await merged.poller.tick();
  assert.equal(merged.facts.length, 1);
  assert.deepEqual(merged.facts[0]!.people[0]!.achievements!.map((item) => item.apiName), ['A1', 'A2']);

  const stale = { value: [] as string[] };
  const old = pollerSetup(stale, { unlockedAtOffset: 3 * 3_600_000 });
  await old.poller.tick();
  stale.value = ['A1'];
  old.advance(60_000);
  await old.poller.tick();
  old.advance(4 * 60_000);
  await old.poller.tick();
  assert.equal(old.facts.length, 0, 'an unlock from hours ago is not announced');
});

test('achievements are read on their own clock: presence every 30 s, at most one read per playing account every 2 minutes', async () => {
  const store = new SteamStore(':memory:');
  store.link({ senderKey: 'whatsapp:1', steamId: ID, personaName: 'Alpha', personId: 'p1', now: DAY });
  store.enroll(GROUP, 'whatsapp:1');
  let now = DAY;
  let playing = true;
  let summaries = 0;
  let reads = 0;
  const unlocked = ['A1'];
  const facts: AnnouncementFacts[] = [];
  const poller = new PresencePoller({
    store,
    client: {
      playerSummaries: async (ids) => { summaries += 1; return new Map(ids.map((id): [string, PlayerSummary] => [id, { steamId: id, name: 'Alpha', profilePublic: true, personaState: 1, ...(playing ? { gameId: '10', gameName: 'Current Game' } : {}) }])); },
      playerAchievements: async () => { reads += 1; return { known: true, value: states(unlocked).map((entry) => (entry.unlockedAt === undefined ? entry : { ...entry, unlockedAt: now - 1000 })) }; },
      achievementSchema: async () => [{ apiName: 'A1', name: 'First', hidden: false }, { apiName: 'A2', name: 'Second', hidden: false }],
      achievementPercentages: async () => new Map(),
    },
    compose: async (value) => { facts.push(value); return 'x'; },
    send: async () => undefined,
    now: () => now,
  });
  // ten minutes of 30-second ticks: 20 presence calls, but only one achievement read per 2 minutes (5)
  for (let index = 0; index < 20; index += 1) { await poller.tick(); now += 30_000; }
  assert.equal(summaries, 20);
  assert.equal(reads, 5);
  // an unlock is seen at the next permitted read, within 2 minutes
  unlocked.push('A2');
  const before = reads;
  for (let index = 0; index < 4; index += 1) { await poller.tick(); now += 30_000; }
  assert.equal(reads - before, 1);
  for (let index = 0; index < 6; index += 1) { await poller.tick(); now += 30_000; } // the merge window closes, then it goes out
  assert.ok(facts.some((fact) => fact.people[0]!.kind === 'achievement_unlocked'));
  // the one last read after the game ends still happens, once it is allowed
  playing = false;
  const beforeEnd = reads;
  for (let index = 0; index < 6; index += 1) { await poller.tick(); now += 30_000; }
  assert.equal(reads - beforeEnd, 1, 'one final read after the game, and nothing while nothing is played');
});
