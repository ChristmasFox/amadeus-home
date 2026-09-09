import type { SearchFeed } from '../search/model.js';
import type { Watch } from '../watch/model.js';

export const WATCH_RUNTIME_STATUSES = ['HEALTHY', 'DEGRADED', 'PAUSED', 'ERROR'] as const;
export type WatchRuntimeStatus = (typeof WATCH_RUNTIME_STATUSES)[number];

export interface WatchRuntimeStats {
  watchId: string;
  feedRuns: number;
  successfulRuns: number;
  failedRuns: number;
  newListings: number;
  candidatesProcessed: number;
  imageComparisons: number;
  aboveThreshold: number;
  notificationsSent: number;
  bestScore: number | null;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastError?: string;
  status: WatchRuntimeStatus;
}

export interface WatchRuntimeRunMetrics {
  newListings?: number;
  candidatesProcessed?: number;
  imageComparisons?: number;
  aboveThreshold?: number;
  bestScore?: number;
}

export interface UsageLedgerEntry {
  id: string;
  watchId: string;
  provider: string;
  model: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  timestamp: string;
  inferenceCount: number;
  imagesProcessed: number;
  latencyMs?: number;
}

export interface UsageSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inferenceCount: number;
  imagesProcessed: number;
  latencyMs: number;
}

export interface WatchObservability {
  watch: Watch;
  status: WatchRuntimeStatus;
  runningForSeconds: number;
  lastRunAt?: string;
  nextRunAt?: string;
  runtime: WatchRuntimeStats;
  feeds: SearchFeed[];
  usage: UsageSummary;
}
