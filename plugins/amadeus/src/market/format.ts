import type { MarketQuote } from './types.js';

const FLAT_EPSILON = 0.0005;

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function directionFor(changePercent: number): 'positive' | 'negative' | 'flat' {
  if (Math.abs(changePercent) < FLAT_EPSILON) return 'flat';
  return changePercent > 0 ? 'positive' : 'negative';
}

export function directionGlyph(direction: ReturnType<typeof directionFor>): '▲' | '▼' | '—' {
  return direction === 'positive' ? '▲' : direction === 'negative' ? '▼' : '—';
}

export function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

export function formatSigned(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${value > 0 ? '+' : value < 0 ? '-' : ''}${abs}`;
}

export function formatPercent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '—' : `${formatSigned(value, 2)}%`;
}

export function formatCompact(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const absolute = Math.abs(value);
  const suffix = absolute >= 1e12 ? 'T' : absolute >= 1e9 ? 'B' : absolute >= 1e6 ? 'M' : absolute >= 1e3 ? 'K' : '';
  const divisor = suffix === 'T' ? 1e12 : suffix === 'B' ? 1e9 : suffix === 'M' ? 1e6 : suffix === 'K' ? 1e3 : 1;
  return suffix ? `${(value / divisor).toFixed(2)}${suffix}` : Math.round(value).toLocaleString('en-US');
}

export function formatQuoteLine(quote: MarketQuote): string {
  const direction = directionGlyph(quote.direction);
  return `${quote.label}\n${formatPrice(quote.last)}\n${direction} ${formatSigned(quote.change)}  (${formatPercent(quote.changePercent)})`;
}

export function quoteDirection(quote: Pick<MarketQuote, 'changePercent'>): ReturnType<typeof directionFor> {
  return directionFor(finite(quote.changePercent));
}
