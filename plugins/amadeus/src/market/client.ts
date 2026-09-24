import type { AmadeusConfig } from '../config.js';
import { requestJson } from '../http.js';
import { LongbridgeOAuth } from './auth.js';

/**
 * Narrow read-only seam over Longbridge's quote APIs. There is deliberately no
 * generic path or trade/account method here: adding one would widen the
 * OpenClaw capability boundary.
 */
export interface LongbridgeClient {
  quote(symbols: string[], signal?: AbortSignal): Promise<unknown>;
  intraday(symbol: string, signal?: AbortSignal): Promise<unknown>;
  tradingSession(signal?: AbortSignal): Promise<unknown>;
  tradingDays(market: string, start?: string, end?: string, signal?: AbortSignal): Promise<unknown>;
  marketTemperature(market: string, signal?: AbortSignal): Promise<unknown>;
  movers(market: string, signal?: AbortSignal): Promise<unknown>;
  indexConstituents(symbol: string, signal?: AbortSignal): Promise<unknown>;
}

function pathFor(path: string, query: Record<string, string | string[] | undefined> = {}): string {
  const url = new URL(path, 'https://openapi.longbridge.com');
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    url.searchParams.set(key, Array.isArray(value) ? value.join(',') : value);
  }
  return url.pathname + url.search;
}

export function createLongbridgeClient(config: AmadeusConfig, oauth = new LongbridgeOAuth(config)): LongbridgeClient {
  const request = async (path: string, query: Record<string, string | string[] | undefined>, signal?: AbortSignal): Promise<unknown> => {
    const token = await oauth.accessToken();
    const url = `${config.longbridgeApiBaseUrl}${pathFor(path, query)}`;
    return requestJson(url, { signal, timeoutMs: 15_000, headers: { Authorization: `Bearer ${token}` }, includeErrorDetail: false });
  };
  return {
    quote: (symbols, signal) => request('/v1/quote/quote', { symbol: symbols }, signal),
    intraday: (symbol, signal) => request('/v1/quote/intraday', { symbol }, signal),
    tradingSession: (signal) => request('/v1/quote/trading-session', {}, signal),
    tradingDays: (market, start, end, signal) => request('/v1/quote/trading-days', { market, start, end }, signal),
    marketTemperature: (market, signal) => request('/v1/quote/market-temperature', { market }, signal),
    movers: (market, signal) => request('/v1/quote/movers', { market }, signal),
    indexConstituents: (symbol, signal) => request('/v1/quote/index-constituents', { symbol }, signal),
  };
}
