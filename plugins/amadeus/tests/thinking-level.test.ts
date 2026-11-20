import test from 'node:test';
import assert from 'node:assert/strict';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { registerThinkingLevel, type ThinkingStore } from '../src/thinking-level.js';

const GROUP = 'agent:main:whatsapp:group:120363000000000000@g.us:thread:whatsapp-account-secondary';
const DIRECT = 'agent:main:whatsapp:secondary:direct:+8613800000000';
const MAIN = 'agent:main:main';
const CRON = 'agent:main:cron:0e6866ef-0000-4000-8000-000000000000';
const RELEASE = 'agent:main:lab-release-2c6b1a8ee5a7-1-chat1';

test('owner WhatsApp direct chat alone uses private combo and low thinking', async () => {
  const hooks = new Map<string, (event: unknown, context: unknown) => unknown>();
  const levels: Record<string,string> = {};
  const store: ThinkingStore = { read: key => ({ thinkingLevel: levels[key] }), patch: async (key, _agent, level) => { levels[key] = level; } };
  registerThinkingLevel({ logger: { info() {}, warn() {} }, on: (name: string, handler: (event: unknown, context: unknown) => unknown) => { hooks.set(name, handler); } } as unknown as OpenClawPluginApi, store, async () => '8613800000000');
  const route = hooks.get('before_model_resolve')!;
  assert.deepEqual(await route({}, { sessionKey: DIRECT }), { providerOverride: 'nine_router', modelOverride: 'kurisu-private-combo' });
  assert.equal(await route({}, { sessionKey: GROUP }), undefined);
  assert.equal(await route({}, { sessionKey: 'agent:main:whatsapp:secondary:direct:+8613900000000' }), undefined);
  assert.equal(await route({}, { sessionKey: 'agent:main:telegram:direct:13800000000' }), undefined);
  await hooks.get('agent_turn_prepare')!({}, { sessionKey: DIRECT });
  await hooks.get('agent_turn_prepare')!({}, { sessionKey: GROUP });
  assert.equal(levels[DIRECT], 'low');
  assert.equal(levels[GROUP], undefined);
});
