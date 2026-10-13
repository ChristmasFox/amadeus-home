import { readFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';

const migrationIds = ['0001_public_schema.sql', '0002_kook_ingress.sql', '0003_onboarding.sql', '0004_guild_welcome.sql', '0005_sharded_match_cache.sql', '0006_query_authorization.sql', '0007_team_scoped_telemetry_features.sql', '0008_public_account_names.sql', '0009_public_sync_jobs.sql', '0010_kook_ingress_rate_limits.sql', '0011_kook_daily_message_budget.sql', '0012_privacy_retention_indexes.sql'] as const;

export async function migratePublicDatabase(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [7192041301]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    for (const migrationId of migrationIds) {
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE migration_id = $1', [migrationId]);
      if (applied.rowCount) continue;
      const migrationUrl = new URL(`./migrations/${migrationId}`, import.meta.url);
      const sql = await readFile(migrationUrl, 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(migration_id) VALUES ($1)', [migrationId]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try { await client.query('ROLLBACK'); } catch { /* keep the migration error */ }
}
