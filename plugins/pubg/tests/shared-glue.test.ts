import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PUBG_SKILL_RULES } from '@rine-kit/pubg-reply';
import { jsonToolResult } from '../src/index.js';
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
      assert.equal(
        `${JSON.stringify(payload(result), null, 2)}\n`,
        golden(`${name}${withShare ? '.share' : ''}`),
      );
    });
  }
}

test('the skill file Lab loads is the same text the shared package carries (no drift)', () => {
  const skill = readFileSync(new URL('../skills/pubg/SKILL.md', import.meta.url), 'utf8');
  const body = skill.split('---').slice(2).join('---').replace(/^\n+/u, '');
  // Lab may append a clearly marked addendum for rules that the shared package has not published yet.
  const addendum = body.indexOf('\n\n## Lab addendum');
  assert.equal(addendum === -1 ? body : body.slice(0, addendum), PUBG_SKILL_RULES.replace(/\n+$/u, '') + (addendum === -1 ? PUBG_SKILL_RULES.match(/\n*$/u)![0] : ''));
});
