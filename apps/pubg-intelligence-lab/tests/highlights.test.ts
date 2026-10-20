import assert from 'node:assert/strict';
import test from 'node:test';
import type { crossMatchHighlights } from '../src/server/highlights.js';
import { startHighlightFixture } from './highlights-fixture.js';

test('real HTTP/worker path lists cross-match moments, respects night/date/mode, reports gaps and links back to replay', async () => {
  const server = await startHighlightFixture();
  try {
    type Result = Awaited<ReturnType<typeof crossMatchHighlights>>;
    const get = async (query: string) => {
      const response = await fetch(`${server.url}/api/highlights?${query}`); assert.equal(response.status, 200); return response.json() as Promise<Result>;
    };
    const all = await get('limit=20');
    assert.equal(all.scope.selectedMatches, 4, 'normal match is excluded');
    assert.equal(all.scope.analyzedMatches, 3); assert.equal(all.scope.missingMatches, 1);
    assert.equal(all.items.length, 12);
    assert.deepEqual([...new Set(all.items.map((item) => item.kind))].sort(), ['comeback', 'rescue', 'streak', 'wipe']);
    assert.equal((await get('limit=1')).items.length, 0, 'latest match has no archive, so earlier matches never replace it');
    const night = await get('window=night&from=2026-10-19&to=2026-10-20');
    assert.equal(night.scope.night, '2026-10-19');
    assert.equal(night.scope.selectedMatches, 2, '23:00 and next-day 02:00 are the same night');
    assert.equal(night.items.length, 8);
    assert.equal((await get('mode=solo')).scope.selectedMatches, 0);
    assert.equal((await get('squadId=all')).items.length, 12, 'all recorded members are supported');
    for (const query of ['limit=101', 'limit=0', 'limit=NaN', 'window=invalid', 'from=bad']) assert.equal((await fetch(`${server.url}/api/highlights?${query}`)).status, 400);
    const selected = all.items.find((item) => item.kind === 'comeback')!;
    const storyResponse = await fetch(`${server.url}/api/matches/${selected.matchId}/story?squadId=${all.scope.squadId}`);
    assert.equal(storyResponse.status, 200);
    const story = await storyResponse.json() as { available: boolean; story: { fights: Array<{ index: number; start: number; end: number }> } };
    assert.equal(story.available, true);
    const fight = story.story.fights.find((fight) => fight.index === selected.fightIndex)!;
    assert.ok(selected.startSeconds >= fight.start && selected.startSeconds <= fight.end);
    assert.ok(selected.evidence.every((ref) => ref.matchId === selected.matchId && /^telemetry-\d+$/u.test(ref.eventId)));
    assert.equal(server.sourceUnchanged(), true, 'source snapshot remains byte-for-byte unchanged');
  } finally { await server.close(); }
});
