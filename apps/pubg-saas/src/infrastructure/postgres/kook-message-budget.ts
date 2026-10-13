import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { KookDailyMessageBudget } from '../../application/kook-daily-message-budget.js';

export class KookDailyMessageBudgetError extends Error {
  readonly code = 'kook_message_daily_budget_exhausted';
  constructor(readonly retryAfterMs: number) {
    super('kook_message_daily_budget_exhausted');
    this.name = 'KookDailyMessageBudgetError';
  }
}

interface BudgetWindow {
  window_key: string;
  retry_after_ms: string | number;
}

const CURRENT_WINDOW_SQL = `
  SELECT date_trunc('day', local_now - interval '12 hours')::date::text AS window_key,
         GREATEST(1::BIGINT,
           CEIL(EXTRACT(EPOCH FROM
             (((date_trunc('day', local_now - interval '12 hours') + interval '36 hours')
               AT TIME ZONE 'Asia/Shanghai') - now())
           ) * 1000)::BIGINT
         ) AS retry_after_ms
  FROM (SELECT timezone('Asia/Shanghai', now()) AS local_now) clock
`;

async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  }
  catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
  finally {
    client.release();
  }
}

function reservationHash(reservationId: string): string {
  const normalized = reservationId.trim();
  if (!normalized || normalized.length > 128) throw new Error('kook_message_budget_reservation_invalid');
  return createHash('sha256').update(normalized).digest('hex');
}

/** Durable per-bot reservation cap. KOOK resets its account quota at 12:00
 * Asia/Shanghai; the configured limit is this SaaS bot's reserved share. */
export class PostgresKookDailyMessageBudget implements KookDailyMessageBudget {
  constructor(
    private readonly pool: Pool,
    private readonly botAccountId: string,
    private readonly dailyLimit = 200,
  ) {
    if (!botAccountId.trim() || botAccountId.length > 128) throw new Error('kook_message_budget_bot_invalid');
    if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 10_000)
      throw new Error('kook_message_budget_limit_invalid');
  }

  async reserve(reservationId: string): Promise<void> {
    const hash = reservationHash(reservationId);
    await inTransaction(this.pool, async (client) => {
      await this.lockBot(client);
      const window = await this.currentWindow(client);
      await client.query(
        `INSERT INTO kook_message_daily_usage(bot_account_id,window_key,used_count)
         VALUES ($1,$2,0) ON CONFLICT (bot_account_id) DO NOTHING`,
        [this.botAccountId, window.window_key],
      );
      const usage = await client.query(
        `SELECT window_key::text,used_count FROM kook_message_daily_usage
         WHERE bot_account_id=$1 FOR UPDATE`, [this.botAccountId],
      );
      let used = Number(usage.rows[0]?.used_count ?? 0);
      if (usage.rows[0]?.window_key !== window.window_key) {
        used = 0;
        await client.query(
          `UPDATE kook_message_daily_usage SET window_key=$2,used_count=0,updated_at=now()
           WHERE bot_account_id=$1`, [this.botAccountId, window.window_key],
        );
      }
      const existing = await client.query(
        `SELECT window_key::text,status FROM kook_message_daily_reservations
         WHERE bot_account_id=$1 AND reservation_hash=$2 FOR UPDATE`, [this.botAccountId, hash],
      );
      if (existing.rows[0]?.window_key === window.window_key
        && (existing.rows[0]?.status === 'reserved' || existing.rows[0]?.status === 'spent')) return;
      if (used >= this.dailyLimit) throw new KookDailyMessageBudgetError(Number(window.retry_after_ms));
      await client.query(
        `UPDATE kook_message_daily_usage SET used_count=$2,updated_at=now()
         WHERE bot_account_id=$1`, [this.botAccountId, used + 1],
      );
      await client.query(
        `INSERT INTO kook_message_daily_reservations(bot_account_id,reservation_hash,window_key,status)
         VALUES ($1,$2,$3,'reserved')
         ON CONFLICT (bot_account_id,reservation_hash) DO UPDATE
         SET window_key=EXCLUDED.window_key,status='reserved',updated_at=now()`,
        [this.botAccountId, hash, window.window_key],
      );
    });
  }

  async markSent(reservationId: string): Promise<void> {
    const hash = reservationHash(reservationId);
    await inTransaction(this.pool, async (client) => {
      await this.lockBot(client);
      const result = await client.query(
        `UPDATE kook_message_daily_reservations SET status='spent',updated_at=now()
         WHERE bot_account_id=$1 AND reservation_hash=$2 AND status IN ('reserved','spent')`,
        [this.botAccountId, hash],
      );
      if (result.rowCount !== 1) throw new Error('kook_message_budget_reservation_missing');
    });
  }

  async release(reservationId: string): Promise<void> {
    const hash = reservationHash(reservationId);
    await inTransaction(this.pool, async (client) => {
      await this.lockBot(client);
      const reservation = await client.query(
        `SELECT window_key::text,status FROM kook_message_daily_reservations
         WHERE bot_account_id=$1 AND reservation_hash=$2 FOR UPDATE`, [this.botAccountId, hash],
      );
      const row = reservation.rows[0];
      if (!row || row.status !== 'reserved') return;
      await client.query(
        `UPDATE kook_message_daily_reservations SET status='released',updated_at=now()
         WHERE bot_account_id=$1 AND reservation_hash=$2`, [this.botAccountId, hash],
      );
      await client.query(
        `UPDATE kook_message_daily_usage SET used_count=GREATEST(0,used_count-1),updated_at=now()
         WHERE bot_account_id=$1 AND window_key=$2`, [this.botAccountId, row.window_key],
      );
    });
  }

  async prune(): Promise<number> {
    return inTransaction(this.pool, async (client) => {
      const window = await this.currentWindow(client);
      const deleted = await client.query(
        `DELETE FROM kook_message_daily_reservations
         WHERE bot_account_id=$1 AND window_key < $2::date - 7`, [this.botAccountId, window.window_key],
      );
      return deleted.rowCount ?? 0;
    });
  }

  private async currentWindow(client: PoolClient): Promise<BudgetWindow> {
    const result = await client.query<BudgetWindow>(CURRENT_WINDOW_SQL);
    const window = result.rows[0];
    if (!window || typeof window.window_key !== 'string') throw new Error('kook_message_budget_clock_invalid');
    return window;
  }

  private async lockBot(client: PoolClient): Promise<void> {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`kook-message-budget:${this.botAccountId}`]);
  }
}
