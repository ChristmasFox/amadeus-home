import assert from 'node:assert/strict';
import test from 'node:test';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import {
  createPathClassifier,
  privateSessionTargetHidden,
  redactPrivateRetrieval,
  redactToolResultMessage,
  registerPrivateMemoryGuard,
  structuralMemoryVisibility,
  visibilityFromHeader,
} from '../src/private-memory.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OWNER = '15550100123';
const DM = 'agent:main:whatsapp:secondary:direct:+15550100123';
const OTHER_DM = 'agent:main:whatsapp:secondary:direct:+15550100999';
const GROUP = 'agent:main:whatsapp:secondary:group:120363000000000000@g.us';
const PRIVATE_SNIPPET = 'PRIVATE-MEMORY-SNIPPET';
const SHARED_SNIPPET = 'SHARED-NOTE';

test('structural paths keep shared notes and hide the private memory file', () => {
  assert.equal(structuralMemoryVisibility('MEMORY.md'), 'private');
  assert.equal(structuralMemoryVisibility('notes/memory.md'), 'private');
  assert.equal(structuralMemoryVisibility('.amadeus-private/owner-dm-preferences.md'), 'private');
  assert.equal(structuralMemoryVisibility('memory/dreaming/light/2026-11-10.md'), 'private');
  assert.equal(structuralMemoryVisibility('USER.md'), 'shared');
  assert.equal(structuralMemoryVisibility('memory/2026-10-19-squad-group.md'), 'shared');
  assert.equal(structuralMemoryVisibility('memory/2026-10-31-1032.md'), 'unknown');
});

test('a session log header follows the session kind', () => {
  assert.equal(visibilityFromHeader(`- **Session Key**: ${DM}`), 'private');
  assert.equal(visibilityFromHeader(`- **Session Key**: ${GROUP}`), 'shared');
  assert.equal(visibilityFromHeader('no session key here'), 'unknown');
});

test('direct session targets are hidden outside the owner direct session', () => {
  assert.equal(privateSessionTargetHidden(GROUP, DM, OWNER), true);
  assert.equal(privateSessionTargetHidden(OTHER_DM, DM, OWNER), true);
  assert.equal(privateSessionTargetHidden(DM, OTHER_DM, OWNER), true);
  assert.equal(privateSessionTargetHidden(DM, DM, OWNER), false);
  assert.equal(privateSessionTargetHidden(GROUP, 'current', OWNER), false);
  assert.equal(privateSessionTargetHidden(GROUP, GROUP, OWNER), false);
  assert.equal(privateSessionTargetHidden(DM, DM, undefined), true);
});

test('search hits and long-form reads drop private memory and keep shared notes', () => {
  const isPrivate = (path: string) => structuralMemoryVisibility(path) === 'private';
  const payload = {
    results: [
      { path: 'MEMORY.md', snippet: PRIVATE_SNIPPET, score: 0.9 },
      { path: 'USER.md', snippet: SHARED_SNIPPET, score: 0.4 },
      { path: 'memory/2026-10-19-squad-group.md', snippet: 'group note', score: 0.2 },
      { sessionKey: DM, snippet: PRIVATE_SNIPPET, score: 0.8 },
    ],
  };
  const redacted = redactPrivateRetrieval(payload, isPrivate, GROUP, OWNER);
  assert.equal(redacted.removed, 2);
  assert.deepEqual((redacted.value as { results: Array<{ path?: string; sessionKey?: string }> }).results.map((item) => item.path ?? item.sessionKey), ['USER.md', 'memory/2026-10-19-squad-group.md']);
  const read = redactPrivateRetrieval({ path: 'MEMORY.md', text: PRIVATE_SNIPPET }, isPrivate, OTHER_DM, OWNER);
  assert.equal(read.removed, 1);
  assert.equal((read.value as { text: string }).text, '');
  assert.equal((read.value as { status: string }).status, 'unavailable');
  const ownerRead = redactPrivateRetrieval({ path: 'MEMORY.md', text: PRIVATE_SNIPPET }, isPrivate, DM, OWNER);
  assert.equal(ownerRead.removed, 1, 'the helper itself does not grant access; the hook skips owner sessions');
});

test('a persisted tool result keeps shared hits only', () => {
  const message = {
    content: [{ type: 'text', text: JSON.stringify({ results: [{ path: 'MEMORY.md', snippet: PRIVATE_SNIPPET }, { path: 'USER.md', snippet: SHARED_SNIPPET }] }, null, 2) }],
    details: { results: [{ path: 'MEMORY.md', snippet: PRIVATE_SNIPPET }, { path: 'USER.md', snippet: SHARED_SNIPPET }] },
  };
  const redacted = redactToolResultMessage(message, (path) => path === 'MEMORY.md', GROUP, OWNER);
  assert.equal(redacted.removed, 2);
  const text = (redacted.message.content as Array<{ text: string }>)[0]!.text;
  assert.equal(text.includes(PRIVATE_SNIPPET), false);
  assert.equal(text.includes(SHARED_SNIPPET), true);
  assert.equal(JSON.stringify(redacted.message.details).includes(PRIVATE_SNIPPET), false);
});

test('header classification reads a session log and fails closed when it cannot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'private-memory-'));
  try {
    await mkdir(join(dir, 'memory'), { recursive: true });
    await writeFile(join(dir, 'memory', 'direct.md'), `# Session\n- **Session Key**: ${DM}\n`);
    await writeFile(join(dir, 'memory', 'group.md'), `# Session\n- **Session Key**: ${GROUP}\n`);
    const classify = createPathClassifier([dir]);
    assert.equal(classify('memory/direct.md'), true);
    assert.equal(classify('memory/group.md'), false);
    assert.equal(classify('memory/missing.md'), true);
    assert.equal(classify('USER.md'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function setup(ownerLookup: () => Promise<string | undefined> = async () => OWNER) {
  const hooks = new Map<string, (...args: any[]) => any>();
  const logs: string[] = [];
  const api = {
    logger: { info: (message: string) => logs.push(message) },
    on: (name: string, handler: never) => { hooks.set(name, handler); },
    config: {},
  } as unknown as OpenClawPluginApi;
  registerPrivateMemoryGuard(api, { ownerDigits: ownerLookup, classifyPath: (path) => path === 'MEMORY.md' || path.endsWith('/MEMORY.md') });
  return { hooks, logs };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test('group and non-owner direct sessions cannot read private memory; the owner direct session can', async () => {
  const { hooks, logs } = setup();
  await settle();
  const before = hooks.get('before_tool_call')!;
  const persist = hooks.get('tool_result_persist')!;
  assert.deepEqual(await before({ toolName: 'memory_get', params: { path: 'MEMORY.md' } }, { sessionKey: GROUP }), { block: true, blockReason: 'private memory is not available in this session' });
  assert.deepEqual(await before({ toolName: 'memory_get', params: { path: 'MEMORY.md' } }, { sessionKey: OTHER_DM }), { block: true, blockReason: 'private memory is not available in this session' });
  assert.equal(await before({ toolName: 'memory_get', params: { path: 'USER.md' } }, { sessionKey: GROUP }), undefined);
  assert.equal(await before({ toolName: 'memory_get', params: { path: 'MEMORY.md' } }, { sessionKey: DM }), undefined);
  assert.equal((await before({ toolName: 'sessions_history', params: { sessionKey: DM } }, { sessionKey: GROUP }))?.block, true);
  assert.equal(await before({ toolName: 'sessions_history', params: { sessionKey: 'current' } }, { sessionKey: GROUP }), undefined);
  assert.equal(await before({ toolName: 'sessions_history', params: { sessionKey: DM } }, { sessionKey: DM }), undefined);
  const hidden = persist({
    toolName: 'memory_search',
    message: { content: [{ type: 'text', text: JSON.stringify({ results: [{ path: 'MEMORY.md', snippet: PRIVATE_SNIPPET }, { path: 'USER.md', snippet: SHARED_SNIPPET }] }) }] },
  }, { sessionKey: GROUP });
  assert.equal(JSON.stringify(hidden.message).includes(PRIVATE_SNIPPET), false);
  assert.equal(JSON.stringify(hidden.message).includes(SHARED_SNIPPET), true);
  const kept = persist({
    toolName: 'memory_search',
    message: { content: [{ type: 'text', text: JSON.stringify({ results: [{ path: 'MEMORY.md', snippet: PRIVATE_SNIPPET }] }) }] },
  }, { sessionKey: DM });
  assert.equal(kept, undefined);
  assert.equal(logs.some((line) => line.includes('removed=1')), true);
});

test('an unknown owner hides private memory', async () => {
  const { hooks } = setup(async () => undefined);
  await settle();
  const before = hooks.get('before_tool_call')!;
  assert.equal((await before({ toolName: 'memory_get', params: { path: 'MEMORY.md' } }, { sessionKey: DM }))?.block, true);
});
