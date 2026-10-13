import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { AccountClaimService } from './application/account-claim-service.js';
import { createKookManagementHandler } from './application/kook-management-handler.js';
import { TeamAdminService } from './application/team-admin-service.js';
import { KookPermissionClient } from './channels/kook/permission-client.js';
import { KookApplicationRuntime } from './kook-runtime.js';
/** Explicit source startup target. Without --apply it reads no runtime secret,
 * connects to no service and applies no database migration. */
export async function gatewayMain(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (args.length === 0) {
    process.stdout.write('PUBG_SAAS_GATEWAY=dry-run; startup requires --apply and public DATABASE_URL, KOOK_BOT_ACCOUNT_ID, KOOK_BOT_TOKEN. Apply schema migrations separately.\n');
    return;
  }
  if (args.length !== 1 || args[0] !== '--apply')
    throw new Error('pubg_saas_gateway_arguments_invalid');
  const databaseUrl = env.DATABASE_URL, botId = env.KOOK_BOT_ACCOUNT_ID, token = env.KOOK_BOT_TOKEN;
  if (!databaseUrl || !botId || !token)
    throw new Error('pubg_saas_gateway_config_missing');
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  }
  catch {
    throw new Error('pubg_saas_database_url_invalid');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol))
    throw new Error('pubg_saas_database_url_invalid');
  const pool = new Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, statement_timeout: 5000 });
  const stop = new AbortController();
  const onStop = () => stop.abort();
  process.once('SIGINT', onStop);
  process.once('SIGTERM', onStop);
  try {
    const ready = await pool.query("SELECT 1 FROM schema_migrations WHERE migration_id='0002_kook_ingress.sql'");
    if (!ready.rowCount)
      throw new Error('pubg_saas_schema_upgrade_required');
    const teams = new TeamAdminService(pool, new KookPermissionClient({ token }));
    const claims = new AccountClaimService(pool);
    const runtime = new KookApplicationRuntime({ pool, botAccountId: botId, token, handler: createKookManagementHandler({ teams, claims }), onError: code => process.stderr.write(`${code}\n`) });
    await runtime.run(stop.signal);
  }
  finally {
    stop.abort();
    process.removeListener('SIGINT', onStop);
    process.removeListener('SIGTERM', onStop);
    await pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void gatewayMain(process.argv.slice(2)).catch(() => { process.stderr.write('pubg_saas_gateway_startup_failed\n'); process.exitCode = 1; });
}
