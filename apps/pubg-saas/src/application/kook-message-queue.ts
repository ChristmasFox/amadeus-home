import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { TrustedKookGroupMessage } from '../channels/kook/trusted-group-event.js';

export type KookTextPayload = { type: 'text' | 'kmarkdown' | 'card'; content: string };

export interface AcceptedGroupEvent {
  tenantId: string;
  teamId: string;
  botAccountId: string;
  channelId: string;
  sourceEventId: string;
}

export type GroupEventAcceptance =
  | { status: 'accepted' | 'duplicate'; scope: AcceptedGroupEvent }
  | { status: 'unbound' };

export interface QueuedReply {
  outboxId: string;
  idempotencyKey: string;
  created: boolean;
}

export interface KookOutboxJob {
  tenantId: string | null;
  teamId: string | null;
  botAccountId: string;
  channelId: string | null;
  targetKind: 'channel' | 'direct';
  targetId: string;
  sourceEventId: string | null;
  outboxId: string;
  idempotencyKey: string;
  leaseToken: string;
  attemptCount: number;
  payload: KookTextPayload;
}

export type OutboxDeliveryResult = 'empty' | 'sent' | 'retry' | 'dead';

export interface KookGroupMessageSender {
  send(channelId: string, payload: KookTextPayload, nonce: string, replyToMessageId?: string | null): Promise<void>;
  sendDirect?(userId: string, payload: KookTextPayload, nonce: string, replyToMessageId?: string | null): Promise<void>;
}

export interface KookMessageQueueOptions {
  botAccountId: string;
  leaseMs?: number;
  maxAttempts?: number;
  baseRetryMs?: number;
  maxRetryMs?: number;
  random?: () => number;
}

interface TransactionClient extends PoolClient { }

async function inTransaction<T>(pool: Pool, work: (client: TransactionClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve the original error */ }
    throw error;
  } finally {
    client.release();
  }
}

function requiredText(value: string, key: string, maxLength = 256): string {
  if (typeof value !== 'string') throw new Error(`invalid_${key}`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`invalid_${key}`);
  return normalized;
}

export function validateKookMessagePayload(value: unknown): KookTextPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('kook_payload_invalid');
  const payload = value as Record<string, unknown>;
  if ((payload.type !== 'text' && payload.type !== 'kmarkdown' && payload.type !== 'card') || typeof payload.content !== 'string'
    || !payload.content.trim() || payload.content.length > 8000) {
    throw new Error('kook_payload_invalid');
  }
  if (payload.type === 'card') {
    let cards: unknown;
    try { cards = JSON.parse(payload.content); } catch { throw new Error('kook_payload_invalid'); }
    if (!Array.isArray(cards) || cards.length < 1 || cards.length > 5
      || cards.some((card) => !card || typeof card !== 'object' || (card as Record<string, unknown>).type !== 'card'
        || !Array.isArray((card as Record<string, unknown>).modules))) throw new Error('kook_payload_invalid');
  }
  return { type: payload.type, content: payload.content };
}

function idempotencyKey(event: TrustedKookGroupMessage, part: number): string {
  return createHash('sha256')
    .update(`${event.platform}\0${event.botAccountId}\0${event.messageId}\0${part}`)
    .digest('hex');
}

function safeErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    const code = (error as { code: string }).code;
    if (/^[a-z0-9_-]{1,64}$/iu.test(code)) return code.toLowerCase();
  }
  return 'delivery_failed';
}

function parseJobPayload(value: unknown): KookTextPayload {
  if (typeof value === 'string') {
    try { return validateKookMessagePayload(JSON.parse(value)); } catch { throw new Error('kook_outbox_payload_invalid'); }
  }
  try { return validateKookMessagePayload(value); } catch { throw new Error('kook_outbox_payload_invalid'); }
}

/** Durable, tenant-scoped inbox dedupe and at-least-once group reply delivery.
 * Transport owns the socket; this class never selects a destination from model output. */
export class KookMessageQueue {
  private readonly botAccountId: string;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly baseRetryMs: number;
  private readonly maxRetryMs: number;
  private readonly random: () => number;

  constructor(private readonly pool: Pool, options: KookMessageQueueOptions) {
    this.botAccountId = requiredText(options.botAccountId, 'bot_account_id', 128);
    this.leaseMs = options.leaseMs ?? 30_000;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.baseRetryMs = options.baseRetryMs ?? 1_000;
    this.maxRetryMs = options.maxRetryMs ?? 60_000;
    this.random = options.random ?? Math.random;
    if (!Number.isSafeInteger(this.leaseMs) || this.leaseMs < 1_000 || this.leaseMs > 5 * 60_000) throw new Error('kook_outbox_lease_invalid');
    if (!Number.isSafeInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > 20) throw new Error('kook_outbox_attempt_limit_invalid');
    if (!Number.isSafeInteger(this.baseRetryMs) || this.baseRetryMs < 1 || this.baseRetryMs > 60 * 60_000
      || !Number.isSafeInteger(this.maxRetryMs) || this.maxRetryMs < this.baseRetryMs || this.maxRetryMs > 60 * 60_000) {
      throw new Error('kook_outbox_backoff_invalid');
    }
  }

  async acceptGroupEvent(event: TrustedKookGroupMessage): Promise<GroupEventAcceptance> {
    if (event.botAccountId !== this.botAccountId) throw new Error('kook_bot_scope_mismatch');
    return inTransaction(this.pool, async (client) => {
      const binding = await client.query(
        `SELECT tenant.tenant_id,channel.team_id
         FROM tenants tenant
         JOIN channel_bindings channel
           ON channel.tenant_id=tenant.tenant_id AND channel.platform=tenant.platform
          AND channel.bot_account_id=tenant.bot_account_id
         WHERE tenant.platform='kook' AND tenant.bot_account_id=$1 AND tenant.guild_id=$2
           AND channel.channel_id=$3
         FOR SHARE OF tenant,channel`,
        [event.botAccountId, event.guildId, event.channelId],
      );
      const tenantId = binding.rows[0]?.tenant_id;
      const teamId = binding.rows[0]?.team_id;
      if (typeof tenantId !== 'string' || typeof teamId !== 'string') return { status: 'unbound' };
      const acceptedScope: AcceptedGroupEvent = {
        tenantId,
        teamId,
        botAccountId: event.botAccountId,
        channelId: event.channelId,
        sourceEventId: event.messageId,
      };
      const inserted = await client.query(
        `INSERT INTO message_inbox(platform,bot_account_id,source_event_id,tenant_id,team_id,channel_id,status)
         VALUES ('kook',$1,$2,$3,$4,$5,'received')
         ON CONFLICT (platform,bot_account_id,source_event_id) DO NOTHING
         RETURNING source_event_id`,
        [event.botAccountId, event.messageId, tenantId, teamId, event.channelId],
      );
      return { status: inserted.rowCount === 1 ? 'accepted' : 'duplicate', scope: acceptedScope };
    });
  }

  async enqueueReply(event: TrustedKookGroupMessage, payloadInput: unknown, part = 0): Promise<QueuedReply> {
    if (event.botAccountId !== this.botAccountId) throw new Error('kook_bot_scope_mismatch');
    const payload = validateKookMessagePayload(payloadInput);
    if (!Number.isSafeInteger(part) || part < 0 || part > 9) throw new Error('kook_reply_part_invalid');
    const key = idempotencyKey(event, part);
    const result = await inTransaction(this.pool, async (client) => {
      const inbox = await client.query(
        `SELECT tenant_id,team_id,channel_id
         FROM message_inbox
         WHERE platform='kook' AND bot_account_id=$1 AND source_event_id=$2
         FOR UPDATE`,
        [event.botAccountId, event.messageId],
      );
      const row = inbox.rows[0];
      if (!row || typeof row.tenant_id !== 'string' || typeof row.team_id !== 'string' || row.channel_id !== event.channelId) {
        throw new Error('kook_inbox_event_not_accepted');
      }
      const binding = await client.query(
        `SELECT 1 FROM channel_bindings
         WHERE tenant_id=$1 AND team_id=$2 AND platform='kook' AND bot_account_id=$3 AND channel_id=$4
         FOR SHARE`,
        [row.tenant_id, row.team_id, event.botAccountId, event.channelId],
      );
      if (!binding.rowCount) throw new Error('kook_reply_destination_unbound');
      const inserted = await client.query(
        `INSERT INTO message_outbox(
           outbox_id,idempotency_key,platform,bot_account_id,tenant_id,team_id,channel_id,target_id,source_event_id,payload_json,status
         ) VALUES ($1,$2,'kook',$3,$4,$5,$6,$6,$7,$8::jsonb,'pending')
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING outbox_id`,
        [randomUUID(), key, event.botAccountId, row.tenant_id, row.team_id, row.channel_id, event.messageId, JSON.stringify(payload)],
      );
      const existing = inserted.rows[0]?.outbox_id
        ? String(inserted.rows[0].outbox_id)
        : String((await client.query('SELECT outbox_id FROM message_outbox WHERE idempotency_key=$1', [key])).rows[0]?.outbox_id ?? '');
      if (!existing) throw new Error('kook_outbox_enqueue_failed');
      await client.query(
        `UPDATE message_inbox SET status='reply_queued'
         WHERE platform='kook' AND bot_account_id=$1 AND source_event_id=$2`,
        [event.botAccountId, event.messageId],
      );
      return { outboxId: existing, idempotencyKey: key, created: inserted.rowCount === 1 };
    });
    return result;
  }

  async claimNextOutbox(): Promise<KookOutboxJob | null> {
    const leaseToken = randomBytes(24).toString('base64url');
    const result = await this.pool.query(
      `WITH candidate AS (
         SELECT outbox_id FROM message_outbox
         WHERE status IN ('pending','retry','sending')
           AND (next_attempt_at IS NULL OR next_attempt_at <= now())
           AND bot_account_id=$3
           AND (status <> 'sending' OR lease_until IS NULL OR lease_until <= now())
         ORDER BY created_at,outbox_id
         FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE message_outbox AS message
       SET status='sending', attempt_count=message.attempt_count+1,
           lease_token=$1, lease_until=now() + ($2::BIGINT * interval '1 millisecond')
       FROM candidate
       WHERE message.outbox_id=candidate.outbox_id
       RETURNING message.outbox_id,message.idempotency_key,message.tenant_id,message.team_id,
                 message.bot_account_id,message.channel_id,message.target_kind,message.target_id,
                 message.source_event_id,message.attempt_count,message.payload_json`,
      [leaseToken, this.leaseMs, this.botAccountId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      outboxId: String(row.outbox_id),
      idempotencyKey: String(row.idempotency_key),
      tenantId: typeof row.tenant_id === 'string' ? row.tenant_id : null,
      teamId: typeof row.team_id === 'string' ? row.team_id : null,
      botAccountId: String(row.bot_account_id),
      channelId: typeof row.channel_id === 'string' ? row.channel_id : null,
      targetKind: row.target_kind === 'direct' ? 'direct' : 'channel',
      targetId: typeof row.target_id === 'string' && row.target_id ? row.target_id : String(row.channel_id),
      sourceEventId: typeof row.source_event_id === 'string' ? row.source_event_id : null,
      leaseToken,
      attemptCount: Number(row.attempt_count),
      payload: parseJobPayload(row.payload_json),
    };
  }

  async markSent(job: Pick<KookOutboxJob, 'outboxId' | 'leaseToken'>): Promise<void> {
    const result = await this.pool.query(
      `UPDATE message_outbox
       SET status='sent',payload_json='{}'::jsonb,next_attempt_at=NULL,lease_token=NULL,lease_until=NULL,last_error_code=NULL
       WHERE outbox_id=$1 AND status='sending' AND lease_token=$2`,
      [job.outboxId, job.leaseToken],
    );
    if (result.rowCount !== 1) throw new Error('kook_outbox_lease_lost');
  }

  async markFailed(job: Pick<KookOutboxJob, 'outboxId' | 'leaseToken'>, error: unknown): Promise<'retry' | 'dead'> {
    return inTransaction(this.pool, async (client) => {
      const locked = await client.query(
        `SELECT attempt_count FROM message_outbox
         WHERE outbox_id=$1 AND status='sending' AND lease_token=$2 FOR UPDATE`,
        [job.outboxId, job.leaseToken],
      );
      if (!locked.rowCount) throw new Error('kook_outbox_lease_lost');
      const attempts = Number(locked.rows[0]?.attempt_count);
      const errorCode = safeErrorCode(error);
      if (attempts >= this.maxAttempts) {
        await client.query(
          `UPDATE message_outbox
           SET status='dead',payload_json='{}'::jsonb,next_attempt_at=NULL,lease_token=NULL,lease_until=NULL,last_error_code=$3
           WHERE outbox_id=$1 AND lease_token=$2`,
          [job.outboxId, job.leaseToken, errorCode],
        );
        return 'dead';
      }
      const exponent = Math.min(attempts - 1, 30);
      const backoff = Math.min(this.maxRetryMs, this.baseRetryMs * 2 ** exponent);
      const randomValue = this.random();
      const random = Number.isFinite(randomValue) ? Math.min(Math.max(randomValue, 0), 1) : 0.5;
      const delay = Math.min(this.maxRetryMs, Math.max(1, Math.round(backoff * (0.8 + 0.4 * random))));
      await client.query(
        `UPDATE message_outbox
         SET status='retry',next_attempt_at=now() + ($3::BIGINT * interval '1 millisecond'),
             lease_token=NULL,lease_until=NULL,last_error_code=$4
         WHERE outbox_id=$1 AND lease_token=$2`,
        [job.outboxId, job.leaseToken, delay, errorCode],
      );
      return 'retry';
    });
  }

  async deliverOne(sender: KookGroupMessageSender): Promise<OutboxDeliveryResult> {
    const job = await this.claimNextOutbox();
    if (!job) return 'empty';
    try {
      if (job.targetKind === 'channel' && job.tenantId && job.teamId) {
        const current = await this.pool.query(
          `SELECT 1 FROM channel_bindings WHERE tenant_id=$1 AND team_id=$2
           AND platform='kook' AND bot_account_id=$3 AND channel_id=$4`,
          [job.tenantId, job.teamId, job.botAccountId, job.targetId],
        );
        if (!current.rowCount) {
          await this.pool.query(
            `UPDATE message_outbox SET status='dead',payload_json='{}'::jsonb,
             lease_token=NULL,lease_until=NULL,last_error_code='destination_unbound'
             WHERE outbox_id=$1 AND lease_token=$2`, [job.outboxId, job.leaseToken],
          );
          return 'dead';
        }
      }
      if (job.targetKind === 'direct') {
        if (!sender.sendDirect) throw Object.assign(new Error('direct_sender_unavailable'), { code: 'direct_sender_unavailable' });
        await sender.sendDirect(job.targetId, job.payload, job.idempotencyKey, job.sourceEventId);
      } else {
        await sender.send(job.targetId, job.payload, job.idempotencyKey, job.sourceEventId);
      }
      await this.markSent(job);
      return 'sent';
    } catch (error) {
      return this.markFailed(job, error);
    }
  }

  async pruneRetainedRecords(before: Date): Promise<{ inboxDeleted: number; outboxDeleted: number }> {
    if (!(before instanceof Date) || !Number.isFinite(before.getTime())) throw new Error('kook_retention_cutoff_invalid');
    return inTransaction(this.pool, async (client) => {
      const inbox = await client.query('DELETE FROM message_inbox WHERE received_at < $1 AND bot_account_id=$2', [before, this.botAccountId]);
      const outbox = await client.query(
        `DELETE FROM message_outbox WHERE created_at < $1 AND status IN ('sent','dead') AND bot_account_id=$2`,
        [before, this.botAccountId],
      );
      return { inboxDeleted: inbox.rowCount ?? 0, outboxDeleted: outbox.rowCount ?? 0 };
    });
  }
}
