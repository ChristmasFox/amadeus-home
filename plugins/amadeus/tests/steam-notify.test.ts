import assert from 'node:assert/strict';
import test from 'node:test';
import { minutesText, renderSteamNotifications } from '../src/steam/notify.js';
import type { AnnouncementPerson } from '../src/steam/poller.js';

const NOW = new Date('2026-11-09T10:00:00Z');
const render = (people: AnnouncementPerson[]) => renderSteamNotifications({ groupId: 'g', people }, NOW);

const END = '\n\nEl Psy Kongroo.';

test('back from away: title carries Amadeus, who and what; Steam nickname only because it differs', () => {
  assert.deepEqual(render([{ name: 'kim', steamName: 'danelll', kind: 'back_from_away' }]), [
    'Amadeus · kim 回来了 🔄\n\n- Steam：danelll\n- 状态：在线' + END,
  ]);
});

test('came online, started playing and switched game; missing facts are left out, never invented', () => {
  assert.equal(render([{ name: 'kim', kind: 'came_online' }])[0], 'Amadeus · kim 上线 🟢\n\n- 状态：在线' + END);
  assert.equal(render([{ name: 'kim', kind: 'came_online', game: 'PUBG: BATTLEGROUNDS' }])[0], 'Amadeus · kim 上线 · 正在玩 PUBG: BATTLEGROUNDS 🟢\n\n- 游戏：PUBG: BATTLEGROUNDS\n- 状态：游戏中' + END);
  assert.equal(render([{ name: 'kim', kind: 'started_playing', game: 'GTA5' }])[0], 'Amadeus · kim 开始玩 GTA5 🎮\n\n- 游戏：GTA5\n- 状态：游戏中' + END);
  assert.equal(render([{ name: 'kim', kind: 'started_playing' }])[0], 'Amadeus · kim 开始玩游戏 🎮\n\n- 状态：游戏中' + END);
  const switched = render([{ name: 'kim', kind: 'switched_game', game: 'GTA5', previous: { gameName: 'PUBG: BATTLEGROUNDS', minutes: 83 } }])[0]!;
  assert.equal(switched, 'Amadeus · kim 世界线变动 · PUBG: BATTLEGROUNDS → GTA5 🔀\n\n- 游戏：GTA5\n- 状态：游戏中\n- 上一局：PUBG: BATTLEGROUNDS，1 小时 23 分钟' + END);
  // The left game is named even when the session was too short to count; then there is no 上一局 length line.
  assert.equal(render([{ name: 'kim', kind: 'switched_game', game: 'GTA5', previous: { gameName: 'Notepad' } }])[0], 'Amadeus · kim 世界线变动 · Notepad → GTA5 🔀\n\n- 游戏：GTA5\n- 状态：游戏中' + END);
  assert.match(render([{ name: 'kim', kind: 'switched_game', game: 'GTA5' }])[0]!, /^Amadeus · kim 世界线变动 · → GTA5 🔀\n/u);
});

test('achievements: game, achievement and the global rate only when known', () => {
  const withRate = render([{ name: 'kim', kind: 'achievement_unlocked', game: 'GTA5', achievements: [{ apiName: 'a', name: '西部最强', globalPercent: 2.8 }] }])[0]!;
  assert.equal(withRate, 'Amadeus · kim 解锁成就 · GTA5 🏆\n\n- 游戏：GTA5\n- 成就：「西部最强」\n- 全球解锁率：2.8%' + END);
  const noRate = render([{ name: 'kim', kind: 'achievement_unlocked', game: 'GTA5', achievements: [{ apiName: 'a', name: '西部最强' }] }])[0]!;
  assert.doesNotMatch(noRate, /全球解锁率/u);
  const many = render([{ name: 'kim', kind: 'achievement_unlocked', game: 'GTA5', achievements: [{ apiName: 'a', name: 'A', globalPercent: 1 }, { apiName: 'b', name: 'B' }] }])[0]!;
  assert.match(many, /- 成就：「A」、「B」\n- 全球解锁率：「A」1%\n/u);
});

test('stopped playing: 收束 with the game and the session length in the title', () => {
  assert.equal(render([{ name: 'kim', kind: 'stopped_playing', game: 'PUBG: BATTLEGROUNDS', durationMinutes: 83 }])[0],
    'Amadeus · kim 收束 · PUBG: BATTLEGROUNDS 1小时23分 🏁\n\n- 游戏：PUBG: BATTLEGROUNDS\n- 本局时长：1 小时 23 分钟' + END);
  assert.match(render([{ name: 'kim', kind: 'stopped_playing', game: 'CS2', durationMinutes: 125 }])[0]!, /^Amadeus · kim 收束 · CS2 2小时05分 🏁\n/u);
  assert.deepEqual([minutesText(5), minutesText(60), minutesText(61)], ['5 分钟', '1 小时', '1 小时 1 分钟']);
});

test('several people in one batch: one message per kind, names in the title, one row each', () => {
  const messages = render([{ name: 'kim', kind: 'started_playing', game: 'GTA5' }, { name: '打工战士', kind: 'started_playing', game: 'PUBG: BATTLEGROUNDS' }, { name: 'kim', kind: 'stopped_playing', game: 'X', durationMinutes: 30 }]);
  assert.equal(messages.length, 2);
  assert.equal(messages[0], 'Amadeus · kim、打工战士 开局 🎮\n\n- kim：GTA5\n- 打工战士：PUBG: BATTLEGROUNDS' + END);
  assert.equal(messages[1], 'Amadeus · kim 收束 · X 30分钟 🏁\n\n- 游戏：X\n- 本局时长：30 分钟' + END);
  const five = render(['a', 'b', 'c', 'd', 'e'].map((name) => ({ name, kind: 'came_online' as const })));
  assert.equal(five[0], 'Amadeus · a、b 等5人 上线 🟢\n\n- a：在线\n- b：在线\n- c：在线\n- d：在线\n- e：在线' + END);
  assert.deepEqual(render([]), []);
});

test('no Kurisu voice or model wording anywhere in the notices', () => {
  const all = ['came_online', 'back_from_away', 'started_playing', 'switched_game', 'achievement_unlocked', 'stopped_playing'].flatMap((kind) => render([{ name: 'kim', kind: kind as never, game: 'G', achievements: [{ apiName: 'a', name: 'N' }], durationMinutes: 6 }])).join('\n');
  for (const word of ['笨蛋', '冈部', '……', '[react', '双手']) assert.ok(!all.includes(word), word);
});
