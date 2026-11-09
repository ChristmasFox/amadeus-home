import assert from 'node:assert/strict';
import test from 'node:test';
import { minutesText, renderSteamNotifications } from '../src/steam/notify.js';
import type { AnnouncementPerson } from '../src/steam/poller.js';

const NOW = new Date('2026-11-09T10:00:00Z');
const render = (people: AnnouncementPerson[]) => renderSteamNotifications({ groupId: 'g', people }, NOW);

test('back from away: the approved world line shape, Steam nickname only because it differs', () => {
  assert.deepEqual(render([{ name: 'kim', steamName: 'danelll', kind: 'back_from_away' }]), [
    'Amadeus • 世界线观测 · Steam 回归信号\n\nkim 离开了一阵后又上线了。\n\n- 成员：kim\n- Steam：danelll\n- 状态：在线\n\nEl Psy Kongroo.',
  ]);
});

test('came online, started playing and switched game; missing facts are left out, never invented', () => {
  assert.equal(render([{ name: 'kim', kind: 'came_online' }])[0], 'Amadeus • 世界线观测 · Steam 上线\n\nkim 上线了。\n\n- 成员：kim\n- 状态：在线\n\nEl Psy Kongroo.');
  assert.equal(render([{ name: 'kim', kind: 'came_online', game: 'PUBG: BATTLEGROUNDS' }])[0], 'Amadeus • 世界线观测 · Steam 上线\n\nkim 上线了，正在玩 PUBG: BATTLEGROUNDS。\n\n- 成员：kim\n- 游戏：PUBG: BATTLEGROUNDS\n- 状态：游戏中\n\nEl Psy Kongroo.');
  assert.equal(render([{ name: 'kim', kind: 'started_playing', game: 'GTA5' }])[0], 'Amadeus • 世界线观测 · Steam 开局\n\nkim 开始玩 GTA5。\n\n- 成员：kim\n- 游戏：GTA5\n- 状态：游戏中\n\nEl Psy Kongroo.');
  assert.equal(render([{ name: 'kim', kind: 'started_playing' }])[0], 'Amadeus • 世界线观测 · Steam 开局\n\nkim 开始玩游戏了。\n\n- 成员：kim\n- 状态：游戏中\n\nEl Psy Kongroo.');
  const switched = render([{ name: 'kim', kind: 'switched_game', game: 'GTA5', previous: { gameName: 'PUBG: BATTLEGROUNDS', minutes: 83 } }])[0]!;
  assert.match(switched, /^Amadeus • 世界线观测 · 世界线变动\n\nkim 从 PUBG: BATTLEGROUNDS 切换到 GTA5。\n\n- 成员：kim\n- 游戏：GTA5\n- 状态：游戏中\n- 上一局：PUBG: BATTLEGROUNDS，1 小时 23 分钟\n\nEl Psy Kongroo\.$/u);
  // The left game is named even when the session was too short to count; then there is no 上一局 length line.
  assert.equal(render([{ name: 'kim', kind: 'switched_game', game: 'GTA5', previous: { gameName: 'Notepad' } }])[0], 'Amadeus • 世界线观测 · 世界线变动\n\nkim 从 Notepad 切换到 GTA5。\n\n- 成员：kim\n- 游戏：GTA5\n- 状态：游戏中\n\nEl Psy Kongroo.');
  assert.match(render([{ name: 'kim', kind: 'switched_game', game: 'GTA5' }])[0]!, /kim 切换到了 GTA5。/u);
});

test('achievements: game, achievement and the global rate only when known', () => {
  const withRate = render([{ name: 'kim', kind: 'achievement_unlocked', game: 'GTA5', achievements: [{ apiName: 'a', name: '西部最强', globalPercent: 2.8 }] }])[0]!;
  assert.equal(withRate, 'Amadeus • 世界线观测 · Steam 成就\n\nkim 在 GTA5 里解锁了成就。\n\n- 成员：kim\n- 游戏：GTA5\n- 成就：「西部最强」\n- 全球解锁率：2.8%\n\nEl Psy Kongroo.');
  const noRate = render([{ name: 'kim', kind: 'achievement_unlocked', game: 'GTA5', achievements: [{ apiName: 'a', name: '西部最强' }] }])[0]!;
  assert.doesNotMatch(noRate, /全球解锁率/u);
  const many = render([{ name: 'kim', kind: 'achievement_unlocked', game: 'GTA5', achievements: [{ apiName: 'a', name: 'A', globalPercent: 1 }, { apiName: 'b', name: 'B' }] }])[0]!;
  assert.match(many, /- 成就：「A」、「B」\n- 全球解锁率：「A」1%\n/u);
});

test('stopped playing: Steam 收束 with the game and the session length', () => {
  assert.equal(render([{ name: 'kim', kind: 'stopped_playing', game: 'PUBG: BATTLEGROUNDS', durationMinutes: 83 }])[0],
    'Amadeus • 世界线观测 · Steam 收束\n\nkim 结束了 PUBG: BATTLEGROUNDS。\n\n- 成员：kim\n- 游戏：PUBG: BATTLEGROUNDS\n- 本局时长：1 小时 23 分钟\n\nEl Psy Kongroo.');
  assert.deepEqual([minutesText(5), minutesText(60), minutesText(61)], ['5 分钟', '1 小时', '1 小时 1 分钟']);
});

test('several people in one batch: one message per kind, details inside the sentences', () => {
  const messages = render([{ name: 'kim', kind: 'started_playing', game: 'GTA5' }, { name: '打工战士', kind: 'started_playing', game: 'PUBG: BATTLEGROUNDS' }, { name: 'kim', kind: 'stopped_playing', game: 'X', durationMinutes: 30 }]);
  assert.equal(messages.length, 2);
  assert.match(messages[0]!, /Steam 开局\n\nkim 开始玩 GTA5。\n打工战士 开始玩 PUBG: BATTLEGROUNDS。\n\n- 成员：kim、打工战士\n\nEl Psy Kongroo\./u);
  assert.match(messages[1]!, /Steam 收束\n\nkim 结束了 X。\n\n- 成员：kim\n- 游戏：X\n- 本局时长：30 分钟/u);
  assert.deepEqual(render([]), []);
});

test('no Kurisu voice or model wording anywhere in the notices', () => {
  const all = ['came_online', 'back_from_away', 'started_playing', 'switched_game', 'achievement_unlocked', 'stopped_playing'].flatMap((kind) => render([{ name: 'kim', kind: kind as never, game: 'G', achievements: [{ apiName: 'a', name: 'N' }], durationMinutes: 6 }])).join('\n');
  for (const word of ['笨蛋', '冈部', '……', '[react', '双手']) assert.ok(!all.includes(word), word);
});
