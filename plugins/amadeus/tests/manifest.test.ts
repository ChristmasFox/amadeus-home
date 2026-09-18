import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import type { OpenClawPluginApi, OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import { identityContextFromOpenClaw } from '../src/identity.js';
import entry from '../src/index.js';

test('Amadeus manifest exposes the native Identity contract', async () => {
  const manifest = JSON.parse(await readFile(new URL('../openclaw.plugin.json', import.meta.url), 'utf8')) as {
    skills?: string[];
    contracts?: { tools?: string[] };
  };
  const tools = new Set(manifest.contracts?.tools ?? []);
  for (const name of [
    'identity_resolve',
    'identity_get_person',
    'identity_bind_channel',
    'identity_add_alias',
    'identity_link_account',
    'identity_list_candidates',
    'identity_confirm_candidate',
  ]) assert.equal(tools.has(name), true, `missing manifest tool: ${name}`);
  for (const name of [
    'amadeus_vps_service_info',
    'amadeus_vps_live_status',
    'amadeus_vps_usage',
    'amadeus_vps_system_status',
    'amadeus_vps_services',
  ]) assert.equal(tools.has(name), true, `missing VPS manifest tool: ${name}`);
  assert.equal(manifest.skills?.includes('skills/identity'), true);
  assert.equal(manifest.skills?.includes('skills/vps'), true);
});

test('Amadeus registers typed inbound identity context hooks', () => {
  const hooks = new Map<string, (...args: unknown[]) => unknown>();
  const api = {
    pluginConfig: {},
    rootDir: '/tmp/amadeus-test',
    logger: { info() {}, warn() {} },
    on(name: string, handler: (...args: unknown[]) => unknown) { hooks.set(name, handler); },
    registerService() {},
    registerTool() {},
  } as unknown as OpenClawPluginApi;

  entry.register(api);
  assert.equal(hooks.has('before_dispatch'), true);
  assert.equal(hooks.has('agent_end'), true);

  hooks.get('before_dispatch')?.(
    { sessionKey: 'agent:main:hook-test', channel: 'whatsapp', replyToSender: 'reply-1' },
    { sessionKey: 'agent:main:hook-test', channelId: 'whatsapp', accountId: 'secondary', conversationId: 'group-1@g.us', replyToSender: 'reply-1' },
  );
  const context = {
    sessionKey: 'agent:main:hook-test',
    messageChannel: 'whatsapp',
    agentAccountId: 'secondary',
    nativeChannelId: 'group-1@g.us',
  } as OpenClawPluginToolContext;
  assert.equal(identityContextFromOpenClaw(context).replySender?.platformUserId, 'reply-1');
  hooks.get('agent_end')?.({}, { sessionKey: 'agent:main:hook-test' });
  assert.equal(identityContextFromOpenClaw(context).replySender, undefined);
});
