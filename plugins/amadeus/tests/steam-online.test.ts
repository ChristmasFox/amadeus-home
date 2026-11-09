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

const titles = (sent: string[]) => sent.map((text) => /· (\S+ ?\S*)\n/u.exec(text)?.[1]);

test('offline -> online announces the arrival', async () => {
  const { sent, run } = env();
  await run(1, { state: 0 });
  await run(5, { state: 1 });
  assert.deepEqual(titles(sent), ['Steam 上线']);
});

test('offline -> straight into a game announces the arrival with the game', async () => {
  const { sent, run } = env();
  await run(1, { state: 0 });
  await run(5, { state: 1, game: { id: '10', name: 'Game A' } });
  assert.deepEqual(titles(sent), ['Steam 上线']);
  assert.match(sent[0]!, /kim 上线了，正在玩 Game A。/u);
});

test('coming online and then starting a game inside the merge window still announces the arrival, with the game', async () => {
  const { sent, run } = env();
  await run(1, { state: 0 });
  await run(1, { state: 1 });
  await run(5, { state: 1, game: { id: '10', name: 'Game A' } });
  assert.deepEqual(titles(sent), ['Steam 上线']);
  assert.match(sent[0]!, /kim 上线了，正在玩 Game A。/u);
});

test('coming online into a launcher and then switching to the real game inside the window is one arrival, not a switch', async () => {
  const { sent, run } = env();
  await run(1, { state: 0 });
  await run(1, { state: 1, game: { id: '1', name: 'Launcher' } });
  await run(5, { state: 1, game: { id: '2', name: 'Game B' } });
  assert.deepEqual(titles(sent), ['Steam 上线']);
  assert.match(sent[0]!, /kim 上线了，正在玩 Game B。/u);
});

test('a switch after the arrival was announced is a 世界线变动 naming both games, even for a short session', async () => {
  const { sent, run } = env();
  await run(1, { state: 0 });
  await run(5, { state: 1, game: { id: '10', name: 'Game A' } });
  await run(1, { state: 1, game: { id: '20', name: 'Game B' } });
  await run(5, { state: 1, game: { id: '20', name: 'Game B' } });
  assert.deepEqual(titles(sent), ['Steam 上线', '世界线变动']);
  assert.match(sent[1]!, /Amadeus • 世界线观测 · 世界线变动\n\nkim 从 Game A 切换到 Game B。/u);
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
  assert.match(sent[0]!, /kim 上线了，正在玩 PUBG: BATTLEGROUNDS（吃鸡）。/u);
  assert.match(sent[0]!, /- 游戏：PUBG: BATTLEGROUNDS（吃鸡）/u);
  assert.match(sent[1]!, /kim 从 PUBG: BATTLEGROUNDS（吃鸡） 切换到 Grand Theft Auto V（GTA5）。/u);
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
  assert.equal(play, 'Amadeus • 世界线观测 · Steam 游戏时长\n\n猴 今天玩了 2小时35分钟。\n\n- 成员：猴\n- 时段：今天（2026-11-09 06:00 → 次日 06:00）\n- 游戏：PUBG: BATTLEGROUNDS（吃鸡），2小时5分钟\n- 游戏：Other，30分钟\n- 合计：2小时35分钟\n\nEl Psy Kongroo.');
  assert.match(renderPlaytimeCard({ name: '猴', label: '昨天（x）', games: [], totalText: '0分钟' }, at), /猴 昨天没有记录到游戏时长。/u);
  const who = renderPlayingCard({ friends: [{ name: 'A', steamId: '1', state: 'in_game', game: 'Phantom Blade Zero', appId: '4115450' }, { name: 'B', steamId: '2', state: 'online', game: null }] }, at);
  assert.equal(who, 'Amadeus • 世界线观测 · Steam 在线情况\n\n当前观测到 2 位。\n\n- A：Phantom Blade Zero（游戏中）\n- B：在线\n\nEl Psy Kongroo.');
  assert.match(CARD_REPLY_GUIDE, /原样/u);
});
