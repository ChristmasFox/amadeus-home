import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { PublicSyncWorker } from './application/public-sync-worker.js';
import { PostgresPublicPubgAdmission } from './infrastructure/pubg/request-limiter.js';

const DEFAULT_INTERVAL_MS = 5 * 60_000;

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) throw new Error('pubg_saas_worker_config_invalid');
  return result;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { signal.removeEventListener('abort', finish); clearTimeout(timer); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

/** Without --apply this entrypoint is a side-effect-free preview. --once keeps
 * an explicitly applied worker run bounded for local acceptance and recovery. */
export async function publicSyncWorkerMain(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (args.length === 0) {
    process.stdout.write('PUBG_SAAS_SYNC_WORKER=dry-run; start requires --apply, DATABASE_URL, and PUBLIC_PUBG_API_KEY.\n');
    return;
  }
  const once = args.includes('--once');
  if (!args.includes('--apply') || args.length !== (once ? 2 : 1) || args.some(value => value !== '--apply' && value !== '--once')) {
    throw new Error('pubg_saas_worker_arguments_invalid');
  }
  const databaseUrl = env.DATABASE_URL;
  const apiKey = env.PUBLIC_PUBG_API_KEY;
  if (!databaseUrl || !apiKey?.trim()) throw new Error('pubg_saas_worker_config_missing');
  let parsed: URL;
  try { parsed = new URL(databaseUrl); }
  catch { throw new Error('pubg_saas_database_url_invalid'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('pubg_saas_database_url_invalid');

  const requestsPerMinute = positiveInteger(env.PUBLIC_PUBG_REQUESTS_PER_MINUTE, 10, 1000);
  const intervalMs = positiveInteger(env.PUBLIC_SYNC_INTERVAL_MS, DEFAULT_INTERVAL_MS, 24 * 60 * 60_000);
  const maxMatches = positiveInteger(env.PUBLIC_SYNC_MAX_MATCHES, 500, 1000);
  const maxTelemetryFetches = positiveInteger(env.PUBLIC_SYNC_MAX_TELEMETRY_FETCHES, 20, 50);
  const pool = new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, statement_timeout: 30_000 });
  const stop = new AbortController();
  const onStop = () => stop.abort();
  process.once('SIGINT', onStop);
  process.once('SIGTERM', onStop);
  try {
    const ready = await pool.query("SELECT 1 FROM schema_migrations WHERE migration_id='0008_public_account_names.sql'");
    if (!ready.rowCount) throw new Error('pubg_saas_schema_upgrade_required');
    const worker = new PublicSyncWorker(pool, {
      apiKey,
      admission: new PostgresPublicPubgAdmission(pool, requestsPerMinute, 30_000),
      maxMatches,
      maxTelemetryFetches,
      onTeamError: code => process.stderr.write(`${code}\n`),
    });
    do {
      const result = await worker.runOnce(stop.signal);
      process.stdout.write(`PUBG_SAAS_SYNC_WORKER teams=${result.teamsDiscovered} completed=${result.teamsCompleted} failed=${result.teamsFailed} matches=${result.matchesDiscovered} telemetry_fetched=${result.telemetryFetched} telemetry_unavailable=${result.telemetryUnavailable}\n`);
      if (once || stop.signal.aborted) break;
      await wait(intervalMs, stop.signal);
    } while (!stop.signal.aborted);
  } finally {
    stop.abort();
    process.removeListener('SIGINT', onStop);
    process.removeListener('SIGTERM', onStop);
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void publicSyncWorkerMain(process.argv.slice(2)).catch(() => {
    process.stderr.write('pubg_saas_sync_worker_startup_failed\n');
    process.exitCode = 1;
  });
}
