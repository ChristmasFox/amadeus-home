import type { AmadeusConfig } from '../config.js';
import { adaptWorldlineNotification } from '@agent/presentation';
import { LongbridgeOAuth } from './auth.js';
import { createLongbridgeClient, type LongbridgeClient } from './client.js';
import { buildMarketNotification } from './presentation.js';
import { DEFAULT_INDEX_SYMBOLS, normalizeSymbol, normalizeSymbols } from './symbols.js';
import { intradayResult, normalizeConstituents, normalizeMovers, normalizeQuote, normalizeSession, normalizeTradingDays } from './normalize.js';
import type { MarketFailure, MarketOverview, MarketQuote, MarketSession } from './types.js';

function labelsFor(symbols: ReturnType<typeof normalizeSymbols>): Map<string, string> {
  return new Map(symbols.map((item) => [item.symbol, item.label]));
}

function failure(status: MarketFailure['status'], auth: Awaited<ReturnType<LongbridgeOAuth['status']>>, message: string): MarketFailure {
  return { status, provider: 'longbridge', auth, message };
}

function today(timezone = 'America/New_York', now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export class MarketService {
  private readonly oauth: LongbridgeOAuth;
  private readonly client: LongbridgeClient;
  constructor(private readonly config: AmadeusConfig, client?: LongbridgeClient, oauth?: LongbridgeOAuth) {
    this.oauth = oauth ?? new LongbridgeOAuth(config);
    this.client = client ?? createLongbridgeClient(config, this.oauth);
  }

  async authStatus() { return this.oauth.status(); }

  async quote(inputs: string[], signal?: AbortSignal): Promise<MarketQuote[] | MarketFailure> {
    const symbols = normalizeSymbols(inputs);
    const auth = await this.oauth.ensureReady();
    if (auth.status !== 'ready') return failure('longbridge_oauth_reauthorization_required', auth, auth.message ?? 'Longbridge OAuth authorization is required');
    try { return normalizeQuote(await this.client.quote(symbols.map((item) => item.symbol), signal), labelsFor(symbols)); }
    catch (error) { return failure('longbridge_unavailable', auth, error instanceof Error ? error.message : String(error)); }
  }

  async overview(signal?: AbortSignal, phase?: 'open' | 'close'): Promise<MarketOverview | MarketFailure> {
    const symbols = DEFAULT_INDEX_SYMBOLS.map((symbol) => normalizeSymbol(symbol));
    const auth = await this.oauth.ensureReady();
    if (auth.status !== 'ready') return failure('longbridge_oauth_reauthorization_required', auth, auth.message ?? 'Longbridge OAuth authorization is required');
    try {
      const [quotePayload, sessionPayload, tradingDaysPayload, temperaturePayload, moversPayload] = await Promise.all([
        this.client.quote(symbols.map((item) => item.symbol), signal),
        this.client.tradingSession(signal),
        this.client.tradingDays('US', undefined, undefined, signal),
        this.client.marketTemperature('US', signal).catch(() => undefined),
        this.client.movers('US', signal).catch(() => undefined),
      ]);
      const labels = labelsFor(symbols);
      const quotes = normalizeQuote(quotePayload, labels);
      const session = normalizeSession(sessionPayload, new Date(), 'America/New_York', normalizeTradingDays(tradingDaysPayload));
      if (phase && (!session.isTradingDay || (phase === 'open' && session.state !== 'open') || (phase === 'close' && (session.state === 'pre' || session.state === 'open')))) {
        return failure('market_closed', auth, session.reason ?? `Longbridge US session is not valid for ${phase}`);
      }
      const dataUpdatedAt = new Date().toISOString();
      const temperatureValue = temperaturePayload && typeof temperaturePayload === 'object' ? Number((temperaturePayload as Record<string, unknown>).temperature ?? ((temperaturePayload as Record<string, unknown>).data as Record<string, unknown> | undefined)?.temperature) : null;
      const notification = phase ? buildMarketNotification(phase, today(), quotes, dataUpdatedAt) : undefined;
      return { status: 'ok', provider: 'longbridge', auth, market: 'US', session, quotes, temperature: Number.isFinite(temperatureValue) ? temperatureValue : null, movers: normalizeMovers(moversPayload, labels), dataUpdatedAt, ...(notification ? { notification } : {}) };
    } catch (error) { return failure('longbridge_unavailable', auth, error instanceof Error ? error.message : String(error)); }
  }

  async intraday(input: string, signal?: AbortSignal) {
    const symbol = normalizeSymbol(input);
    const auth = await this.oauth.ensureReady();
    if (auth.status !== 'ready') return failure('longbridge_oauth_reauthorization_required', auth, auth.message ?? 'Longbridge OAuth authorization is required');
    try { return { status: 'ok' as const, provider: 'longbridge' as const, auth, data: intradayResult(await this.client.intraday(symbol.symbol, signal), symbol.symbol, symbol.label) }; }
    catch (error) { return failure('longbridge_unavailable', auth, error instanceof Error ? error.message : String(error)); }
  }

  async session(signal?: AbortSignal): Promise<MarketSession | MarketFailure> {
    const auth = await this.oauth.ensureReady();
    if (auth.status !== 'ready') return failure('longbridge_oauth_reauthorization_required', auth, auth.message ?? 'Longbridge OAuth authorization is required');
    try {
      const [sessionPayload, calendarPayload] = await Promise.all([this.client.tradingSession(signal), this.client.tradingDays('US', undefined, undefined, signal)]);
      return normalizeSession(sessionPayload, new Date(), 'America/New_York', normalizeTradingDays(calendarPayload));
    }
    catch (error) { return failure('longbridge_unavailable', auth, error instanceof Error ? error.message : String(error)); }
  }

  async tradingDays(signal?: AbortSignal) {
    const auth = await this.oauth.ensureReady();
    if (auth.status !== 'ready') return failure('longbridge_oauth_reauthorization_required', auth, auth.message ?? 'Longbridge OAuth authorization is required');
    try { return { status: 'ok' as const, provider: 'longbridge' as const, auth, ...normalizeTradingDays(await this.client.tradingDays('US', undefined, undefined, signal)) }; }
    catch (error) { return failure('longbridge_unavailable', auth, error instanceof Error ? error.message : String(error)); }
  }

  async movers(signal?: AbortSignal) {
    const auth = await this.oauth.ensureReady();
    if (auth.status !== 'ready') return failure('longbridge_oauth_reauthorization_required', auth, auth.message ?? 'Longbridge OAuth authorization is required');
    try { return { status: 'ok' as const, provider: 'longbridge' as const, auth, market: 'US', movers: normalizeMovers(await this.client.movers('US', signal)) }; }
    catch (error) { return failure('longbridge_unavailable', auth, error instanceof Error ? error.message : String(error)); }
  }

  async constituents(input: string, signal?: AbortSignal) {
    const symbol = normalizeSymbol(input);
    if (symbol.kind !== 'index') throw new Error('index constituents require an index symbol');
    const auth = await this.oauth.ensureReady();
    if (auth.status !== 'ready') return failure('longbridge_oauth_reauthorization_required', auth, auth.message ?? 'Longbridge OAuth authorization is required');
    try { return { status: 'ok' as const, provider: 'longbridge' as const, auth, symbol: symbol.symbol, constituents: normalizeConstituents(await this.client.indexConstituents(symbol.symbol, signal)) }; }
    catch (error) { return failure('longbridge_unavailable', auth, error instanceof Error ? error.message : String(error)); }
  }
}

export function ownerMarketNotification(value: MarketOverview): ReturnType<typeof adaptWorldlineNotification> { return value.notification ?? buildMarketNotification('close', today(), value.quotes, value.dataUpdatedAt); }
