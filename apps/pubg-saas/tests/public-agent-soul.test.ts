import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  PUBLIC_KOOK_ASSISTANT_INSTRUCTIONS,
  PUBLIC_KOOK_RECOVERY_INSTRUCTIONS,
} from '../src/application/kook-conversation-agent.js';
import { PUBLIC_AGENT_SOUL_STYLE } from '../src/application/public-agent-soul.js';

const checkedInSoulCopy = readFileSync(
  new URL('../src/application/public-agent-soul.md', import.meta.url),
  'utf8',
).trim();

test('public Agent uses the checked-in SOUL speaking-style copy verbatim', () => {
  assert.equal(PUBLIC_AGENT_SOUL_STYLE, checkedInSoulCopy);
  assert.equal(
    createHash('sha256').update(checkedInSoulCopy).digest('hex'),
    '541830b5c8cb28a9f2ef1887fcb4dba2b59d66a07f231236bdf5d8c4e63f49da',
    'the reviewed public-safe excerpt must stay verbatim',
  );
  assert.ok(PUBLIC_KOOK_ASSISTANT_INSTRUCTIONS.startsWith(PUBLIC_AGENT_SOUL_STYLE));
  assert.ok(PUBLIC_KOOK_RECOVERY_INSTRUCTIONS.startsWith(PUBLIC_AGENT_SOUL_STYLE));
  assert.match(PUBLIC_AGENT_SOUL_STYLE, /说话简洁、直接，优先给结论，再解释关键原因/u);
  assert.match(PUBLIC_AGENT_SOUL_STYLE, /普通聊天不要写成报告/u);
  assert.match(PUBLIC_AGENT_SOUL_STYLE, /遇到明显错误时直接指出，不需要先夸赞/u);
});

test('public SOUL copy and model instructions contain no private identity or personal sources', () => {
  for (const value of [checkedInSoulCopy, PUBLIC_KOOK_ASSISTANT_INSTRUCTIONS, PUBLIC_KOOK_RECOVERY_INSTRUCTIONS]) {
    assert.doesNotMatch(value, /Kurisu|Arthur|MEMORY\.md|USER\.md|私聊|私人昵称/iu);
  }
});
