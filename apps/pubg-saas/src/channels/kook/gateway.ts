import type { Pool } from 'pg';

interface KookApiEnvelope<T> {
  code: number;
  data: T;
}

interface GatewayIndexData {
  url?: unknown;
}

export interface KookGatewaySessionState {
  sessionId: string | null;
  lastSn: number;
}

export interface KookGatewayStateStore {
  load(botAccountId: string): Promise<KookGatewaySessionState | null>;
  save(botAccountId: string, state: KookGatewaySessionState): Promise<void>;
  clear(botAccountId: string): Promise<void>;
}

export interface KookGatewayUrlProvider {
  getGatewayUrl(): Promise<string>;
}

export interface KookGatewayApiClientOptions {
  token: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export type KookGatewaySocketEvent = { data?: unknown };

export interface KookGatewaySocket {
  addEventListener(type: 'open' | 'message' | 'error' | 'close', listener: (event: KookGatewaySocketEvent) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type KookGatewaySocketFactory = (url: string) => KookGatewaySocket;

export interface KookWebSocketConstructor {
  new(url: string): KookGatewaySocket;
}

/** Uses Node 22's built-in WebSocket without adding a runtime package. Tests
 * can pass a constructor explicitly; runtime startup should fail closed when
 * the supported global is unavailable. */
export function createNodeWebSocketFactory(
  WebSocketConstructor: KookWebSocketConstructor | null = (globalThis as typeof globalThis & { WebSocket?: KookWebSocketConstructor }).WebSocket,
): KookGatewaySocketFactory {
  if (!WebSocketConstructor) throw new Error('node_websocket_unavailable');
  return (url) => new WebSocketConstructor(url);
}

export interface KookGatewayClientOptions {
  botAccountId: string;
  gatewayUrlProvider: KookGatewayUrlProvider;
  stateStore: KookGatewayStateStore;
  socketFactory: KookGatewaySocketFactory;
  handleEvent(event: unknown, sn: number): Promise<void>;
  heartbeatIntervalMs?: number;
  heartbeatJitterMs?: number;
  pongTimeoutMs?: number;
  helloTimeoutMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  maxBufferedEvents?: number;
  random?: () => number;
  onError?: (code: string) => void;
  onConnectionStatus?: (status: 'connected' | 'disconnected') => void;
}

type GatewayFrame = {
  s: number;
  d?: unknown;
  sn?: number;
};

type SessionExit = 'closed' | 'reset' | 'aborted';

function requiredText(value: unknown, key: string, maxLength = 256): string {
  if (typeof value !== 'string') throw new Error(`kook_${key}_invalid`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`kook_${key}_invalid`);
  return normalized;
}

function apiEnvelope<T>(value: unknown): KookApiEnvelope<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('kook_gateway_response_invalid');
  const record = value as Record<string, unknown>;
  if (record.code !== 0 || !('data' in record)) throw new Error('kook_gateway_api_rejected');
  return { code: 0, data: record.data as T };
}

function gatewayUrl(value: unknown): URL {
  if (typeof value !== 'string') throw new Error('kook_gateway_url_invalid');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('kook_gateway_url_invalid'); }
  if (url.protocol !== 'wss:' || url.username || url.password || url.hash || !url.hostname || url.pathname !== '/gateway') {
    throw new Error('kook_gateway_url_invalid');
  }
  url.searchParams.set('compress', '0');
  return url;
}

function parseFrame(value: unknown): GatewayFrame {
  if (typeof value !== 'string' || value.length > 64 * 1024) throw new Error('kook_gateway_frame_invalid');
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('kook_gateway_frame_invalid'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('kook_gateway_frame_invalid');
  const frame = parsed as Record<string, unknown>;
  if (!Number.isSafeInteger(frame.s) || Number(frame.s) < 0) throw new Error('kook_gateway_frame_invalid');
  return {
    s: Number(frame.s),
    ...(frame.d !== undefined ? { d: frame.d } : {}),
    ...(frame.sn !== undefined ? { sn: frame.sn as number } : {}),
  };
}

function dataRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('kook_gateway_frame_invalid');
  return value as Record<string, unknown>;
}

function parseState(row: { session_id: unknown; last_sn: unknown }): KookGatewaySessionState {
  const lastSn = typeof row.last_sn === 'number' ? row.last_sn : Number(row.last_sn);
  if (!Number.isSafeInteger(lastSn) || lastSn < 0) throw new Error('kook_gateway_state_invalid');
  const sessionId = row.session_id === null ? null : requiredText(row.session_id, 'session_id', 256);
  return { sessionId, lastSn };
}

function resumeUrl(input: string, state: KookGatewaySessionState): string {
  const url = gatewayUrl(input);
  if (state.sessionId) {
    url.searchParams.set('resume', '1');
    url.searchParams.set('sn', String(state.lastSn));
    url.searchParams.set('session_id', state.sessionId);
  }
  return url.toString();
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    const onAbort = () => finish();
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Official KOOK gateway URL lookup. It requests uncompressed text frames so
 * the protocol adapter does not need a zlib dependency. */
export class KookGatewayApiClient implements KookGatewayUrlProvider {
  private readonly token: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly apiBase = 'https://www.kookapp.cn/api/v3';

  constructor(options: KookGatewayApiClientOptions) {
    this.token = requiredText(options.token, 'token', 4096);
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) throw new Error('kook_gateway_timeout_invalid');
  }

  async getGatewayUrl(): Promise<string> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.apiBase}/gateway/index?compress=0`, {
        method: 'GET',
        headers: { Authorization: `Bot ${this.token}`, Accept: 'application/json', 'Cache-Control': 'no-cache' },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new Error('kook_gateway_api_unavailable');
    }
    if (!response.ok) throw new Error(`kook_gateway_api_http_${response.status}`);
    let body: unknown;
    try { body = await response.json(); } catch { throw new Error('kook_gateway_response_invalid'); }
    const data = apiEnvelope<GatewayIndexData>(body).data;
    return gatewayUrl(data.url).toString();
  }
}

/** Durable resume sequence state, scoped to the configured KOOK bot identity. */
export class PostgresKookGatewayStateStore implements KookGatewayStateStore {
  constructor(private readonly pool: Pool) { }

  async load(botAccountId: string): Promise<KookGatewaySessionState | null> {
    const result = await this.pool.query('SELECT session_id,last_sn FROM kook_gateway_state WHERE bot_account_id=$1', [requiredText(botAccountId, 'bot_account_id', 128)]);
    const row = result.rows[0];
    return row ? parseState(row) : null;
  }

  async save(botAccountId: string, state: KookGatewaySessionState): Promise<void> {
    const botId = requiredText(botAccountId, 'bot_account_id', 128);
    if (state.sessionId !== null) requiredText(state.sessionId, 'session_id', 256);
    if (!Number.isSafeInteger(state.lastSn) || state.lastSn < 0) throw new Error('kook_gateway_state_invalid');
    await this.pool.query(
      `INSERT INTO kook_gateway_state(bot_account_id,session_id,last_sn,updated_at)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (bot_account_id) DO UPDATE
       SET session_id=EXCLUDED.session_id,last_sn=EXCLUDED.last_sn,updated_at=now()`,
      [botId, state.sessionId, state.lastSn],
    );
  }

  async clear(botAccountId: string): Promise<void> {
    await this.pool.query('DELETE FROM kook_gateway_state WHERE bot_account_id=$1', [requiredText(botAccountId, 'bot_account_id', 128)]);
  }
}

/** One socket session at a time, with ordered event handling, durable resume
 * sequence, heartbeat timeout and bounded exponential reconnect. */
export class KookGatewayClient {
  private readonly botAccountId: string;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatJitterMs: number;
  private readonly pongTimeoutMs: number;
  private readonly helloTimeoutMs: number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly maxBufferedEvents: number;
  private readonly random: () => number;

  constructor(private readonly options: KookGatewayClientOptions) {
    this.botAccountId = requiredText(options.botAccountId, 'bot_account_id', 128);
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
    this.heartbeatJitterMs = options.heartbeatJitterMs ?? 5000;
    this.pongTimeoutMs = options.pongTimeoutMs ?? 6000;
    this.helloTimeoutMs = options.helloTimeoutMs ?? 6000;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 2000;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 60_000;
    this.maxBufferedEvents = options.maxBufferedEvents ?? 256;
    this.random = options.random ?? Math.random;
    if (!Number.isSafeInteger(this.heartbeatIntervalMs) || this.heartbeatIntervalMs < 1
      || !Number.isSafeInteger(this.heartbeatJitterMs) || this.heartbeatJitterMs < 0
      || !Number.isSafeInteger(this.pongTimeoutMs) || this.pongTimeoutMs < 1
      || !Number.isSafeInteger(this.helloTimeoutMs) || this.helloTimeoutMs < 1
      || !Number.isSafeInteger(this.reconnectBaseMs) || this.reconnectBaseMs < 0
      || !Number.isSafeInteger(this.reconnectMaxMs) || this.reconnectMaxMs < this.reconnectBaseMs
      || !Number.isSafeInteger(this.maxBufferedEvents) || this.maxBufferedEvents < 1 || this.maxBufferedEvents > 10_000) {
      throw new Error('kook_gateway_limits_invalid');
    }
  }

  async run(signal?: AbortSignal): Promise<void> {
    let failureCount = 0;
    while (!signal?.aborted) {
      let exit: SessionExit = 'closed';
      try {
        const state = await this.options.stateStore.load(this.botAccountId) ?? { sessionId: null, lastSn: 0 };
        const url = resumeUrl(await this.options.gatewayUrlProvider.getGatewayUrl(), state);
        exit = await this.connectOnce(url, state, signal);
      } catch {
        try { this.options.onConnectionStatus?.('disconnected'); } catch { /* observation cannot stop reconnect */ }
        this.options.onError?.('kook_gateway_connection_failed');
      }
      if (exit === 'aborted' || signal?.aborted) return;
      if (exit === 'reset') {
        failureCount = 0;
        continue;
      }
      failureCount += 1;
      const exponent = Math.min(failureCount - 1, 20);
      const backoff = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * 2 ** exponent);
      const sample = this.random();
      const jitter = Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 1) : 0.5;
      await delay(Math.round(backoff * (0.8 + 0.4 * jitter)), signal);
    }
  }

  private connectOnce(url: string, priorState: KookGatewaySessionState, signal?: AbortSignal): Promise<SessionExit> {
    let socket: KookGatewaySocket;
    try { socket = this.options.socketFactory(url); } catch { return Promise.resolve('closed'); }
    return new Promise((resolve) => {
      let settled = false;
      let ready = false;
      let sessionId = priorState.sessionId;
      let lastSn = priorState.lastSn;
      let resumeRequestedForSn: number | null = null;
      let messageChain = Promise.resolve();
      let queuedFrames = 0;
      const pending = new Map<number, unknown>();
      let helloTimer: ReturnType<typeof setTimeout> | undefined;
      let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
      let pongTimer: ReturnType<typeof setTimeout> | undefined;
      let connectionReported = false;

      const reportConnection = (connected: boolean) => {
        if (connectionReported === connected) return;
        connectionReported = connected;
        try { this.options.onConnectionStatus?.(connected ? 'connected' : 'disconnected'); }
        catch { /* health observation cannot change the gateway state */ }
      };

      const clearTimers = () => {
        if (helloTimer) clearTimeout(helloTimer);
        if (heartbeatTimer) clearTimeout(heartbeatTimer);
        if (pongTimer) clearTimeout(pongTimer);
        reportConnection(false);
      };
      const finish = (exit: SessionExit, code?: string) => {
        if (settled) return;
        settled = true;
        clearTimers();
        signal?.removeEventListener('abort', onAbort);
        if (code) { try { this.options.onError?.(code); } catch { /* observation cannot block shutdown */ } }
        try { socket.close(); } catch { /* no further transport action */ }
        // Drain any in-flight durable state write before the process closes PG.
        void messageChain.finally(() => resolve(exit));
      };
      const onAbort = () => finish('aborted');
      const scheduleHeartbeat = () => {
        if (settled || !ready) return;
        if (heartbeatTimer) clearTimeout(heartbeatTimer);
        const sample = this.random();
        const jitter = Number.isFinite(sample) ? (Math.min(Math.max(sample, 0), 1) * 2 - 1) : 0;
        const waitMs = Math.max(1, Math.round(this.heartbeatIntervalMs + jitter * this.heartbeatJitterMs));
        heartbeatTimer = setTimeout(() => {
          if (settled || !ready) return;
          try { socket.send(JSON.stringify({ s: 2, sn: lastSn })); } catch { finish('closed', 'kook_gateway_ping_send_failed'); return; }
          pongTimer = setTimeout(() => finish('closed', 'kook_gateway_pong_timeout'), this.pongTimeoutMs);
        }, waitMs);
      };

      const handleFrame = async (raw: unknown) => {
        if (settled) return;
        let frame: GatewayFrame;
        try { frame = parseFrame(raw); } catch { finish('closed', 'kook_gateway_frame_invalid'); return; }
        if (frame.s === 1) {
          let data: Record<string, unknown>;
          try { data = dataRecord(frame.d); } catch { finish('closed', 'kook_gateway_hello_invalid'); return; }
          if (data.code !== 0) {
            if ([40106, 40107, 40108].includes(Number(data.code))) {
              await this.options.stateStore.clear(this.botAccountId).catch(() => undefined);
              finish('reset', 'kook_gateway_resume_rejected');
            } else {
              finish('closed', 'kook_gateway_hello_rejected');
            }
            return;
          }
          try { sessionId = requiredText(data.session_id, 'session_id', 256); } catch { finish('closed', 'kook_gateway_hello_invalid'); return; }
          ready = true;
          reportConnection(true);
          if (helloTimer) clearTimeout(helloTimer);
          try { await this.options.stateStore.save(this.botAccountId, { sessionId, lastSn }); } catch { finish('closed', 'kook_gateway_state_write_failed'); return; }
          scheduleHeartbeat();
          return;
        }
        if (frame.s === 6) {
          let data: Record<string, unknown>;
          try { data = dataRecord(frame.d); } catch { finish('closed', 'kook_gateway_resume_ack_invalid'); return; }
          if (typeof data.session_id === 'string' && data.session_id.trim()) sessionId = data.session_id.trim();
          ready = true;
          reportConnection(true);
          if (helloTimer) clearTimeout(helloTimer);
          try { await this.options.stateStore.save(this.botAccountId, { sessionId, lastSn }); } catch { finish('closed', 'kook_gateway_state_write_failed'); return; }
          scheduleHeartbeat();
          return;
        }
        if (frame.s === 3) {
          if (pongTimer) clearTimeout(pongTimer);
          pongTimer = undefined;
          scheduleHeartbeat();
          return;
        }
        if (frame.s === 5) {
          pending.clear();
          await this.options.stateStore.clear(this.botAccountId).catch(() => undefined);
          finish('reset');
          return;
        }
        if (frame.s !== 0) return;
        if (!ready || !Number.isSafeInteger(frame.sn) || Number(frame.sn) < 1) {
          finish('closed', 'kook_gateway_event_sequence_invalid');
          return;
        }
        const sn = Number(frame.sn);
        if (sn <= lastSn || pending.has(sn)) return;
        if (sn - lastSn > this.maxBufferedEvents || pending.size >= this.maxBufferedEvents) {
          finish('closed', 'kook_gateway_event_buffer_overflow');
          return;
        }
        pending.set(sn, frame.d);
        if (sn > lastSn + 1 && resumeRequestedForSn !== lastSn) {
          try { socket.send(JSON.stringify({ s: 4, sn: lastSn })); } catch { finish('closed', 'kook_gateway_resume_send_failed'); return; }
          resumeRequestedForSn = lastSn;
        }
        while (pending.has(lastSn + 1) && !settled) {
          const nextSn = lastSn + 1;
          const event = pending.get(nextSn);
          try {
            await this.options.handleEvent(event, nextSn);
            await this.options.stateStore.save(this.botAccountId, { sessionId, lastSn: nextSn });
          } catch {
            finish('closed', 'kook_gateway_event_processing_failed');
            return;
          }
          pending.delete(nextSn);
          lastSn = nextSn;
          if (resumeRequestedForSn !== null && lastSn >= resumeRequestedForSn) resumeRequestedForSn = null;
        }
      };

      socket.addEventListener('open', () => {
        if (helloTimer) clearTimeout(helloTimer);
        helloTimer = setTimeout(() => finish('closed', 'kook_gateway_hello_timeout'), this.helloTimeoutMs);
      });
      socket.addEventListener('message', (event) => {
        if (settled) return;
        if (queuedFrames >= this.maxBufferedEvents) { finish('closed', 'kook_gateway_frame_queue_overflow'); return; }
        queuedFrames += 1;
        messageChain = messageChain.then(() => handleFrame(event.data))
          .catch(() => finish('closed', 'kook_gateway_frame_processing_failed'))
          .finally(() => { queuedFrames -= 1; });
      });
      socket.addEventListener('error', () => finish('closed', 'kook_gateway_socket_error'));
      socket.addEventListener('close', () => finish(signal?.aborted ? 'aborted' : 'closed'));
      signal?.addEventListener('abort', onAbort, { once: true });
      helloTimer = setTimeout(() => finish('closed', 'kook_gateway_connect_timeout'), this.helloTimeoutMs);
      if (signal?.aborted) onAbort();
    });
  }
}
