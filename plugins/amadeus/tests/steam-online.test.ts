import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlayerSummary } from '../src/steam/client.js';
import { PresencePoller } from '../src/steam/poller.js';
import { SteamStore } from '../src/steam/store.js';
import { renderSteamNotifications } from '../src/steam/notify.js';

const MIN = 60_000;
const ID = '76561190000000001';
const GROUP = '120363000000000000@g.us';

type Seen = { state: 0 | 1; game?: { id: string; name: string } };

function env() {
  const store = new SteamStore(':memory:');
  store.link({ senderKey: 'whatsapp:p1', steamId: ID, personaName: 'nick', personId: 'p1', now: 0 });
  store.enroll(GROUP, 'whatsapp:p1');
  let now = Date.parse('2026-11-09T12:00:00Z');
  let seen: Seen = { state: 0 };
  const sent: string[] = [];
  const poller = new PresencePoller({
    store,
    client: { playerSummaries: async (ids) => new Map(ids.map((id): [string, PlayerSummary] => [id, { steamId: id, name: 'nick', profilePublic: true, personaState: seen.state, ...(seen.game ? { gameId: seen.game.id, gameName: seen.game.name } : {}) }])) },
    compose: (facts) => renderSteamNotifications(facts, new Date(now)),
    send: async (_group, text) => { sent.push(text); },
    displayName: () => 'kim',
    now: () => now,
  });
  const run = async (minutes: number, next: Seen) => { seen = next; for (let i = 0; i < minutes; i += 1) { await poller.tick(); now += MIN; } };
  return { sent, run };
}

/** The kind of each notice, by the emoji that ends its title. */
const titles = (sent: string[]) => sent.map((text) => text.split('\n')[0]!.split(' ').at(-1));

test('offline -> online announces the arrival', async () => {
  const { sent, run } = env();
  await run(1, { state: 0 });
  await run(5, { state: 1 });
  assert.deepEqual(titles(sent), ['🟢']);
});

test('offline -> straight into a game announces the arrival with the game', async () => {
  const { sent, run } = env();
  await run(1, { state: 0 });
  await run(5, { state: 1, game: { id: '10', name: 'Game A' } });
  assert.deepEqual(titles(sent), ['🟢']);
  assert.match(sent[0]!, /^Amadeus · kim 上线 · 正在玩 Game A 🟢\n/u);
});

test('coming online and then starting a game inside the merge window still announces the arrival, with the game', async () => {
  const { sent, run } = env();
  await run(1, { state: 0 });
  await run(1, { state: 1 });
  await run(5, { state: 1, game: { id: '10', name: 'Game A' } });
  assert.deepEqual(titles(sent), ['🟢']);
  assert.match(sent[0]!, /^Amadeus · kim 上线 · 正在玩 Game A 🟢\n/u);
});

test('coming online into a launcher and then switching to the real game inside the window is one arrival, not a switch', async () => {
  const { sent, run } = env();
  await run(1, { state: 0 });
  await run(1, { state: 1, game: { id: '1', name: 'Launcher' } });
  await run(5, { state: 1, game: { id: '2', name: 'Game B' } });
  assert.deepEqual(titles(sent), ['🟢']);
  assert.match(sent[0]!, /^Amadeus · kim 上线 · 正在玩 Game B 🟢\n/u);
});

test('a switch after the arrival was announced is a 世界线变动 naming both games, even for a short session', async () => {
  const { sent, run } = env();
  await run(1, { state: 0 });
  await run(5, { state: 1, game: { id: '10', name: 'Game A' } });
  await run(1, { state: 1, game: { id: '20', name: 'Game B' } });
  await run(5, { state: 1, game: { id: '20', name: 'Game B' } });
  assert.deepEqual(titles(sent), ['🟢', '🔀']);
  assert.match(sent[1]!, /^Amadeus · kim 世界线变动 · Game A → Game B 🔀\n/u);
  assert.match(sent[1]!, /El Psy Kongroo\.$/u);
});

test('games with a community alias are shown as name（alias） in every notice; others are left exactly as Steam names them', async () => {
  const { gameLabel } = await import('../src/steam/game-aliases.js');
  assert.equal(gameLabel('578080', 'PUBG: BATTLEGROUNDS'), 'PUBG: BATTLEGROUNDS（吃鸡）');
  assert.equal(gameLabel('271590', 'Grand Theft Auto V'), 'Grand Theft Auto V（GTA5）');
  assert.equal(gameLabel('730', 'Counter-Strike 2'), 'Counter-Strike 2（CS2）');
  assert.equal(gameLabel('999999', 'Some Game'), 'Some Game');
  assert.equal(gameLabel(undefined, 'Some Game'), 'Some Game');
  assert.equal(gameLabel('578080', '绝地求生 吃鸡'), '绝地求生 吃鸡', 'no doubled alias');
  assert.equal(gameLabel('578080', undefined), undefined);
  const { sent, run } = env();
  await run(1, { state: 0 });
  await run(5, { state: 1, game: { id: '578080', name: 'PUBG: BATTLEGROUNDS' } });
  await run(1, { state: 1, game: { id: '271590', name: 'Grand Theft Auto V' } });
  await run(5, { state: 1, game: { id: '271590', name: 'Grand Theft Auto V' } });
  assert.match(sent[0]!, /^Amadeus · kim 上线 · 正在玩 PUBG: BATTLEGROUNDS（吃鸡） 🟢\n/u);
  assert.match(sent[0]!, /- 游戏：PUBG: BATTLEGROUNDS（吃鸡）/u);
  assert.match(sent[1]!, /^Amadeus · kim 世界线变动 · PUBG: BATTLEGROUNDS（吃鸡） → Grand Theft Auto V（GTA5） 🔀\n/u);
});

test('guidance: a plain 玩了多久 is today; lifetime only when asked (stated in the tool description and the SKILL, not in code)', async () => {
  const { readFileSync } = await import('node:fs');
  const register = readFileSync(new URL('../src/steam/register.ts', import.meta.url), 'utf8');
  const skill = readFileSync(new URL('../skills/steam/SKILL.md', import.meta.url), 'utf8');
  assert.match(register, /没有说生涯、总共.*用 period=today，不要用不带 period 的总时长顶替/u);
  assert.match(skill, /plain "X 玩了多久[^]*means \*\*today\*\*[^]*do not substitute the lifetime totals/u);
});

test('who is playing and play time come back as finished Amadeus cards with the SteamID64, ready to deliver unchanged', async () => {
  const { renderPlaytimeCard, renderPlayingCard, CARD_REPLY_GUIDE } = await import('../src/steam/cards.js');
  const at = new Date('2026-11-09T12:00:00Z');
  const play = renderPlaytimeCard({ name: '猴', label: '今天（2026-11-09 06:00 → 次日 06:00）', games: [{ appId: '578080', name: 'PUBG: BATTLEGROUNDS', text: '2小时5分钟' }, { appId: '9', name: 'Other', text: '30分钟' }], totalText: '2小时35分钟' }, at);
  assert.equal(play, 'Amadeus · 猴 今日游戏时长 ⏱️\n\n- 时段：今天（2026-11-09 06:00 → 次日 06:00）\n- 游戏：PUBG: BATTLEGROUNDS（吃鸡），2小时5分钟\n- 游戏：Other，30分钟\n- 合计：2小时35分钟\n\nEl Psy Kongroo.');
  assert.match(renderPlaytimeCard({ name: '猴', label: '昨天（x）', games: [], totalText: '0分钟' }, at), /^Amadeus · 猴 昨日游戏时长 ⏱️\n[\s\S]*- 结果：没有记录到游戏时长/u);
  const who = renderPlayingCard({ friends: [{ name: 'A', steamId: '1', state: 'in_game', game: 'Phantom Blade Zero', appId: '4115450' }, { name: 'B', steamId: '2', state: 'online', game: null }] }, at);
  assert.equal(who, 'Amadeus · Steam 在线情况 · 2 位 👥\n\n- A：Phantom Blade Zero（游戏中）\n- B：在线\n\nEl Psy Kongroo.');
  assert.match(CARD_REPLY_GUIDE, /原样/u);
});

test('several people asked at once: one merged card with each person\'s games and total, delivered once', async () => {
  const { renderPlaytimeGroupCard } = await import('../src/steam/cards.js');
  const at = new Date('2026-11-09T12:00:00Z');
  const card = renderPlaytimeGroupCard({
    label: '今天（2026-11-09 06:00 → 次日 06:00）',
    members: [
      { name: '猴', known: true, games: [{ appId: '4115450', name: 'Phantom Blade Zero', text: '2小时19分钟' }, { appId: '578080', name: 'PUBG: BATTLEGROUNDS', text: '3分钟' }], totalText: '2小时22分钟' },
      { name: 'kim', known: true, games: [{ appId: '578080', name: 'PUBG: BATTLEGROUNDS', text: '5分钟' }], totalText: '5分钟' },
      { name: '胶', known: true, games: [], totalText: '0分钟' },
    ],
  }, at);
  assert.equal(card, 'Amadeus · 猴、kim、胶 今日游戏时长 ⏱️\n\n- 时段：今天（2026-11-09 06:00 → 次日 06:00）\n- 猴 · Phantom Blade Zero：2小时19分钟\n- 猴 · PUBG: BATTLEGROUNDS（吃鸡）：3分钟\n- 猴 · 合计：2小时22分钟\n- kim · PUBG: BATTLEGROUNDS（吃鸡）：5分钟\n- kim · 合计：5分钟\n- 胶：没有记录到游戏时长\n\nEl Psy Kongroo.');
  assert.equal((card.match(/El Psy Kongroo/gu) ?? []).length, 1, 'one card, one sign-off');
});

test('steam_get_playtime with people returns one card for everybody; several people without a period is refused', async () => {
  const { SteamStore } = await import('../src/steam/store.js');
  const { steamGetPlaytime } = await import('../src/steam/tools.js');
  const store = new SteamStore(':memory:');
  const NOW = Date.parse('2026-11-09T12:00:00Z');
  const A = '76561190000000001';
  const B = '76561190000000002';
  store.link({ senderKey: 'whatsapp:1', steamId: A, personaName: 'Alpha', personId: 'p1', now: NOW - 5 * 3_600_000 });
  store.link({ senderKey: 'whatsapp:2', steamId: B, personaName: 'Beta', personId: 'p2', now: NOW - 5 * 3_600_000 });
  store.enroll(GROUP, 'whatsapp:1'); store.enroll(GROUP, 'whatsapp:2');
  for (const [id, game, from] of [[A, { appId: '10', name: 'Game A' }, NOW - 3 * 3_600_000], [B, { appId: '578080', name: 'PUBG: BATTLEGROUNDS' }, NOW - 2 * 3_600_000]] as const) {
    store.recordPlay(id, game, from);
    store.recordPlay(id, game, NOW - 60_000);
    store.recordPlay(id, undefined, NOW);
  }
  const deps = { store, client: {} as never, now: () => NOW };
  const caller = { senderKey: 'whatsapp:1', groupId: GROUP, isOwner: true, mentions: ['whatsapp:1', 'whatsapp:2'], mentionPerson: (index: number) => (index === 0 ? 'p1' : 'p2'), displayName: (id: string) => (id === 'p1' ? '猴' : 'kim') };
  const result = await steamGetPlaytime(deps, caller, { people: [{ reference: 'mention', mentionIndex: 0 }, { reference: 'mention', mentionIndex: 1 }], period: 'today' }) as { status: string; displayText: string; people: unknown[] };
  assert.equal(result.status, 'ok');
  assert.equal(result.people.length, 2);
  assert.equal((result.displayText.match(/El Psy Kongroo/gu) ?? []).length, 1);
  assert.match(result.displayText, /猴 · Game A/u);
  assert.match(result.displayText, /kim · PUBG: BATTLEGROUNDS（吃鸡）/u);
  const refused = await steamGetPlaytime(deps, caller, { people: [{ reference: 'mention', mentionIndex: 0 }, { reference: 'mention', mentionIndex: 1 }] }) as { status: string };
  assert.equal(refused.status, 'invalid_request');
  const single = await steamGetPlaytime(deps, caller, { person: { reference: 'mention', mentionIndex: 0 }, period: 'today' }) as { displayText: string };
  assert.match(single.displayText, /^Amadeus · 猴 今日游戏时长 ⏱️/u);
});
