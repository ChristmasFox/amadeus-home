import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { OpenClawPluginApi, OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import { identityContextFromOpenClaw } from '../src/identity.js';
import entry from '../src/index.js';
import { macHostStatus } from '../src/machost.js';
import { assertVpsSubscriptionOwnerContext, parseVpsSubscriptionProbe } from '../src/vps.js';
import { isMacHostAgentHttpProbe, isMacHostShellProbe } from '../src/capabilities/macos-host/tool-guard.js';
import { WHATSAPP_VOICE_RUNS_GLOBAL } from '../src/voice-reply-prompt.js';

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
    'amadeus_vps_subscription_overview',
    'amadeus_vps_subscription_detail',
  ]) assert.equal(tools.has(name), true, `missing VPS manifest tool: ${name}`);
  for (const name of ['amadeus_market_overview', 'amadeus_market_quote', 'amadeus_market_intraday', 'amadeus_market_session', 'amadeus_market_movers', 'amadeus_market_constituents', 'amadeus_macos_host_status', 'amadeus_macos_host_processes']) assert.equal(tools.has(name), true, `missing market/host manifest tool: ${name}`);
  assert.equal(tools.has('amadeus_image_upscale'), true, 'missing image upscale manifest tool');
  assert.equal(tools.has('amadeus_briefing'), false, 'retired technology briefing tool is still exposed');
  assert.equal(manifest.skills?.includes('skills/identity'), true);
  assert.equal(manifest.skills?.includes('skills/market'), true);
  assert.equal(manifest.skills?.includes('skills/vps'), true);
  assert.equal(manifest.skills?.includes('skills/image-upscale'), true);
  const configKeys = Object.keys((manifest as { configSchema?: { properties?: Record<string, unknown> } }).configSchema?.properties ?? {});
  assert.equal(configKeys.includes('homeLabServiceBaseUrl'), true);
  assert.equal(configKeys.includes('openWrtBaseUrl'), true);
  assert.equal(configKeys.includes('imageAssetServiceBaseUrl'), true);
  assert.equal(configKeys.includes('imageAssetServiceTokenFile'), true);
  assert.equal(configKeys.includes('imageAssetContainerRoot'), true);
  assert.equal(configKeys.some((key) => /glances|61208|homeLabHost|homeLabBaseUrl/iu.test(key)), false);
});

test('Amadeus registers typed inbound identity context hooks', () => {
  const hooks = new Map<string, Array<(...args: unknown[]) => unknown>>();
  const registered: string[] = [];
  const registeredFactories = new Map<string, unknown>();
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
    registerTool(_factory: unknown, options: { name: string }) {
      registered.push(options.name);
      registeredFactories.set(options.name, _factory);
    },
  } as unknown as OpenClawPluginApi;

  entry.register(api);
  assert.equal(registered.some((name) => /trade|order|balance|position|portfolio/iu.test(name)), false);
  assert.equal(registered.includes('amadeus_market_quote'), true);
  assert.equal(registered.includes('amadeus_macos_host_status'), true);
  const hostFactory = registeredFactories.get('amadeus_macos_host_status');
  assert.equal(typeof hostFactory, 'function');
  const hostTool = (hostFactory as (context: OpenClawPluginToolContext) => {
    parameters: { additionalProperties?: boolean; properties?: Record<string, unknown> };
  })({} as OpenClawPluginToolContext);
  assert.equal(hostTool.parameters.additionalProperties, false);
  assert.equal(typeof hostTool.parameters.properties?.reason, 'object');
  assert.equal(hooks.has('message_received'), true, 'image asset registration uses the typed inbound media hook');
  assert.equal(hooks.has('before_prompt_build'), true);
  assert.equal(hooks.has('before_dispatch'), true);
  assert.equal(hooks.has('before_tool_call'), true);
  assert.equal(hooks.has('agent_end'), true);
  assert.equal(hooks.has('reply_payload_sending'), true);

  // The pinned WhatsApp monitor creates this lease before Agent dispatch.
  // message_received plugin hooks remain disabled, so no event is fired here.
  const globals = globalThis as Record<string, unknown>;
  const previousRegistry = globals[WHATSAPP_VOICE_RUNS_GLOBAL];
  globals[WHATSAPP_VOICE_RUNS_GLOBAL] = new Map([
    ['voice-session', { sessionKey: 'voice-session', messageId: 'voice-note', closed: false }],
  ]);
  const voicePrompt = runHooks('before_prompt_build',
    { prompt: 'transcribed voice text', messages: [] },
    { channel: 'whatsapp', runId: 'voice-run', sessionKey: 'voice-session' },
  ) as { appendSystemContext?: string } | undefined;
  (globals[WHATSAPP_VOICE_RUNS_GLOBAL] as Map<string, unknown>).delete('voice-session');
  const typedPrompt = runHooks('before_prompt_build',
    { prompt: 'typed text', messages: [] },
    {
      channel: 'whatsapp',
      runId: 'typed-run',
      sessionKey: 'voice-session',
      inputProvenance: { kind: 'external_user' },
    },
  ) as { appendSystemContext?: string } | undefined;
  assert.match(voicePrompt?.appendSystemContext ?? "", /"version":2/u);
  assert.match(typedPrompt?.appendSystemContext ?? "", /structured reply planner/u);
  if (previousRegistry === undefined) delete globals[WHATSAPP_VOICE_RUNS_GLOBAL];
  else globals[WHATSAPP_VOICE_RUNS_GLOBAL] = previousRegistry;

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

  const blocked = runHooks('before_tool_call',
    { toolName: 'exec', params: { command: 'free -m; cat /proc/loadavg; uptime' } },
    { toolName: 'exec' },
  ) as { block?: boolean; blockReason?: string } | undefined;
  assert.equal(blocked?.block, true);
  assert.match(blocked?.blockReason ?? '', /amadeus_macos_host_status/iu);
});

test('host telemetry permits bounded group queries but keeps direct owner checks for notifications', async () => {
  const result = await macHostStatus({ macHostAgentBaseUrl: 'http://127.0.0.1:1', macHostAgentTokenFile: '/missing' } as never, { senderIsOwner: false, sessionKey: 'agent:main:group:1', nativeChannelId: 'group-1@g.us' } as never);
  assert.deepEqual(result, { status: 'unavailable', error: 'host telemetry unavailable', host: 'Amadeus-M204' });
  await assert.rejects(() => macHostStatus({ macHostAgentBaseUrl: 'http://127.0.0.1:1', macHostAgentTokenFile: '/missing' } as never, { senderIsOwner: false, sessionKey: 'agent:main:chat' } as never), /owner or group query authorization/u);
});

test('host telemetry blocks guest shell and raw HTTP substitutes', () => {
  assert.equal(isMacHostShellProbe('free -m; cat /proc/loadavg; uptime'), true);
  assert.equal(isMacHostShellProbe('df -h /; diskutil info /'), true);
  assert.equal(isMacHostShellProbe('git status --short'), false);
  assert.equal(isMacHostAgentHttpProbe('http://host.docker.internal:18791/v1/status'), true);
  assert.equal(isMacHostAgentHttpProbe('http://product-radar:5315/health'), false);
});

test('subscription accounting tools reject non-owners and every group session', () => {
  assert.throws(() => assertVpsSubscriptionOwnerContext({ senderIsOwner: false, sessionKey: 'agent:main:whatsapp:secondary:direct:+8610000000000' } as never), /direct owner or scheduled report/u);
  assert.throws(() => assertVpsSubscriptionOwnerContext({ senderIsOwner: true, sessionKey: 'agent:main:group:42', nativeChannelId: '42@g.us' } as never), /direct owner or scheduled report/u);
  assert.doesNotThrow(() => assertVpsSubscriptionOwnerContext({ senderIsOwner: true, sessionKey: 'agent:main:whatsapp:secondary:direct:+8613800000000' } as never));
  assert.doesNotThrow(() => assertVpsSubscriptionOwnerContext({ senderIsOwner: false, sessionKey: 'cron:amadeus-vps-morning' } as never));
});

test('subscription probe parsing keeps unknowns and drops credential-shaped fields', () => {
  const protocol = {
    uploadBytes: null, downloadBytes: null, totalBytes: null,
    lastCounterSampleAt: null, status: 'unknown', onlineCount: null, onlineCountKind: null,
    onlineStatus: 'unknown', onlineSampledAt: null, windowBytes: null, windowSampleCount: 0,
  };
  const account = (accountId: string) => ({
    accountId, enabled: true, monitoringStartedAt: '2026-10-08T04:00:00Z', subscriptionToken: 'must-not-leak', hy2Secret: 'must-not-leak',
    protocols: { hy2: protocol, vless: protocol }, totalMonitoredBytes: null,
    knownMonitoredBytes: 0, totalsComplete: false, windowBytes: null, windowComplete: false,
  });
  const source = { status: 'ok', checkedAt: '2026-10-08T04:00:00Z', lastSuccessfulAt: '2026-10-08T04:00:00Z', lastErrorAt: null };
  const snapshot = {
    generatedAt: '2026-10-08T04:00:00Z', monitoringStartedAt: '2026-10-08T04:00:00Z',
    accounts: ['Labmem001', 'Labmem002', 'Labmem003', 'Labmem004', 'Labmem005', 'M204-Net-Core'].map(account),
    legacy: { ...account('legacy'), enabled: false }, protocolTotals: { hy2: {}, vless: {} },
    knownProxyAccountedBytes: 0, proxyAccountedBytes: null, proxyAccountedComplete: false,
    sources: { provider: source, hysteria_traffic: source, hysteria_online: source, xray: source, xray_online: source, reality_fallback: source },
    reportWindow: {}, provider: {}, reconciliation: { status: 'uncalibrated' },
    security: {
      realityFallback: {
        totalBytes: 1536, windowTotalBytes: 1536, status: 'ok', lastCounterSampleAt: '2026-10-08T04:00:00Z',
        destination: 'must-not-leak.example',
      },
      hysteriaAuth: {
        status: 'ok', windowSeconds: 43200, authFailuresWindow: 3, authRateLimitedWindow: 1,
        limiterMode: 'telemetry', limiterWindowSeconds: 900, limiterWindowCoverageSeconds: 300, authFailuresLimiterWindow: 2,
        authRateLimitedLimiterWindow: 0, uniqueFailureSourcesWindowApproximate: 1,
        uniqueFailureSourcesWindowSeconds: 900, trackingCapacityReached: false,
        sourceIp: '203.0.113.44', auth: 'must-not-leak',
      },
      signals: [
        { code: 'reality_fallback_traffic', value: 1536, threshold: 1024, sourceIp: '203.0.113.44' },
        { code: 'account_dominant_window', accountId: 'M204-Net-Core', sharePercent: 90, thresholdPercent: 85, windowBytes: 100 },
        { code: 'credential_leaked', token: 'must-not-leak' },
      ],
    },
  };
  const parsed = parseVpsSubscriptionProbe(`ACCOUNTING_SNAPSHOT_JSON=${JSON.stringify(snapshot)}\n`) as { status: string; data: Record<string, unknown> };
  assert.equal(parsed.status, 'partial');
  assert.equal(parsed.data.proxyAccountedBytes, null);
  assert.equal(parsed.data.proxyAccountedComplete, false);
  assert.equal((parsed.data.sources as Record<string, { status: string } | undefined>).xray_online?.status, 'ok');
  assert.equal((parsed.data.accounts as Array<{ accountId: string }>).at(-1)?.accountId, 'M204-Net-Core');
  assert.equal((parsed.data.legacy as { enabled: boolean }).enabled, false);
  assert.equal(JSON.stringify(parsed).includes('must-not-leak'), false);
  const security = parsed.data.security as { realityFallback: { totalBytes: number | null }; hysteriaAuth: { authFailuresWindow: number | null; limiterWindowCoverageSeconds: number | null }; signals: Array<{ code: string }> };
  assert.equal(security.realityFallback.totalBytes, 1536);
  assert.equal(security.hysteriaAuth.authFailuresWindow, 3);
  assert.equal(security.hysteriaAuth.limiterWindowCoverageSeconds, 300);
  assert.deepEqual(security.signals.map((signal) => signal.code), ['reality_fallback_traffic', 'account_dominant_window']);
  assert.equal((parsed.data.sources as Record<string, { status: string } | undefined>).reality_fallback?.status, 'ok');
});
