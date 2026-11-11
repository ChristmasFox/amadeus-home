import test from 'node:test';
import assert from 'node:assert/strict';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { CHAT_THINKING_LEVEL, ensureThinkingLevel, isChatSessionKey, registerThinkingLevel, type ThinkingStore } from '../src/thinking-level.js';

const GROUP = 'agent:main:whatsapp:group:120363000000000000@g.us:thread:whatsapp-account-secondary';
const DIRECT = 'agent:main:whatsapp:secondary:direct:+8613800000000';
const MAIN = 'agent:main:main';
const CRON = 'agent:main:cron:0e6866ef-0000-4000-8000-000000000000';
const RELEASE = 'agent:main:lab-release-2c6b1a8ee5a7-1-chat1';

function setup(levels: Record<string, string | undefined>) {
  const patched: Array<{ key: string; level: string }> = [];
  const store: ThinkingStore = {
    read: (key) => ({ thinkingLevel: levels[key] }),
    patch: async (key, _agent, level) => { patched.push({ key, level }); levels[key] = level; },
  };
  const hooks = new Map<string, (event: unknown, context: unknown) => unknown>();
  registerThinkingLevel({ logger: { info() {}, warn() {} }, on: (name: string, handler: (event: unknown, context: unknown) => unknown) => { hooks.set(name, handler); } } as unknown as OpenClawPluginApi, store);
  return { patched, levels, fire: (name: string, context: object) => hooks.get(name)!({}, context) };
}

test('the single level is max and covers groups, direct chats and the main session but not internal sessions', () => {
  assert.equal(CHAT_THINKING_LEVEL, 'max');
  for (const key of [GROUP, DIRECT, MAIN, 'agent:main:telegram:direct:1', 'agent:main:kook:group:2']) assert.equal(isChatSessionKey(key), true, key);
  for (const key of [CRON, RELEASE, 'agent:main:explicit:1', undefined, 42]) assert.equal(isChatSessionKey(key), false, String(key));
});

test('every chat session is brought to the one level, whatever it had (none, medium, high), and left alone when already there', async () => {
  for (const [key, had] of [[GROUP, undefined], [GROUP, 'medium'], [DIRECT, 'medium'], [DIRECT, 'high'], [MAIN, 'medium']] as const) {
    const { patched, levels, fire } = setup({ [key]: had });
    await fire('agent_turn_prepare', { sessionKey: key });
    assert.deepEqual(patched, [{ key, level: CHAT_THINKING_LEVEL }], `${key} had ${had}`);
    await fire('agent_turn_prepare', { sessionKey: key });
    assert.equal(patched.length, 1, 'no second write once it matches');
    assert.equal(levels[key], CHAT_THINKING_LEVEL);
  }
  const ok = setup({ [GROUP]: CHAT_THINKING_LEVEL });
  await ok.fire('session_start', { sessionKey: GROUP });
  assert.deepEqual(ok.patched, []);
});

test('a later /think change is brought back on the next turn (one source of truth)', async () => {
  const { patched, levels, fire } = setup({ [GROUP]: CHAT_THINKING_LEVEL });
  levels[GROUP] = 'high';
  await fire('agent_turn_prepare', { sessionKey: GROUP });
  assert.equal(patched.length, 1);
  assert.equal(levels[GROUP], CHAT_THINKING_LEVEL);
});

test('internal sessions and keyless runs are never touched; a store failure does not throw', async () => {
  const { patched, fire } = setup({});
  await fire('session_start', { sessionKey: CRON });
  await fire('agent_turn_prepare', { sessionKey: RELEASE });
  await fire('agent_turn_prepare', { sessionKey: undefined });
  assert.deepEqual(patched, []);
  const hooks = new Map<string, (event: unknown, context: unknown) => unknown>();
  registerThinkingLevel({ logger: { info() {}, warn() {} }, on: (n: string, h: (e: unknown, c: unknown) => unknown) => { hooks.set(n, h); } } as unknown as OpenClawPluginApi,
    { read: () => { throw new Error('store down'); }, patch: async () => {} });
  await hooks.get('session_start')!({}, { sessionKey: GROUP });
  assert.equal(await ensureThinkingLevel({ read: () => undefined, patch: async () => {} }, DIRECT), true);
});
