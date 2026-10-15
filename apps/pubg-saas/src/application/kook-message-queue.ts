import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { TrustedKookGroupMessage } from '../channels/kook/trusted-group-event.js';

export type KookTextPayload = { type: 'text' | 'kmarkdown' | 'card'; content: string };
export const KOOK_MAX_MESSAGE_LENGTH = 8000;

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
  welcomeGuildId: string | null;
  sourceEventId: string | null;
  replyToMessageId: string | null;
  outboxId: string;
  idempotencyKey: string;
  leaseToken: string;
  attemptCount: number;
  payload: KookTextPayload;
}

export type OutboxDeliveryResult = 'empty' | 'sent' | 'retry' | 'dead';

export interface KookGroupMessageSender {
  send(channelId: string, payload: KookTextPayload, nonce: string, replyToMessageId?: string | null): Promise<string | void>;
  sendDirect?(userId: string, payload: KookTextPayload, nonce: string, replyToMessageId?: string | null): Promise<string | void>;
  verifyWelcomeTarget?(guildId:string,channelId:string):Promise<boolean>;
}

export interface KookMessageQueueOptions {
  botAccountId: string;
  leaseMs?: number;
  maxAttempts?: number;
  baseRetryMs?: number;
  maxRetryMs?: number;
  random?: () => number;
  onDeliveryFailure?: (event: KookOutboxFailureDiagnostic) => void;
}

export interface KookOutboxFailureDiagnostic {
  event: 'kook_outbox_delivery_failed';
  stage: 'outbox';
  outcome: 'retry' | 'dead';
  reason: string;
  requestKey: string;
  channelId?: string;
  count: number;
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
    || !payload.content.trim() || payload.content.length > KOOK_MAX_MESSAGE_LENGTH) {
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

const REPLY_CLEANUP_FALLBACK = '我刚才没整理好回复，可以再问我一次吗？';
const INTERNAL_JSON_KEYS = new Set([
  'tool', 'toolname', 'toolcallid', 'toolresults', 'queryplan', 'intent', 'subject',
  'playername', 'actorname', 'victimname', 'meleekind', 'evidencerefs',
  'metricversion', 'debug', 'internal', 'finishreason', 'steps',
]);

function hasInternalJsonKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasInternalJsonKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) =>
    INTERNAL_JSON_KEYS.has(key.toLocaleLowerCase('en-US')) || hasInternalJsonKey(child));
}

/** Remove model-visible conversation scaffolding without rewriting ordinary
 * prose or KOOK mention markup. Internal structured output fails closed. */
export function sanitizeKookAssistantReplyContent(value: string): string {
  let content = value.replace(/^\uFEFF/u, '').trim();
  for (let pass = 0; pass < 12; pass += 1) {
    const speaker = content.match(/^\s*(?:\[(?:回复\s*)?成员\s*#?\d+\]|(?:回复\s*)?成员\s*#?\d+\s*(?:说|回复)?\s*[:：])\s*/iu);
    if (speaker) {
      content = content.slice(speaker[0].length).trimStart();
      continue;
    }
    const marker = content.match(/^\s*(?:\[(assistant|final|debug|internal|tool|json|queryplan|tool[_ -]?call)\]|(assistant\s+final|final\s+answer|debug|internal|queryplan|tool[_ -]?call|json)\s*[:：])\s*/iu);
    if (marker) {
      const label = (marker[1] ?? marker[2] ?? '').toLocaleLowerCase('en-US').replaceAll(/\s+/gu, ' ');
      if (label === 'debug' || label === 'internal' || label === 'queryplan' || label === 'tool' || label.replaceAll(/[_-]/gu, ' ') === 'tool call') {
        return REPLY_CLEANUP_FALLBACK;
      }
      content = content.slice(marker[0].length).trimStart();
      continue;
    }
    break;
  }

  if (!content) return REPLY_CLEANUP_FALLBACK;
  const fencedJson = content.match(/^```json\s*\n([\s\S]*?)\n```\s*$/iu);
  const jsonCandidate = fencedJson?.[1] ?? content;
  if (/^[{[]/u.test(jsonCandidate.trimStart())) {
    try {
      const parsed: unknown = JSON.parse(jsonCandidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        if (typeof record.content === 'string' && (record.type === 'text' || record.type === 'kmarkdown')
          && keys.every(key => key === 'content' || key === 'type')) {
          return sanitizeKookAssistantReplyContent(record.content);
        }
        if (typeof record.answer === 'string' && keys.length === 1) {
          return sanitizeKookAssistantReplyContent(record.answer);
        }
      }
      if (hasInternalJsonKey(parsed)) return REPLY_CLEANUP_FALLBACK;
    } catch {
      // Keep malformed or user-facing JSON-like prose intact; only known
      // internal structures are blocked below.
    }
  }
  return content;
}

/** Apply deterministic cleanup before persistence and again at the KOOK HTTP boundary. */
export function sanitizeKookOutboundPayload(value: unknown): KookTextPayload {
  const payload = validateKookMessagePayload(value);
  if (payload.type === 'card') return payload;
  return validateKookMessagePayload({
    type: payload.type,
    content: sanitizeKookAssistantReplyContent(payload.content),
  });
}

/** Sanitize a complete model reply, then split it into platform-sized sends.
 * KOOK mention markup remains intact when it crosses a prospective boundary. */
export function splitKookOutboundPayload(value: unknown): KookTextPayload[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('kook_payload_invalid');
  const candidate = value as Record<string, unknown>;
  if ((candidate.type !== 'text' && candidate.type !== 'kmarkdown' && candidate.type !== 'card')
    || typeof candidate.content !== 'string' || !candidate.content.trim()) throw new Error('kook_payload_invalid');
  if (candidate.type === 'card') return [sanitizeKookOutboundPayload(value)];
  const type = candidate.type;
  const content = sanitizeKookAssistantReplyContent(candidate.content);
  const chunks: string[] = [];
  const mentionPattern = /\(met\)[^()\s]{1,128}\(met\)|<@!?[^>]{1,128}>/gu;
  let start = 0;
  while (start < content.length) {
    let end = Math.min(start + KOOK_MAX_MESSAGE_LENGTH, content.length);
    if (end < content.length) {
      if (end > start && /[\uDC00-\uDFFF]/u.test(content[end]!)) end -= 1;
      mentionPattern.lastIndex = 0;
      for (const match of content.matchAll(mentionPattern)) {
        const mentionStart = match.index ?? 0;
        const mentionEnd = mentionStart + match[0].length;
        if (mentionStart < end && mentionEnd > end) {
          end = mentionStart > start ? mentionStart : mentionEnd;
          break;
        }
      }
      const floor = start + Math.floor((end - start) * 0.65);
      const newline = content.lastIndexOf('\n', end - 1);
      const whitespace = Math.max(content.lastIndexOf(' ', end - 1), content.lastIndexOf('\t', end - 1));
      const boundary = Math.max(newline, whitespace);
      if (boundary >= floor) end = boundary + 1;
    }
    if (end <= start) end = Math.min(start + KOOK_MAX_MESSAGE_LENGTH, content.length);
    chunks.push(content.slice(start, end));
    start = end;
  }
  return chunks.map(chunk => validateKookMessagePayload({ type, content: chunk }));
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
    try { return sanitizeKookOutboundPayload(JSON.parse(value)); } catch { throw new Error('kook_outbox_payload_invalid'); }
  }
  try { return sanitizeKookOutboundPayload(value); } catch { throw new Error('kook_outbox_payload_invalid'); }
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
  private readonly onDeliveryFailure: ((event: KookOutboxFailureDiagnostic) => void) | undefined;
  private readonly diagnosticWindows = new Map<string, { loggedAt: number; suppressed: number }>();

  constructor(private readonly pool: Pool, options: KookMessageQueueOptions) {
    this.botAccountId = requiredText(options.botAccountId, 'bot_account_id', 128);
    this.leaseMs = options.leaseMs ?? 30_000;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.baseRetryMs = options.baseRetryMs ?? 1_000;
    this.maxRetryMs = options.maxRetryMs ?? 60_000;
    this.random = options.random ?? Math.random;
    this.onDeliveryFailure = options.onDeliveryFailure;
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
    const payloads = splitKookOutboundPayload(payloadInput);
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
      let firstInsertedId = '';
      let created = false;
      for (const [replyPart, payload] of payloads.entries()) {
        const partKey = payloads.length === 1 ? key : createHash('sha256').update(`${key}\0${replyPart}`).digest('hex');
        const inserted = await client.query(
          `INSERT INTO message_outbox(
             outbox_id,idempotency_key,reply_group_key,reply_part,reply_part_count,
             platform,bot_account_id,tenant_id,team_id,channel_id,target_id,source_event_id,reply_to_message_id,payload_json,status
           ) VALUES ($1,$2,$3,$4,$5,'kook',$6,$7,$8,$9,$9,$10,$11,$12::jsonb,'pending')
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING outbox_id`,
          [randomUUID(), partKey, payloads.length > 1 ? key : '', replyPart, payloads.length,
            event.botAccountId, row.tenant_id, row.team_id, row.channel_id, event.messageId,
            replyPart === 0 ? event.messageId : null, JSON.stringify(payload)],
        );
        const outboxId = inserted.rows[0]?.outbox_id
          ? String(inserted.rows[0].outbox_id)
          : String((await client.query('SELECT outbox_id FROM message_outbox WHERE idempotency_key=$1', [partKey])).rows[0]?.outbox_id ?? '');
        if (!outboxId) throw new Error('kook_outbox_enqueue_failed');
        if (replyPart === 0) firstInsertedId = outboxId;
        if (inserted.rowCount === 1) created = true;
      }
      await client.query(
        `UPDATE message_inbox SET status='reply_queued'
         WHERE platform='kook' AND bot_account_id=$1 AND source_event_id=$2`,
        [event.botAccountId, event.messageId],
      );
      return { outboxId: firstInsertedId, idempotencyKey: key, created };
    });
    return result;
  }

  async claimNextOutbox(): Promise<KookOutboxJob | null> {
    const leaseToken = randomBytes(24).toString('base64url');
    const result = await this.pool.query(
      `WITH candidate AS (
         SELECT message.outbox_id FROM message_outbox message
         WHERE message.status IN ('pending','retry','sending')
           AND (message.next_attempt_at IS NULL OR message.next_attempt_at <= now())
           AND message.bot_account_id=$3
           AND (message.status <> 'sending' OR message.lease_until IS NULL OR message.lease_until <= now())
           AND (message.reply_group_key='' OR NOT EXISTS (
             SELECT 1 FROM message_outbox earlier
             WHERE earlier.bot_account_id=message.bot_account_id
               AND earlier.reply_group_key=message.reply_group_key
               AND earlier.reply_part<message.reply_part AND earlier.status<>'sent'
           ))
         ORDER BY message.created_at,message.outbox_id
         FOR UPDATE OF message SKIP LOCKED LIMIT 1
       )
       UPDATE message_outbox AS message
       SET status='sending', attempt_count=message.attempt_count+1,
           lease_token=$1, lease_until=now() + ($2::BIGINT * interval '1 millisecond')
       FROM candidate
       WHERE message.outbox_id=candidate.outbox_id
       RETURNING message.outbox_id,message.idempotency_key,message.tenant_id,message.team_id,
                 message.bot_account_id,message.channel_id,message.target_kind,message.target_id,
                 message.source_event_id,message.reply_to_message_id,message.attempt_count,message.payload_json,message.welcome_guild_id`,
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
      welcomeGuildId:typeof row.welcome_guild_id==='string'?row.welcome_guild_id:null,
      sourceEventId: typeof row.source_event_id === 'string' ? row.source_event_id : null,
      replyToMessageId: typeof row.reply_to_message_id === 'string' ? row.reply_to_message_id : null,
      leaseToken,
      attemptCount: Number(row.attempt_count),
      payload: parseJobPayload(row.payload_json),
    };
  }

  async markSent(job: KookOutboxJob, remoteMessageId?: string): Promise<void> {
    await inTransaction(this.pool, async client => {
      const result = await client.query(
        `UPDATE message_outbox
         SET status='sent',payload_json='{}'::jsonb,next_attempt_at=NULL,lease_token=NULL,lease_until=NULL,last_error_code=NULL
         WHERE outbox_id=$1 AND status='sending' AND lease_token=$2`,
        [job.outboxId, job.leaseToken],
      );
      if (result.rowCount !== 1) throw new Error('kook_outbox_lease_lost');
      if (remoteMessageId && /^[^\u0000-\u001f]{1,256}$/u.test(remoteMessageId) && job.sourceEventId) {
        const conversationChannel = job.targetKind === 'channel' ? job.targetId : `dm:${job.botAccountId}:${job.targetId}`;
        await client.query(
          `UPDATE kook_conversation_messages SET message_id=$4
           WHERE bot_account_id=$1 AND channel_id=$2 AND message_id=$3`,
          [job.botAccountId, conversationChannel, `assistant:${job.sourceEventId}`, remoteMessageId],
        );
      }
    });
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
      const providerDelay = error && typeof error === 'object' && 'retryAfterMs' in error
        && typeof (error as { retryAfterMs?: unknown }).retryAfterMs === 'number'
        ? (error as { retryAfterMs: number }).retryAfterMs : null;
      const providerRateLimited = errorCode === 'kook_message_api_rate_limited';
      if (attempts >= this.maxAttempts && !providerRateLimited) {
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
      const delay = providerRateLimited && providerDelay !== null && Number.isFinite(providerDelay)
        ? Math.min(24 * 60 * 60_000, Math.max(1, Math.ceil(providerDelay)))
        : Math.min(this.maxRetryMs, Math.max(1, Math.round(backoff * (0.8 + 0.4 * random))));
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
      if(job.welcomeGuildId){
        if(!sender.verifyWelcomeTarget)throw Object.assign(new Error('kook_welcome_verifier_unavailable'),{code:'kook_welcome_verifier_unavailable'});
        if(!await sender.verifyWelcomeTarget(job.welcomeGuildId,job.targetId)){
          await this.pool.query("UPDATE message_outbox SET status='dead',payload_json='{}'::jsonb,lease_token=NULL,lease_until=NULL,last_error_code='kook_welcome_target_invalid' WHERE outbox_id=$1 AND lease_token=$2",[job.outboxId,job.leaseToken]);
          return 'dead';
        }
      }
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
        const remoteMessageId = await sender.sendDirect(job.targetId, job.payload, job.idempotencyKey, job.replyToMessageId);
        await this.markSent(job, typeof remoteMessageId === 'string' ? remoteMessageId : undefined);
      } else {
        const remoteMessageId = await sender.send(job.targetId, job.payload, job.idempotencyKey, job.replyToMessageId);
        await this.markSent(job, typeof remoteMessageId === 'string' ? remoteMessageId : undefined);
      }
      return 'sent';
    } catch (error) {
      const outcome = await this.markFailed(job, error);
      this.reportDeliveryFailure(job, error, outcome);
      return outcome;
    }
  }

  private reportDeliveryFailure(job: KookOutboxJob, error: unknown, outcome: 'retry' | 'dead'): void {
    if (!this.onDeliveryFailure) return;
    const reason = safeErrorCode(error);
    const channelId = job.channelId && /^[0-9]{1,40}$/u.test(job.channelId) ? job.channelId : undefined;
    const key = `${reason}:${outcome}:${channelId ?? ''}`;
    const now = Date.now();
    let window = this.diagnosticWindows.get(key);
    if (!window) {
      if (this.diagnosticWindows.size >= 64) {
        const oldest = this.diagnosticWindows.keys().next().value;
        if (oldest !== undefined) this.diagnosticWindows.delete(oldest);
      }
      window = { loggedAt: now, suppressed: 0 };
      this.diagnosticWindows.set(key, window);
    } else if (now - window.loggedAt < 60_000) {
      window.suppressed += 1;
      return;
    } else {
      const count = window.suppressed + 1;
      window.loggedAt = now;
      window.suppressed = 0;
      try {
        this.onDeliveryFailure({
          event: 'kook_outbox_delivery_failed', stage: 'outbox', outcome, reason,
          requestKey: createHash('sha256').update(`${job.botAccountId}\0${job.sourceEventId ?? job.outboxId}`).digest('hex').slice(0, 16),
          ...(channelId ? { channelId } : {}), count,
        });
      } catch { /* diagnostics must not change the durable delivery result */ }
      return;
    }
    try {
      this.onDeliveryFailure({
        event: 'kook_outbox_delivery_failed', stage: 'outbox', outcome, reason,
        requestKey: createHash('sha256').update(`${job.botAccountId}\0${job.sourceEventId ?? job.outboxId}`).digest('hex').slice(0, 16),
        ...(channelId ? { channelId } : {}), count: 1,
      });
    } catch { /* diagnostics must not change the durable delivery result */ }
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
