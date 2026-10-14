import assert from 'node:assert/strict';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { connect, createServer as createTcpServer } from 'node:net';
import { once } from 'node:events';
import test from 'node:test';
import type { LookupAddress } from 'node:dns';
import { getGlobalDispatcher, ProxyAgent, setGlobalDispatcher } from 'undici';
import { closeWorkerMetricsRelay, createPublicEgressProxy, createWorkerMetricsRelay, isBlockedEgressAddress, parseHttpsConnectAuthority } from '../src/infrastructure/egress-proxy.js';
import { configurePublicEgress, parsePublicEgressProxy } from '../src/infrastructure/public-egress.js';

test('public egress dispatcher URL rejects unsafe proxy URLs and enforces required configuration', () => {
  assert.equal(parsePublicEgressProxy(undefined), null);
  assert.equal(parsePublicEgressProxy(' http://egress-proxy:8080 ' )?.href, 'http://egress-proxy:8080/');
  for (const value of [
    'https://egress-proxy:8080', 'http://user:pass@egress-proxy:8080',
    'http://egress-proxy:8080/path', 'http://egress-proxy:8080/?x=1',
    'http://egress-proxy', 'not a URL',
  ]) assert.throws(() => parsePublicEgressProxy(value), /pubg_saas_egress_proxy_invalid/u);
  assert.throws(() => configurePublicEgress({ PUBG_SAAS_EGRESS_PROXY_REQUIRED: '1' }), /pubg_saas_egress_proxy_required/u);
});

test('proxy blocks loopback, private, link-local, reserved and IPv4-mapped destinations', () => {
  for (const address of [
    '0.1.2.3', '10.0.0.5', '100.64.0.1', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '192.168.1.1', '168.63.129.16', '198.18.0.1', '224.0.0.1', '240.0.0.1',
    '::', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', 'ff02::1',
    '2001:db8::1', '2002:7f00:1::',
  ]) assert.equal(isBlockedEgressAddress(address), true, address);
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
    assert.equal(isBlockedEgressAddress(address), false, address);
  }
  assert.equal(isBlockedEgressAddress('not-an-ip'), true);
});

test('CONNECT parser accepts only HTTPS DNS host authorities', () => {
  assert.equal(parseHttpsConnectAuthority('api.pubg.com:443'), 'api.pubg.com');
  assert.equal(parseHttpsConnectAuthority('[2001:4860:4860::8888]:443'), null);
  for (const authority of [
    '169.254.169.254:443', '127.0.0.1:443', 'localhost:80', 'api.pubg.com:444',
    'user@api.pubg.com:443', 'api.pubg.com:443/path', 'bad_host:443',
  ]) assert.equal(parseHttpsConnectAuthority(authority), null, authority);
});

async function connectResponse(authority: string, port: number): Promise<string> {
  const socket = connect(port, '127.0.0.1');
  let response = '';
  socket.on('data', chunk => { response += chunk.toString('utf8'); });
  const closed = once(socket, 'close');
  socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
  await closed;
  return response;
}

async function withProxy(lookupHost: (hostname: string) => Promise<LookupAddress[]>, connectAttempts: string[], run: (port: number) => Promise<void>): Promise<void> {
  const server = createPublicEgressProxy({
    host: '127.0.0.1', port: 0, lookupHost,
    connectUpstream: async address => { connectAttempts.push(address); throw new Error('synthetic_connect_failure'); },
  });
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try { await run(address.port); }
  finally { server.close(); await once(server, 'close'); }
}

test('HTTP CONNECT rejects DNS answers resolving to private or metadata addresses without dialing them', async () => {
  const attempts: string[] = [];
  const response = new Map<string, string>([
    ['host.docker.internal', '192.168.65.254'],
    ['metadata.test', '169.254.169.254'],
  ]);
  await withProxy(async host => [{ address: response.get(host) ?? '8.8.8.8', family: 4 }], attempts, async port => {
    for (const host of ['host.docker.internal', 'metadata.test']) {
      const result = await connectResponse(`${host}:443`, port);
      assert.match(result, /^HTTP\/1\.1 403 Forbidden/u);
    }
  });
  assert.deepEqual(attempts, []);
});

test('HTTP CONNECT rejects a mixed public/private DNS answer and allows dialing only public answers', async () => {
  const attempts: string[] = [];
  await withProxy(async host => host === 'mixed.test'
    ? [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.9', family: 4 }]
    : [{ address: '1.1.1.1', family: 4 }], attempts, async port => {
    const mixed = await connectResponse('mixed.test:443', port);
    assert.match(mixed, /^HTTP\/1\.1 403 Forbidden/u);
    const publicOnly = await connectResponse('public.test:443', port);
    assert.match(publicOnly, /^HTTP\/1\.1 502 Bad Gateway/u);
  });
  assert.deepEqual(attempts, ['1.1.1.1']);
});

test('Node WebSocket sends WSS through the configured global dispatcher', async () => {
  const connectLines: string[] = [];
  const proxyServer = createTcpServer(socket => {
    socket.once('data', chunk => {
      connectLines.push(chunk.toString('utf8').split('\r\n', 1)[0] ?? '');
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    });
  });
  proxyServer.listen(0, '127.0.0.1');
  await once(proxyServer, 'listening');
  const proxyAddress = proxyServer.address();
  assert.ok(proxyAddress && typeof proxyAddress !== 'string');
  const previous = getGlobalDispatcher();
  const proxy = new ProxyAgent(`http://127.0.0.1:${proxyAddress.port}`);
  setGlobalDispatcher(proxy);
  try {
    const socket = new WebSocket('wss://public-egress-test.invalid/');
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        new Promise<void>(resolve => socket.addEventListener('error', () => resolve(), { once: true })),
        new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('websocket_proxy_test_timeout')), 3000); }),
      ]);
    } finally { if (timeout) clearTimeout(timeout); }
    assert.deepEqual(connectLines, ['CONNECT public-egress-test.invalid:443 HTTP/1.1']);
  } finally {
    setGlobalDispatcher(previous);
    await proxy.close();
    proxyServer.close();
    await once(proxyServer, 'close');
  }
});

function relayRequest(port: number, method: string, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, method, path }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.once('end', () => resolve({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.once('error', reject);
    request.end();
  });
}

test('worker metrics relay exposes only the fixed GET /metrics upstream path', async () => {
  const upstreamRequests: Array<{ method: string | undefined; url: string | undefined }> = [];
  const upstream = createHttpServer((request, response) => {
    upstreamRequests.push({ method: request.method, url: request.url });
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('pubg_saas_worker_up 1\n');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const upstreamAddress = upstream.address();
  assert.ok(upstreamAddress && typeof upstreamAddress !== 'string');
  const relay = createWorkerMetricsRelay({
    host: '127.0.0.1', port: 0,
    upstreamHost: '127.0.0.1', upstreamPort: upstreamAddress.port,
  });
  await once(relay, 'listening');
  const relayAddress = relay.address();
  assert.ok(relayAddress && typeof relayAddress !== 'string');
  try {
    assert.deepEqual(await relayRequest(relayAddress.port, 'GET', '/metrics'), {
      status: 200, body: 'pubg_saas_worker_up 1\n',
    });
    assert.equal((await relayRequest(relayAddress.port, 'GET', '/metrics?tenant=secret')).status, 404);
    assert.equal((await relayRequest(relayAddress.port, 'POST', '/metrics')).status, 405);
    assert.deepEqual(upstreamRequests, [{ method: 'GET', url: '/metrics' }]);
  } finally {
    await closeWorkerMetricsRelay(relay);
    upstream.close();
    await once(upstream, 'close');
  }
});

test('worker metrics relay bounds upstream output and hides upstream failures', async () => {
  let mode: 'error' | 'oversized' = 'error';
  const upstream = createHttpServer((_request, response) => {
    response.writeHead(mode === 'error' ? 502 : 200);
    response.end(mode === 'error' ? 'upstream detail' : 'x'.repeat(32));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const upstreamAddress = upstream.address();
  assert.ok(upstreamAddress && typeof upstreamAddress !== 'string');
  const relay = createWorkerMetricsRelay({
    host: '127.0.0.1', port: 0,
    upstreamHost: '127.0.0.1', upstreamPort: upstreamAddress.port,
    maxResponseBytes: 16,
  });
  await once(relay, 'listening');
  const relayAddress = relay.address();
  assert.ok(relayAddress && typeof relayAddress !== 'string');
  try {
    assert.deepEqual(await relayRequest(relayAddress.port, 'GET', '/metrics'), {
      status: 503, body: 'metrics temporarily unavailable\n',
    });
    mode = 'oversized';
    assert.deepEqual(await relayRequest(relayAddress.port, 'GET', '/metrics'), {
      status: 503, body: 'metrics temporarily unavailable\n',
    });
  } finally {
    await closeWorkerMetricsRelay(relay);
    upstream.close();
    await once(upstream, 'close');
  }
});
