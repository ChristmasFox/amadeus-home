import assert from 'node:assert/strict';
import test from 'node:test';
import { SteamClient } from '../src/steam/client.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ID = '76561190000000001';

function client(handler: (url: URL) => Response) {
  return new SteamClient({ apiKey: 'TEST-KEY-PLACEHOLDER', baseUrl: 'https://steam.example', storeBaseUrl: 'https://store.example', minIntervalMs: 0, sleep: async () => {}, fetchImpl: (async (input: URL) => handler(input)) as never });
}

test('level, badges and bans: values when shared, unknown (never zero) when the profile is private', async () => {
  const c = client((url) => {
    if (url.pathname.includes('GetSteamLevel')) return json(url.searchParams.get('steamid') === ID ? { response: { player_level: 34 } } : { response: {} });
    if (url.pathname.includes('GetBadges')) return json(url.searchParams.get('steamid') === ID ? { response: { badges: [{}, {}, {}], player_xp: 5000, player_level: 34, player_xp_needed_to_level_up: 70 } } : { response: {} });
    return json({ players: [{ SteamId: ID, CommunityBanned: false, VACBanned: true, NumberOfVACBans: 1, DaysSinceLastBan: 12, NumberOfGameBans: 0, EconomyBan: 'none' }] });
  });
  assert.deepEqual(await c.steamLevel(ID), { known: true, value: 34 });
  assert.deepEqual(await c.steamLevel('x'), { known: false, reason: 'profile_private' });
  assert.deepEqual(await c.badges(ID), { known: true, value: { level: 34, xp: 5000, xpToNextLevel: 70, badgeCount: 3 } });
  assert.deepEqual(await c.badges('x'), { known: false, reason: 'profile_private' });
  const bans = (await c.playerBans([ID])).get(ID)!;
  assert.deepEqual([bans.vacBanned, bans.vacBans, bans.daysSinceLastBan, bans.economyBan], [true, 1, 12, 'none']);
});

test('players online and news: parsed, absent when Steam does not report them', async () => {
  const c = client((url) => (url.pathname.includes('GetNumberOfCurrentPlayers')
    ? json({ response: { player_count: 1234, result: url.searchParams.get('appid') === '1' ? 1 : 42 } })
    : json({ appnews: { newsitems: [{ gid: '9', title: 'Patch', url: 'https://x', feedlabel: 'Steam', date: 1_700_000_000, contents: 'body' }, { bogus: true }] } })));
  assert.equal(await c.currentPlayers('1'), 1234);
  assert.equal(await c.currentPlayers('2'), undefined);
  const items = await c.news('1', 3);
  assert.deepEqual(items.map((item) => [item.title, item.date, item.feedLabel]), [['Patch', 1_700_000_000_000, 'Steam']]);
});

test('per-game statistics and wishlist: private and empty answers are unknown', async () => {
  const c = client((url) => {
    if (url.pathname.includes('GetUserStatsForGame')) {
      const id = url.searchParams.get('steamid');
      if (id === 'private') return json({}, 403);
      if (id === 'none') return json({}, 400);
      return json({ playerstats: { gameName: 'CS2', stats: [{ name: 'total_kills', value: 5 }, { name: 'bad', value: 'x' }] } });
    }
    return json(url.searchParams.get('steamid') === ID ? { response: { items: [{ appid: 10, priority: 1, date_added: 100 }, { appid: 20, priority: 2 }] } } : { response: {} });
  });
  assert.deepEqual(await c.userStats(ID, '730'), { known: true, value: { gameName: 'CS2', stats: [{ name: 'total_kills', value: 5 }] } });
  assert.deepEqual(await c.userStats('private', '730'), { known: false, reason: 'profile_private' });
  assert.deepEqual(await c.userStats('none', '730'), { known: false, reason: 'not_available' });
  assert.deepEqual((await c.wishlist(ID) as { value: Array<{ appId: number }> }).value.map((entry) => entry.appId), [10, 20]);
  assert.deepEqual(await c.wishlist('x'), { known: false, reason: 'not_available' });
});

test('store names are batched through the official store service; the name search uses the public storefront JSON', async () => {
  const seen: string[] = [];
  const c = client((url) => {
    seen.push(url.host + url.pathname);
    if (url.pathname.includes('GetItems')) return json({ response: { store_items: Array.from(JSON.parse(url.searchParams.get('input_json')!).ids as Array<{ appid: number }>, (entry) => ({ appid: entry.appid, name: `N${entry.appid}` })) } });
    return json({ items: [{ type: 'app', id: 578080, name: 'PUBG' }, { type: 'bundle', id: 1, name: 'Bundle' }] });
  });
  const ids = Array.from({ length: 51 }, (_, index) => index + 1);
  const names = await c.storeNames(ids);
  assert.equal(names.size, 51);
  assert.equal(seen.filter((entry) => entry.includes('GetItems')).length, 2, 'batches of 50');
  assert.deepEqual(await c.storeSearch('pubg'), [{ appId: 578080, name: 'PUBG' }]);
  assert.ok(seen.includes('store.example/api/storesearch/'));
});
