import assert from 'node:assert/strict';
import test from 'node:test';
import type { GameStat, Unknown } from '../src/steam/client.js';
import { SteamStore } from '../src/steam/store.js';
import { OWNED_CACHE_MS, steamGetOwnedGames, type SteamCaller, type SteamToolDependencies } from '../src/steam/tools.js';

const GROUP = '120363000000000000@g.us';
const A1 = '76561190000000001';
const A2 = '76561190000000002';
const B = '76561190000000003';
const C = '76561190000000004';
const lib = (...games: Array<[number, string, number]>): Unknown<GameStat[]> => ({ known: true, value: games.map(([appId, name, totalMinutes]) => ({ appId, name, totalMinutes })) });

function env(libraries: Record<string, Unknown<GameStat[]>>) {
  const store = new SteamStore(':memory:');
  store.link({ senderKey: 'whatsapp:1', steamId: A1, personaName: 'MainNick', personId: 'p1', now: 1 });
  store.link({ senderKey: 'whatsapp:1', steamId: A2, personaName: 'AltNick', personId: 'p1', now: 2 });
  store.link({ senderKey: 'whatsapp:2', steamId: B, personaName: 'BNick', personId: 'p2', now: 3 });
  store.link({ senderKey: 'whatsapp:3', steamId: C, personaName: 'CNick', personId: 'p3', now: 4 });
  for (const key of ['whatsapp:1', 'whatsapp:2', 'whatsapp:3']) store.enroll(GROUP, key);
  const calls: string[] = [];
  let now = 1_000_000;
  const deps = { store, now: () => now, client: { hasKey: async () => true, ownedGames: async (id: string) => { calls.push(id); return libraries[id] ?? { known: false, reason: 'profile_private' }; } } } as unknown as SteamToolDependencies;
  const caller = (extra: Partial<SteamCaller> = {}): SteamCaller => ({
    senderKey: 'whatsapp:1', groupId: GROUP, isOwner: false, mentions: [], selfPerson: () => 'p1',
    displayName: (personId) => ({ p1: 'Arthur', p2: 'Nori', p3: 'Zed' } as Record<string, string>)[personId], ...extra,
  });
  return { store, deps, caller, calls, advance: (ms: number) => { now += ms; } };
}

test('a person\'s library over several accounts: a game owned twice counts once, play time adds up, top games are capped', async () => {
  const { deps, caller } = env({
    [A1]: lib([578080, 'PUBG', 6000], [271590, 'GTA5', 600], [10, 'Game C', 60]),
    [A2]: lib([578080, 'PUBG', 600], [20, 'Game D', 30]),
  });
  const answer = await steamGetOwnedGames(deps, caller(), { limit: 2 }) as { gameCount: number; totalHours: number; accountCount: number; accounts: Array<{ known: boolean; gameCount: number }>; top: Array<{ name: string; totalHours: number }> };
  assert.equal(answer.gameCount, 4);                                  // PUBG, GTA5, C, D — PUBG once
  assert.equal(answer.totalHours, 121.5);                             // (6000+600+60+600+30) / 60
  assert.deepEqual(answer.top.map((g) => [g.name, g.totalHours]), [['PUBG', 110], ['GTA5', 10]]);
  assert.deepEqual(answer.accounts.map((a) => [a.known, a.gameCount]), [[true, 3], [true, 2]]);
  assert.equal(answer.accountCount, 2);
});

test('private game details are said plainly, never zero; a half-private person says which part is missing', async () => {
  const { deps, caller } = env({ [A1]: { known: false, reason: 'profile_private' }, [A2]: { known: false, reason: 'profile_private' } });
  assert.deepEqual(await steamGetOwnedGames(deps, caller(), {}), { status: 'ok', games: { known: false, reason: 'profile_private', note: '游戏详情未公开' }, accountCount: 2 });
  const half = env({ [A1]: lib([1, 'One', 120]), [A2]: { known: false, reason: 'profile_private' } });
  const answer = await steamGetOwnedGames(half.deps, half.caller(), {}) as { gameCount: number; note: string };
  assert.equal(answer.gameCount, 1);
  assert.match(answer.note, /1 个账号的游戏详情未公开/u);
});

test('another linked member can be asked about; switching their announcements off hides them', async () => {
  const { store, deps, caller } = env({ [B]: lib([1, 'One', 60], [2, 'Two', 120]) });
  const asker = caller({ senderKey: 'whatsapp:9', selfPerson: () => undefined, mentions: ['whatsapp:2'] });
  const answer = await steamGetOwnedGames(deps, asker, { person: { reference: 'mention' } }) as { gameCount: number };
  assert.equal(answer.gameCount, 2);
  store.setBroadcast(B, false);
  assert.deepEqual(await steamGetOwnedGames(deps, asker, { person: { reference: 'mention' } }), { status: 'refused', reason: 'sharing_off' });
});

test('ranking the group: by games owned (or hours), accounts merged, private members listed and left out', async () => {
  const { deps, caller } = env({
    [A1]: lib([1, 'G1', 6000], [2, 'G2', 60]), [A2]: lib([1, 'G1', 600], [3, 'G3', 0]),     // Arthur: 3 games, 111 h
    [B]: lib([1, 'G1', 60], [2, 'G2', 60], [3, 'G3', 60], [4, 'G4', 60]),                    // Nori: 4 games, 4 h
    // Zed: private
  });
  const byGames = await steamGetOwnedGames(deps, caller(), { all: true }) as { rankedBy: string; ranking: Array<{ name: string; gameCount: number; totalHours: number; accountCount: number }>; gameDetailsNotPublic: string[]; note: string };
  assert.equal(byGames.rankedBy, 'games_owned');
  assert.deepEqual(byGames.ranking.map((r) => [r.name, r.gameCount, r.accountCount]), [['Nori', 4, 1], ['Arthur', 3, 2]]);
  assert.deepEqual(byGames.gameDetailsNotPublic, ['Zed']);
  assert.match(byGames.note, /没有计入排名/u);
  const byHours = await steamGetOwnedGames(deps, caller(), { all: true, rankBy: 'hours' }) as { rankedBy: string; ranking: Array<{ name: string; totalHours: number }> };
  assert.deepEqual([byHours.rankedBy, byHours.ranking.map((r) => r.name)], ['total_hours', ['Arthur', 'Nori']]);
  const direct = caller({ groupId: undefined as never });
  assert.deepEqual(await steamGetOwnedGames(deps, direct, { all: true }), { status: 'refused', reason: 'ranking_needs_a_group' });
});

test('a library is cached briefly: asking again does not call Steam, and refetches after the window', async () => {
  const { deps, caller, calls, advance } = env({ [A1]: lib([1, 'G1', 60]), [A2]: lib([2, 'G2', 60]) });
  await steamGetOwnedGames(deps, caller(), {});
  await steamGetOwnedGames(deps, caller(), {});
  assert.equal(calls.length, 2);                                       // two accounts, once each
  advance(OWNED_CACHE_MS + 1);
  await steamGetOwnedGames(deps, caller(), {});
  assert.equal(calls.length, 4);
});
