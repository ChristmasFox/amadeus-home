export type MarketStatus = 'ready' | 'reauth_required' | 'unavailable';

export interface LongbridgeAuthStatus {
  status: MarketStatus;
  provider: 'longbridge';
  authMode: 'oauth2';
  expiresAt?: string;
  message?: string;
}

export interface NormalizedSymbol {
  symbol: string;
  label: string;
  market: 'US';
  kind: 'index' | 'equity';
}

export interface MarketQuote {
  symbol: string;
  label: string;
  last: number;
  previousClose: number;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  turnover: number | null;
  change: number;
  changePercent: number;
  direction: 'positive' | 'negative' | 'flat';
  tradeStatus: string | null;
  timestamp: string;
}

export interface MarketSession {
  market: string;
  tradingDay: string;
  isTradingDay: boolean;
  state: 'pre' | 'open' | 'post' | 'closed' | 'unknown';
  sessions: Array<{ name: string; opensAt: string; closesAt: string }>;
  reason?: string;
}

export interface IntradayPoint {
  timestamp: string;
  price: number;
  volume: number | null;
  turnover: number | null;
}

export interface MarketIntraday {
  symbol: string;
  label: string;
  points: IntradayPoint[];
  high: number | null;
  low: number | null;
  range: number | null;
  position: number | null;
}

export interface MarketMover {
  symbol: string;
  label: string;
  changePercent: number;
  direction: 'positive' | 'negative' | 'flat';
}

export interface MarketConstituent {
  symbol: string;
  name: string | null;
  weight: number | null;
}

export interface MarketOverview {
  status: 'ok';
  provider: 'longbridge';
  auth: LongbridgeAuthStatus;
  market: string;
  session: MarketSession;
  quotes: MarketQuote[];
  temperature?: number | null;
  movers?: MarketMover[];
  dataUpdatedAt: string;
  notification?: OwnerNotificationPresentation;
}

export interface MarketNotification extends OwnerNotificationPresentation {
  type: 'owner_notification';
  eventType: string;
}

export type MarketFailureStatus = 'longbridge_unavailable' | 'longbridge_oauth_reauthorization_required' | 'market_closed';

export interface MarketFailure {
  status: MarketFailureStatus;
  provider: 'longbridge';
  auth: LongbridgeAuthStatus;
  message: string;
}
import type { OwnerNotificationPresentation } from '@agent/presentation';

export const MARKET_PROVIDER = 'longbridge' as const;
export const MARKET_PROVIDER_COUNT = 1 as const;
export const MARKET_FALLBACK_PROVIDER = 'none' as const;
