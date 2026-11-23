#!/usr/bin/env node
/**
 * Bounded retry for OpenClaw's asynchronous full-history reader. Its underlying
 * SQLite snapshot reader schedules transcript-index reconciliation and throws
 * immediately; a history read should wait briefly for that projection to catch
 * up, then keep failing closed with the same typed projection error.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MARKER = 'amadeus-session-history-projection-retry-v1';
export const PIN = Object.freeze({
  version: '2026.9.4',
  module: 'session-transcript-readers-BZjuw2hz.mjs',
  moduleSha256: '799a71b9b95715ec03d74b543fd1b5c43c8b4374a840d64079db5e82db4e394c',
});
export const PROJECTION_RETRY_TIMEOUT_MS = 2_000;
export const PROJECTION_RETRY_MAX_ATTEMPTS = 8;

export function patchAttemptProjectionSource(original) {
  const marker = 'amadeus-attempt-projection-retry-v1';
  if (original.includes(marker)) return original;
  const start = 'async function prepareEmbeddedAttemptSessionManager(input) {\n\tconst { attempt } = input;';
  const state = 'const transcriptState = await resolveExistingAttemptTranscriptState({\n\t\tsessionManager: attempt.sessionManager,\n\t\tagentId: input.sessionAgentId,\n\t\tconfig: attempt.config,\n\t\tsessionFile: attempt.sessionFile,\n\t\tsessionId: attempt.sessionId,\n\t\tsessionKey: attempt.sessionKey,\n\t\tsessionTarget: attempt.sessionTarget\n\t});';
  const open = 'const unguardedSessionManager = attempt.sessionManager ?? (attempt.sessionTarget ? SessionManager.open(attempt.sessionTarget, input.effectiveCwd, {\n\t\tmaxBytes: Math.min(67108864, Math.max(1024, (attempt.contextTokenBudget ?? 128e3) * 8)),\n\t\tmaxEvents: 1e4\n\t}) : SessionManager.inMemory(input.effectiveCwd));';
  if (original.split(start).length !== 2 || original.split(open).length !== 2 || original.split(state).length !== 2) throw new Error('attempt session manager anchor mismatch');
  const helper = `// ${marker}\nasync function amadeusRetrySessionOpen(read, target) {\n  try { return await read(); } catch (error) {\n    if (error?.name !== "SessionTranscriptProjectionUnavailableError" || !target) throw error;\n    const { waitForSessionTranscriptProjection } = await import("./session-transcript-reconcile-B_Z-UIX7.mjs");\n    await waitForSessionTranscriptProjection(target, AbortSignal.timeout(30000));\n    return await read();\n  }\n}\n`;
  return original.replace(start, helper + start).replace(state, state.replace('await resolveExistingAttemptTranscriptState({', 'await amadeusRetrySessionOpen(() => resolveExistingAttemptTranscriptState({').replace('\n\t});', '\n\t}), attempt.sessionTarget);')).replace(open, 'const unguardedSessionManager = await amadeusRetrySessionOpen(() => attempt.sessionManager ?? (attempt.sessionTarget ? SessionManager.open(attempt.sessionTarget, input.effectiveCwd, {\n\t\tmaxBytes: Math.min(67108864, Math.max(1024, (attempt.contextTokenBudget ?? 128e3) * 8)),\n\t\tmaxEvents: 1e4\n\t}) : SessionManager.inMemory(input.effectiveCwd)), attempt.sessionTarget);');
}

const ORIGINAL_READER = `async function readSessionMessagesWithSourceAsync(scope, opts) {
\tconst target = resolveTranscriptReadTarget(scope);
\tconst messages = opts.mode === "recent" ? (await readRecentSqliteMessageRecords(target, opts)).messages : projectSqliteHistoryEvents(readSessionTranscriptHistoryEvents(toTranscriptReadScope(target)));
\tif (messages.length === 0 && opts.allowResetArchiveFallback === true) return await archivedTranscriptReader(target).read({
\t\t...opts,
\t\tresetArchiveOnly: true
\t});
\treturn {
\t\tmessages,
\t\ttranscriptPath: target.sessionFile
\t};
}`;

async function withBoundedSessionTranscriptProjectionRetry(read, waitForProjection, isProjectionUnavailable, timeoutMs = PROJECTION_RETRY_TIMEOUT_MS, maxAttempts = PROJECTION_RETRY_MAX_ATTEMPTS, now = () => performance.now()) {
  const deadline = now() + timeoutMs;
  let attempts = 0;
  while (true) {
    try {
      return await read();
    } catch (error) {
      if (!isProjectionUnavailable(error)) throw error;
      attempts += 1;
      const remainingMs = deadline - now();
      if (remainingMs <= 0 || attempts >= maxAttempts) throw error;
      try {
        await waitForProjection(remainingMs);
      } catch (waitError) {
        const name = waitError && typeof waitError === "object" ? waitError.name : void 0;
        if (name !== "AbortError" && name !== "TimeoutError") throw waitError;
      }
    }
  }
}

export { withBoundedSessionTranscriptProjectionRetry };

export function patchSessionHistoryProjectionSource(original) {
  if (original.includes(MARKER)) {
    if (!original.includes('withBoundedSessionTranscriptProjectionRetry(async () =>') || !original.includes('waitForSessionTranscriptProjection(transcriptScope, AbortSignal.timeout(remainingMs))')) {
      throw new Error('incomplete session history projection retry patch');
    }
    return original;
  }
  if (original.split(ORIGINAL_READER).length - 1 !== 1) throw new Error('pinned session history reader anchor mismatch');
  const helper = `// ${MARKER}\nconst SESSION_TRANSCRIPT_PROJECTION_RETRY_TIMEOUT_MS = ${PROJECTION_RETRY_TIMEOUT_MS};\nconst SESSION_TRANSCRIPT_PROJECTION_RETRY_MAX_ATTEMPTS = ${PROJECTION_RETRY_MAX_ATTEMPTS};\n${withBoundedSessionTranscriptProjectionRetry.toString()}`
    .replace('timeoutMs = PROJECTION_RETRY_TIMEOUT_MS, maxAttempts = PROJECTION_RETRY_MAX_ATTEMPTS', 'timeoutMs = SESSION_TRANSCRIPT_PROJECTION_RETRY_TIMEOUT_MS, maxAttempts = SESSION_TRANSCRIPT_PROJECTION_RETRY_MAX_ATTEMPTS');
  const reader = `async function readSessionMessagesWithSourceAsync(scope, opts) {
\tconst target = resolveTranscriptReadTarget(scope);
\tconst transcriptScope = toTranscriptReadScope(target);
\treturn withBoundedSessionTranscriptProjectionRetry(async () => {
\t\tconst messages = opts.mode === "recent" ? (await readRecentSqliteMessageRecords(target, opts)).messages : projectSqliteHistoryEvents(readSessionTranscriptHistoryEvents(transcriptScope));
\t\tif (messages.length === 0 && opts.allowResetArchiveFallback === true) return await archivedTranscriptReader(target).read({
\t\t\t...opts,
\t\t\tresetArchiveOnly: true
\t\t});
\t\treturn {
\t\t\tmessages,
\t\t\ttranscriptPath: target.sessionFile
\t\t};
\t}, (remainingMs) => waitForSessionTranscriptProjection(transcriptScope, AbortSignal.timeout(remainingMs)), isSessionTranscriptProjectionUnavailableError, SESSION_TRANSCRIPT_PROJECTION_RETRY_TIMEOUT_MS, SESSION_TRANSCRIPT_PROJECTION_RETRY_MAX_ATTEMPTS);
}`;
  return original.replace(ORIGINAL_READER, `${helper}\n${reader}`);
}

function atomicWrite(target, content) {
  const mode = fs.statSync(target).mode & 0o777;
  const temporary = `${target}.projection-retry-tmp-${process.pid}`;
  fs.writeFileSync(temporary, content);
  fs.chmodSync(temporary, mode);
  fs.renameSync(temporary, target);
}

function main(argv = process.argv.slice(2)) {
  let coreRoot;
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--core-root') coreRoot = argv[++index];
    else if (arg === '--apply') apply = true;
    else throw new Error(`unknown option ${arg}`);
  }
  if (!coreRoot || !path.isAbsolute(coreRoot)) throw new Error('--core-root must be an absolute path');
  const packageRoot = path.resolve(coreRoot, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  if (packageJson.version !== PIN.version) throw new Error(`openclaw_version_mismatch:${packageJson.version}`);
  const file = path.join(coreRoot, PIN.module);
  const original = fs.readFileSync(file, 'utf8');
  const digest = createHash('sha256').update(original).digest('hex');
  if (digest !== PIN.moduleSha256 && !original.includes(MARKER)) throw new Error(`pinned module digest mismatch: ${PIN.module}`);
  const patched = patchSessionHistoryProjectionSource(original);
  if (apply && patched !== original) atomicWrite(file, patched);
  const attemptFile = path.join(coreRoot, 'builtin-openclaw-B-H-7lKk.mjs');
  const attemptOriginal = fs.readFileSync(attemptFile, 'utf8');
  const attemptDigest = createHash('sha256').update(attemptOriginal).digest('hex');
  if (attemptDigest !== '0a8c813e535c92d03f69bc58381518ba0e6ac6e46f3adda54138c5f668340ea8' && !attemptOriginal.includes('amadeus-attempt-projection-retry-v1')) throw new Error('pinned attempt module digest mismatch');
  const attemptPatched = patchAttemptProjectionSource(attemptOriginal);
  if (apply && attemptPatched !== attemptOriginal) atomicWrite(attemptFile, attemptPatched);
  console.log(`OPENCLAW_SESSION_HISTORY_PROJECTION=${apply ? 'applied' : 'patchable'} module=${PIN.module}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    main();
  } catch (error) {
    console.error(`OPENCLAW_SESSION_HISTORY_PROJECTION=failed ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
