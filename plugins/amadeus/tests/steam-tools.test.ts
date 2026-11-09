import assert from 'node:assert/strict';
import test from 'node:test';
import { SteamApiError, type PlayerSummary } from '../src/steam/client.js';
import { SteamStore } from '../src/steam/store.js';
import {
  FRIENDS_CACHE_MS, steamFriendsStatus, steamGetPlaytime, steamGetProfile, steamGetRecentGames, steamGroupSettings, steamLinkAccount, steamSetBroadcast, steamUnlink,
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
      friendList: async () => ({ known: true, value: [] }),
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
  assert.equal(store.groupEnabled(GROUP), true, 'a group announces by default');
  assert.equal((steamGroupSettings(deps, caller({ isOwner: true }), { enabled: false }) as { announcementsEnabled: boolean }).announcementsEnabled, false);
  assert.equal((steamGroupSettings(deps, caller(), {}) as { announcementsEnabled: boolean }).announcementsEnabled, false);
  assert.equal((steamGroupSettings(deps, caller({ isOwner: true }), { enabled: true }) as { announcementsEnabled: boolean }).announcementsEnabled, true);
  assert.deepEqual(steamGroupSettings(deps, caller({ isOwner: true, groupId: undefined as never }), { enabled: true }), { status: 'refused', reason: 'only_available_in_a_group' });
});

function friendsSetup(friends: PlayerSummary[] | 'private', calls = { list: 0, summaries: 0 }) {
  const env = setup();
  env.store.link({ senderKey: ME, steamId: ID, personaName: 'Owner', now: 1 });
  const client = env.deps.client as unknown as Record<string, unknown>;
  client.friendList = async () => { calls.list += 1; return friends === 'private' ? { known: false, reason: 'profile_private' } : { known: true, value: friends.map((friend) => friend.steamId) }; };
  client.playerSummaries = async (ids: string[]) => { calls.summaries += 1; return new Map((friends === 'private' ? [] : friends).filter((friend) => ids.includes(friend.steamId)).map((friend) => [friend.steamId, friend])); };
  return { ...env, calls, ownerDm: () => env.caller({ isOwner: true, groupId: undefined as never }) };
}

const friend = (n: number, extra: Partial<PlayerSummary> = {}): PlayerSummary => summary(`7656119000000010${n}`, { name: `Friend${n}`, ...extra });

test('friends status: the owner in a direct chat sees who is playing; filters, name search and ordering work', async () => {
  const { deps, ownerDm } = friendsSetup([
    friend(1, { gameId: '10', gameName: 'Placeholder One' }),
    friend(2, { personaState: 1 }),
    friend(3, { personaState: 0, lastLogoff: Date.parse('2026-11-01T00:00:00Z') }),
    friend(4, { personaState: 0, profilePublic: false }),
  ]);
  const playing = await steamFriendsStatus(deps, ownerDm(), {}) as { friends: Array<{ name: string; game: string | null; state: string }>; hiddenOrOfflineUnknown: number };
  assert.deepEqual(playing.friends, [{ name: 'Friend1', state: 'in_game', game: 'Placeholder One' }]);
  assert.equal(playing.hiddenOrOfflineUnknown, 1);
  const online = await steamFriendsStatus(deps, ownerDm(), { filter: 'online' }) as { friends: Array<{ name: string }> };
  assert.deepEqual(online.friends.map((entry) => entry.name), ['Friend1', 'Friend2']);
  const all = await steamFriendsStatus(deps, ownerDm(), { filter: 'all' }) as { friends: Array<{ name: string; lastSeenAt?: string }> };
  assert.deepEqual(all.friends.map((entry) => entry.name), ['Friend1', 'Friend2', 'Friend3']); // the hidden profile is never listed as offline
  assert.equal(all.friends[2]!.lastSeenAt, '2026-11-01T00:00:00.000Z');
  const named = await steamFriendsStatus(deps, ownerDm(), { name: 'friend1', filter: 'all' }) as { friends: Array<{ name: string }> };
  assert.deepEqual(named.friends.map((entry) => entry.name), ['Friend1']);
});

test('friends status is refused for non-owners, in groups and without a trusted sender; nothing is exposed', async () => {
  const { deps, caller } = friendsSetup([friend(1, { gameId: '10', gameName: 'Placeholder One' })]);
  for (const refused of [caller({ isOwner: true }), caller({ isOwner: false, groupId: undefined as never }), { isOwner: true, mentions: [] }] as SteamCaller[]) {
    assert.deepEqual(await steamFriendsStatus(deps, refused, {}), { status: 'refused', reason: 'owner_direct_chat_only' });
  }
  const env = setup();
  assert.deepEqual(await steamFriendsStatus(env.deps, env.caller({ isOwner: true, groupId: undefined as never }), {}), { status: 'not_linked', reason: 'link_your_own_steam_account_first' });
});

test('a private friend list is unknown, and a missing key is reported', async () => {
  const { deps, ownerDm } = friendsSetup('private');
  assert.deepEqual(await steamFriendsStatus(deps, ownerDm(), {}), { status: 'ok', friends: { known: false, reason: 'profile_private' } });
  const noKey = friendsSetup([]);
  (noKey.deps.client as unknown as { hasKey: () => Promise<boolean> }).hasKey = async () => false;
  assert.deepEqual(await steamFriendsStatus(noKey.deps, noKey.ownerDm(), {}), { status: 'unavailable', reason: 'steam_api_key_missing' });
});

test('friend data is cached briefly, refetched after it expires, and never stored or announced', async () => {
  let t = 1_000_000;
  const calls = { list: 0, summaries: 0 };
  const { store, deps, ownerDm } = friendsSetup([friend(1, { gameId: '10', gameName: 'Placeholder One' })], calls);
  deps.now = () => t;
  await steamFriendsStatus(deps, ownerDm(), {});
  await steamFriendsStatus(deps, ownerDm(), { filter: 'all' });
  assert.equal(calls.list, 1);
  t += FRIENDS_CACHE_MS + 1;
  await steamFriendsStatus(deps, ownerDm(), {});
  assert.equal(calls.list, 2);
  assert.deepEqual(store.watchedSteamIds(), []);
  assert.equal(store.linkBySteamId('76561190000000101'), undefined);
});

test('one known person shares a link across sender keys: phone-bound, group id finds and re-confirms it', async () => {
  const { store, deps, caller } = setup();
  const PHONE = 'whatsapp:111';
  const LID = 'whatsapp:222';
  const me = (key: string): Partial<SteamCaller> => ({ senderKey: key, selfPerson: () => 'p1', mirrorLink: () => 'p1' });
  await steamLinkAccount(deps, caller(me(PHONE)), { reference: ID, confirm: true });
  const viaGroup = await steamGetProfile(deps, caller(me(LID)), { person: { reference: 'self' } }) as { status: string };
  assert.equal(viaGroup.status, 'ok');
  const again = await steamLinkAccount(deps, caller(me(LID)), { reference: ID, confirm: true }) as { status: string };
  assert.equal(again.status, 'linked');
  assert.equal(store.linkBySender(LID), undefined);
  assert.deepEqual(store.broadcastMembers(GROUP).map((link) => link.senderKey), [PHONE]);
  assert.equal((steamSetBroadcast(deps, caller(me(LID)), { enabled: false }) as { status: string }).status, 'ok');
  assert.equal(store.linkBySender(PHONE)?.broadcast, false);
});

test('a different person still conflicts on the same account; unknown people stay keyed by sender', async () => {
  const { deps, caller } = setup();
  await steamLinkAccount(deps, caller({ senderKey: 'whatsapp:111', selfPerson: () => 'p1', mirrorLink: () => 'p1' }), { reference: ID, confirm: true });
  const other = await steamLinkAccount(deps, caller({ senderKey: 'whatsapp:222', selfPerson: () => 'p2', mirrorLink: () => 'p2' }), { reference: ID, confirm: true }) as { status: string };
  assert.equal(other.status, 'conflict');
  assert.equal((await steamGetProfile(deps, caller({ senderKey: 'whatsapp:333' }), { person: { reference: 'self' } }) as { status: string }).status, 'not_linked');
});
