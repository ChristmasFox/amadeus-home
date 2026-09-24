import type { NormalizedSymbol } from './types.js';

const aliases: Record<string, NormalizedSymbol> = {
  'NASDAQ COMPOSITE': { symbol: '.IXIC.US', label: 'NASDAQ Composite', market: 'US', kind: 'index' },
  'NASDAQ-100': { symbol: '.NDX.US', label: 'NASDAQ-100', market: 'US', kind: 'index' },
  NASDAQ100: { symbol: '.NDX.US', label: 'NASDAQ-100', market: 'US', kind: 'index' },
  NASDAQ: { symbol: '.IXIC.US', label: 'NASDAQ Composite', market: 'US', kind: 'index' },
  'S&P 500': { symbol: '.SPX.US', label: 'S&P 500', market: 'US', kind: 'index' },
  SP500: { symbol: '.SPX.US', label: 'S&P 500', market: 'US', kind: 'index' },
  DOW: { symbol: '.DJI.US', label: 'Dow Jones', market: 'US', kind: 'index' },
  'DOW JONES': { symbol: '.DJI.US', label: 'Dow Jones', market: 'US', kind: 'index' },
  纳指: { symbol: '.IXIC.US', label: 'NASDAQ Composite', market: 'US', kind: 'index' },
  纳斯达克: { symbol: '.IXIC.US', label: 'NASDAQ Composite', market: 'US', kind: 'index' },
  '纳指100': { symbol: '.NDX.US', label: 'NASDAQ-100', market: 'US', kind: 'index' },
  标普: { symbol: '.SPX.US', label: 'S&P 500', market: 'US', kind: 'index' },
  道指: { symbol: '.DJI.US', label: 'Dow Jones', market: 'US', kind: 'index' },
};

function labelFor(symbol: string): string {
  return symbol.endsWith('.US') ? symbol.slice(0, -3) : symbol;
}

export function normalizeSymbol(input: string): NormalizedSymbol {
  const raw = input.trim();
  if (!raw) throw new Error('market symbol is required');
  const alias = aliases[raw.toUpperCase()] ?? aliases[raw];
  if (alias) return { ...alias };
  const symbol = raw.toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,14}\.US$/u.test(symbol)) {
    throw new Error('only explicit US equity symbols (for example AAPL.US) are supported');
  }
  return { symbol, label: labelFor(symbol), market: 'US', kind: 'equity' };
}

export function normalizeSymbols(inputs: string[]): NormalizedSymbol[] {
  const unique = new Map<string, NormalizedSymbol>();
  for (const input of inputs) {
    const normalized = normalizeSymbol(input);
    unique.set(normalized.symbol, normalized);
  }
  if (!unique.size) throw new Error('at least one market symbol is required');
  return [...unique.values()];
}

export const DEFAULT_INDEX_SYMBOLS = ['.IXIC.US', '.NDX.US', '.SPX.US', '.DJI.US'] as const;
