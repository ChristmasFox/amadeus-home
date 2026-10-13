const MAX_BLOCK_MS = 24 * 60 * 60_000;
const DEFAULT_429_RETRY_MS = 60_000;

function boundedDelay(value: number): number {
  return Math.min(MAX_BLOCK_MS, Math.max(0, Math.ceil(value)));
}

function retryAfterHeader(value: string | null, now: number): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return boundedDelay(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? boundedDelay(date - now) : null;
}

/** Tracks KOOK's response-provided route buckets and global pauses for the
 * single gateway process. It does not guess undocumented request quotas. */
export class KookRateLimitGate {
  private readonly routeBuckets = new Map<string, string>();
  private readonly blockedUntilByBucket = new Map<string, number>();
  private globalBlockedUntil = 0;

  constructor(private readonly now: () => number = Date.now) {}

  waitMs(route: string): number {
    const bucket = this.routeBuckets.get(route) ?? route;
    return boundedDelay(Math.max(this.globalBlockedUntil, this.blockedUntilByBucket.get(bucket) ?? 0) - this.now());
  }

  observe(route: string, headers: Headers, status: number): number | null {
    const now = this.now();
    const bucketHeader = headers.get('x-rate-limit-bucket')?.trim();
    const bucket = bucketHeader && bucketHeader.length <= 256 ? bucketHeader : this.routeBuckets.get(route) ?? route;
    this.routeBuckets.set(route, bucket);
    const remainingHeader = headers.get('x-rate-limit-remaining');
    const remaining = remainingHeader === null ? null : Number(remainingHeader);
    const resetHeader = headers.get('x-rate-limit-reset');
    const resetSeconds = resetHeader === null ? NaN : Number(resetHeader);
    const resetDelay = Number.isFinite(resetSeconds) && resetSeconds > 0
      ? boundedDelay(resetSeconds * 1000)
      : 0;
    const retryAfter = retryAfterHeader(headers.get('retry-after'), now);
    const missing429Guidance = status === 429 && resetDelay === 0 && retryAfter === null;
    const delay = Math.max(resetDelay, retryAfter ?? 0, missing429Guidance ? DEFAULT_429_RETRY_MS : 0,
      status !== 429 && remaining === 0 && resetDelay === 0 ? 1_000 : 0);

    const global = headers.has('x-rate-limit-global');
    if ((global || status === 429 && headers.get('x-rate-limit-bucket') === null) && delay > 0) {
      this.globalBlockedUntil = Math.max(this.globalBlockedUntil, now + delay);
    }
    if (status === 429 || remaining === 0) {
      if (delay > 0) this.blockedUntilByBucket.set(bucket, Math.max(this.blockedUntilByBucket.get(bucket) ?? 0, now + delay));
      return delay;
    }
    return null;
  }
}
