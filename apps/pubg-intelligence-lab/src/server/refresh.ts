import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REFRESH_COOLDOWN_MS = 2 * 60_000;
/** A run that never reports back (crashed host, killed script) must not block the button forever. */
export const REFRESH_STALE_MS = 10 * 60_000;

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../scripts/refresh-intelligence-now.sh');

export interface RefreshStatus {
  state: 'idle' | 'running' | 'done';
  requestedAt: string | null;
  finishedAt: string | null;
  fetch: string | null;
  changed: boolean | null;
  matches: number | null;
  previousMatches: number | null;
  latestMatchMs: number | null;
  cooldownSeconds: number;
}

function stateDirectory(): string {
  return process.env.PUBG_INTELLIGENCE_STATE_DIR?.trim() || join(homedir(), '.local', 'share', 'amadeus', 'pubg-intelligence-lab');
}

function requestFile(): string {
  return join(stateDirectory(), 'refresh-request.json');
}

/** The snapshot refresh script writes its verdict here; it lives next to the snapshot, not in the server state directory. */
function resultFile(): string {
  return join(process.env.INTELLIGENCE_LAB_STATE_DIR?.trim() || join(homedir(), 'Library', 'Application Support', 'Amadeus', 'PubgIntelligenceLab'), 'refresh.json');
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const numberOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export function refreshStatus(now = Date.now()): RefreshStatus {
  const request = readJson(requestFile());
  const requestedAt = typeof request?.at === 'string' ? request.at : null;
  const requestedMs = requestedAt ? Date.parse(requestedAt) : Number.NaN;
  const idle: RefreshStatus = { state: 'idle', requestedAt: null, finishedAt: null, fetch: null, changed: null, matches: null, previousMatches: null, latestMatchMs: null, cooldownSeconds: 0 };
  if (!requestedAt || Number.isNaN(requestedMs)) return idle;
  const cooldownSeconds = Math.max(0, Math.ceil((requestedMs + REFRESH_COOLDOWN_MS - now) / 1000));
  const result = readJson(resultFile());
  const finishedAt = typeof result?.at === 'string' && Date.parse(result.at) >= requestedMs - 1000 ? result.at : null;
  const fetch = typeof request?.fetch === 'string' ? request.fetch : null;
  if (!finishedAt) {
    // Nothing reported yet: still running, or abandoned long ago.
    return now - requestedMs > REFRESH_STALE_MS ? { ...idle, cooldownSeconds } : { ...idle, state: 'running', requestedAt, fetch, cooldownSeconds };
  }
  const summary = result?.summary as Record<string, unknown> | undefined;
  const previous = result?.previous as Record<string, unknown> | undefined;
  return {
    state: 'done', requestedAt, finishedAt, fetch,
    changed: result?.changed === true,
    matches: numberOrNull(summary?.matches),
    previousMatches: numberOrNull(previous?.matches),
    latestMatchMs: numberOrNull(summary?.latestMatchMs),
    cooldownSeconds,
  };
}

export type StartResult = { started: true; status: RefreshStatus } | { started: false; reason: 'running' | 'cooldown'; status: RefreshStatus };

/** Starts one detached refresh; only a single run at a time and not more often than the cooldown. */
export function startRefresh(now = Date.now(), launch: (requestPath: string) => void = launchScript): StartResult {
  const status = refreshStatus(now);
  if (status.state === 'running') return { started: false, reason: 'running', status };
  if (status.cooldownSeconds > 0) return { started: false, reason: 'cooldown', status };
  const file = requestFile();
  writeFileSync(file, JSON.stringify({ at: new Date(now).toISOString(), fetch: null }), { mode: 0o600 });
  launch(file);
  return { started: true, status: refreshStatus(now) };
}

function launchScript(requestPath: string): void {
  if (!existsSync(SCRIPT)) throw new Error('refresh_script_missing');
  // Detached on purpose: the script restarts this very server when new data arrives.
  const child = spawn('bash', [SCRIPT, requestPath], { detached: true, stdio: 'ignore' });
  child.unref();
}
