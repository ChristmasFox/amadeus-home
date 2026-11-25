import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Value } from 'typebox/value';
import { PUBG_SKILL_RULES } from '@rine-kit/pubg-reply';
import { jsonToolResult, ToolOutputSchema } from '../src/index.js';
import { FIXTURES } from './shared-glue-fixtures.js';

/*
 * Lab's PUBG reply glue now comes from @rine-kit/pubg-reply. The golden files were produced by Lab's own code BEFORE
 * the switch (rine-kit packages/pubg-reply/scripts/gen-golden-from-lab.ts), so equality here is "Lab answers exactly
 * as it did". The same files are what RINE is compared with.
 */
const golden = (name: string) =>
  readFileSync(new URL(`./shared-glue-golden/${name}.json`, import.meta.url), 'utf8');
const share = (_envelope: unknown, displayText: string) => ({
  text: `${displayText}\n\n🔗 https://share.example/s/AAAAAAAAAAAAAAAAAAAAAA`,
  url: 'https://share.example/s/AAAAAAAAAAAAAAAAAAAAAA',
});

/** What the model reads out of an OpenClaw tool result (jsonResult puts the JSON in content and details). */
function payload(result: unknown): unknown {
  const wrapped = result as { details?: unknown; content?: Array<{ text?: string }> };
  return wrapped.details ?? JSON.parse(wrapped.content![0]!.text!);
}

for (const [name, fixture] of Object.entries(FIXTURES)) {
  for (const withShare of [false, true]) {
    test(`${name}${withShare ? ' with share link' : ''}: Lab's result is unchanged by the switch`, () => {
      const result = jsonToolResult(
        fixture.tool,
        structuredClone(fixture.envelope) as never,
        'Asia/Shanghai',
        withShare ? (share as never) : undefined,
      );
      assert.deepEqual([...Value.Errors(ToolOutputSchema, payload(result))].map((error) => ({ path: error.instancePath, message: error.message })), []);
      const actual = payload(result) as Record<string, unknown>;
      const expectedText = golden(`${name}${withShare ? '.share' : ''}`);
      if (name === 'team_damage') {
        // The Lab wrapper changes only this chat display block and its guide; shared facts stay byte-identical.
        const expected = JSON.parse(expectedText) as Record<string, unknown>;
        assert.deepEqual({ ...actual, displayText: expected.displayText, replyGuide: expected.replyGuide }, expected);
      } else assert.equal(`${JSON.stringify(actual, null, 2)}\n`, expectedText);
    });
  }
}

test('team damage chat output groups short direction rows under descending actor totals and keeps partial/share facts', () => {
  const result = jsonToolResult('pubg_query_team_damage', {
    asOf: '2026-11-25T03:00:00.000Z',
    metricVersion: 'pubg-metrics-v1',
    status: 'partial',
    data: {
      direction: 'all directions', totalHitCount: null, totalDamage: null, knownHitCount: 7, knownDamage: 110, complete: false,
      directions: [
        { actor: { playerId: 'subject.a', name: '成员甲' }, victim: { playerId: 'subject.b', name: '成员乙' }, hitCount: null, damage: null, knownHitCount: 4, knownDamage: 80, complete: false },
        { actor: { playerId: 'subject.a', name: '成员甲' }, victim: { playerId: 'subject.c', name: '成员丙' }, hitCount: null, damage: null, knownHitCount: 1, knownDamage: 10, complete: false },
        { actor: { playerId: 'subject.b', name: '成员乙' }, victim: { playerId: 'subject.a', name: '成员甲' }, hitCount: null, damage: null, knownHitCount: 2, knownDamage: 20, complete: false },
      ],
      matches: [],
    },
    coverage: {
      status: 'PARTIAL', complete: false,
      coverageStart: '2026-11-24T22:00:00.000Z', coverageEnd: '2026-11-25T22:00:00.000Z',
      checkedAt: '2026-11-25T03:00:00.000Z', failedMatchIds: ['match.placeholder'], sourceUnavailable: false, freshness: 'unknown',
    },
    queryResolved: {
      tool: 'pubg_query_team_damage',
      resolvedSelector: { type: 'absolute_range', from: '2026-11-24T22:00:00.000Z', to: '2026-11-25T22:00:00.000Z', timezone: 'Asia/Shanghai' },
    },
    evidenceRefs: { matchIds: ['match.placeholder'], playerIds: ['subject.a', 'subject.b', 'subject.c'], fields: [], calculation: 'fixture' },
  } as never, 'Asia/Shanghai', share as never);
  const output = payload(result) as { displayText: string; replyGuide: string; presentation: { directions: Array<{ damage: number | null }> } };
  const lines = output.displayText.split('\n');
  assert.match(lines[0]!, /^🥊 /u);
  assert.ok(lines.includes('已确认：7次 · 已知110伤害（完整总量未知）'));
  assert.ok(lines.includes('覆盖说明：只列已确认数据，未知总量不按 0 处理。'));
  const actorA = lines.indexOf('成员甲  已确认5次（总次数未知） · 已知90伤害（总量未知）');
  const actorB = lines.indexOf('成员乙  已确认2次（总次数未知） · 已知20伤害（总量未知）');
  assert.ok(actorA >= 0 && actorB > actorA, 'actors are ordered by their known hit totals');
  assert.ok(lines.includes('└ 成员乙  已确认4次（总次数未知） · 已知80伤害（总量未知）'));
  assert.ok(lines.includes('└ 成员丙  已确认1次（总次数未知） · 已知10伤害（总量未知）'));
  assert.ok(lines.includes('└ 成员甲  已确认2次（总次数未知） · 已知20伤害（总量未知）'));
  assert.ok(output.displayText.endsWith('🔗 https://share.example/s/AAAAAAAAAAAAAAAAAAAAAA'));
  assert.match(output.replyGuide, /把 displayText 原样发出/u);
  assert.match(output.replyGuide, /不要压缩掉分层/u);
  assert.match(output.replyGuide, /未知不是 0/u);
  assert.deepEqual(output.presentation.directions.map((direction) => direction.damage), [null, null, null]);
});

test('complete team damage rows retain every direction damage required by reply-check', async () => {
  const result = jsonToolResult('pubg_query_team_damage', {
    asOf: '2026-11-25T03:00:00.000Z',
    metricVersion: 'pubg-metrics-v1',
    status: 'ok',
    data: {
      direction: 'all directions', totalHitCount: 7, totalDamage: 110, complete: true,
      directions: [
        { actor: { playerId: 'subject.a', name: '成员甲' }, victim: { playerId: 'subject.b', name: '成员乙' }, hitCount: 4, damage: 80, knownHitCount: 4, knownDamage: 80, complete: true },
        { actor: { playerId: 'subject.a', name: '成员甲' }, victim: { playerId: 'subject.c', name: '成员丙' }, hitCount: 1, damage: 10, knownHitCount: 1, knownDamage: 10, complete: true },
        { actor: { playerId: 'subject.b', name: '成员乙' }, victim: { playerId: 'subject.a', name: '成员甲' }, hitCount: 2, damage: 20, knownHitCount: 2, knownDamage: 20, complete: true },
      ],
      matches: [],
    },
    coverage: {
      status: 'OK', complete: true,
      coverageStart: '2026-11-24T22:00:00.000Z', coverageEnd: '2026-11-25T22:00:00.000Z',
      checkedAt: '2026-11-25T03:00:00.000Z', failedMatchIds: [], sourceUnavailable: false, freshness: 'fresh',
    },
    queryResolved: {
      tool: 'pubg_query_team_damage',
      resolvedSelector: { type: 'absolute_range', from: '2026-11-24T22:00:00.000Z', to: '2026-11-25T22:00:00.000Z', timezone: 'Asia/Shanghai' },
    },
    evidenceRefs: { matchIds: [], playerIds: ['subject.a', 'subject.b', 'subject.c'], fields: [], calculation: 'fixture' },
  } as never);
  const output = payload(result) as { displayText: string; presentation: unknown };
  assert.match(output.displayText, /成员甲  5次 · 90伤害/u);
  assert.match(output.displayText, /└ 成员乙  4次 · 80伤害/u);
  assert.match(output.displayText, /└ 成员丙  1次 · 10伤害/u);
  assert.match(output.displayText, /└ 成员甲  2次 · 20伤害/u);
  const { missingReplyFacts } = await import('@rine-kit/presentation');
  assert.deepEqual(missingReplyFacts(output.presentation as never, output.displayText), []);
});

test('the skill file Lab loads is the same text the shared package carries (no drift)', () => {
  const skill = readFileSync(new URL('../skills/pubg/SKILL.md', import.meta.url), 'utf8');
  assert.equal(skill.split('---').slice(2).join('---').replace(/^\n+/u, ''), PUBG_SKILL_RULES);
});
