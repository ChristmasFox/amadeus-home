import type { AmadeusConfig } from '../config.js';
import { readRequiredFile } from '../config.js';
import { LongbridgeOAuth } from './auth.js';

/**
 * Narrow read-only seam over the official Longbridge SDK. There is
 * deliberately no generic HTTP path or trade/account context here: adding
 * one would widen the OpenClaw capability boundary.
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

type LongbridgeSdk = typeof import('longbridge');
type SdkContexts = {
  sdk: LongbridgeSdk;
  quote: InstanceType<LongbridgeSdk['QuoteContext']>;
  market: InstanceType<LongbridgeSdk['MarketContext']>;
};

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  if (value && typeof value === 'object') {
    const candidate = value as { toNumber?: unknown; toString?: unknown };
    if (typeof candidate.toNumber === 'function') {
      const number = (candidate.toNumber as () => unknown)();
      if (typeof number === 'number' && Number.isFinite(number)) return number;
    }
    if (typeof candidate.toString === 'function') {
      const text = (candidate.toString as () => unknown)();
      if (typeof text === 'string' && text.trim() && Number.isFinite(Number(text))) return Number(text);
    }
  }
  return null;
}

function isoTimestamp(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  const numeric = numberValue(value);
  return numeric === null ? null : new Date(numeric * 1000).toISOString();
}

function dateParts(date: Date): [number, number, number] {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
  return [
    Number(parts.find((part) => part.type === 'year')?.value ?? 0),
    Number(parts.find((part) => part.type === 'month')?.value ?? 0),
    Number(parts.find((part) => part.type === 'day')?.value ?? 0),
  ];
}

function dateText(date: Date): string {
  const [year, month, day] = dateParts(date);
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function sdkDate(sdk: LongbridgeSdk, value: string): InstanceType<LongbridgeSdk['NaiveDate']> {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) throw new Error(`invalid Longbridge trading-day date: ${value}`);
  return new sdk.NaiveDate(year, month, day);
}

function calendarRange(start?: string, end?: string): { start: string; end: string } {
  if (start && end) return { start, end };
  const now = new Date();
  const begin = new Date(now);
  begin.setUTCDate(begin.getUTCDate() - 370);
  const finish = new Date(now);
  finish.setUTCDate(finish.getUTCDate() + 370);
  return { start: start ?? dateText(begin), end: end ?? dateText(finish) };
}

function timeText(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const time = value as { hour?: unknown; minute?: unknown; second?: unknown };
  const hour = numberValue(time.hour);
  const minute = numberValue(time.minute);
  const second = numberValue(time.second) ?? 0;
  if (hour === null || minute === null) return null;
  return `${Math.trunc(hour).toString().padStart(2, '0')}${Math.trunc(minute).toString().padStart(2, '0')}${Math.trunc(second).toString().padStart(2, '0')}`;
}

function marketCode(sdk: LongbridgeSdk, market: string): number {
  if (market.toUpperCase() !== 'US') throw new Error(`Longbridge market is restricted to US, received ${market}`);
  return sdk.Market.US;
}

function guard(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Longbridge request aborted');
}

export function createLongbridgeClient(config: AmadeusConfig, oauth = new LongbridgeOAuth(config)): LongbridgeClient {
  let contextsPromise: Promise<SdkContexts> | undefined;
  const contexts = async (): Promise<SdkContexts> => {
    contextsPromise ??= (async () => {
      const clientId = await readRequiredFile(config.longbridgeClientIdFile, 'Longbridge OAuth client id');
      const sdk = await import('longbridge');
      const sdkOAuth = await sdk.OAuth.build(clientId, (error) => {
        if (error) throw error;
        throw new Error('longbridge_oauth_reauthorization_required');
      });
      const sdkConfig = sdk.Config.fromOAuth(sdkOAuth);
      return { sdk, quote: sdk.QuoteContext.new(sdkConfig), market: sdk.MarketContext.new(sdkConfig) };
    })();
    try { return await contextsPromise; } catch (error) { contextsPromise = undefined; throw error; }
  };
  const call = async <T>(signal: AbortSignal | undefined, fn: (contexts: SdkContexts) => Promise<T>): Promise<T> => {
    guard(signal);
    const result = await fn(await contexts());
    await oauth.syncSdkCache();
    guard(signal);
    return result;
  };
  return {
    quote: (symbols, signal) => call(signal, async ({ quote }) => {
      const rows = await quote.quote(symbols);
      return { data: { secu_quote: rows.map((row) => ({
        symbol: row.symbol,
        last_done: numberValue(row.lastDone),
        prev_close: numberValue(row.prevClose),
        open: numberValue(row.open),
        high: numberValue(row.high),
        low: numberValue(row.low),
        volume: row.volume,
        turnover: numberValue(row.turnover),
        timestamp: isoTimestamp(row.timestamp),
        trade_status: row.tradeStatus,
      })) } };
    }),
    intraday: (symbol, signal) => call(signal, async ({ sdk, quote }) => {
      const rows = await quote.intraday(symbol, sdk.TradeSessions.Intraday);
      return { data: { lines: rows.map((row) => ({ price: numberValue(row.price), timestamp: isoTimestamp(row.timestamp), volume: row.volume, turnover: numberValue(row.turnover) })) } };
    }),
    tradingSession: (signal) => call(signal, async ({ sdk, quote }) => {
      const rows = await quote.tradingSession();
      return { data: { market_trade_session: rows.map((row) => ({
        market: row.market === sdk.Market.US ? 'US' : String(row.market),
        trade_session: row.tradeSessions.map((session) => ({
          trade_session: session.tradeSession,
          beg_time: timeText(session.beginTime),
          end_time: timeText(session.endTime),
        })),
      })) } };
    }),
    tradingDays: (market, start, end, signal) => call(signal, async ({ sdk, quote }) => {
      const range = calendarRange(start, end);
      const rows = await quote.tradingDays(marketCode(sdk, market), sdkDate(sdk, range.start), sdkDate(sdk, range.end));
      const text = (value: unknown): string | null => {
        if (!value || typeof value !== 'object') return null;
        const date = value as { year?: unknown; month?: unknown; day?: unknown };
        const year = numberValue(date.year);
        const month = numberValue(date.month);
        const day = numberValue(date.day);
        return year === null || month === null || day === null ? null : `${Math.trunc(year).toString().padStart(4, '0')}-${Math.trunc(month).toString().padStart(2, '0')}-${Math.trunc(day).toString().padStart(2, '0')}`;
      };
      return { data: { trading_days: rows.tradingDays.flatMap((item) => { const value = text(item); return value ? [value] : []; }), half_trading_days: rows.halfTradingDays.flatMap((item) => { const value = text(item); return value ? [value] : []; }) } };
    }),
    marketTemperature: (market, signal) => call(signal, async ({ sdk, quote }) => {
      const value = await quote.marketTemperature(marketCode(sdk, market));
      return { data: { temperature: value.temperature, description: value.description, valuation: value.valuation, sentiment: value.sentiment, timestamp: isoTimestamp(value.timestamp) } };
    }),
    movers: (market, signal) => call(signal, async ({ market: marketContext }) => {
      const rows = await marketContext.topMovers([market.toUpperCase()], 0, null, 20);
      return { data: { movers: rows.events.map((event) => { const change = numberValue(event.stock.change); return { symbol: event.stock.symbol, name: event.stock.name, change_percent: change === null ? null : change * 100 }; }) } };
    }),
    indexConstituents: (symbol, signal) => call(signal, async ({ market: marketContext }) => {
      const value = await marketContext.constituent(symbol);
      return { data: { constituents: value.stocks.map((stock) => ({ symbol: stock.symbol, name: stock.name, weight: null })) } };
    }),
  };
}
