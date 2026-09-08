import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backoffIntervalSeconds, DEFAULT_SIMILARITY_INTERVAL_SECONDS, DEFAULT_SIMILARITY_JITTER_SECONDS, deterministicJitterSeconds, scheduledIntervalSeconds } from '../src/core/search/scheduling.js';

test('similarity scheduling defaults to 900 seconds with deterministic bounded jitter', () => {
  assert.equal(DEFAULT_SIMILARITY_INTERVAL_SECONDS, 900);
  assert.equal(DEFAULT_SIMILARITY_JITTER_SECONDS, 120);
  const jitter = deterministicJitterSeconds('feed-a');
  assert.equal(jitter >= -120 && jitter <= 120, true);
  assert.equal(jitter, deterministicJitterSeconds('feed-a'));
  assert.equal(scheduledIntervalSeconds('feed-a', 900) >= 780 && scheduledIntervalSeconds('feed-a', 900) <= 1020, true);
});

test('backoff follows 15m, 30m, 60m and respects Retry-After', () => {
  assert.equal(backoffIntervalSeconds(900, 1), 1800);
  assert.equal(backoffIntervalSeconds(900, 2), 3600);
  assert.equal(backoffIntervalSeconds(900, 3), 7200);
  assert.equal(backoffIntervalSeconds(900, 1, 4000), 4000);
});
