import assert from 'node:assert/strict';
import test from 'node:test';
import { SteamApiError, SteamClient } from '../src/steam/client.js';

const KEY = 'TEST-KEY-PLACEHOLDER';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const player = (id: string, extra: Record<string, unknown> = {}) => ({ steamid: id, personaname: `p${id.slice(-2)}`, communityvisibilitystate: 3, personastate: 1, ...extra });

function client(handler: (url: URL, call: number) => Response | Promise<Response>, extra: Record<string, unknown> = {}) {
  const urls: URL[] = [];
  const instance = new SteamClient({
    apiKey: KEY, baseUrl: 'https://steam.example', minIntervalMs: 0, sleep: async () => {},
    fetchImpl: (async (input: URL) => { urls.push(input); return handler(input, urls.length); }) as never,
    ...extra,
  });
  return { instance, urls };
}

test('summaries are batched by 100 and carry the key only in the query', async () => {
  const ids = Array.from({ length: 101 }, (_, index) => `7656119${String(index).padStart(10, '0')}`);
  const { instance, urls } = client((url) => json({ response: { players: url.searchParams.get('steamids')!.split(',').map((id) => player(id)) } }));
  const result = await instance.playerSummaries(ids);
  assert.equal(result.size, 101);
  assert.equal(urls.length, 2);
  assert.equal(urls[0]!.searchParams.get('steamids')!.split(',').length, 100);
  assert.equal(urls[0]!.searchParams.get('key'), KEY);
});

test('server errors are retried, then reported without leaking the key', async () => {
  const flaky = client((_url, call) => (call < 3 ? json({}, 502) : json({ response: { players: [player('76561190000000001')] } })));
  assert.equal((await flaky.instance.playerSummaries(['76561190000000001'])).size, 1);
  assert.equal(flaky.urls.length, 3);
  const limited = client(() => json({}, 429));
  await assert.rejects(limited.instance.playerSummaries(['76561190000000001']), (error: unknown) => {
    assert.ok(error instanceof SteamApiError);
    assert.equal(error.code, 'rate_limited');
    assert.ok(!String(error.message).includes(KEY));
    return true;
  });
  assert.equal(limited.urls.length, 3);
  await assert.rejects(client(() => json({}, 403)).instance.ownedGames('1'), { code: 'forbidden' });
});

test('network failures surface as a bounded error code', async () => {
  const failing = new SteamClient({ apiKey: KEY, minIntervalMs: 0, sleep: async () => {}, fetchImpl: (async () => { throw new TypeError(`fetch failed ${KEY}`); }) as never });
  await assert.rejects(failing.playerSummaries(['1']), (error: unknown) => error instanceof SteamApiError && error.code === 'network' && !error.message.includes(KEY));
});

test('a missing key file is reported, not guessed', async () => {
  const none = new SteamClient({ keyFile: '/nonexistent/steam-key' });
  assert.equal(await none.hasKey(), false);
  await assert.rejects(none.resolveVanity('x'), { code: 'key_missing' });
});

test('private profiles come back as unknown, never as zero', async () => {
  const { instance } = client((url) => {
    if (url.pathname.includes('GetOwnedGames')) return json({ response: {} });
    if (url.pathname.includes('GetRecentlyPlayedGames')) return json({ response: {} });
    return json({ response: { players: [] } });
  });
  assert.deepEqual(await instance.ownedGames('1'), { known: false, reason: 'profile_private' });
  assert.deepEqual(await instance.recentGames('1'), { known: false, reason: 'profile_private' });
  const none = client(() => json({ response: { total_count: 0 } }));
  assert.deepEqual(await none.instance.recentGames('1'), { known: true, value: [] });
});

test('games and vanity resolution parse the documented shapes', async () => {
  const { instance } = client((url) => {
    if (url.pathname.includes('ResolveVanityURL')) return json({ response: url.searchParams.get('vanityurl') === 'known' ? { success: 1, steamid: '76561190000000001' } : { success: 42 } });
    return json({ response: { game_count: 1, games: [{ appid: 10, name: 'Placeholder Game', playtime_forever: 125, playtime_2weeks: 30 }] } });
  });
  assert.equal(await instance.resolveVanity('known'), '76561190000000001');
  assert.equal(await instance.resolveVanity('nope'), undefined);
  assert.deepEqual(await instance.ownedGames('1'), { known: true, value: [{ appId: 10, name: 'Placeholder Game', totalMinutes: 125, recentMinutes: 30 }] });
});
