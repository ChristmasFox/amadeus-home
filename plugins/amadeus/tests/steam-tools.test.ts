import assert from 'node:assert/strict';
import test from 'node:test';
import { SteamApiError, type PlayerSummary } from '../src/steam/client.js';
import { SteamStore } from '../src/steam/store.js';
import {
  steamGetPlaytime, steamGetProfile, steamGetRecentGames, steamGroupSettings, steamLinkAccount, steamSetBroadcast, steamUnlink,
  type SteamCaller, type SteamToolDependencies,
} from '../src/steam/tools.js';

const GROUP = '120363000000000000@g.us';
const ME = 'whatsapp:15550100001';
const OTHER = 'whatsapp:15550100002';
const ID = '76561190000000001';
const summary = (id: string, extra: Partial<PlayerSummary> = {}): PlayerSummary => ({ steamId: id, name: `Name${id.slice(-1)}`, profilePublic: true, personaState: 1, createdAt: Date.parse('2015-01-01T00:00:00Z'), ...extra });

function setup(options: { key?: boolean; privateGames?: boolean } = {}) {
  const store = new SteamStore(':memory:');
  const deps: SteamToolDependencies = {
    store,
    now: () => 1_000,
    client: {
      hasKey: async () => options.key !== false,
      resolveVanity: async (vanity) => (vanity === 'known_name' ? ID : undefined),
      playerSummaries: async (ids) => new Map(ids.map((id): [string, PlayerSummary] => [id, summary(id)])),
      ownedGames: async () => options.privateGames ? { known: false, reason: 'profile_private' } : { known: true, value: [{ appId: 1, name: 'Placeholder One', totalMinutes: 600 }, { appId: 2, name: 'Placeholder Two', totalMinutes: 60, recentMinutes: 30 }] },
      recentGames: async () => options.privateGames ? { known: false, reason: 'profile_private' } : { known: true, value: [{ appId: 2, name: 'Placeholder Two', totalMinutes: 60, recentMinutes: 30 }] },
    },
  };
  const caller = (extra: Partial<SteamCaller> = {}): SteamCaller => ({ senderKey: ME, groupId: GROUP, isOwner: false, mentions: [], ...extra });
  return { store, deps, caller };
}

test('linking is two-step: the nickname is shown first, only a confirmed call binds', async () => {
  const { store, deps, caller } = setup();
  const first = await steamLinkAccount(deps, caller(), { reference: 'known_name' }) as { status: string; candidate: { name: string } };
  assert.equal(first.status, 'needs_confirmation');
  assert.equal(first.candidate.name, 'Name1');
  assert.equal(store.linkBySender(ME), undefined);
  const done = await steamLinkAccount(deps, caller(), { reference: 'known_name', confirm: true }) as { status: string; broadcast: boolean };
  assert.deepEqual([done.status, done.broadcast], ['linked', true]);
  assert.equal(store.linkBySender(ME)?.broadcast, true);
  assert.deepEqual(store.broadcastMembers(GROUP).map((link) => link.steamId), [ID]);
});

test('an account held by someone else conflicts; garbage and unknown names are refused', async () => {
  const { deps, caller } = setup();
  await steamLinkAccount(deps, caller(), { reference: ID, confirm: true });
  assert.equal((await steamLinkAccount(deps, caller({ senderKey: OTHER }), { reference: ID, confirm: true }) as { status: string }).status, 'conflict');
  assert.equal((await steamLinkAccount(deps, caller(), { reference: '!!' }) as { status: string }).status, 'invalid_reference');
  assert.equal((await steamLinkAccount(deps, caller(), { reference: 'nobody_here' }) as { status: string }).status, 'not_found');
  assert.throws(() => steamUnlink(deps, { isOwner: false, mentions: [] }), /trusted_sender_metadata_unavailable/u);
});

test('without an API key every Steam call says so instead of guessing', async () => {
  const { deps, caller } = setup({ key: false });
  assert.deepEqual(await steamLinkAccount(deps, caller(), { reference: ID }), { status: 'unavailable', reason: 'steam_api_key_missing' });
  deps.store.link({ senderKey: ME, steamId: ID, personaName: 'x', now: 1 });
  assert.deepEqual(await steamGetProfile(deps, caller(), { person: { reference: 'self' } }), { status: 'unavailable', reason: 'steam_api_key_missing' });
});

test('API failures become bounded reasons', async () => {
  const { deps, caller } = setup();
  deps.store.link({ senderKey: ME, steamId: ID, personaName: 'x', now: 1 });
  (deps.client as { playerSummaries: unknown }).playerSummaries = async () => { throw new SteamApiError('rate_limited', 429); };
  assert.deepEqual(await steamGetProfile(deps, caller(), { person: { reference: 'self' } }), { status: 'unavailable', reason: 'rate_limited' });
});

test('broadcast switch: default on, off and on again, enrolment follows the group', async () => {
  const { store, deps, caller } = setup();
  assert.deepEqual(steamSetBroadcast(deps, caller(), { enabled: false }), { status: 'not_linked' });
  await steamLinkAccount(deps, caller(), { reference: ID, confirm: true });
  assert.equal((steamSetBroadcast(deps, caller(), { enabled: false }) as { broadcast: boolean }).broadcast, false);
  assert.deepEqual(store.broadcastMembers(GROUP), []);
  steamSetBroadcast(deps, caller(), { enabled: true });
  assert.equal(store.broadcastMembers(GROUP).length, 1);
  assert.equal(steamUnlink(deps, caller()) && store.linkBySender(ME), undefined);
});

test('others can be queried while their broadcast is on; switching it off hides them', async () => {
  const { deps, caller } = setup();
  deps.store.link({ senderKey: OTHER, steamId: '76561190000000002', personaName: 'Other', now: 1 });
  const viaMention = caller({ mentions: [OTHER] });
  assert.equal((await steamGetProfile(deps, viaMention, { person: { reference: 'mention' } }) as { status: string }).status, 'ok');
  deps.store.setBroadcast(OTHER, false);
  assert.deepEqual(await steamGetProfile(deps, viaMention, { person: { reference: 'mention' } }), { status: 'refused', reason: 'sharing_off' });
  assert.deepEqual(await steamGetProfile(deps, caller(), { person: { reference: 'self' } }), { status: 'not_linked', reason: 'no_steam_account_linked' });
  assert.equal((await steamGetProfile(deps, caller({ personForAlias: () => undefined }), { person: { reference: 'alias', alias: 'x' } }) as { status: string }).status, 'not_linked');
});

test('profile, playtime and recent games report values; private data is unknown, never zero', async () => {
  const open = setup();
  open.store.link({ senderKey: ME, steamId: ID, personaName: 'x', now: 1 });
  const profile = await steamGetProfile(open.deps, open.caller(), { person: { reference: 'self' } }) as { state: { known: boolean }; name: string };
  assert.equal(profile.state.known, true);
  const playtime = await steamGetPlaytime(open.deps, open.caller(), { person: { reference: 'self' } }) as { totalHours: number; top: Array<{ name: string }> };
  assert.equal(playtime.totalHours, 11);
  assert.equal(playtime.top[0]!.name, 'Placeholder One');
  const one = await steamGetPlaytime(open.deps, open.caller(), { person: { reference: 'self' }, game: 'two' }) as { found: boolean };
  assert.equal(one.found, true);
  const recent = await steamGetRecentGames(open.deps, open.caller(), { person: { reference: 'self' } }) as { recent: { known: boolean } };
  assert.equal(recent.recent.known, true);

  const hidden = setup({ privateGames: true });
  hidden.store.link({ senderKey: ME, steamId: ID, personaName: 'x', now: 1 });
  assert.deepEqual(await steamGetPlaytime(hidden.deps, hidden.caller(), { person: { reference: 'self' } }), { status: 'ok', games: { known: false, reason: 'profile_private' } });
  assert.deepEqual(await steamGetRecentGames(hidden.deps, hidden.caller(), { person: { reference: 'self' } }), { status: 'ok', recent: { known: false, reason: 'profile_private' } });
});

test('a hidden profile never reports a state; offline is not guessed', async () => {
  const { store, deps, caller } = setup();
  store.link({ senderKey: ME, steamId: ID, personaName: 'x', now: 1 });
  (deps.client as { playerSummaries: unknown }).playerSummaries = async () => new Map([[ID, summary(ID, { profilePublic: false, personaState: 0 })]]);
  const profile = await steamGetProfile(deps, caller(), { person: { reference: 'self' } }) as { state: { known: boolean }; accountCreatedAt: { known: boolean } };
  assert.equal(profile.state.known, false);
  assert.equal(profile.accountCreatedAt.known, false);
});

test('group announcements: owner only, in a group only', () => {
  const { store, deps, caller } = setup();
  assert.deepEqual(steamGroupSettings(deps, caller(), { enabled: true }), { status: 'refused', reason: 'owner_only' });
  assert.equal(store.groupEnabled(GROUP), false);
  assert.equal((steamGroupSettings(deps, caller({ isOwner: true }), { enabled: true }) as { announcementsEnabled: boolean }).announcementsEnabled, true);
  assert.equal((steamGroupSettings(deps, caller(), {}) as { announcementsEnabled: boolean }).announcementsEnabled, true);
  assert.deepEqual(steamGroupSettings(deps, caller({ isOwner: true, groupId: undefined as never }), { enabled: true }), { status: 'refused', reason: 'only_available_in_a_group' });
});
