import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { OpenClawPluginApi, OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import { identityContextFromOpenClaw } from '../src/identity.js';
import entry from '../src/index.js';
import { macHostStatus } from '../src/machost.js';

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
  for (const name of ['amadeus_market_overview', 'amadeus_market_quote', 'amadeus_market_intraday', 'amadeus_market_session', 'amadeus_market_movers', 'amadeus_market_constituents', 'amadeus_macos_host_status', 'amadeus_macos_host_processes']) assert.equal(tools.has(name), true, `missing market/host manifest tool: ${name}`);
  assert.equal(tools.has('amadeus_briefing'), false, 'retired technology briefing tool is still exposed');
  assert.equal(manifest.skills?.includes('skills/identity'), true);
  assert.equal(manifest.skills?.includes('skills/market'), true);
  assert.equal(manifest.skills?.includes('skills/vps'), true);
});

test('Amadeus registers typed inbound identity context hooks', () => {
  const hooks = new Map<string, Array<(...args: unknown[]) => unknown>>();
  const registered: string[] = [];
  const runHooks = (name: string, ...args: unknown[]): unknown => {
    let result: unknown;
    for (const handler of hooks.get(name) ?? []) {
      const next = handler(...args);
      if (next !== undefined) result = next;
    }
    return result;
  };
  const api = {
    pluginConfig: {},
    rootDir: fileURLToPath(new URL('..', import.meta.url)),
    logger: { info() {}, warn() {} },
    on(name: string, handler: (...args: unknown[]) => unknown) { hooks.set(name, [...(hooks.get(name) ?? []), handler]); },
    registerService() {},
    registerTool(_factory: unknown, options: { name: string }) { registered.push(options.name); },
  } as unknown as OpenClawPluginApi;

  entry.register(api);
  assert.equal(registered.some((name) => /trade|order|balance|position|portfolio/iu.test(name)), false);
  assert.equal(registered.includes('amadeus_market_quote'), true);
  assert.equal(registered.includes('amadeus_macos_host_status'), true);
  assert.equal(hooks.has('message_received'), true);
  assert.equal(hooks.has('before_prompt_build'), true);
  assert.equal(hooks.has('before_dispatch'), true);
  assert.equal(hooks.has('agent_end'), true);

  // The pinned OpenClaw 2026.9.4 message_received mapper omits runId from
  // the event/context. SessionKey is the verified bridge until the harness
  // supplies the concrete runId to before_prompt_build.
  runHooks('message_received',
    { sessionKey: 'voice-session', media: [{ contentType: 'audio/ogg; codecs=opus' }] },
    { channelId: 'whatsapp', sessionKey: 'voice-session' },
  );
  const voicePrompt = runHooks('before_prompt_build',
    { prompt: 'transcribed voice text', messages: [] },
    { channel: 'whatsapp', runId: 'voice-run', sessionKey: 'voice-session' },
  ) as { appendSystemContext?: string } | undefined;
  assert.match(voicePrompt?.appendSystemContext ?? '', /one faithful, concise Chinese sentence/u);
  assert.match(voicePrompt?.appendSystemContext ?? '', /spoken audio MUST be\s+Japanese/u);
  assert.match(voicePrompt?.appendSystemContext ?? '', /even if the user explicitly asks for a Chinese\s+spoken reply/u);
  assert.match(voicePrompt?.appendSystemContext ?? '', /preserve the\s+existing ordinary text-message behavior, including the user's explicit\s+language request/u);
  assert.match(voicePrompt?.appendSystemContext ?? '', /the same Japanese answer, written naturally with Japanese kanji and kana/u);
  assert.match(voicePrompt?.appendSystemContext ?? '', /exactly the same Japanese sentence as the 日本語 line/u);
  assert.match(voicePrompt?.appendSystemContext ?? '', /\[\[tts:text\]\]/u);
  assert.match(voicePrompt?.appendSystemContext ?? '', /do not call the read tool to retrieve that Skill again/u);
  runHooks('agent_end', {}, { runId: 'voice-run', sessionKey: 'voice-session' });
  const typedPrompt = runHooks('before_prompt_build',
    { prompt: 'typed text', messages: [] },
    { channel: 'whatsapp', runId: 'typed-run', sessionKey: 'voice-session' },
  );
  assert.equal(typedPrompt, undefined, 'session fallback is cleared before any later typed-only turn');

  runHooks('before_dispatch',
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
  runHooks('agent_end', {}, { sessionKey: 'agent:main:hook-test' });
  assert.equal(identityContextFromOpenClaw(context).replySender, undefined);
});

test('host telemetry rejects owner messages in group conversations', async () => {
  await assert.rejects(() => macHostStatus({ macHostAgentBaseUrl: 'http://127.0.0.1:1', macHostAgentTokenFile: '/missing' } as never, { senderIsOwner: true, sessionKey: 'agent:main:group:1', nativeChannelId: 'group-1@g.us' } as never), /private/u);
});
