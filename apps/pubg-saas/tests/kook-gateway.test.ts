import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import {
  KookGatewayApiClient,
  KookGatewayClient,
  createNodeWebSocketFactory,
  migratePublicDatabase,
  PostgresKookGatewayStateStore,
  type KookGatewaySessionState,
  type KookGatewaySocket,
  type KookGatewaySocketEvent,
} from '../src/index.js';

const databaseUrl = process.env.PUBG_SAAS_TEST_DATABASE_URL;

class MemoryGatewayStateStore {
  state: KookGatewaySessionState | null = null;

  async load(): Promise<KookGatewaySessionState | null> {
    return this.state ? { ...this.state } : null;
  }

  async save(_botAccountId: string, state: KookGatewaySessionState): Promise<void> {
    this.state = { ...state };
  }

  async clear(): Promise<void> {
    this.state = null;
  }
}

class FakeSocket implements KookGatewaySocket {
  readonly sent: Array<Record<string, unknown>> = [];
  private readonly listeners = new Map<string, Array<(event: KookGatewaySocketEvent) => void>>();

  addEventListener(type: 'open' | 'message' | 'error' | 'close', listener: (event: KookGatewaySocketEvent) => void): void {
    const values = this.listeners.get(type) ?? [];
    values.push(listener);
    this.listeners.set(type, values);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {
    this.emit('close', {});
  }

  open(): void {
    this.emit('open', {});
  }

  frame(value: Record<string, unknown>): void {
    this.emit('message', { data: JSON.stringify(value) });
  }

  private emit(type: string, event: KookGatewaySocketEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${label}`);
}

test('gateway API uses the official fixed URL and requests uncompressed WSS frames', async () => {
  const requests: Array<{ url: URL; authorization: string | null }> = [];
  const client = new KookGatewayApiClient({
    token: 'fixture-token',
    fetcher: async (input, init) => {
      requests.push({ url: new URL(String(input)), authorization: new Headers(init?.headers).get('Authorization') });
      return new Response(JSON.stringify({ code: 0, data: { url: 'wss://gateway.kookapp.cn/gateway?token=fixture' } }), { status: 200 });
    },
  });
  const url = new URL(await client.getGatewayUrl());
  assert.equal(url.protocol, 'wss:');
  assert.equal(url.searchParams.get('compress'), '0');
  assert.equal(requests[0]?.url.origin, 'https://www.kookapp.cn');
  assert.equal(requests[0]?.url.pathname, '/api/v3/gateway/index');
  assert.equal(requests[0]?.url.searchParams.get('compress'), '0');
  assert.equal(requests[0]?.authorization, 'Bot fixture-token');

  const invalid = new KookGatewayApiClient({
    token: 'fixture-token',
    fetcher: async () => new Response(JSON.stringify({ code: 0, data: { url: 'https://example.com/gateway' } }), { status: 200 }),
  });
  await assert.rejects(invalid.getGatewayUrl(), /kook_gateway_url_invalid/u);
});

test('Node WebSocket factory forwards only the validated gateway URL', () => {
  class ConstructedSocket extends FakeSocket {
    constructor(readonly url: string) { super(); }
  }
  const factory = createNodeWebSocketFactory(ConstructedSocket);
  const socket = factory('wss://gateway.kookapp.cn/gateway?compress=0');
  assert.ok(socket instanceof ConstructedSocket);
  assert.equal((socket as ConstructedSocket).url, 'wss://gateway.kookapp.cn/gateway?compress=0');
  assert.throws(() => createNodeWebSocketFactory(null), /node_websocket_unavailable/u);
});

test('gateway processes events in sn order and resumes from the last durably handled sequence', async () => {
  const stateStore = new MemoryGatewayStateStore();
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  const handled: number[] = [];
  const connectionStates: Array<'connected' | 'disconnected'> = [];
  const client = new KookGatewayClient({
    botAccountId: 'configured-bot',
    gatewayUrlProvider: {
      async getGatewayUrl() { return 'wss://gateway.kookapp.cn/gateway?token=fixture&compress=0'; },
    },
    stateStore,
    socketFactory(url) { urls.push(url); const socket = new FakeSocket(); sockets.push(socket); return socket; },
    async handleEvent(_event, sn) { handled.push(sn); },
    heartbeatIntervalMs: 10_000,
    heartbeatJitterMs: 0,
    reconnectBaseMs: 1,
    reconnectMaxMs: 2,
    random: () => 0.5,
    onConnectionStatus: status => connectionStates.push(status),
  });
  const abort = new AbortController();
  const run = client.run(abort.signal);
  await waitFor(() => sockets.length === 1, 'first WebSocket');
  const first = sockets[0]!;
  first.open();
  first.frame({ s: 1, d: { code: 0, session_id: 'session-a' } });
  await waitFor(() => stateStore.state?.sessionId === 'session-a', 'gateway hello state');
  assert.equal(connectionStates.at(-1), 'connected');

  first.frame({ s: 0, sn: 1, d: { message: 'one' } });
  await waitFor(() => stateStore.state?.lastSn === 1, 'first event sequence');
  first.frame({ s: 0, sn: 3, d: { message: 'three' } });
  await waitFor(() => first.sent.some((frame) => frame.s === 4), 'gap resume request');
  assert.equal(stateStore.state?.lastSn, 1);
  assert.deepEqual(handled, [1]);
  first.frame({ s: 0, sn: 2, d: { message: 'two' } });
  await waitFor(() => stateStore.state?.lastSn === 3, 'ordered buffered event drain');
  first.frame({ s: 0, sn: 2, d: { message: 'duplicate' } });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(handled, [1, 2, 3]);

  first.close();
  assert.equal(connectionStates.at(-1), 'disconnected');
  await waitFor(() => sockets.length === 2, 'resumed WebSocket');
  const resumedUrl = new URL(urls[1]!);
  assert.equal(resumedUrl.searchParams.get('resume'), '1');
  assert.equal(resumedUrl.searchParams.get('sn'), '3');
  assert.equal(resumedUrl.searchParams.get('session_id'), 'session-a');
  sockets[1]!.open();
  sockets[1]!.frame({ s: 1, d: { code: 0, session_id: 'session-a' } });
  await waitFor(() => sockets[1]!.sent.length === 0, 'second hello');
  abort.abort();
  await run;
  assert.equal(connectionStates.at(-1), 'disconnected');
});

test('gateway bounds queued frames and waits for the in-flight durable write during shutdown', async () => {
  const state = new MemoryGatewayStateStore(); const socket = new FakeSocket();
  let unblock: () => void = () => { }; let entered = false; let finished = false;
  const blocked = new Promise<void>(resolve => { unblock = resolve; });
  const errors: string[] = []; const abort = new AbortController();
  const client = new KookGatewayClient({
    botAccountId: 'fixture-bot', gatewayUrlProvider: { async getGatewayUrl() { return 'wss://gateway.kookapp.cn/gateway?compress=0'; } },
    stateStore: state, socketFactory: () => socket, maxBufferedEvents: 2, reconnectBaseMs: 10_000,
    async handleEvent() { entered = true; await blocked; }, onError: code => errors.push(code),
  });
  const run = client.run(abort.signal).then(() => { finished = true; });
  await new Promise(resolve => setTimeout(resolve, 1));
  socket.open(); socket.frame({ s: 1, d: { code: 0, session_id: 'bounded-session' } });
  await waitFor(() => state.state?.sessionId === 'bounded-session', 'hello');
  socket.frame({ s: 0, sn: 1, d: { content: 'one' } });
  await waitFor(() => entered, 'blocked durable handler');
  socket.frame({ s: 0, sn: 2, d: { content: 'two' } }); socket.frame({ s: 0, sn: 3, d: { content: 'three' } });
  await waitFor(() => errors.includes('kook_gateway_frame_queue_overflow'), 'bounded frame queue');
  abort.abort(); await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(finished, false);
  unblock(); await run; assert.equal(state.state?.lastSn, 1);
});

test('gateway heartbeat waits for pong and reconnect signal discards only session sequence state', async () => {
  const stateStore = new MemoryGatewayStateStore();
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  const client = new KookGatewayClient({
    botAccountId: 'configured-bot',
    gatewayUrlProvider: {
      async getGatewayUrl() { return 'wss://gateway.kookapp.cn/gateway?token=fixture&compress=0'; },
    },
    stateStore,
    socketFactory(url) { urls.push(url); const socket = new FakeSocket(); sockets.push(socket); return socket; },
    async handleEvent() { },
    heartbeatIntervalMs: 10,
    heartbeatJitterMs: 0,
    pongTimeoutMs: 100,
    helloTimeoutMs: 100,
    reconnectBaseMs: 1,
    reconnectMaxMs: 2,
    random: () => 0.5,
  });
  const abort = new AbortController();
  const run = client.run(abort.signal);
  await waitFor(() => sockets.length === 1, 'first heartbeat socket');
  const first = sockets[0]!;
  first.open();
  first.frame({ s: 1, d: { code: 0, session_id: 'session-old' } });
  await waitFor(() => first.sent.some((frame) => frame.s === 2), 'first heartbeat ping');
  first.frame({ s: 3 });
  await waitFor(() => first.sent.filter((frame) => frame.s === 2).length >= 2, 'next heartbeat after pong');
  first.frame({ s: 0, sn: 1, d: { message: 'received' } });
  await waitFor(() => stateStore.state?.lastSn === 1, 'persisted event before reconnect');
  first.frame({ s: 5, d: { code: 0 } });
  await waitFor(() => sockets.length === 2, 'fresh socket after reconnect signal');
  assert.equal(stateStore.state, null);
  const freshUrl = new URL(urls[1]!);
  assert.equal(freshUrl.searchParams.has('resume'), false);
  sockets[1]!.open();
  sockets[1]!.frame({ s: 1, d: { code: 0, session_id: 'session-new' } });
  await waitFor(() => stateStore.state?.sessionId === 'session-new', 'fresh session state');
  abort.abort();
  await run;
});

test('PostgreSQL gateway state survives a process restart and can be cleared', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const botId = `gateway-bot-${Date.now()}-${Math.random()}`;
  const store = new PostgresKookGatewayStateStore(pool);
  try {
    await migratePublicDatabase(pool);
    await store.save(botId, { sessionId: 'session-fixture', lastSn: 37 });
    assert.deepEqual(await store.load(botId), { sessionId: 'session-fixture', lastSn: 37 });
    await store.clear(botId);
    assert.equal(await store.load(botId), null);
  } finally {
    await store.clear(botId).catch(() => undefined);
    await pool.end();
  }
});
