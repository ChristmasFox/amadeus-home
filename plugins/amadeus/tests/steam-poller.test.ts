import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlayerSummary } from '../src/steam/client.js';
import { PresencePoller, type AnnouncementFacts } from '../src/steam/poller.js';
import { SteamStore } from '../src/steam/store.js';

const DAY = Date.parse('2026-11-09T04:00:00Z'); // 12:00 Asia/Shanghai
const NIGHT = Date.parse('2026-11-08T17:00:00Z'); // 01:00 Asia/Shanghai
const GROUP = '120363000000000000@g.us';
const A = { sender: 'whatsapp:15550100001', steam: '76561190000000001', name: 'Alpha' };
const B = { sender: 'whatsapp:15550100002', steam: '76561190000000002', name: 'Bravo' };

function setup(options: { people?: typeof A[]; compose?: (facts: AnnouncementFacts) => Promise<string>; enabled?: boolean } = {}) {
  const store = new SteamStore(':memory:');
  for (const person of options.people ?? [A, B]) {
    store.link({ senderKey: person.sender, steamId: person.steam, personaName: person.name, now: DAY });
    store.enroll(GROUP, person.sender);
  }
  if (options.enabled === false) store.setGroup(GROUP, false);
  const states = new Map<string, { personaState: number; gameId?: string; gameName?: string }>();
  const sent: Array<{ groupId: string; text: string; key: string }> = [];
  let now = DAY;
  const poller = () => new PresencePoller({
    store,
    client: { playerSummaries: async (ids) => new Map(ids.flatMap((id): Array<[string, PlayerSummary]> => {
      const state = states.get(id);
      return state ? [[id, { steamId: id, name: id, profilePublic: true, ...state }]] : [];
    })) },
    compose: options.compose ?? (async (facts) => `FAKE: ${facts.people.map((person) => person.name).join('+')}`),
    send: async (groupId, text, key) => { sent.push({ groupId, text, key }); },
    now: () => now,
  });
  const advance = (ms: number) => { now += ms; };
  return { store, states, sent, poller, advance, setNow: (value: number) => { now = value; } };
}

async function cycle(env: ReturnType<typeof setup>, poller: PresencePoller, steps = 1) {
  for (let i = 0; i < steps; i += 1) { await poller.tick(); env.advance(60_000); }
}

test('baseline first, then a confirmed arrival is announced once, with a Kurisu-composed text', async () => {
  const env = setup();
  const poller = env.poller();
  env.states.set(A.steam, { personaState: 0 });
  await cycle(env, poller);                                   // baseline
  env.states.set(A.steam, { personaState: 1, gameId: '10', gameName: 'Placeholder Game' });
  await cycle(env, poller, 2);                                // seen twice -> event, merge window opens
  assert.equal(env.sent.length, 0);
  await cycle(env, poller, 4);                                // merge window (3 min) closes
  assert.equal(env.sent.length, 1);
  assert.equal(env.sent[0]!.text, 'FAKE: Alpha');
  assert.equal(env.sent[0]!.groupId, GROUP);
  await cycle(env, poller, 3);
  assert.equal(env.sent.length, 1);
});

test('a restart never replays: the ledger already knows the person is online', async () => {
  const env = setup();
  env.states.set(A.steam, { personaState: 1 });
  env.states.set(B.steam, { personaState: 0 });
  await cycle(env, env.poller(), 8);
  assert.equal(env.sent.length, 0);
  const restarted = env.poller();
  await cycle(env, restarted, 8);
  assert.equal(env.sent.length, 0);
});

test('two people arriving together share one message; coming back later is announced again', async () => {
  const env = setup();
  const poller = env.poller();
  env.states.set(A.steam, { personaState: 0 });
  env.states.set(B.steam, { personaState: 0 });
  await cycle(env, poller);
  env.states.set(A.steam, { personaState: 1 });
  env.states.set(B.steam, { personaState: 1 });
  await cycle(env, poller, 7);
  assert.equal(env.sent.length, 1);
  assert.equal(env.sent[0]!.text, 'FAKE: Alpha+Bravo');
  env.states.set(A.steam, { personaState: 0 });
  await cycle(env, poller, 3);
  env.states.set(A.steam, { personaState: 1 });
  await cycle(env, poller, 8);
  assert.equal(env.sent.length, 2); // no cooldown: a new arrival is a new announcement
});

test('an arrival that goes away again inside the merge window is not announced', async () => {
  const env = setup();
  const poller = env.poller();
  env.states.set(A.steam, { personaState: 0 });
  await cycle(env, poller);
  env.states.set(A.steam, { personaState: 1 });
  await cycle(env, poller, 2);
  env.states.set(A.steam, { personaState: 0 });
  await cycle(env, poller, 8);
  assert.equal(env.sent.length, 0);
});

test('quiet hours drop the arrival for good; nothing is replayed in the morning', async () => {
  const env = setup();
  env.setNow(NIGHT);
  const poller = env.poller();
  env.states.set(A.steam, { personaState: 0 });
  await cycle(env, poller);
  env.states.set(A.steam, { personaState: 1 });
  await cycle(env, poller, 8);
  assert.equal(env.sent.length, 0);
  env.setNow(DAY);
  await cycle(env, poller, 8);
  assert.equal(env.sent.length, 0);
});

test('switched-off person, disabled group and a failed compose all stay silent; a failed compose is recorded, not templated', async () => {
  for (const scenario of ['opt-out', 'group-off', 'compose-fails'] as const) {
    const env = setup({ enabled: scenario !== 'group-off', compose: scenario === 'compose-fails' ? async () => { throw new Error('model down'); } : undefined as never });
    if (scenario === 'opt-out') env.store.setBroadcast(A.sender, false);
    const poller = env.poller();
    env.states.set(A.steam, { personaState: 0 });
    await cycle(env, poller);
    env.states.set(A.steam, { personaState: 1 });
    await cycle(env, poller, 8);
    assert.equal(env.sent.length, 0, scenario);
  }
});

test('send failures are recorded and not retried into a duplicate', async () => {
  const env = setup();
  const store = env.store;
  const failing = new PresencePoller({
    store,
    client: { playerSummaries: async (ids) => new Map(ids.map((id): [string, PlayerSummary] => [id, { steamId: id, name: id, profilePublic: true, personaState: env.states.get(id)?.personaState ?? 0 }])) },
    compose: async () => 'x Alpha',
    send: async () => { throw new Error('gateway down'); },
    now: () => DAY + 0,
  });
  let t = DAY;
  (failing as unknown as { now: () => number }).now = () => t;
  env.states.set(A.steam, { personaState: 0 });
  await failing.tick();
  t += 60_000; env.states.set(A.steam, { personaState: 1 });
  for (let i = 0; i < 8; i += 1) { await failing.tick(); t += 60_000; }
  assert.equal(store.announcedInLastHour(GROUP, t), 0);
});

test('a person who left the group (membership check fails) is not announced', async () => {
  const env = setup({ people: [A] });
  const poller = new PresencePoller({
    store: env.store,
    client: { playerSummaries: async (ids) => new Map(ids.map((id): [string, PlayerSummary] => [id, { steamId: id, name: id, profilePublic: true, personaState: env.states.get(id)?.personaState ?? 0 }])) },
    compose: async () => 'Alpha',
    send: async (groupId, text, key) => { env.sent.push({ groupId, text, key }); },
    isMember: async () => false,
    now: () => DAY,
  });
  let t = DAY;
  (poller as unknown as { now: () => number }).now = () => t;
  env.states.set(A.steam, { personaState: 0 });
  await poller.tick();
  env.states.set(A.steam, { personaState: 1 });
  for (let i = 0; i < 8; i += 1) { t += 60_000; await poller.tick(); }
  assert.equal(env.sent.length, 0);
});

test('default-on group: linked people seen in the group are enrolled on their own, opt-outs stay out, friendship is irrelevant', async () => {
  const store = new SteamStore(':memory:');
  store.link({ senderKey: 'whatsapp:1', steamId: A.steam, personaName: 'Alpha', personId: 'pa', now: DAY });
  store.link({ senderKey: 'whatsapp:2', steamId: B.steam, personaName: 'Bravo', personId: 'pb', now: DAY });
  store.setBroadcast('whatsapp:2', false);
  assert.equal(store.groupEnabled(GROUP), true);
  assert.deepEqual(store.watchedSteamIds(), []);
  const poller = new PresencePoller({
    store,
    client: { playerSummaries: async (ids) => new Map(ids.map((id): [string, PlayerSummary] => [id, { steamId: id, name: id, profilePublic: true, personaState: 1 }])) },
    compose: async () => 'x',
    send: async () => undefined,
    now: () => DAY,
    groupPeople: () => [{ groupId: GROUP, personIds: ['pa', 'pb', 'nobody'] }],
  });
  const report = await poller.tick();
  assert.equal(report.watched, 1);
  assert.deepEqual(store.watchedSteamIds(), [A.steam]);
  assert.deepEqual(store.broadcastMembers(GROUP).map((link) => link.senderKey), ['whatsapp:1']);
  store.setGroup(GROUP, false);
  assert.deepEqual(store.watchedSteamIds(), []);
});

test('an online person who starts a game, then switches game, is announced each time; no cooldown holds them back', async () => {
  const env = setup({ people: [A] });
  const poller = env.poller();
  env.states.set(A.steam, { personaState: 1 });
  await cycle(env, poller);                                   // baseline: online
  env.states.set(A.steam, { personaState: 1, gameId: '10', gameName: 'Game One' });
  await cycle(env, poller, 6);
  assert.equal(env.sent.length, 1);
  env.states.set(A.steam, { personaState: 1, gameId: '11', gameName: 'Game Two' });
  await cycle(env, poller, 6);
  assert.equal(env.sent.length, 2);
  env.states.set(A.steam, { personaState: 1, gameId: '10', gameName: 'Game One' });
  await cycle(env, poller, 6);
  assert.equal(env.sent.length, 3);
});
