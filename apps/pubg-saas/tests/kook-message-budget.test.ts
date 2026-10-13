import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { KookDailyMessageBudgetError, PostgresKookDailyMessageBudget, migratePublicDatabase } from '../src/index.js';

const databaseUrl = process.env.PUBG_SAAS_TEST_DATABASE_URL;

test('durable KOOK daily send budget serializes reservations, releases known failures, and reuses an attempt reservation', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 6 });
  const bot = `budget-${randomUUID()}`;
  try {
    await migratePublicDatabase(pool);
    const budget = new PostgresKookDailyMessageBudget(pool, bot, 1);
    await budget.reserve('nonce-one');
    await budget.reserve('nonce-one');
    await budget.release('nonce-one');
    await budget.reserve('nonce-two');
    await budget.markSent('nonce-two');
    await budget.reserve('nonce-two');
    await assert.rejects(budget.reserve('nonce-three'), (error: unknown) => {
      assert.ok(error instanceof KookDailyMessageBudgetError);
      assert.equal(error.code, 'kook_message_daily_budget_exhausted');
      assert.ok(error.retryAfterMs > 0 && error.retryAfterMs <= 24 * 60 * 60_000);
      return true;
    });

    const stored = await pool.query(
      'SELECT reservation_hash,status FROM kook_message_daily_reservations WHERE bot_account_id=$1 ORDER BY reservation_hash', [bot],
    );
    assert.equal(stored.rows.length, 2);
    assert.equal(JSON.stringify(stored.rows).includes('nonce-two'), false);
    assert.equal(stored.rows.some(row => row.status === 'spent'), true);

    await pool.query("UPDATE kook_message_daily_usage SET window_key='2000-01-01',used_count=2 WHERE bot_account_id=$1", [bot]);
    await budget.reserve('nonce-three');
    assert.equal(Number((await pool.query('SELECT used_count FROM kook_message_daily_usage WHERE bot_account_id=$1', [bot])).rows[0]?.used_count), 1);
  }
  finally {
    await pool.query('DELETE FROM kook_message_daily_reservations WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM kook_message_daily_usage WHERE bot_account_id=$1', [bot]);
    await pool.end();
  }
});

test('concurrent KOOK budget reservations cannot exceed the configured daily limit', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 6 });
  const bot = `budget-race-${randomUUID()}`;
  try {
    await migratePublicDatabase(pool);
    const budget = new PostgresKookDailyMessageBudget(pool, bot, 1);
    const attempts = await Promise.allSettled([budget.reserve('parallel-a'), budget.reserve('parallel-b')]);
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    const failed = attempts.find(result => result.status === 'rejected');
    assert.ok(failed && failed.status === 'rejected' && failed.reason instanceof KookDailyMessageBudgetError);
    assert.equal(Number((await pool.query('SELECT used_count FROM kook_message_daily_usage WHERE bot_account_id=$1', [bot])).rows[0]?.used_count), 1);
  }
  finally {
    await pool.query('DELETE FROM kook_message_daily_reservations WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM kook_message_daily_usage WHERE bot_account_id=$1', [bot]);
    await pool.end();
  }
});
