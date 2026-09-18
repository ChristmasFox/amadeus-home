import { readOptionalFile, type AmadeusConfig } from './config.js';
import { requestJson } from './http.js';

export type ProductRadarAction =
  | 'preview' | 'create' | 'list' | 'get' | 'update' | 'delete' | 'pause' | 'resume'
  | 'status' | 'stats' | 'usage' | 'run' | 'context_get' | 'context_set' | 'context_clear';

export interface ProductRadarRequest {
  action: ProductRadarAction;
  watchId?: string;
  body?: Record<string, unknown>;
  contextKey?: string;
}

function requiredId(value: string | undefined): string {
  const id = value?.trim() ?? '';
  if (!id || id.length > 256) throw new Error('watchId is required and must be bounded');
  return encodeURIComponent(id);
}

export async function productRadar(config: AmadeusConfig, input: ProductRadarRequest, signal?: AbortSignal): Promise<unknown> {
  const apiKey = await readOptionalFile(config.productRadarApiKeyFile);
  const headers = apiKey ? { 'X-Product-Radar-Key': apiKey } : undefined;
  const body = input.body ?? {};
  let method = 'GET';
  let path = '/api/watches';
  let requestBody: Record<string, unknown> | undefined;
  switch (input.action) {
    case 'preview': path = '/api/watches/preview'; method = 'POST'; requestBody = body; break;
    case 'create': path = '/api/watches'; method = 'POST'; requestBody = body; break;
    case 'list': path = '/api/watches'; break;
    case 'get': path = `/api/watches/${requiredId(input.watchId)}`; break;
    case 'update': path = `/api/watches/${requiredId(input.watchId)}`; method = 'PATCH'; requestBody = body; break;
    case 'delete': path = `/api/watches/${requiredId(input.watchId)}`; method = 'DELETE'; break;
    case 'pause': path = `/api/watches/${requiredId(input.watchId)}/pause`; method = 'POST'; break;
    case 'resume': path = `/api/watches/${requiredId(input.watchId)}/resume`; method = 'POST'; break;
    case 'status': path = `/api/watches/${requiredId(input.watchId)}/status`; break;
    case 'stats': path = `/api/watches/${requiredId(input.watchId)}/stats`; break;
    case 'usage': path = `/api/watches/${requiredId(input.watchId)}/usage`; break;
    case 'run': path = `/api/watches/${requiredId(input.watchId)}/run`; method = 'POST'; break;
    case 'context_get': {
      const key = input.contextKey?.trim();
      if (!key || key.length > 512) throw new Error('contextKey is required and must be bounded');
      path = `/api/watch-contexts?contextKey=${encodeURIComponent(key)}`;
      break;
    }
    case 'context_set': {
      const key = input.contextKey?.trim();
      const watchId = input.watchId?.trim();
      if (!key || !watchId) throw new Error('context_set requires contextKey and watchId');
      path = '/api/watch-contexts'; method = 'POST'; requestBody = { contextKey: key, watchId };
      break;
    }
    case 'context_clear': {
      const key = input.contextKey?.trim();
      if (!key) throw new Error('context_clear requires contextKey');
      path = `/api/watch-contexts?contextKey=${encodeURIComponent(key)}`; method = 'DELETE';
      break;
    }
    default: throw new Error(`unsupported Product Radar action: ${String(input.action)}`);
  }
  return requestJson(`${config.productRadarBaseUrl}${path}`, { method, ...(headers ? { headers } : {}), ...(requestBody === undefined ? {} : { body: requestBody }), ...(signal ? { signal } : {}), timeoutMs: 60_000 });
}
