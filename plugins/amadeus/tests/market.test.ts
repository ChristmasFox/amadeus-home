import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderOwnerNotification } from '@agent/presentation';
import { buildMarketNotification, formatCompact, formatPercent, formatPrice, formatSigned, directionGlyph } from '../src/market.js';
import { intradayResult, normalizeConstituents, normalizeQuote, normalizeSession, normalizeTradingDays } from '../src/market/normalize.js';
import { normalizeSymbol } from '../src/market/symbols.js';

test('normalizes public index aliases and explicit US equities', () => {
  assert.equal(normalizeSymbol('Nasdaq Composite').symbol, '.IXIC.US');
  assert.equal(normalizeSymbol('纳指100').symbol, '.NDX.US');
  assert.equal(normalizeSymbol('S&P 500').symbol, '.SPX.US');
  assert.equal(normalizeSymbol('Dow Jones').symbol, '.DJI.US');
  assert.equal(normalizeSymbol('AMD.US').symbol, 'AMD.US');
  assert.throws(() => normalizeSymbol('AMD'), /explicit US equity/u);
});

test('normalizes Longbridge quote values and calculates deterministic changes', () => {
  const quotes = normalizeQuote({ data: { secu_quote: [{ symbol: 'AMD.US', last_done: '308.2382', prev_close: '300', open: '300', high: '310', low: '290', volume: 2_837_481_234, timestamp: 1_758_200_000 }] } });
  assert.ok(Math.abs((quotes[0]?.change ?? 0) - 8.2382) < 1e-9);
  assert.ok(Math.abs((quotes[0]?.changePercent ?? 0) - (100 * 8.2382 / 300)) < 1e-9);
  assert.equal(quotes[0]?.direction, 'positive');
});

test('market presentation has controlled decimals, signs, compact volume and direction glyphs', () => {
  assert.equal(formatPrice(26936.03728), '26,936.04');
  assert.equal(formatSigned(308.2382), '+308.24');
  assert.equal(formatSigned(-308.2382), '-308.24');
  assert.equal(formatPercent(1.131428), '+1.13%');
  assert.equal(formatPercent(-1.131428), '-1.13%');
  assert.equal(formatCompact(2_837_481_234), '2.84B');
  assert.equal(directionGlyph('positive'), '▲');
  assert.equal(directionGlyph('negative'), '▼');
  assert.equal(directionGlyph('flat'), '—');
});

test('Longbridge trading day payload preserves holidays and half days', () => {
  assert.deepEqual(normalizeTradingDays({ data: { trading_days: ['2026-09-24'], half_trading_days: ['2026-11-27'] } }), { tradingDays: ['2026-09-24'], halfTradingDays: ['2026-11-27'] });
});

test('session state follows Longbridge calendar and handles DST and half-day close', () => {
  const payload = { data: { market_trade_session: [{ market: 'US', trade_session: [{ beg_time: 400, end_time: 930, trade_session: 1 }, { beg_time: 930, end_time: 1600, trade_session: 0 }, { beg_time: 1600, end_time: 2000, trade_session: 2 }] }] } };
  const session = normalizeSession(payload, new Date('2026-03-09T13:35:00.000Z'), 'America/New_York', { tradingDays: ['2026-03-09'], halfTradingDays: [] });
  assert.equal(session.tradingDay, '2026-03-09');
  assert.equal(session.state, 'open');
  const half = normalizeSession(payload, new Date('2026-11-27T18:30:00.000Z'), 'America/New_York', { tradingDays: ['2026-11-27'], halfTradingDays: ['2026-11-27'] });
  assert.equal(half.state, 'closed');
  assert.equal(half.sessions.find((item) => item.name === 'regular')?.closesAt, '1300');
});

test('intraday range and position are deterministic', () => {
  const result = intradayResult({ data: { lines: [{ price: '10', timestamp: 1 }, { price: '15', timestamp: 2 }, { price: '12', timestamp: 3 }] } }, 'AMD.US', 'AMD');
  assert.equal(result.high, 15);
  assert.equal(result.low, 10);
  assert.equal(result.range, 5);
  assert.equal(result.position, 0.4);
});

test('Longbridge notification keeps direction in facts and severity informational', () => {
  const notification = buildMarketNotification('close', '2026-09-24', [{ symbol: '.SPX.US', label: 'S&P 500', last: 7706.03, previousClose: 7764.64, open: 7750, high: 7770, low: 7680, volume: 2_837_481_234, turnover: null, change: -58.61, changePercent: -0.755, direction: 'negative', tradeStatus: 'normal', timestamp: '2026-09-24T20:00:00.000Z' }], '2026-09-24T20:00:00.000Z');
  assert.equal(notification.severity, 'info');
  const rendered = renderOwnerNotification(notification, { now: notification.occurredAt });
  assert.match(rendered, /▼/u);
  assert.match(rendered, /7,706\.03/u);
  assert.match(rendered, /-58\.61/u);
  assert.match(rendered, /-0\.76%/u);
});

test('index constituents stay a public bounded read operation', () => {
  assert.deepEqual(normalizeConstituents({ data: { constituents: [{ symbol: 'AAPL.US', name_en: 'Apple', weight: '7.2' }] } }), [{ symbol: 'AAPL.US', name: 'Apple', weight: 7.2 }]);
});
