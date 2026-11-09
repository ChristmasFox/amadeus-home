import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAnnouncementPrompt, kurisuComposer, validateAnnouncement } from '../src/steam/compose.js';

const facts = { groupId: 'g', people: [{ name: 'Alpha', game: 'Placeholder Game' }, { name: 'Bravo' }] };

test('the prompt carries only the code-decided facts and the voice anchor', () => {
  const prompt = buildAnnouncementPrompt(facts);
  assert.match(prompt, /Alpha，正在玩 Placeholder Game/u);
  assert.match(prompt, /Bravo，在线/u);
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
