import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AmadeusConfig } from './config.js';

const execFileAsync = promisify(execFile);
const MARKET_TIMEZONE = 'America/New_York';
const DATA_SOURCE = 'Yahoo Finance Chart API';
const CURL_USER_AGENT = 'Amadeus/1.2 market-observer';

const INDEXES = [
  { symbol: '^NDX', name: '纳斯达克100' },
  { symbol: '^GSPC', name: '标普500' },
] as const;

export type MarketPhase = 'open' | 'close';

export interface MarketObservation {
  symbol: string;
  name: string;
  tradingDate: string;
  timezone: string;
  value: number;
  open: number;
  close: number | null;
  previousClose: number;
  change: number;
  changePercent: number;
  intradayChange: number | null;
  barTimestamp: string;
}

export type ParsedMarketChart =
  | { status: 'ok'; observation: MarketObservation }
  | { status: 'market_closed'; tradingDate: string; timezone: string; message: string }
  | { status: 'unavailable'; message: string };

export interface MarketNotification {
  eventKey: string;
  source: 'market-indices';
  title: string;
  message: string;
}

export type MarketResult =
  | {
      status: 'ok';
      phase: MarketPhase;
      marketDate: string;
      marketTimezone: string;
      dataUpdatedAt: string;
      source: typeof DATA_SOURCE;
      indices: MarketObservation[];
      notification: MarketNotification;
    }
  | {
      status: 'market_closed';
      phase: MarketPhase;
      checkedAt: string;
      marketTimezone: string;
      source: typeof DATA_SOURCE;
      message: string;
    }
  | {
      status: 'error';
      phase: MarketPhase;
      checkedAt: string;
      source: typeof DATA_SOURCE;
      message: string;
      errors: string[];
    };

interface MarketRow {
  timestampMs: number;
  tradingDate: string;
  open: number | undefined;
  close: number | undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function numberSeries(value: unknown): Array<number | undefined> {
  return Array.isArray(value) ? value.map((item) => finiteNumber(item)) : [];
}

function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const value = parts.find((part) => part.type === type)?.value;
  if (!value) throw new Error(`timezone date is missing ${type}`);
  return value;
}

function dateInTimeZone(timestampMs: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestampMs));
  return `${datePart(parts, 'year')}-${datePart(parts, 'month')}-${datePart(parts, 'day')}`;
}

function dateTimeInTimeZone(timestampMs: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestampMs));
  return `${datePart(parts, 'year')}-${datePart(parts, 'month')}-${datePart(parts, 'day')} ${datePart(parts, 'hour')}:${datePart(parts, 'minute')}:${datePart(parts, 'second')}`;
}

function signed(value: number, digits = 2): string {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(digits)}`;
}

function valueText(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseChartRows(result: Record<string, unknown>, timezone: string): MarketRow[] {
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const indicators = record(result.indicators);
  const quoteList = Array.isArray(indicators?.quote) ? indicators.quote : [];
  const quote = record(quoteList[0]);
  const opens = numberSeries(quote?.open);
  const closes = numberSeries(quote?.close);
  return timestamps.flatMap((timestamp, index) => {
    const numericTimestamp = finiteNumber(timestamp);
    if (numericTimestamp === undefined) return [];
    const timestampMs = numericTimestamp * 1_000;
    return [{
      timestampMs,
      tradingDate: dateInTimeZone(timestampMs, timezone),
      open: opens[index],
      close: closes[index],
    }];
  });
}

export function parseYahooChart(
  payload: unknown,
  symbol: string,
  name: string,
  phase: MarketPhase,
  now: Date,
): ParsedMarketChart {
  const root = record(payload);
  const chart = record(root?.chart);
  const results = Array.isArray(chart?.result) ? chart.result : [];
  const result = record(results[0]);
  const meta = record(result?.meta);
  const timezone = typeof meta?.exchangeTimezoneName === 'string' && meta.exchangeTimezoneName.trim()
    ? meta.exchangeTimezoneName
    : MARKET_TIMEZONE;
  const today = dateInTimeZone(now.getTime(), timezone);
  if (!result) return { status: 'unavailable', message: `${symbol} chart result is missing` };
  if (typeof meta?.symbol === 'string' && meta.symbol !== symbol) {
    return { status: 'unavailable', message: `${symbol} chart returned ${meta.symbol}` };
  }

  const rows = parseChartRows(result, timezone);
  let currentIndex = -1;
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index]?.tradingDate === today) currentIndex = index;
  }
  if (currentIndex < 0) {
    return {
      status: 'market_closed',
      tradingDate: today,
      timezone,
      message: `${name} 在 ${today} 没有当日交易数据，可能是周末或美股休市日`,
    };
  }

  const current = rows[currentIndex];
  if (!current) return { status: 'unavailable', message: `${symbol} current chart row is missing` };
  let previousClose: number | undefined;
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const candidate = rows[index]?.close;
    if (candidate !== undefined) {
      previousClose = candidate;
      break;
    }
  }
  if (previousClose === undefined) return { status: 'unavailable', message: `${symbol} previous close is missing` };
  const value = phase === 'open' ? current.open : current.close;
  if (value === undefined) return { status: 'unavailable', message: `${symbol} ${phase} value is missing` };
  const change = value - previousClose;
  return {
    status: 'ok',
    observation: {
      symbol,
      name,
      tradingDate: today,
      timezone,
      value,
      open: current.open ?? value,
      close: current.close ?? null,
      previousClose,
      change,
      changePercent: previousClose === 0 ? 0 : (change / previousClose) * 100,
      intradayChange: current.open !== undefined && current.close !== undefined ? current.close - current.open : null,
      barTimestamp: new Date(current.timestampMs).toISOString(),
    },
  };
}

async function readChart(config: AmadeusConfig, symbol: string, signal?: AbortSignal): Promise<unknown> {
  const baseUrl = config.marketDataBaseUrl.replace(/\/$/u, '');
  const url = `${baseUrl}/${encodeURIComponent(symbol)}?range=5d&interval=1d&includePrePost=false`;
  const args = [
    '--fail', '--silent', '--show-error', '--location', '--compressed',
    '--connect-timeout', '5', '--max-time', '15', '--retry', '2', '--retry-delay', '1',
    '--header', 'Accept: application/json', '--header', `User-Agent: ${CURL_USER_AGENT}`, url,
  ];
  const result = await execFileAsync('curl', args, {
    maxBuffer: 4 * 1024 * 1024,
    timeout: 20_000,
    ...(signal ? { signal } : {}),
  });
  return JSON.parse(result.stdout) as unknown;
}

export function buildMarketNotification(
  phase: MarketPhase,
  marketDate: string,
  observations: MarketObservation[],
  dataUpdatedAt: string,
): MarketNotification {
  const phaseLabel = phase === 'open' ? '开盘' : '收盘';
  const lines = observations.flatMap((item) => {
    const daily = phase === 'close' && item.intradayChange !== null
      ? `\n日内：${signed(item.intradayChange)}（开盘 ${valueText(item.open)}）`
      : '';
    return [
      `${item.name}（${item.symbol}）`,
      `${phaseLabel}：${valueText(item.value)}`,
      `较前一交易日收盘：${signed(item.change)}（${signed(item.changePercent)}%）${daily}`,
      '',
    ];
  });
  const eventKey = `market-indices:${marketDate}:${phase}`;
  return {
    eventKey,
    source: 'market-indices',
    title: `Amadeus • 世界线观测 · 美股${phaseLabel}`,
    message: [
      `世界线观测记录：美股${phaseLabel}`,
      `交易日：${marketDate}（美东）`,
      '',
      ...lines,
      `数据源：${DATA_SOURCE}（指数数据可能存在延迟）`,
      `数据更新时间：${dateTimeInTimeZone(Date.parse(dataUpdatedAt), MARKET_TIMEZONE)}（${MARKET_TIMEZONE}）`,
      '',
      'El Psy Kongroo.',
    ].join('\n').trim(),
  };
}

export async function marketIndices(config: AmadeusConfig, phase: MarketPhase, signal?: AbortSignal): Promise<MarketResult> {
  const checkedAt = new Date().toISOString();
  const results = await Promise.all(INDEXES.map(async (item) => {
    try {
      const payload = await readChart(config, item.symbol, signal);
      return { item, parsed: parseYahooChart(payload, item.symbol, item.name, phase, new Date(checkedAt)) };
    } catch (error) {
      return {
        item,
        parsed: {
          status: 'unavailable' as const,
          message: `${item.symbol} request failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  }));
  const unavailable = results.filter((result): result is typeof result & { parsed: { status: 'unavailable'; message: string } } => result.parsed.status === 'unavailable');
  if (unavailable.length > 0) {
    return {
      status: 'error',
      phase,
      checkedAt,
      source: DATA_SOURCE,
      message: '市场数据源不可用，本次不发送通知',
      errors: unavailable.map((result) => result.parsed.message),
    };
  }
  const closed = results.filter((result): result is typeof result & { parsed: { status: 'market_closed'; message: string; tradingDate: string; timezone: string } } => result.parsed.status === 'market_closed');
  if (closed.length > 0) {
    return {
      status: 'market_closed',
      phase,
      checkedAt,
      marketTimezone: MARKET_TIMEZONE,
      source: DATA_SOURCE,
      message: closed.map((result) => result.parsed.message).join('；'),
    };
  }
  const successful = results.filter((result): result is typeof result & { parsed: { status: 'ok'; observation: MarketObservation } } => result.parsed.status === 'ok');
  if (successful.length !== results.length) {
    return {
      status: 'error',
      phase,
      checkedAt,
      source: DATA_SOURCE,
      message: '市场数据结果不完整，本次不发送通知',
      errors: [],
    };
  }
  const observations = successful.map((result) => result.parsed.observation);
  const marketDates = new Set(observations.map((item) => item.tradingDate));
  if (marketDates.size !== 1) {
    return {
      status: 'error',
      phase,
      checkedAt,
      source: DATA_SOURCE,
      message: '两个指数返回的交易日不一致，本次不发送通知',
      errors: observations.map((item) => `${item.symbol}:${item.tradingDate}`),
    };
  }
  const marketDate = observations[0]?.tradingDate;
  if (!marketDate) {
    return { status: 'error', phase, checkedAt, source: DATA_SOURCE, message: '市场数据为空，本次不发送通知', errors: [] };
  }
  return {
    status: 'ok',
    phase,
    marketDate,
    marketTimezone: MARKET_TIMEZONE,
    dataUpdatedAt: checkedAt,
    source: DATA_SOURCE,
    indices: observations,
    notification: buildMarketNotification(phase, marketDate, observations, checkedAt),
  };
}
