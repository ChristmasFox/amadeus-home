import { directionFor } from './format.js';
import type { IntradayPoint, MarketConstituent, MarketMover, MarketQuote, MarketSession } from './types.js';

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function number(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function scalarText(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : text(value);
}

function sessionName(value: unknown): string {
  const raw = scalarText(value);
  if (raw === '1') return 'pre';
  if (raw === '2') return 'post';
  if (raw === '0') return 'regular';
  return raw ?? 'regular';
}

function payloadData(payload: unknown): Record<string, unknown> {
  const root = record(payload);
  return record(root?.data) ?? root ?? {};
}

function listAt(data: Record<string, unknown>, ...keys: string[]): unknown[] {
  for (const key of keys) if (Array.isArray(data[key])) return data[key] as unknown[];
  return [];
}

export function normalizeQuote(payload: unknown, labels = new Map<string, string>()): MarketQuote[] {
  const data = payloadData(payload);
  const rows = listAt(data, 'secu_quote', 'quotes', 'list');
  return rows.flatMap((raw) => {
    const row = record(raw);
    if (!row) return [];
    const symbol = text(row.symbol);
    const last = number(row.last_done ?? row.last ?? row.price);
    const previousClose = number(row.prev_close ?? row.previous_close);
    if (!symbol || last === null || previousClose === null) return [];
    const change = last - previousClose;
    const changePercent = previousClose === 0 ? 0 : (change / previousClose) * 100;
    const timestamp = number(row.timestamp);
    return [{
      symbol,
      label: labels.get(symbol) ?? symbol,
      last,
      previousClose,
      open: number(row.open),
      high: number(row.high),
      low: number(row.low),
      volume: number(row.volume),
      turnover: number(row.turnover),
      change,
      changePercent,
      direction: directionFor(changePercent),
      tradeStatus: text(row.trade_status ?? row.status),
      timestamp: timestamp === null ? new Date().toISOString() : new Date(timestamp * 1000).toISOString(),
    }];
  });
}

export function normalizeIntraday(payload: unknown, symbol: string, label: string): IntradayPoint[] {
  const data = payloadData(payload);
  return listAt(data, 'lines', 'intraday', 'list').flatMap((raw) => {
    const row = record(raw);
    if (!row) return [];
    const price = number(row.price ?? row.last_done);
    const timestamp = number(row.timestamp);
    if (price === null || timestamp === null) return [];
    return [{ timestamp: new Date(timestamp * 1000).toISOString(), price, volume: number(row.volume), turnover: number(row.turnover) }];
  }).map((point) => point);
}

export function intradayResult(payload: unknown, symbol: string, label: string) {
  const points = normalizeIntraday(payload, symbol, label);
  const prices = points.map((point) => point.price);
  const high = prices.length ? Math.max(...prices) : null;
  const low = prices.length ? Math.min(...prices) : null;
  const last = points.at(-1)?.price ?? null;
  const range = high === null || low === null ? null : high - low;
  const position = last === null || range === null ? null : range === 0 ? 0 : (last - low!) / range;
  return { symbol, label, points, high, low, range, position };
}

export function normalizeSession(payload: unknown, now = new Date(), timezone = 'America/New_York', calendar?: { tradingDays?: string[]; halfTradingDays?: string[] }): MarketSession {
  const data = payloadData(payload);
  const rows = listAt(data, 'market_trade_session', 'markets', 'sessions');
  const us = record(rows.find((row) => text(record(row)?.market)?.toUpperCase() === 'US')) ?? record(rows[0]);
  const sessionRows = listAt(us ?? {}, 'trade_session', 'sessions');
  const sessions = sessionRows.flatMap((raw) => {
    const row = record(raw);
    if (!row) return [];
    const begin = scalarText(row.beg_time ?? row.open);
    const end = scalarText(row.end_time ?? row.close);
    if (!begin || !end) return [];
    return [{ name: sessionName(row.trade_session ?? row.name), opensAt: begin, closesAt: end }];
  });
  const tradingDay = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const isTradingDay = calendar?.tradingDays ? calendar.tradingDays.includes(tradingDay) : false;
  const halfDay = calendar?.halfTradingDays?.includes(tradingDay) ?? false;
  const lastRegularIndex = sessions.reduce((index, session, current) => /pre|post/iu.test(session.name) ? index : current, -1);
  const effectiveSessions = halfDay ? sessions.map((session, index) => index === lastRegularIndex ? { ...session, closesAt: '1300' } : session) : sessions;
  const state = isTradingDay ? sessionStateAt(effectiveSessions, now, timezone, false) : 'closed';
  return { market: 'US', tradingDay, isTradingDay, state, sessions: effectiveSessions, ...(isTradingDay ? {} : { reason: 'Longbridge trading calendar does not list this day' }) };
}

function hhmm(value: string): number | null {
  const numeric = Number(value.replace(/[^0-9]/gu, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function sessionStateAt(sessions: Array<{ name: string; opensAt: string; closesAt: string }>, now: Date, timezone: string, halfDay: boolean): MarketSession['state'] {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  const current = hour * 100 + minute;
  const regular = sessions.filter((session) => !/pre|post/iu.test(session.name));
  const target = halfDay && regular.length ? regular.slice(0, -1).concat({ ...regular.at(-1)!, closesAt: '1300' }) : regular;
  if (target.some((session) => { const start = hhmm(session.opensAt); const end = hhmm(session.closesAt); return start !== null && end !== null && current >= start && current < end; })) return 'open';
  if (sessions.some((session) => /pre/iu.test(session.name) && current >= (hhmm(session.opensAt) ?? 0) && current < (hhmm(session.closesAt) ?? 0))) return 'pre';
  if (sessions.some((session) => /post/iu.test(session.name) && current >= (hhmm(session.opensAt) ?? 0) && current < (hhmm(session.closesAt) ?? 0))) return 'post';
  return 'closed';
}

export function normalizeMovers(payload: unknown, labels = new Map<string, string>): MarketMover[] {
  const data = payloadData(payload);
  return listAt(data, 'movers', 'list', 'items').flatMap((raw) => {
    const row = record(raw);
    const symbol = text(row?.symbol);
    const percent = number(row?.change_percent ?? row?.changePercent ?? row?.change);
    if (!symbol || percent === null) return [];
    return [{ symbol, label: labels.get(symbol) ?? text(row?.name) ?? symbol, changePercent: percent, direction: directionFor(percent) }];
  });
}

export function normalizeConstituents(payload: unknown): MarketConstituent[] {
  const data = payloadData(payload);
  return listAt(data, 'constituents', 'list', 'items').flatMap((raw) => {
    const row = record(raw);
    const symbol = text(row?.symbol);
    if (!symbol) return [];
    return [{ symbol, name: text(row?.name ?? row?.name_en ?? row?.name_cn), weight: number(row?.weight) }];
  });
}

export function normalizeTradingDays(payload: unknown): { tradingDays: string[]; halfTradingDays: string[] } {
  const data = payloadData(payload);
  return { tradingDays: list(data.trading_days).flatMap((item) => typeof item === 'string' ? [item] : []), halfTradingDays: list(data.half_trading_days).flatMap((item) => typeof item === 'string' ? [item] : []) };
}
