import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMarketNotification, parseYahooChart } from '../src/market.js';

function chartPayload(symbol: string): unknown {
  return {
    chart: {
      result: [{
        meta: { symbol, exchangeTimezoneName: 'America/New_York' },
        timestamp: [
          Date.parse('2026-09-17T13:30:00.000Z') / 1_000,
          Date.parse('2026-09-18T13:30:00.000Z') / 1_000,
        ],
        indicators: {
          quote: [{
            open: [100, 110],
            close: [105, 115],
          }],
        },
      }],
      error: null,
    },
  };
}

test('market chart uses the current trading bar and previous close for open observations', () => {
  const result = parseYahooChart(
    chartPayload('^NDX'),
    '^NDX',
    '纳斯达克100',
    'open',
    new Date('2026-09-18T13:35:00.000Z'),
  );
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.equal(result.observation.tradingDate, '2026-09-18');
  assert.equal(result.observation.value, 110);
  assert.equal(result.observation.previousClose, 105);
  assert.equal(result.observation.change, 5);
  assert.equal(result.observation.changePercent, 100 * 5 / 105);
});

test('market chart uses the current close and keeps the intraday move', () => {
  const result = parseYahooChart(
    chartPayload('^GSPC'),
    '^GSPC',
    '标普500',
    'close',
    new Date('2026-09-18T20:05:00.000Z'),
  );
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.equal(result.observation.value, 115);
  assert.equal(result.observation.change, 10);
  assert.equal(result.observation.intradayChange, 5);
});

test('market chart reports market closed when no current trading bar exists', () => {
  const result = parseYahooChart(
    chartPayload('^NDX'),
    '^NDX',
    '纳斯达克100',
    'close',
    new Date('2026-09-19T16:05:00.000Z'),
  );
  assert.equal(result.status, 'market_closed');
  if (result.status !== 'market_closed') return;
  assert.equal(result.tradingDate, '2026-09-19');
});

test('market notification preserves stable event identity and world-line closing', () => {
  const open = parseYahooChart(
    chartPayload('^NDX'),
    '^NDX',
    '纳斯达克100',
    'open',
    new Date('2026-09-18T13:35:00.000Z'),
  );
  assert.equal(open.status, 'ok');
  if (open.status !== 'ok') return;
  const notification = buildMarketNotification('open', open.observation.tradingDate, [open.observation], '2026-09-18T13:35:00.000Z');
  assert.equal(notification.eventKey, 'market-indices:2026-09-18:open');
  assert.equal(notification.title, 'Amadeus • 世界线观测 · 美股开盘');
  assert.match(notification.message, /数据更新时间/u);
  assert.match(notification.message, /El Psy Kongroo\.$/u);
});
