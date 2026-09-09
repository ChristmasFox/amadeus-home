import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { RadarError } from '../core/errors.js';
import type { ProductRadarService } from '../core/application.js';
import type { SourceAdapterRegistry } from '../sources/registry.js';
import type { SensorClient } from '../sensors/sensor.js';
import type { SqliteRadarStore } from '../storage/sqlite.js';

export interface RadarServerOptions {
  service: ProductRadarService;
  sources: SourceAdapterRegistry;
  sensor: SensorClient;
  store: SqliteRadarStore;
  apiKey?: string;
  maxBodyBytes?: number;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(body);
}

function sendEmpty(response: ServerResponse, status: number): void {
  response.statusCode = status;
  response.end();
}

function errorPayload(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof RadarError) {
    return { status: error.statusCode, body: { error: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) } };
  }
  return { status: 500, body: { error: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) } };
}

async function readBody(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) throw new RadarError('request body too large', 'PAYLOAD_TOO_LARGE', 413);
    chunks.push(buffer);
  }
  if (size === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RadarError('request body must be valid JSON', 'INVALID_JSON', 400);
  }
}

function watchResponse(service: ProductRadarService, watch: ReturnType<ProductRadarService['getWatch']>): unknown {
  if (!watch) return undefined;
  return watch;
}

export function createRadarServer(options: RadarServerOptions): Server {
  const maxBodyBytes = options.maxBodyBytes ?? 1_000_000;
  const server = createServer(async (request, response) => {
    try {
      const method = request.method ?? 'GET';
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      const path = url.pathname.replace(/\/$/u, '') || '/';
      const isWebhook = path === '/api/sensors/changedetection/webhook';
      if (options.apiKey && path.startsWith('/api/') && !isWebhook) {
        const provided = request.headers['x-product-radar-key'] ?? request.headers.authorization?.replace(/^Bearer\s+/iu, '');
        if (provided !== options.apiKey) throw new RadarError('product radar API key required', 'UNAUTHORIZED', 401);
      }

      if (method === 'GET' && path === '/health') {
        const sensor = await options.sensor.health();
        sendJson(response, sensor.ok ? 200 : 503, { status: sensor.ok ? 'ok' : 'degraded', service: 'product-radar', sensor, database: options.store.tableCounts() });
        return;
      }
      if (method === 'GET' && path === '/api/sources') {
        sendJson(response, 200, { sources: options.sources.list().map((source) => options.sources.describe(source)) });
        return;
      }
      const sourceMatch = /^\/api\/sources\/([^/]+)$/u.exec(path);
      if (method === 'GET' && sourceMatch) {
        const source = options.sources.get(decodeURIComponent(sourceMatch[1] ?? ''));
        if (!source) throw new RadarError('source not found', 'NOT_FOUND', 404);
        sendJson(response, 200, options.sources.describe(source));
        return;
      }
      if (method === 'GET' && path === '/api/watches') {
        sendJson(response, 200, { watches: options.service.listWatches() });
        return;
      }
      if (method === 'GET' && path === '/api/search-feeds') {
        sendJson(response, 200, { feeds: options.service.listSearchFeeds() });
        return;
      }
      if (method === 'GET' && path === '/api/watch-contexts') {
        const contextKey = url.searchParams.get('contextKey')?.trim() ?? '';
        if (!contextKey) throw new RadarError('contextKey is required', 'INVALID_REQUEST', 400);
        sendJson(response, 200, { watchId: options.store.getWatchContext(contextKey) ?? null });
        return;
      }
      if (method === 'POST' && path === '/api/watch-contexts') {
        const body = await readBody(request, maxBodyBytes);
        const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
        const contextKey = typeof value.contextKey === 'string' ? value.contextKey.trim() : '';
        const watchId = typeof value.watchId === 'string' ? value.watchId.trim() : '';
        if (!contextKey || !watchId) throw new RadarError('contextKey and watchId are required', 'INVALID_REQUEST', 400);
        if (!options.service.getWatch(watchId)) throw new RadarError('watch not found', 'NOT_FOUND', 404);
        options.store.setWatchContext(contextKey, watchId, new Date().toISOString());
        sendJson(response, 200, { contextKey, watchId });
        return;
      }
      if (method === 'DELETE' && path === '/api/watch-contexts') {
        const contextKey = url.searchParams.get('contextKey')?.trim() ?? '';
        if (!contextKey) throw new RadarError('contextKey is required', 'INVALID_REQUEST', 400);
        options.store.clearWatchContext(contextKey);
        sendJson(response, 200, { cleared: true });
        return;
      }
      if (method === 'POST' && path === '/api/usage') {
        const body = await readBody(request, maxBodyBytes);
        const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
        const watchId = typeof value.watchId === 'string' ? value.watchId.trim() : '';
        const provider = typeof value.provider === 'string' ? value.provider.trim() : '';
        const model = typeof value.model === 'string' ? value.model.trim() : '';
        const operation = typeof value.operation === 'string' ? value.operation.trim() : '';
        if (!watchId || !provider || !model || !operation) throw new RadarError('usage requires watchId, provider, model, and operation', 'INVALID_REQUEST', 400);
        if (!options.service.getWatch(watchId)) throw new RadarError('watch not found', 'NOT_FOUND', 404);
        const nonNegative = (name: string, fallback = 0): number => {
          const candidate = value[name];
          if (candidate === undefined) return fallback;
          if (typeof candidate !== 'number' || !Number.isInteger(candidate) || candidate < 0) throw new RadarError(`${name} must be a non-negative integer`, 'INVALID_REQUEST', 400);
          return candidate;
        };
        const latencyMs = value.latencyMs === undefined ? undefined : nonNegative('latencyMs');
        const entry = options.store.recordUsage({
          ...(typeof value.id === 'string' && value.id.trim() ? { id: value.id.trim() } : {}),
          watchId, provider, model, operation,
          inputTokens: nonNegative('inputTokens'), outputTokens: nonNegative('outputTokens'), totalTokens: nonNegative('totalTokens'),
          timestamp: typeof value.timestamp === 'string' && value.timestamp.trim() ? value.timestamp : new Date().toISOString(),
          inferenceCount: nonNegative('inferenceCount'), imagesProcessed: nonNegative('imagesProcessed'),
          ...(latencyMs === undefined ? {} : { latencyMs }),
        });
        sendJson(response, 201, entry);
        return;
      }
      if (method === 'POST' && path === '/api/watches/preview') {
        const body = await readBody(request, maxBodyBytes);
        sendJson(response, 200, await options.service.previewWatch(body));
        return;
      }
      if (method === 'POST' && path === '/api/watches') {
        const body = await readBody(request, maxBodyBytes);
        sendJson(response, 201, await options.service.createWatch(body));
        return;
      }
      const testListingMatch = /^\/api\/watches\/([^/]+)\/test-listing$/u.exec(path);
      if (method === 'POST' && testListingMatch) {
        const body = await readBody(request, maxBodyBytes);
        sendJson(response, 202, await options.service.injectTestListing(decodeURIComponent(testListingMatch[1] ?? ''), body));
        return;
      }
      const watchMatch = /^\/api\/watches\/([^/]+)(?:\/(run|pause|resume|status|stats|usage))?$/u.exec(path);
      if (watchMatch) {
        const watchId = decodeURIComponent(watchMatch[1] ?? '');
        const action = watchMatch[2];
        if (method === 'GET' && !action) {
          const watch = options.service.getWatch(watchId);
          if (!watch) throw new RadarError('watch not found', 'NOT_FOUND', 404);
          sendJson(response, 200, watchResponse(options.service, watch));
          return;
        }
        if (method === 'GET' && (action === 'status' || action === 'stats')) {
          sendJson(response, 200, options.service.getWatchObservability(watchId));
          return;
        }
        if (method === 'GET' && action === 'usage') {
          if (!options.service.getWatch(watchId)) throw new RadarError('watch not found', 'NOT_FOUND', 404);
          sendJson(response, 200, { summary: options.store.summarizeUsage(watchId), entries: options.store.listUsage(watchId) });
          return;
        }
        if (method === 'PATCH' && !action) {
          const body = await readBody(request, maxBodyBytes);
          sendJson(response, 200, await options.service.patchWatch(watchId, body));
          return;
        }
        if (method === 'DELETE' && !action) {
          await options.service.deleteWatch(watchId);
          sendJson(response, 200, { deleted: true, id: watchId });
          return;
        }
        if (method === 'POST' && action === 'run') {
          sendJson(response, 200, await options.service.runWatch(watchId));
          return;
        }
        if (method === 'POST' && action === 'pause') {
          sendJson(response, 200, await options.service.pauseWatch(watchId));
          return;
        }
        if (method === 'POST' && action === 'resume') {
          sendJson(response, 200, await options.service.resumeWatch(watchId));
          return;
        }
      }
      if (method === 'POST' && isWebhook) {
        const body = await readBody(request, maxBodyBytes);
        sendJson(response, 202, await options.service.handleSensorWebhook(body));
        return;
      }
      throw new RadarError('route not found', 'NOT_FOUND', 404);
    } catch (error) {
      const result = errorPayload(error);
      sendJson(response, result.status, result.body);
    }
  });
  return server;
}
