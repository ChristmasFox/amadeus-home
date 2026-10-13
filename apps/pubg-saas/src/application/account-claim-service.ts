import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { TrustedKookButtonClick } from '../channels/kook/trusted-button-event.js';
import type { TrustedKookDirectMessage } from '../channels/kook/trusted-group-event.js';

export interface AccountClaimInput {
  pubgShard: string;
  pubgAccountId: string;
}

export interface PreparedAccountClaim {
  confirmationToken: string;
  expiresAt: string;
}

export interface AccountClaimRecord extends AccountClaimInput {
  claimStatus: 'self_declared' | 'verified';
}

export interface SelfDeclaredAccountClaim extends AccountClaimInput {
  claimStatus: 'self_declared';
}

export type ConfirmedAccountClaim =
  | { kind: 'claim'; claim: SelfDeclaredAccountClaim }
  | { kind: 'unclaim'; removed: true };

export interface AccountClaimServiceOptions {
  confirmationTtlMs?: number;
}

type PendingAccountAction =
  | { kind: 'claim'; pubgShard: string; pubgAccountId: string }
  | { kind: 'unclaim'; pubgShard: string; pubgAccountId: string };

function requiredText(value: string, key: string, maxLength = 256): string {
  if (typeof value !== 'string') throw new Error(`invalid_${key}`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`invalid_${key}`);
  return normalized;
}

function claimInput(input: AccountClaimInput): PendingAccountAction {
  if (!input || typeof input !== 'object') throw new Error('invalid_account_claim');
  const pubgShard = requiredText(input.pubgShard, 'pubg_shard', 32);
  if (!/^[a-z0-9_-]+$/u.test(pubgShard)) throw new Error('invalid_pubg_shard');
  const pubgAccountId = requiredText(input.pubgAccountId, 'pubg_account_id');
  return { kind: 'claim', pubgShard, pubgAccountId };
}

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === '23505');
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try { await client.query('ROLLBACK'); } catch { /* preserve the original error */ }
}

/** User-scoped, self-declared PUBG account claims. A claim is never treated as
 * proof of ownership; the durable interaction is bound to a KOOK direct actor. */
export class AccountClaimService {
  private readonly confirmationTtlMs: number;

  constructor(private readonly pool: Pool, options: AccountClaimServiceOptions = {}) {
    this.confirmationTtlMs = options.confirmationTtlMs ?? 10 * 60_000;
    if (!Number.isSafeInteger(this.confirmationTtlMs) || this.confirmationTtlMs < 1_000 || this.confirmationTtlMs > 15 * 60_000) {
      throw new Error('account_claim_confirmation_ttl_invalid');
    }
  }

  async getMyClaim(event: TrustedKookDirectMessage): Promise<AccountClaimRecord | null> {
    const result = await this.pool.query(
      `SELECT pubg_shard, pubg_account_id, claim_status
       FROM account_claims WHERE platform='kook' AND bot_account_id=$1 AND user_id=$2`,
      [event.botAccountId, event.userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.claim_status !== 'verified' && row.claim_status !== 'self_declared') throw new Error('account_claim_state_invalid');
    return {
      pubgShard: String(row.pubg_shard),
      pubgAccountId: String(row.pubg_account_id),
      claimStatus: row.claim_status,
    };
  }

  async prepareClaim(event: TrustedKookDirectMessage, input: AccountClaimInput): Promise<PreparedAccountClaim> {
    return this.prepare(event, claimInput(input));
  }

  async prepareUnclaim(event: TrustedKookDirectMessage): Promise<PreparedAccountClaim> {
    const existing = await this.getMyClaim(event);
    if (!existing) throw new Error('account_claim_not_found');
    return this.prepare(event, { kind: 'unclaim', pubgShard: existing.pubgShard, pubgAccountId: existing.pubgAccountId });
  }

  private async prepare(event: TrustedKookDirectMessage, action: PendingAccountAction): Promise<PreparedAccountClaim> {
    const confirmationToken = randomBytes(32).toString('base64url');
    const confirmationId = randomUUID();
    const expiresAt = new Date(Date.now() + this.confirmationTtlMs);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (action.kind === 'claim') {
        const existing = await client.query(
          `SELECT 1 FROM account_claims WHERE platform='kook' AND bot_account_id=$1 AND user_id=$2`,
          [event.botAccountId, event.userId],
        );
        if (existing.rowCount) throw new Error('account_claim_already_bound');
      }
      if (action.kind === 'unclaim') {
        const existing = await client.query(
          `SELECT 1 FROM account_claims WHERE platform='kook' AND bot_account_id=$1 AND user_id=$2`,
          [event.botAccountId, event.userId],
        );
        if (!existing.rowCount) throw new Error('account_claim_not_found');
      }
      await client.query("DELETE FROM pending_account_claims WHERE bot_account_id=$1 AND ((consumed_at IS NULL AND expires_at <= now()) OR consumed_at < now() - interval '1 day')", [event.botAccountId]);
      const count = await client.query(
        `SELECT COUNT(*)::INTEGER AS count FROM pending_account_claims
         WHERE platform='kook' AND bot_account_id=$1 AND user_id=$2 AND consumed_at IS NULL AND expires_at > now()`,
        [event.botAccountId, event.userId],
      );
      if (Number(count.rows[0]?.count) >= 10) throw new Error('too_many_pending_account_claims');
      await client.query(
        `INSERT INTO pending_account_claims(
           confirmation_id,token_hash,platform,bot_account_id,user_id,action,pubg_shard,pubg_account_id,expires_at
         ) VALUES ($1,$2,'kook',$3,$4,$5,$6,$7,$8)`,
        [confirmationId, digest(confirmationToken), event.botAccountId, event.userId, action.kind,
          action.pubgShard, action.pubgAccountId, expiresAt],
      );
      await client.query('COMMIT');
      return { confirmationToken, expiresAt: expiresAt.toISOString() };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async confirm(event: TrustedKookDirectMessage, tokenInput: string): Promise<ConfirmedAccountClaim> {
    return this.confirmForActor(event, tokenInput, null);
  }

  async confirmFromButton(click: TrustedKookButtonClick): Promise<ConfirmedAccountClaim> {
    return this.confirmForActor(click, click.value, click.eventId);
  }

  private async confirmForActor(event: { botAccountId: string; userId: string }, tokenInput: string, receiptEventId: string | null): Promise<ConfirmedAccountClaim> {
    const token = requiredText(tokenInput, 'confirmation_token', 64);
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) throw new Error('account_claim_confirmation_unavailable');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const pending = await client.query(
        `SELECT action,pubg_shard,pubg_account_id,consumed_at,consumed_event_id
         FROM pending_account_claims
         WHERE token_hash=$1 AND platform='kook' AND bot_account_id=$2 AND user_id=$3
           AND ((expires_at > now() AND consumed_at IS NULL)
             OR ($4::TEXT IS NOT NULL AND consumed_event_id=$4 AND consumed_at>now()-interval '1 day'))
         FOR UPDATE`,
        [digest(token), event.botAccountId, event.userId, receiptEventId],
      );
      const row = pending.rows[0];
      if (!row) throw new Error('account_claim_confirmation_unavailable');

      if (row.consumed_at) {
        const result: ConfirmedAccountClaim = row.action === 'unclaim'
          ? { kind: 'unclaim', removed: true }
          : {
            kind: 'claim',
            claim: {
              pubgShard: requiredText(row.pubg_shard, 'pubg_shard', 32),
              pubgAccountId: requiredText(row.pubg_account_id, 'pubg_account_id'),
              claimStatus: 'self_declared',
            },
          };
        await client.query('COMMIT');
        return result;
      }

      let result: ConfirmedAccountClaim;
      if (row.action === 'claim') {
        const pubgShard = requiredText(String(row.pubg_shard ?? ''), 'pubg_shard', 32);
        const pubgAccountId = requiredText(String(row.pubg_account_id ?? ''), 'pubg_account_id');
        const existing = await client.query(
          `SELECT pubg_shard,pubg_account_id FROM account_claims
           WHERE platform='kook' AND bot_account_id=$1 AND user_id=$2 FOR UPDATE`,
          [event.botAccountId, event.userId],
        );
        if (existing.rowCount) {
          const current = existing.rows[0];
          if (current?.pubg_shard !== pubgShard || current?.pubg_account_id !== pubgAccountId) {
            throw new Error('account_claim_already_bound');
          }
        } else {
          await client.query(
            `INSERT INTO channel_identities(platform,bot_account_id,user_id)
             VALUES ('kook',$1,$2) ON CONFLICT (platform,bot_account_id,user_id) DO NOTHING`,
            [event.botAccountId, event.userId],
          );
          await client.query(
            `INSERT INTO account_claims(platform,bot_account_id,user_id,pubg_shard,pubg_account_id,claim_status)
             VALUES ('kook',$1,$2,$3,$4,'self_declared')`,
            [event.botAccountId, event.userId, pubgShard, pubgAccountId],
          );
        }
        result = { kind: 'claim', claim: { pubgShard, pubgAccountId, claimStatus: 'self_declared' } };
      } else if (row.action === 'unclaim') {
        const pubgShard = requiredText(String(row.pubg_shard ?? ''), 'pubg_shard', 32);
        const pubgAccountId = requiredText(String(row.pubg_account_id ?? ''), 'pubg_account_id');
        const removed = await client.query(
          `DELETE FROM account_claims
           WHERE platform='kook' AND bot_account_id=$1 AND user_id=$2 AND pubg_shard=$3 AND pubg_account_id=$4`,
          [event.botAccountId, event.userId, pubgShard, pubgAccountId],
        );
        if (removed.rowCount !== 1) throw new Error('account_claim_not_found');
        result = { kind: 'unclaim', removed: true };
      } else {
        throw new Error('account_claim_confirmation_unavailable');
      }

      await client.query(
        `DELETE FROM pending_account_claims
         WHERE platform='kook' AND bot_account_id=$1 AND user_id=$2 AND token_hash<>$3 AND consumed_at IS NULL`,
        [event.botAccountId, event.userId, digest(token)],
      );
      await client.query('UPDATE pending_account_claims SET consumed_at=now(),consumed_event_id=$2 WHERE token_hash=$1', [digest(token), receiptEventId]);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await rollbackQuietly(client);
      if (isUniqueViolation(error)) throw new Error('account_claim_conflict');
      throw error;
    } finally {
      client.release();
    }
  }
}
