import { readFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';

const migrationIds = ['0001_public_schema.sql'] as const;

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
