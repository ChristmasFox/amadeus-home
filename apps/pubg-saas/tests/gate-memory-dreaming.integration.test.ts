import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { migratePublicDatabase } from '../src/infrastructure/postgres/migrate.js';
import { PostgresGateMemoryDreamingRunStore } from '../src/application/gate-memory-dreaming.js';

const databaseUrl = process.env.PUBG_SAAS_TEST_DATABASE_URL;
if (process.env.CI === 'true' && !databaseUrl) {
  throw new Error('gate_memory_dreaming_ci_database_required');
}

test('PostgreSQL permits one durable Dreaming claim per Bot and local date', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const botAccountId = `bot-dreaming-${randomUUID().replaceAll('-', '')}`;
  const store = new PostgresGateMemoryDreamingRunStore(pool);
  const firstDate = {
    botAccountId, timezone: 'Asia/Shanghai', localDate: '2026-10-16',
    scheduledAt: new Date('2026-10-15T19:00:00Z'),
  };

  try {
    await migratePublicDatabase(pool);
    const claims = await Promise.all([
      store.claim(firstDate),
      store.claim(firstDate),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    const runId = claims.find((value): value is string => value !== null);
    assert.ok(runId);
    await store.finish(firstDate, runId, 'failed');
    assert.equal(await store.claim(firstDate), null, 'a failed date is not retried immediately');

    const nextDate = { ...firstDate, localDate: '2026-10-17', scheduledAt: new Date('2026-10-16T19:00:00Z') };
    const nextRunId = await store.claim(nextDate);
    assert.ok(nextRunId);
    await store.finish(nextDate, nextRunId, 'succeeded');
    const rows = await pool.query<{ status: string; error_code: string | null }>(
      `SELECT status,error_code FROM gate_memory_dreaming_runs
       WHERE bot_account_id=$1 ORDER BY scheduled_date`, [botAccountId],
    );
    assert.deepEqual(rows.rows, [
      { status: 'failed', error_code: 'dreaming_run_failed' },
      { status: 'succeeded', error_code: null },
    ]);
  } finally {
    await pool.query('DELETE FROM gate_memory_dreaming_runs WHERE bot_account_id=$1', [botAccountId]).catch(() => undefined);
    await pool.end();
  }
});
