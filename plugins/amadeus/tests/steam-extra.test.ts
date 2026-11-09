import assert from 'node:assert/strict';
import test from 'node:test';
import type { GameStat, PlayerBans, Unknown, WishlistEntry } from '../src/steam/client.js';
import { SteamStore } from '../src/steam/store.js';
import type { SteamCaller, SteamToolDependencies } from '../src/steam/tools.js';
import { steamGameInfo, steamGetAccountInfo, steamGetGameStats, steamLibraryOverlap } from '../src/steam/tools-extra.js';

const GROUP = '120363000000000000@g.us';
const A1 = '76561190000000001';
const A2 = '76561190000000002';
const B = '76561190000000003';
const C = '76561190000000004';
const lib = (...games: Array<[number, string, number]>): Unknown<GameStat[]> => ({ known: true, value: games.map(([appId, name, totalMinutes]) => ({ appId, name, totalMinutes })) });
const noBan: PlayerBans = { steamId: '', communityBanned: false, vacBanned: false, vacBans: 0, gameBans: 0, daysSinceLastBan: 0, economyBan: 'none' };

function env(overrides: Record<string, unknown> = {}) {
  const store = new SteamStore(':memory:');
  store.link({ senderKey: 'whatsapp:1', steamId: A1, personaName: 'MainNick', personId: 'p1', now: 1 });
  store.link({ senderKey: 'whatsapp:1', steamId: A2, personaName: 'AltNick', personId: 'p1', now: 2 });
  store.link({ senderKey: 'whatsapp:2', steamId: B, personaName: 'BNick', personId: 'p2', now: 3 });
  store.link({ senderKey: 'whatsapp:3', steamId: C, personaName: 'CNick', personId: 'p3', now: 4 });
  for (const key of ['whatsapp:1', 'whatsapp:2', 'whatsapp:3']) store.enroll(GROUP, key);
  const calls: string[] = [];
  const libraries: Record<string, Unknown<GameStat[]>> = {
    [A1]: lib([1, 'Shared One', 600], [2, 'Only Arthur', 60], [730, 'Counter-Strike 2', 300]),
    [A2]: lib([3, 'Shared Two', 60]),
    [B]: lib([1, 'Shared One', 60], [3, 'Shared Two', 60], [4, 'Only Nori', 6]),
    [C]: { known: false, reason: 'profile_private' },
  };
  const levels: Record<string, number | undefined> = { [A1]: 34, [A2]: 5, [B]: 80, [C]: undefined };
  const wishlists: Record<string, WishlistEntry[]> = { [A1]: [{ appId: 10, priority: 1 }, { appId: 11, priority: 2 }], [B]: [{ appId: 11, priority: 1 }, { appId: 12, priority: 2 }] };
  const client = {
    hasKey: async () => true,
    ownedGames: async (id: string) => { calls.push(`owned:${id}`); return libraries[id] ?? { known: false, reason: 'profile_private' }; },
    steamLevel: async (id: string): Promise<Unknown<number>> => { calls.push(`level:${id}`); return levels[id] === undefined ? { known: false, reason: 'profile_private' } : { known: true, value: levels[id]! }; },
    badges: async (id: string) => (levels[id] === undefined ? { known: false as const, reason: 'profile_private' as const } : { known: true as const, value: { level: levels[id]!, xp: 100, xpToNextLevel: 50, badgeCount: 7 } }),
    playerBans: async (ids: string[]) => new Map(ids.map((id): [string, PlayerBans] => [id, id === A2 ? { ...noBan, steamId: id, vacBanned: true, vacBans: 1, daysSinceLastBan: 400 } : { ...noBan, steamId: id }])),
    currentPlayers: async (appId: string) => { calls.push(`players:${appId}`); return appId === '999' ? undefined : 337_833; },
    news: async (appId: string, count: number) => (appId === '999' ? [] : Array.from({ length: count }, (_, index) => ({ gid: String(index), title: `Patch ${index}`, url: 'https://news.example/x', feedLabel: 'Steam', date: Date.parse('2026-11-08T00:00:00Z'), contents: '[b]Fixes[/b] <p>things</p>' }))),
    userStats: async (id: string, appId: string): Promise<Unknown<{ gameName?: string; stats: Array<{ name: string; value: number }> }>> => (id === A1 && appId === '730' ? { known: true, value: { gameName: 'Counter-Strike 2', stats: [{ name: 'total_kills', value: 1310 }, { name: 'total_deaths', value: 1523 }, { name: 'total_wins', value: 90 }] } } : { known: false, reason: id === B ? 'profile_private' : 'not_available' }),
    wishlist: async (id: string): Promise<Unknown<WishlistEntry[]>> => (wishlists[id] ? { known: true, value: wishlists[id]! } : { known: false, reason: 'not_available' }),
    storeNames: async (ids: number[]) => new Map(ids.map((id): [number, string] => [id, `Name${id}`])),
    storeSearch: async (term: string) => (term.toLowerCase() === 'unknown game' ? [] : [{ appId: 4242, name: 'Found By Search' }]),
    ...overrides,
  };
  const deps = { store, now: () => 1_000_000, client } as unknown as SteamToolDependencies;
  const caller = (extra: Partial<SteamCaller> = {}): SteamCaller => ({
    senderKey: 'whatsapp:1', groupId: GROUP, isOwner: false, mentions: [], selfPerson: () => 'p1',
    displayName: (personId) => ({ p1: 'Arthur', p2: 'Nori', p3: 'Zed' } as Record<string, string>)[personId], ...extra,
  });
  return { store, deps, caller, calls };
}

test('level, badges and bans per account; bans are stated as facts; ranking leaves out members whose level is private', async () => {
  const { deps, caller } = env();
  const own = await steamGetAccountInfo(deps, caller(), { include: ['level', 'badges', 'bans'] }) as { accountCount: number; accounts: Array<{ account: string; level: number; badges: { badgeCount: number }; bans: { vacBanned: boolean; summary: string; lastBan?: string } }> };
  assert.equal(own.accountCount, 2);
  assert.deepEqual(own.accounts.map((a) => [a.account, a.level, a.badges.badgeCount, a.bans.vacBanned]), [['MainNick', 34, 7, false], ['AltNick', 5, 7, true]]);
  assert.match(own.accounts[1]!.bans.summary, /只陈述事实/u);
  assert.equal(own.accounts[1]!.bans.lastBan, '400 天前');
  const ranking = await steamGetAccountInfo(deps, caller(), { all: true }) as { ranking: Array<{ name: string; level: number }>; levelNotPublic: string[] };
  assert.deepEqual(ranking.ranking.map((r) => [r.name, r.level]), [['Nori', 80], ['Arthur', 34]]);
  assert.deepEqual(ranking.levelNotPublic, ['Zed']);
  const privateOwn = await steamGetAccountInfo(deps, caller({ senderKey: 'whatsapp:3', selfPerson: () => 'p3' }), { include: ['level'] }) as { level: { known: boolean; note: string } };
  assert.deepEqual([privateOwn.level.known, privateOwn.level.note], [false, '等级未公开']);
});

test('a game: players online and news, found from the asker\'s library or the store search; cached; unknown games say so', async () => {
  const { deps, caller, calls } = env();
  const own = await steamGameInfo(deps, caller(), { game: 'counter-strike' }) as { game: { appId: string; name: string }; currentPlayers: { value: number }; news: { value: Array<{ title: string; summary: string; date: string }> } };
  assert.deepEqual([own.game.appId, own.currentPlayers.value, own.news.value.length], ['730', 337_833, 3]);
  assert.equal(own.news.value[0]!.summary, 'Fixes things');                // markup stripped
  assert.equal(own.news.value[0]!.date, '2026-11-08');
  await steamGameInfo(deps, caller(), { game: '730', info: 'players' });
  assert.equal(calls.filter((entry) => entry === 'players:730').length, 1, 'the player count is cached');
  const searched = await steamGameInfo(deps, caller(), { game: 'Some Game From The Store', info: 'players' }) as { game: { appId: string; name: string } };
  assert.deepEqual([searched.game.appId, searched.game.name], ['4242', 'Found By Search']);
  assert.deepEqual(await steamGameInfo(deps, caller(), { game: 'unknown game' }), { status: 'not_found', reason: 'game_not_found' });
  const none = await steamGameInfo(deps, caller(), { game: '999' }) as { currentPlayers: { known: boolean }; news: { known: boolean } };
  assert.deepEqual([none.currentPlayers.known, none.news.known], [false, false]);
});

test('a person\'s numbers in a game: filtered, capped, private and no-stats said plainly, PUBG sent to the pubg tools', async () => {
  const { deps, caller } = env();
  const answer = await steamGetGameStats(deps, caller(), { game: 'Counter-Strike 2', stat: 'total', limit: 2 }) as { account?: string; stats: { known: boolean; total: number; shown: number; items: Array<{ name: string; value: number }> }; accountCount?: number; accounts?: Array<{ stats: { known: boolean } }> };
  assert.equal(answer.accountCount, 2);                                      // two accounts, listed separately
  assert.deepEqual(answer.accounts!.map((a) => a.stats.known), [true, false]);
  const first = (answer.accounts![0] as unknown as { stats: { items: Array<{ name: string }>; shown: number } }).stats;
  assert.deepEqual([first.shown, first.items.map((i) => i.name)], [2, ['total_deaths', 'total_kills']]);
  assert.deepEqual(await steamGetGameStats(deps, caller(), { game: '578080' }), { status: 'refused', reason: 'use_pubg_tools', note: 'PUBG 的战绩和数据请用 pubg_* 工具查询。' });
  const other = await steamGetGameStats(deps, caller({ selfPerson: () => undefined, senderKey: 'whatsapp:9', mentions: ['whatsapp:2'] }), { person: { reference: 'mention' }, game: '730' }) as { stats: { known: boolean; note: string } };
  assert.deepEqual([other.stats.known, other.stats.note], [false, '游戏详情未公开']);
});

test('shared games: members\' libraries intersected, private members listed, needs two readable members', async () => {
  const { deps, caller } = env();
  const all = await steamLibraryOverlap(deps, caller(), { mode: 'common', all: true }) as { compared: string[]; sharedCount: number; shared: Array<{ name: string; combinedHours: number }>; gameDetailsNotPublic: string[] };
  assert.deepEqual(all.compared, ['Arthur', 'Nori']);
  assert.deepEqual(all.shared.map((g) => [g.name, g.combinedHours]), [['Shared One', 11], ['Shared Two', 2]]);   // Shared Two comes from the second account
  assert.deepEqual(all.gameDetailsNotPublic, ['Zed']);
  const alone = await steamLibraryOverlap(deps, caller(), { mode: 'common' }) as { note: string };
  assert.match(alone.note, /至少需要两个/u);
  const chosen = await steamLibraryOverlap(deps, caller({ mentions: ['whatsapp:2'] }), { mode: 'common', people: [{ reference: 'self' }, { reference: 'mention' }] }) as { sharedCount: number };
  assert.equal(chosen.sharedCount, 2);
});

test('wishlists: per member, the intersection by name, empty or hidden lists named; one person alone is fine', async () => {
  const { deps, caller } = env();
  const everyone = await steamLibraryOverlap(deps, caller(), { mode: 'wishlist', all: true }) as { wishlists: Array<{ name: string; count: number; top: string[] }>; shared: string[]; wishlistEmptyOrNotPublic: string[] };
  assert.deepEqual(everyone.wishlists.map((w) => [w.name, w.count]), [['Arthur', 2], ['Nori', 2]]);
  assert.deepEqual(everyone.wishlists[0]!.top, ['Name10', 'Name11']);
  assert.deepEqual(everyone.shared, ['Name11']);
  assert.deepEqual(everyone.wishlistEmptyOrNotPublic, ['Zed']);
  const self = await steamLibraryOverlap(deps, caller(), { mode: 'wishlist' }) as { wishlists: unknown[]; shared?: unknown };
  assert.equal(self.wishlists.length, 1);
  assert.equal(self.shared, undefined);
  const none = await steamLibraryOverlap(deps, caller({ senderKey: 'whatsapp:3', selfPerson: () => 'p3' }), { mode: 'wishlist' }) as { wishlist: { known: boolean; note: string } };
  assert.deepEqual([none.wishlist.known, none.wishlist.note], [false, '愿望单为空或未公开']);
});

test('a client without these reads reports them unavailable instead of failing', async () => {
  const { deps, caller } = env({ steamLevel: undefined, currentPlayers: undefined, userStats: undefined, wishlist: undefined });
  for (const answer of [await steamGetAccountInfo(deps, caller(), {}), await steamGameInfo(deps, caller(), { game: 'x' }), await steamGetGameStats(deps, caller(), { game: 'x' }), await steamLibraryOverlap(deps, caller(), { mode: 'wishlist' })]) {
    assert.deepEqual(answer, { status: 'unavailable', reason: 'not_supported' });
  }
});
