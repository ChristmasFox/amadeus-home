import assert from 'node:assert/strict';
import test from 'node:test';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { GROUP_OWNER_ONLY_REASON, GROUP_OWNER_ONLY_TOOLS, groupOwnerGateVerdict, isGroupSession, registerGroupOwnerGate } from '../src/group-owner-gate.js';

const GROUP = 'agent:main:whatsapp:group:fixture@g.us:thread:whatsapp-account-secondary';

test('owner-only tools are refused in a group unless the host resolved the sender as owner (fail closed)', () => {
  for (const tool of GROUP_OWNER_ONLY_TOOLS) {
    assert.deepEqual(groupOwnerGateVerdict(tool, GROUP, false), { block: true, blockReason: GROUP_OWNER_ONLY_REASON }, tool);
    assert.deepEqual(groupOwnerGateVerdict(tool, GROUP, undefined), { block: true, blockReason: GROUP_OWNER_ONLY_REASON }, `${tool} without requester identity`);
    assert.equal(groupOwnerGateVerdict(tool, GROUP, true), undefined, `${tool} for the owner`);
  }
});

test('other tools, direct chats and cron are untouched', () => {
  assert.equal(groupOwnerGateVerdict('pubg_query_stats', GROUP, false), undefined);
  assert.equal(groupOwnerGateVerdict('steam_get_profile', GROUP, undefined), undefined);
  assert.equal(groupOwnerGateVerdict('memory_search', 'agent:main:whatsapp:secondary:direct:+10000000000', undefined), undefined);
  assert.equal(groupOwnerGateVerdict('memory_search', 'agent:main:cron:job', undefined), undefined);
  assert.equal(isGroupSession(undefined), false);
  assert.equal(isGroupSession('agent:main:telegram:group:-1'), true);
});

test('the before_tool_call hook applies the verdict from the host requester context', () => {
  const hooks: Record<string, (event: any, context: any) => any> = {};
  const logger = { warn() {}, info() {}, error() {}, debug() {} };
  registerGroupOwnerGate({ logger, on: (name: string, handler: (event: any, context: any) => any) => { hooks[name] = handler; } } as unknown as OpenClawPluginApi);
  assert.deepEqual(hooks.before_tool_call!({ toolName: 'memory_get' }, { sessionKey: GROUP, requester: { senderIsOwner: false } }), { block: true, blockReason: GROUP_OWNER_ONLY_REASON });
  assert.equal(hooks.before_tool_call!({ toolName: 'memory_get' }, { sessionKey: GROUP, requester: { senderIsOwner: true } }), undefined);
});
