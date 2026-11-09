import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAnnouncementPrompt, kurisuComposer, validateAnnouncement } from '../src/steam/compose.js';
import type { AnnouncementFacts } from '../src/steam/poller.js';

const facts: AnnouncementFacts = { groupId: 'g', people: [{ name: 'Alpha', kind: 'came_online', game: 'Placeholder Game' }, { name: 'Bravo', kind: 'came_online' }] };

test('the prompt carries only the code-decided facts and the voice anchor', () => {
  const prompt = buildAnnouncementPrompt(facts);
  assert.match(prompt, /Alpha，刚上线，正在玩 Placeholder Game/u);
  assert.match(prompt, /Bravo，刚上线/u);
  assert.match(prompt, /不要编造/u);
});

test('model output is accepted only when short, plain and naming every person', () => {
  assert.equal(validateAnnouncement('“Alpha 和 Bravo 上线了”', facts), 'Alpha 和 Bravo 上线了');
  for (const bad of ['', 'Alpha 上线了', 'Alpha Bravo https://x.example', 'Alpha Bravo @everyone', `Alpha Bravo ${'字'.repeat(300)}`]) assert.equal(validateAnnouncement(bad, facts), undefined, bad);
});

test('composer rejects invalid output instead of falling back to a template', async () => {
  assert.equal(await kurisuComposer(async () => 'Alpha 和 Bravo 来了')(facts), 'Alpha 和 Bravo 来了');
  await assert.rejects(kurisuComposer(async () => 'nonsense')(facts), /announcement_invalid/u);
  await assert.rejects(kurisuComposer(async () => { throw new Error('down'); })(facts), /down/u);
});

test('each event type states its own fact, with the game name where there is one', () => {
  const prompt = buildAnnouncementPrompt({ groupId: 'g', people: [
    { name: 'A', kind: 'started_playing', game: 'G1' }, { name: 'B', kind: 'switched_game', game: 'G2' }, { name: 'C', kind: 'back_from_away' }, { name: 'D', kind: 'back_from_away', game: 'G3' },
  ] });
  assert.match(prompt, /A，本来就在线，刚开始玩 G1/u);
  assert.match(prompt, /B，刚换了游戏，现在玩的是 G2/u);
  assert.match(prompt, /C，离开了一阵后回来了\n/u);
  assert.match(prompt, /D，离开了一阵后回来了，正在玩 G3/u);
});

test('a person with several accounts gets the Steam nickname in the facts', () => {
  const prompt = buildAnnouncementPrompt({ groupId: 'g', people: [{ name: 'P', steamName: 'AltNick', kind: 'came_online' }] });
  assert.match(prompt, /P（Steam 账号昵称：AltNick/u);
});
