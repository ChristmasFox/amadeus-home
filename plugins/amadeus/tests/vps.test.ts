import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AmadeusConfig } from '../src/config.js';
import { getVpsUsage, parseVpsServicesProbe, parseVpsSystemProbe } from '../src/vps.js';

function config(directory: string): AmadeusConfig {
  return {
    productRadarBaseUrl: 'http://product-radar',
    mediaAdapterBaseUrl: 'http://media-adapter',
    homeLabHost: 'http://homelab',
    homeLabBaseUrl: 'http://homelab',
    homeLabGlancesUrl: 'http://homelab/glances',
    homeLabUptimeUrl: 'http://homelab/uptime',
    macSshHost: 'host.docker.internal',
    macSshUser: 'test',
    macSshKeyFile: join(directory, 'mac-key'),
    kookApiBaseUrl: 'https://kook.invalid',
    ownerTargetFile: join(directory, 'owner-target'),
    ownerWhatsappAccountId: 'secondary',
    ownerNotificationDeliveryEnabled: true,
    notificationOutboxDir: join(directory, 'outbox'),
    identityDatabasePath: join(directory, 'identity.sqlite'),
    longbridgeApiBaseUrl: 'https://openapi.longbridge.com',
    longbridgeAuthBaseUrl: 'https://openapi.longbridge.com',
    longbridgeClientIdFile: '/run/secrets/longbridge_client_id',
    longbridgeOAuthStateFile: '/data/longbridge-oauth.json',
    macHostAgentBaseUrl: 'http://host.docker.internal:18791',
    macHostAgentTokenFile: join(directory, 'machostagent-token'),
    kiwiVmBaseUrl: 'https://api.64clouds.com/v1',
    kiwiVmCredentialsFile: join(directory, 'kiwivm.json'),
    vpsSshHost: 'amadeus-gateway',
    vpsSshUser: 'vps-readonly',
    vpsSshPort: 22,
    vpsSshKeyFile: join(directory, 'vps-key'),
    vpsSshKnownHostsFile: join(directory, 'known-hosts'),
    vpsUsageStateFile: join(directory, 'vps-usage-state.json'),
  };
}

test('VPS usage computes numeric counters and persists only the successful baseline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'amadeus-vps-'));
  const originalFetch = globalThis.fetch;
  const seen: Array<{ url: string; body: string }> = [];
  try {
    const current = config(directory);
    await writeFile(current.kiwiVmCredentialsFile, JSON.stringify({ veid: '12345', apiKey: 'test-api-key' }));
    const responses: unknown[] = [
      { error: 0, data_counter: 200, plan_monthly_data: 1_000, data_next_reset: 1_800_000_000 },
      { error: 0, data: [{ timestamp: 1_799_999_000, network_in_bytes: 10, network_out_bytes: 5 }] },
      { error: 0, data_counter: 250, plan_monthly_data: 1_000, data_next_reset: 1_800_000_000 },
      { error: 0, data: [] },
    ];
    globalThis.fetch = async (input, init) => {
      seen.push({ url: String(input), body: String(init?.body ?? '') });
      const payload = responses.shift();
      if (payload === undefined) throw new Error('network unavailable');
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const first = await getVpsUsage(current);
    assert.equal((first as { status: string }).status, 'ok');
    assert.deepEqual((first as { usage: unknown }).usage, {
      usedBytes: 200,
      totalBytes: 1_000,
      remainingBytes: 800,
      usedPercent: 20,
      resetAt: '2027-01-15T08:00:00.000Z',
      deltaSincePreviousSampleBytes: null,
      counterReset: false,
    });
    assert.equal(seen.every((request) => !request.url.includes('api_key')), true);
    assert.equal(seen[0]?.body.includes('api_key=test-api-key'), true);

    const second = await getVpsUsage(current);
    assert.equal((second as { status: string }).status, 'ok');
    assert.equal((second as { usage: { deltaSincePreviousSampleBytes: number } }).usage.deltaSincePreviousSampleBytes, 50);
    const state = JSON.parse(await readFile(current.vpsUsageStateFile, 'utf8')) as Record<string, unknown>;
    assert.equal(state.lastSuccessfulCounter, 250);
    assert.equal(typeof state.lastSuccessfulAt, 'string');
    assert.equal(JSON.stringify(second).includes('test-api-key'), false);

    globalThis.fetch = async () => { throw new Error('network unavailable'); };
    const stale = await getVpsUsage(current);
    assert.equal((stale as { status: string }).status, 'stale');
    assert.equal((stale as { stale: boolean }).stale, true);
    assert.equal((stale as { usage: { usedBytes: number; totalBytes: number | null } }).usage.usedBytes, 250);
    assert.equal((stale as { usage: { totalBytes: number | null } }).usage.totalBytes, 1_000);
    assert.equal((stale as { usage: { remainingBytes: number | null } }).usage.remainingBytes, 750);
    assert.equal((stale as { usage: { usedPercent: number | null } }).usage.usedPercent, 25);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('VPS SSH parsers mark missing or inactive facts instead of treating them as healthy', () => {
  const system = parseVpsSystemProbe([
    'VPS_PROBE_VERSION=1',
    'HOSTNAME=amadeus-gateway',
    'UPTIME_SECONDS=123',
    'UPTIME_TEXT=up 2 minutes',
    'LOAD_AVERAGE=0.12 0.08 0.06',
    'MEMORY_BYTES=500 1000',
    'ROOTFS=/dev/sda2 10000 2000 8000 20',
  ].join('\n')) as { status: string; system: { memory: { usedBytes: number }; rootFilesystem: { usedPercent: number } } };
  assert.equal(system.status, 'ok');
  assert.equal(system.system.memory.usedBytes, 500);
  assert.equal(system.system.rootFilesystem.usedPercent, 20);

  const services = parseVpsServicesProbe([
    'VPS_SERVICES_PROBE_VERSION=1',
    'SERVICE\tcaddy.service\tactive\tenabled',
    'SERVICE\txray.service\tinactive\tenabled',
    'SERVICE\thysteria-server.service\tactive\tenabled',
    'SERVICE\tfrps.service\tunknown\tunknown',
  ].join('\n')) as { status: string; inactiveServices: string[]; unknownServices: string[] };
  assert.equal(services.status, 'partial');
  assert.deepEqual(services.inactiveServices, ['Xray', 'frps']);
  assert.deepEqual(services.unknownServices, ['frps']);
});
