import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { JsonContextStore } from './context/context-store.js';
import { N8nDataProvider } from './data/provider.js';
import { PubgMastraRuntime } from './runtime/workflow.js';
import { DEFAULT_TEAM } from './config/team.js';
import { JsonSelectionStore } from './review/selection-store.js';
import { DEFAULT_REVIEW_FEATURE_VERSION, DEFAULT_TELEMETRY_PARSER_VERSION, JsonTelemetryFeatureStore, N8nTelemetryDownloader, PubgApiTelemetryDownloader, TelemetryWorker } from './review/telemetry.js';
import type { NormalizedBotMessage } from './platform/core/contracts.js';
import type { RuntimeRequest } from './runtime/types.js';
import { HomeHubRuntime } from './runtime/homehub-runtime.js';
import { identityMappingsFromEnvironment } from './config/identity.js';
import { IdentityRegistry } from './platform/core/identity.js';

const port = Number(process.env.PUBG_QUERY_ENGINE_PORT ?? 5310);
const host = process.env.PUBG_QUERY_ENGINE_HOST ?? '0.0.0.0';
const stateFile = process.env.PUBG_STATE_FILE ?? new URL('../data/state.json', import.meta.url).pathname;
const n8nUrl = process.env.PUBG_N8N_DATA_URL ?? 'http://n8n:5678/webhook/pubg-query-data-v3';
const featureFile = process.env.PUBG_FEATURE_STATE_FILE ?? `${stateFile}.features.json`;
const selectionFile = process.env.PUBG_SELECTION_STATE_FILE ?? `${stateFile}.selections.json`;
const telemetryUrl = process.env.PUBG_TELEMETRY_URL ?? '';

function readSecretFile(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

const telemetryApiKey = (process.env.PUBG_API_KEY_FILE ? readSecretFile(process.env.PUBG_API_KEY_FILE) : '')
  || process.env.PUBG_API_KEY
  || '';
const telemetryDownloader = telemetryUrl
  ? new N8nTelemetryDownloader({ url: telemetryUrl, timeoutMs: Number(process.env.PUBG_TELEMETRY_TIMEOUT_MS ?? 120_000) })
  : telemetryApiKey
    ? new PubgApiTelemetryDownloader({ apiKey: telemetryApiKey, timeoutMs: Number(process.env.PUBG_TELEMETRY_TIMEOUT_MS ?? 60_000) })
    : undefined;
const telemetryWorker = new TelemetryWorker({
  team: DEFAULT_TEAM,
  store: new JsonTelemetryFeatureStore(featureFile),
  parserVersion: process.env.PUBG_TELEMETRY_PARSER_VERSION ?? DEFAULT_TELEMETRY_PARSER_VERSION,
  featureVersion: process.env.PUBG_REVIEW_FEATURE_VERSION ?? DEFAULT_REVIEW_FEATURE_VERSION,
  ...(telemetryDownloader ? { downloader: telemetryDownloader } : {}),
});

const identityRegistry = new IdentityRegistry(identityMappingsFromEnvironment());
const runtime = new PubgMastraRuntime({
  provider: new N8nDataProvider({ url: n8nUrl, timeoutMs: Number(process.env.PUBG_N8N_TIMEOUT_MS ?? 120000) }),
  contextStore: new JsonContextStore(stateFile),
  identityRegistry,
  telemetryWorker,
  selectionStore: new JsonSelectionStore(selectionFile),
  resultSetTtlMs: Number(process.env.PUBG_RESULTSET_TTL_MS ?? 24 * 60 * 60 * 1000),
});

const homehubRuntime = new HomeHubRuntime({ identityRegistry });

function json(response: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('content-length', Buffer.byteLength(payload));
  response.end(payload);
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) throw new Error('request body too large');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('request body must be an object');
  return value as Record<string, unknown>;
}

function runtimeRequest(body: Record<string, unknown>): RuntimeRequest {
  const message = body.message && typeof body.message === 'object' && !Array.isArray(body.message)
    ? body.message as NormalizedBotMessage
    : undefined;
  const messageText = message?.message?.text;
  return {
    text: String(body.text ?? body.query ?? messageText ?? (typeof body.message === 'string' ? body.message : undefined) ?? body.chatInput ?? '今日战绩'),
    ...(message ? { message } : {}),
    ...(body.botId ? { botId: String(body.botId) } : {}),
    ...(body.messageId ? { messageId: String(body.messageId) } : {}),
    ...(body.replyToMessageId !== undefined ? { replyToMessageId: body.replyToMessageId === null ? null : String(body.replyToMessageId) } : {}),
    platform: body.platform ? String(body.platform) : 'kook',
    launcherType: String(body.launcherType ?? body.launcher_type ?? 'unknown'),
    launcherId: String(body.launcherId ?? body.launcher_id ?? 'unknown'),
    senderId: String(body.senderId ?? body.sender_id ?? 'unknown'),
    ...(body.queryId || body.query_id ? { queryId: String(body.queryId ?? body.query_id) } : {}),
    ...(body.now ? { now: String(body.now) } : {}),
    ...(body.callbackData || body.callback_data ? { callbackData: String(body.callbackData ?? body.callback_data) } : {}),
    ...(body.callbackId || body.callback_id ? { callbackId: String(body.callbackId ?? body.callback_id) } : {}),
    ...(body.queryPlan || body.query_plan ? { providedQuery: body.queryPlan ?? body.query_plan } : {}),
  };
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (request.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/')) {
      json(response, 200, { status: 'ok', service: 'pubg-query-engine-v3', runtime: 'mastra', workflow: 'pubg-query-runtime-v3', review: 'v3.3' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/homehub/telegram/polling') {
      const polling = {
        lastSuccessfulPollAt: process.env.HOMEHUB_TELEGRAM_LAST_POLL_AT
          ? new Date(process.env.HOMEHUB_TELEGRAM_LAST_POLL_AT).toISOString()
          : null,
        health: 'ok',
      };
      json(response, 200, polling);
      return;
    }
    if (request.method === 'POST' && ['/homehub/route', '/api/homehub/route'].includes(url.pathname)) {
      const body = await readBody(request);
      const text = String(body.text ?? (body.message && typeof body.message === 'object' ? (body.message as { message?: { text?: unknown } }).message?.text : undefined) ?? '');
      json(response, 200, {
        domain: homehubRuntime.classify(text) ? 'homehub' : 'unknown',
        route: homehubRuntime.classify(text) ? 'mandatory' : 'pass',
        reason: homehubRuntime.classify(text) ? 'homehub_signal' : 'no_homehub_signal',
        contextActive: false,
        sessionId: String(body.sessionId ?? body.sender_id ?? 'unknown'),
      });
      return;
    }
    if (request.method === 'POST' && [
      '/whoami', '/api/whoami',
      '/homehub/whoami', '/api/homehub/whoami',
      '/v3/whoami', '/api/v3/whoami',
    ].includes(url.pathname)) {
      const body = await readBody(request);
      const result = await runtime.whoami(runtimeRequest(body));
      json(response, 200, result);
      return;
    }
    if (request.method === 'POST' && ['/homehub/authorize', '/api/homehub/authorize'].includes(url.pathname)) {
      const body = await readBody(request);
      const result = homehubRuntime.authorize(
        runtimeRequest(body),
        String(body.serviceId ?? body.service_id ?? ''),
        String(body.action ?? ''),
        body.confirmed === true,
      );
      json(response, 200, result);
      return;
    }
    if (request.method === 'POST' && ['/homehub/query', '/api/homehub/query'].includes(url.pathname)) {
      const body = await readBody(request);
      const result = await homehubRuntime.handle(runtimeRequest(body));
      json(response, 200, result);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/homehub/health') {
      const health = homehubRuntime.healthCheck();
      json(response, 200, { status: health.status, service: 'homehub-v1', components: health.components });
      return;
    }
    if (request.method === 'GET' && (url.pathname === '/status' || url.pathname === '/homehub/status')) {
      const health = await homehubRuntime.status();
      json(response, 200, { status: 'ok', service: 'homehub-v1', health });
      return;
    }
    if (request.method === 'POST' && ['/v3/route', '/api/v3/route'].includes(url.pathname)) {
      const body = await readBody(request);
      const route = await runtime.route(runtimeRequest(body));
      json(response, 200, route);
      return;
    }
    if (request.method !== 'POST' || !['/v3/query', '/api/v3/query', '/v3/callback', '/api/v3/callback', '/query'].includes(url.pathname)) {
      json(response, 404, { error: 'not_found' });
      return;
    }
    const body = await readBody(request);
    const runtimeInput = runtimeRequest(body);
    const route = runtimeInput.callbackData ? null : await runtime.route(runtimeInput);
    if (route?.domain === 'homehub') {
      const result = await homehubRuntime.handle(runtimeInput);
      json(response, 200, result);
      return;
    }
    const result = await runtime.handle(runtimeInput);
    json(response, 200, result);
  } catch (error) {
    json(response, 400, { status: 'INVALID_QUERY', error: error instanceof Error ? error.message : 'request_failed' });
  }
});

server.listen(port, host, () => {
  console.log(JSON.stringify({ service: 'pubg-query-engine-v3', runtime: 'mastra', host, port, n8nUrl, stateFile }));
});

function shutdown(): void {
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
