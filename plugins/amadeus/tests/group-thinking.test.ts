import test from 'node:test';
import assert from 'node:assert/strict';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { GROUP_THINKING_LEVEL, registerGroupThinking, type ThinkingStore } from '../src/group-thinking.js';

const GROUP = 'agent:main:whatsapp:group:120363000000000000@g.us:thread:whatsapp-account-secondary';
const DIRECT = 'agent:main:whatsapp:direct:+8613800000000';

function setup(levels: Record<string, string | undefined>) {
  const patched: Array<{ key: string; level: string }> = [];
  const store: ThinkingStore = {
    read: (key) => ({ thinkingLevel: levels[key] }),
    patch: async (key, _agent, level) => { patched.push({ key, level }); levels[key] = level; },
  };
  const hooks = new Map<string, (event: unknown, context: unknown) => unknown>();
  registerGroupThinking({ logger: { info() {}, warn() {} }, on: (name: string, handler: (event: unknown, context: unknown) => unknown) => { hooks.set(name, handler); } } as unknown as OpenClawPluginApi, store);
  return { patched, levels, fire: (name: string, context: object) => hooks.get(name)!({}, context) };
}

test('a group session with no level gets low at session start, once', async () => {
  const { patched, fire } = setup({});
  await fire('session_start', { sessionKey: GROUP, sessionId: 's1' });
  await fire('agent_turn_prepare', { sessionKey: GROUP, sessionId: 's1' });
  assert.deepEqual(patched, [{ key: GROUP, level: GROUP_THINKING_LEVEL }]);
  assert.equal(GROUP_THINKING_LEVEL, 'low');
});

test('an existing group session without a level is fixed on its next turn; a chosen level is left alone', async () => {
  const a = setup({});
  await a.fire('agent_turn_prepare', { sessionKey: GROUP, sessionId: 's1' });
  assert.equal(a.levels[GROUP], 'low');
  const b = setup({ [GROUP]: 'high' });
  await b.fire('agent_turn_prepare', { sessionKey: GROUP, sessionId: 's1' });
  assert.deepEqual(b.patched, []);
});

test('a reset (same key, new session id) is checked again', async () => {
  const { patched, levels, fire } = setup({});
  await fire('session_start', { sessionKey: GROUP, sessionId: 's1' });
  levels[GROUP] = undefined;
  await fire('session_start', { sessionKey: GROUP, sessionId: 's2' });
  assert.equal(patched.length, 2);
});

test('direct chats and keyless runs are never touched; a store failure does not throw', async () => {
  const { patched, fire } = setup({});
  await fire('session_start', { sessionKey: DIRECT, sessionId: 'd' });
  await fire('agent_turn_prepare', { sessionKey: undefined });
  assert.deepEqual(patched, []);
  const hooks = new Map<string, (event: unknown, context: unknown) => unknown>();
  registerGroupThinking({ logger: { info() {}, warn() {} }, on: (n: string, h: (e: unknown, c: unknown) => unknown) => { hooks.set(n, h); } } as unknown as OpenClawPluginApi,
    { read: () => { throw new Error('store down'); }, patch: async () => {} });
  await hooks.get('session_start')!({}, { sessionKey: GROUP, sessionId: 'x' });
});
