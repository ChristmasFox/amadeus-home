import { createHash } from 'node:crypto';
import type { ImplementedWatchType } from '../watch/model.js';

export const DEFAULT_SIMILARITY_INTERVAL_SECONDS = 900;
export const DEFAULT_SIMILARITY_JITTER_SECONDS = 120;

export function defaultIntervalSeconds(type: ImplementedWatchType): number {
  return type === 'similarity' ? DEFAULT_SIMILARITY_INTERVAL_SECONDS : 120;
}

export function deterministicJitterSeconds(feedId: string, jitterSeconds = DEFAULT_SIMILARITY_JITTER_SECONDS): number {
  if (jitterSeconds <= 0) return 0;
  const digest = createHash('sha256').update(feedId).digest();
  const raw = digest.readUInt32BE(0) / 0xffffffff;
  return Math.floor(raw * (jitterSeconds * 2 + 1)) - jitterSeconds;
}

export function scheduledIntervalSeconds(feedId: string, baseIntervalSeconds: number, jitterSeconds = DEFAULT_SIMILARITY_JITTER_SECONDS): number {
  return Math.max(1, baseIntervalSeconds + deterministicJitterSeconds(feedId, jitterSeconds));
}

export function backoffIntervalSeconds(baseIntervalSeconds: number, failureCount: number, retryAfterSeconds?: number): number {
  const exponential = Math.min(baseIntervalSeconds * (2 ** Math.max(0, failureCount)), baseIntervalSeconds * 8);
  return Math.max(exponential, retryAfterSeconds ?? 0);
}

export function recoveryIntervalSeconds(baseIntervalSeconds: number, failureCount: number): number {
  return Math.max(baseIntervalSeconds, baseIntervalSeconds * (2 ** Math.max(0, failureCount - 1)));
}

export function retryAfterSeconds(details: unknown): number | undefined {
  if (!details || typeof details !== 'object') return undefined;
  const value = (details as Record<string, unknown>).retryAfterSeconds ?? (details as Record<string, unknown>).retryAfter;
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) && number > 0 ? Math.ceil(number) : undefined;
}
