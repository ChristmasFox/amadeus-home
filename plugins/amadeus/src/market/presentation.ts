import { adaptWorldlineNotification, type OwnerNotificationPresentation } from '@agent/presentation';
import { directionGlyph, formatCompact, formatPercent, formatPrice, formatSigned } from './format.js';
import type { MarketQuote } from './types.js';

export function buildMarketNotification(phase: 'open' | 'close', marketDate: string, quotes: MarketQuote[], dataUpdatedAt: string): OwnerNotificationPresentation {
  const label = phase === 'open' ? '开盘' : '收盘';
  const facts = quotes.flatMap((quote) => [
    { label: `${quote.label} ${directionGlyph(quote.direction)}`, value: `${formatPrice(quote.last)} ${formatSigned(quote.change)} (${formatPercent(quote.changePercent)})`, evidenceRefs: [] },
    ...(phase === 'close' && quote.high !== null && quote.low !== null ? [{ label: `${quote.label} 日内区间`, value: `${formatPrice(quote.low)} – ${formatPrice(quote.high)}`, evidenceRefs: [] }] : []),
    ...(quote.volume !== null ? [{ label: `${quote.label} 成交量`, value: formatCompact(quote.volume), evidenceRefs: [] }] : []),
  ]);
  return adaptWorldlineNotification({
    type: 'worldline_notification_intent',
    eventType: `market_longbridge_${phase}`,
    kind: 'market_report',
    severity: 'info',
    significance: phase === 'close' ? 'major' : 'notable',
    eventKey: `market-indices:${marketDate}:${phase}`,
    source: 'market-longbridge',
    headline: `美股${label}`,
    facts,
    summary: `Longbridge ${label} 观测，共 ${quotes.length} 个指数。`,
    dataUpdatedAt,
    occurredAt: dataUpdatedAt,
    ...(phase === 'close' ? { worldLineClosing: true } : {}),
  });
}
