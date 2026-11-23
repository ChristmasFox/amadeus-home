#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  MARKER,
  PIN,
  PROJECTION_RETRY_MAX_ATTEMPTS,
  PROJECTION_RETRY_TIMEOUT_MS,
  patchSessionHistoryProjectionSource,
  patchAttemptProjectionSource,
  withBoundedSessionTranscriptProjectionRetry,
} from './patch-openclaw-session-history-projection.mjs';

const runtimeRoot = path.resolve('node_modules/.pnpm/openclaw@2026.9.4/node_modules/openclaw/dist');
const original = fs.readFileSync(path.join(runtimeRoot, PIN.module), 'utf8');
assert.equal(createHash('sha256').update(original).digest('hex'), PIN.moduleSha256);

const patched = patchSessionHistoryProjectionSource(original);
const attemptOriginal = fs.readFileSync(path.join(runtimeRoot, 'builtin-openclaw-B-H-7lKk.mjs'), 'utf8');
const attemptPatched = patchAttemptProjectionSource(attemptOriginal);
assert.equal(patchAttemptProjectionSource(attemptPatched), attemptPatched);
assert.match(attemptPatched, /amadeusRetrySessionOpen\(\(\) => attempt\.sessionManager/u);
assert.throws(() => patchAttemptProjectionSource(attemptOriginal.replace('async function prepareEmbeddedAttemptSessionManager', 'async function renamed')), /anchor mismatch/u);
assert.equal(patched.split(MARKER).length - 1, 1);
assert.equal(patchSessionHistoryProjectionSource(patched), patched, 'idempotent');
assert.match(patched, /waitForSessionTranscriptProjection\(transcriptScope, AbortSignal\.timeout\(remainingMs\)\)/u);
assert.match(patched, /SESSION_TRANSCRIPT_PROJECTION_RETRY_TIMEOUT_MS = 2000/u);
assert.match(patched, /SESSION_TRANSCRIPT_PROJECTION_RETRY_MAX_ATTEMPTS = 8/u);
assert.throws(() => patchSessionHistoryProjectionSource(original.replace('async function readSessionMessagesWithSourceAsync', 'async function renamed')), /anchor mismatch/u);

for (const source of [patched]) {
  const temporary = path.join(os.tmpdir(), `openclaw-history-projection-${process.pid}.mjs`);
  try {
    fs.writeFileSync(temporary, source, { flag: 'wx' });
    const check = spawnSync(process.execPath, ['--check', temporary], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

class ProjectionUnavailableError extends Error {
  constructor() {
    super('projection unavailable');
    this.name = 'SessionTranscriptProjectionUnavailableError';
  }
}
const isUnavailable = (error) => error instanceof ProjectionUnavailableError;
const unavailable = new ProjectionUnavailableError();

// The source event is committed first; the projection catches up during the
// wait and the exact same history read then succeeds within the bound.
{
  let latestSeq = 18;
  let indexedSeq = 17;
  let needsRebuild = false;
  let now = 0;
  let reads = 0;
  const read = async () => {
    reads += 1;
    if (needsRebuild || indexedSeq !== latestSeq) throw unavailable;
    return { indexedSeq, latestSeq };
  };
  const result = await withBoundedSessionTranscriptProjectionRetry(
    read,
    async () => {
      now += 25;
      indexedSeq = latestSeq;
    },
    isUnavailable,
    100,
    PROJECTION_RETRY_MAX_ATTEMPTS,
    () => now,
  );
  assert.deepEqual(result, { indexedSeq: 18, latestSeq: 18 });
  assert.equal(reads, 2);
  assert.ok(now < 100);
}

// A projection that never catches up stops at the deadline and preserves the
// typed projection error for the caller instead of converting it to a format error.
{
  let now = 0;
  let reads = 0;
  const result = await withBoundedSessionTranscriptProjectionRetry(
    async () => {
      reads += 1;
      throw unavailable;
    },
    async (remainingMs) => {
      now += remainingMs;
      const timeout = new Error('wait aborted');
      timeout.name = 'AbortError';
      throw timeout;
    },
    isUnavailable,
    30,
    PROJECTION_RETRY_MAX_ATTEMPTS,
    () => now,
  ).then(() => undefined, (error) => error);
  assert.equal(result, unavailable);
  assert.equal(reads, 2);
  assert.equal(now, 30);
  assert.ok(now <= 30);
}

assert.equal(PROJECTION_RETRY_TIMEOUT_MS, 2_000);
console.log('OPENCLAW_SESSION_HISTORY_PROJECTION_RETRY=passed');
