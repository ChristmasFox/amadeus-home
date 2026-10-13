import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { migratePublicDatabase } from './infrastructure/postgres/migrate.js';
export async function migrationMain(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (args.length === 0) {
    process.stdout.write('PUBG_SAAS_MIGRATION=dry-run; public schema migration requires --apply and DATABASE_URL.\n');
    return;
  }
  if (args.length !== 1 || args[0] !== '--apply')
    throw new Error('pubg_saas_migration_arguments_invalid');
  if (!env.DATABASE_URL)
    throw new Error('pubg_saas_database_url_missing');
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 30000 });
  try {
    await migratePublicDatabase(pool);
    process.stdout.write('PUBG_SAAS_MIGRATION=applied\n');
  }
  finally {
    await pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void migrationMain(process.argv.slice(2)).catch(() => { process.stderr.write('pubg_saas_migration_failed\n'); process.exitCode = 1; });
}
