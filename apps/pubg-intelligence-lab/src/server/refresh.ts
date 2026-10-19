import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REFRESH_COOLDOWN_MS = 2 * 60_000;
/** A run that never reports back (crashed host, killed script) must not block the button forever. */
export const REFRESH_STALE_MS = 10 * 60_000;

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../scripts/refresh-intelligence-now.sh');
const SNAPSHOT_SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../scripts/refresh-intelligence-snapshot.sh');
/** A share link that is not in the snapshot yet may refresh the snapshot (never the PUBG fetch), at most this often. */
export const SHARE_SYNC_COOLDOWN_MS = 2 * 60_000;

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

/** Tests (and any host that must never touch the Lab) set this so no refresh script is ever started. */
const scriptsDisabled = () => process.env.PUBG_INTELLIGENCE_REFRESH_SCRIPTS === 'off';

function launchScript(requestPath: string): void {
  if (scriptsDisabled()) return;
  if (!existsSync(SCRIPT)) throw new Error('refresh_script_missing');
  // Detached on purpose: the script restarts this very server when new data arrives.
  const child = spawn('bash', [SCRIPT, requestPath], { detached: true, stdio: 'ignore' });
  child.unref();
}

/**
 * Refreshes only the snapshot (no PUBG fetch, no Lab job) so a just-minted share link becomes readable. Rate-limited
 * across visitors through a timestamp file; the script restarts the page when the data changed.
 */
export function requestSnapshotSync(now = Date.now(), launch: () => void = launchSnapshotSync): boolean {
  const file = join(stateDirectory(), 'share-sync.json');
  const last = readJson(file);
  const lastMs = typeof last?.at === 'string' ? Date.parse(last.at) : Number.NaN;
  if (Number.isFinite(lastMs) && now - lastMs < SHARE_SYNC_COOLDOWN_MS) return false;
  writeFileSync(file, JSON.stringify({ at: new Date(now).toISOString() }), { mode: 0o600 });
  launch();
  return true;
}

function launchSnapshotSync(): void {
  if (scriptsDisabled() || !existsSync(SNAPSHOT_SCRIPT)) return;
  const child = spawn('bash', [SNAPSHOT_SCRIPT, '--apply', '--restart'], { detached: true, stdio: 'ignore' });
  child.unref();
}
