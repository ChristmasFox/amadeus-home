import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { inspectKookRequest, parseKookRequest, type KookRequestEvent } from '../channels/kook/request-event.js';
import { validateKookMessagePayload, type KookTextPayload } from './kook-message-queue.js';
import {isVerifiedKookWelcomeTarget,type VerifiedKookWelcomeTarget,type KookGuildWelcomeResolver} from '../channels/kook/guild-welcome.js';
import type { TrustedKookGroupMessage } from '../channels/kook/trusted-group-event.js';
import { sanitizeKookMentionMarkup } from '../channels/kook/trusted-group-event.js';
import type { TrustedKookGuildJoin } from '../channels/kook/guild-welcome.js';
export interface KookIngressJob {
  botAccountId: string;
  eventId: string;
  leaseToken: string;
  attemptCount: number;
  /** Admission-time generation; same-team unbind/rebind still invalidates it. */
  bindingRevision: string | null;
  request: KookRequestEvent;
  boundTeam: {
    tenantId: string;
    teamId: string;
  } | null;
}
export interface KookIngressQueueOptions {
  botAccountId: string;
  maxPending?: number;
  maxPendingPerUser?: number;
  maxRequestsPerUserPerMinute?: number;
  maxRequestsPerChannelPerMinute?: number;
  maxRequestsPerTenantPerMinute?: number;
  maxRequestsPerBotPerMinute?: number;
  payloadTtlMs?: number;
  leaseMs?: number;
  maxAttempts?: number;
  baseRetryMs?: number;
  onDiscard?: (event: KookIngressDiscardLog) => void;
}
export interface KookIngressDiscardLog {
  event: 'kook_ingress_discarded';
  stage: 'trusted_group' | 'freshness' | 'admission' | 'processing';
  reason: string;
  count: number;
  channelId?: string;
}
export type KookIngressResult = 'ignored' | 'accepted' | 'duplicate';
export type KookIngressProcessResult = 'empty' | 'done' | 'retry' | 'dead';
export type KookRequestHandler = (job: KookIngressJob, signal: AbortSignal) => Promise<KookTextPayload | null | undefined>;
export type KookGroupChannelProvisioner = (event: TrustedKookGroupMessage, signal: AbortSignal) => Promise<{ tenantId: string; teamId: string }>;
export type KookGuildJoinProvisioner = (event: TrustedKookGuildJoin, target: VerifiedKookWelcomeTarget, signal: AbortSignal) => Promise<KookTextPayload | null>;
async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
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
function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    && /^[a-z0-9_]{1,64}$/u.test(error.code))
    return error.code;
  if (error instanceof Error && /^[a-z0-9_]{1,64}$/u.test(error.message)) return error.message;
  return 'request_processing_failed';
}
const SAFE_PROCESSING_DIAGNOSTIC_REASONS = new Set([
  'kook_ingress_binding_changed', 'kook_welcome_target_invalid', 'kook_welcome_channel_unconfigured',
  'kook_channel_member_required', 'kook_target_channel_member_required', 'guild_team_ambiguous',
]);
/** The sole durable gateway ingress. It stages every trusted non-bot human
 * message after durable admission limits, pins any existing team binding, and
 * atomically commits a reply or intentional silence plus completion.
 * Business handlers must make their own state changes idempotent across retries. */
export class KookIngressQueue {
  private readonly botId: string;
  private readonly maxPending: number;
  private readonly maxPerUser: number;
  private readonly maxRequestsPerUserPerMinute: number;
  private readonly maxRequestsPerChannelPerMinute: number;
  private readonly maxRequestsPerTenantPerMinute: number;
  private readonly maxRequestsPerBotPerMinute: number;
  private readonly ttlMs: number;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly baseRetryMs: number;
  private readonly onDiscard: ((event: KookIngressDiscardLog) => void) | undefined;
  private readonly discardWindows = new Map<string, { loggedAt: number; suppressed: number }>();
  constructor(private readonly pool: Pool, options: KookIngressQueueOptions) {
    this.botId = options.botAccountId.trim();
    this.maxPending = options.maxPending ?? 1000;
    this.maxPerUser = options.maxPendingPerUser ?? 20;
    this.maxRequestsPerUserPerMinute = options.maxRequestsPerUserPerMinute ?? 10;
    this.maxRequestsPerChannelPerMinute = options.maxRequestsPerChannelPerMinute ?? 60;
    this.maxRequestsPerTenantPerMinute = options.maxRequestsPerTenantPerMinute ?? 120;
    this.maxRequestsPerBotPerMinute = options.maxRequestsPerBotPerMinute ?? 300;
    this.ttlMs = options.payloadTtlMs ?? 60 * 60000;
    this.leaseMs = options.leaseMs ?? 30000;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.baseRetryMs = options.baseRetryMs ?? 1000;
    this.onDiscard = options.onDiscard;
    if (!this.botId || this.botId.length > 128 || !Number.isSafeInteger(this.maxPending) || this.maxPending < 1 || this.maxPending > 10000
      || !Number.isSafeInteger(this.maxPerUser) || this.maxPerUser < 1 || this.maxPerUser > this.maxPending
      || !Number.isSafeInteger(this.maxRequestsPerUserPerMinute) || this.maxRequestsPerUserPerMinute < 1 || this.maxRequestsPerUserPerMinute > 10000
      || !Number.isSafeInteger(this.maxRequestsPerChannelPerMinute) || this.maxRequestsPerChannelPerMinute < 1 || this.maxRequestsPerChannelPerMinute > 100000
      || !Number.isSafeInteger(this.maxRequestsPerTenantPerMinute) || this.maxRequestsPerTenantPerMinute < 1 || this.maxRequestsPerTenantPerMinute > 100000
      || !Number.isSafeInteger(this.maxRequestsPerBotPerMinute) || this.maxRequestsPerBotPerMinute < 1 || this.maxRequestsPerBotPerMinute > 100000
      || !Number.isSafeInteger(this.ttlMs) || this.ttlMs < 1000 || this.ttlMs > 24 * 60 * 60000
      || !Number.isSafeInteger(this.leaseMs) || this.leaseMs < 1000 || this.leaseMs > 5 * 60000
      || !Number.isSafeInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > 20
      || !Number.isSafeInteger(this.baseRetryMs) || this.baseRetryMs < 1 || this.baseRetryMs > 60000)
      throw new Error('kook_ingress_limits_invalid');
  }
  private reportDiscard(stage: KookIngressDiscardLog['stage'], reason: string, channelId?: string): void {
    const safeChannel = channelId && /^[0-9]{1,40}$/u.test(channelId) ? channelId : undefined;
    const key = `${stage}:${reason}:${safeChannel ?? ''}`;
    const now = Date.now();
    let window = this.discardWindows.get(key);
    if (!window) {
      if (this.discardWindows.size >= 64) {
        const oldest = this.discardWindows.keys().next().value;
        if (oldest !== undefined) this.discardWindows.delete(oldest);
      }
      window = { loggedAt: now, suppressed: 0 };
      this.discardWindows.set(key, window);
      try { this.onDiscard?.({ event: 'kook_ingress_discarded', stage, reason, count: 1, ...(safeChannel ? { channelId: safeChannel } : {}) }); }
      catch { /* diagnostics must never block event handling */ }
      return;
    }
    window.suppressed += 1;
    if (now - window.loggedAt < 60_000) return;
    const count = window.suppressed;
    window.loggedAt = now;
    window.suppressed = 0;
    try { this.onDiscard?.({ event: 'kook_ingress_discarded', stage, reason, count, ...(safeChannel ? { channelId: safeChannel } : {}) }); }
    catch { /* diagnostics must never block event handling */ }
  }
  async ingestGatewayEvent(data: unknown): Promise<KookIngressResult> {
    const inspection = inspectKookRequest(data, this.botId);
    if (inspection.kind === 'ignored') return 'ignored';
    if (inspection.kind === 'dropped') {
      this.reportDiscard(inspection.stage, inspection.reason, inspection.channelId);
      return 'ignored';
    }
    const parsed = inspection.parsed;
    if (parsed.timestamp < Date.now() - this.ttlMs || parsed.timestamp > Date.now() + 5 * 60000) {
      this.reportDiscard('freshness', 'timestamp_out_of_window', parsed.channelId ?? undefined);
      return 'ignored';
    }
    const serialized = JSON.stringify(parsed.envelope);
    const fingerprint = createHash('sha256').update(serialized).digest('hex');
    try {
      return await transaction(this.pool, async (client) => {
        // Serialize admission counts across all connections for this bot.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`kook-ingress:${this.botId}`]);
        const duplicate = await client.query('SELECT fingerprint FROM kook_ingress_events WHERE bot_account_id=$1 AND event_id=$2', [this.botId, parsed.eventId]);
        if (duplicate.rowCount) {
          if (duplicate.rows[0]?.fingerprint !== fingerprint)
            throw new Error('kook_ingress_event_conflict');
          return 'duplicate';
        }
        const count = await client.query(`SELECT COUNT(*)::INTEGER AS total, COUNT(*) FILTER (WHERE user_id=$2)::INTEGER AS actor
           FROM kook_ingress_events WHERE bot_account_id=$1 AND status IN ('pending','processing','retry') AND expires_at>now()`, [this.botId, parsed.userId]);
        if (Number(count.rows[0]?.total) >= this.maxPending || Number(count.rows[0]?.actor) >= this.maxPerUser) {
          throw new Error('kook_ingress_capacity_exceeded');
        }
        const binding = parsed.request.kind === 'group' ? await client.query(`SELECT tenant.tenant_id,binding.team_id FROM tenants tenant JOIN channel_bindings binding
           ON binding.tenant_id=tenant.tenant_id AND binding.platform=tenant.platform AND binding.bot_account_id=tenant.bot_account_id
           WHERE tenant.platform='kook' AND tenant.bot_account_id=$1 AND tenant.guild_id=$2 AND binding.channel_id=$3 FOR SHARE OF binding`, [this.botId, parsed.guildId, parsed.channelId]) : null;
        const tenantId = typeof binding?.rows[0]?.tenant_id === 'string' ? binding.rows[0].tenant_id : null;
        const channelId = parsed.request.kind === 'group' ? parsed.channelId : null;
        const recent = await client.query(`SELECT
          (SELECT COUNT(*) FROM kook_ingress_events WHERE bot_account_id=$1 AND received_at>=clock_timestamp()-interval '1 minute')::INTEGER AS bot,
          (SELECT COUNT(*) FROM kook_ingress_events WHERE bot_account_id=$1 AND user_id=$2 AND received_at>=clock_timestamp()-interval '1 minute')::INTEGER AS actor,
          (SELECT COUNT(*) FROM kook_ingress_events WHERE bot_account_id=$1 AND channel_id=$3 AND received_at>=clock_timestamp()-interval '1 minute')::INTEGER AS channel,
          (SELECT COUNT(*) FROM kook_ingress_events WHERE bot_account_id=$1 AND tenant_id=$4 AND received_at>=clock_timestamp()-interval '1 minute')::INTEGER AS tenant`,
        [this.botId, parsed.userId, channelId, tenantId]);
        const recentCounts = recent.rows[0];
        if (Number(recentCounts?.bot ?? 0) >= this.maxRequestsPerBotPerMinute) throw new Error('kook_ingress_rate_limited_bot');
        if (Number(recentCounts?.tenant ?? 0) >= this.maxRequestsPerTenantPerMinute) throw new Error('kook_ingress_rate_limited_tenant');
        if (Number(recentCounts?.channel ?? 0) >= this.maxRequestsPerChannelPerMinute) throw new Error('kook_ingress_rate_limited_channel');
        if (Number(recentCounts?.actor ?? 0) >= this.maxRequestsPerUserPerMinute) throw new Error('kook_ingress_rate_limited_user');
        const version = parsed.request.kind === 'group' ? await client.query('SELECT revision FROM channel_binding_versions WHERE bot_account_id=$1 AND channel_id=$2', [this.botId, parsed.channelId]) : null;
        await client.query(`INSERT INTO kook_ingress_events(bot_account_id,event_id,event_kind,user_id,guild_id,channel_id,
           tenant_id,team_id,target_kind,target_id,reply_to_message_id,fingerprint,event_json,expires_at,binding_revision)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,now()+($14::BIGINT*interval '1 millisecond'),$15)`, [this.botId, parsed.eventId, parsed.request.kind, parsed.userId, parsed.guildId, parsed.channelId,
        binding?.rows[0]?.tenant_id ?? null, binding?.rows[0]?.team_id ?? null, parsed.targetKind, parsed.targetId,
        parsed.replyToMessageId, fingerprint, serialized, this.ttlMs, parsed.request.kind === 'group' ? String(version?.rows[0]?.revision ?? 0) : null]);
        if (parsed.request.kind === 'group' || parsed.request.kind === 'direct') {
          const request = parsed.request.event;
          const conversationChannelId = parsed.channelId ?? `dm:${this.botId}:${parsed.userId}`;
          await client.query(`INSERT INTO kook_conversation_messages(
              bot_account_id,channel_id,message_id,speaker_kind,speaker_id,source_event_id,reply_to_message_id,content,expires_at
            ) VALUES ($1,$2,$3,'human',$4,$3,$5,$6,now()+interval '12 hours')
            ON CONFLICT (bot_account_id,channel_id,message_id) DO NOTHING`, [
            this.botId, conversationChannelId, parsed.eventId, parsed.userId,
            parsed.request.kind === 'group' ? parsed.request.event.quotedMessageId : null,
            sanitizeKookMentionMarkup(request.content).slice(0, 1600),
          ]);
        }
        return 'accepted';
      });
    } catch (error) {
      const code = errorCode(error);
      if (code === 'kook_ingress_capacity_exceeded' || /^kook_ingress_rate_limited_(?:bot|tenant|channel|user)$/u.test(code)) {
        this.reportDiscard('admission', code, parsed.channelId ?? undefined);
        return 'ignored';
      }
      throw error;
    }
  }
  async claimNext(): Promise<KookIngressJob | null> {
    const leaseToken = randomBytes(24).toString('base64url');
    const result = await this.pool.query(`WITH candidate AS (
         SELECT current.event_id FROM kook_ingress_events current
         WHERE current.bot_account_id=$1 AND current.status IN ('pending','processing','retry') AND current.expires_at>now()
           AND (current.next_attempt_at IS NULL OR current.next_attempt_at<=now())
           AND (current.status<>'processing' OR current.lease_until<=now())
           AND NOT EXISTS (
             SELECT 1 FROM kook_ingress_events earlier WHERE earlier.bot_account_id=current.bot_account_id
               AND ((current.channel_id IS NOT NULL AND earlier.channel_id=current.channel_id
                   AND earlier.guild_id IS NOT DISTINCT FROM current.guild_id)
                 OR (current.channel_id IS NULL AND earlier.user_id=current.user_id
                   AND earlier.guild_id IS NOT DISTINCT FROM current.guild_id))
               AND earlier.status IN ('pending','processing','retry') AND earlier.expires_at>now()
               AND (earlier.received_at,earlier.event_id)<(current.received_at,current.event_id)
           )
         ORDER BY current.received_at,current.event_id FOR UPDATE OF current SKIP LOCKED LIMIT 1
       ) UPDATE kook_ingress_events event SET status='processing',lease_token=$2,
         lease_until=now()+($3::BIGINT*interval '1 millisecond'),attempt_count=event.attempt_count+1
       FROM candidate WHERE event.bot_account_id=$1 AND event.event_id=candidate.event_id RETURNING event.*`, [this.botId, leaseToken, this.leaseMs]);
    const row = result.rows[0];
    if (!row)
      return null;
    const stored = row.event_json as {
      d?: unknown;
    } | null;
    const parsed = parseKookRequest(stored?.d, this.botId);
    if (!parsed || parsed.eventId !== row.event_id || parsed.request.kind !== row.event_kind)
      throw new Error('kook_ingress_payload_invalid');
    return {
      botAccountId: this.botId, eventId: String(row.event_id), leaseToken, attemptCount: Number(row.attempt_count), request: parsed.request,
      bindingRevision: row.binding_revision === null ? null : String(row.binding_revision),
      boundTeam: typeof row.tenant_id === 'string' && typeof row.team_id === 'string' ? { tenantId: row.tenant_id, teamId: row.team_id } : null,
    };
  }
  private async requireCurrentBinding(client: Pool | PoolClient, job: KookIngressJob): Promise<void> {
    if (job.request.kind !== 'group')
      return;
    const event = job.request.event;
    const current = await client.query(`SELECT tenant.tenant_id,binding.team_id FROM tenants tenant JOIN channel_bindings binding
       ON binding.tenant_id=tenant.tenant_id AND binding.platform=tenant.platform AND binding.bot_account_id=tenant.bot_account_id
       WHERE tenant.platform='kook' AND tenant.bot_account_id=$1 AND tenant.guild_id=$2 AND binding.channel_id=$3 FOR SHARE OF binding`, [job.botAccountId, event.guildId, event.channelId]);
    const row = current.rows[0];
    const version = await client.query('SELECT revision FROM channel_binding_versions WHERE bot_account_id=$1 AND channel_id=$2', [this.botId, event.channelId]);
    if (job.bindingRevision !== String(version.rows[0]?.revision ?? 0) || (job.boundTeam ? row?.tenant_id !== job.boundTeam.tenantId || row?.team_id !== job.boundTeam.teamId : Boolean(row))) {
      throw Object.assign(new Error('kook_ingress_binding_changed'), { code: 'kook_ingress_binding_changed' });
    }
  }

  /** Pins a freshly auto-bound channel to the currently leased ingress event.
   * The event must still be unbound at admission and the service must have
   * created a newer binding revision for the same verified guild/channel. */
  private async adoptProvisionedBinding(job: KookIngressJob, team: { tenantId: string; teamId: string }): Promise<void> {
    if (job.request.kind !== 'group' || job.boundTeam) throw new Error('kook_ingress_binding_changed');
    const event = job.request.event;
    await transaction(this.pool, async (client) => {
      const leased = await client.query(
        `SELECT tenant_id,team_id,binding_revision FROM kook_ingress_events
         WHERE bot_account_id=$1 AND event_id=$2 AND status='processing' AND lease_token=$3
           AND lease_until>now() AND expires_at>now() FOR UPDATE`,
        [this.botId, job.eventId, job.leaseToken],
      );
      const row = leased.rows[0];
      if (!row || row.tenant_id !== null || row.team_id !== null
        || String(row.binding_revision ?? 0) !== String(job.bindingRevision ?? 0)) throw new Error('kook_ingress_binding_changed');
      const current = await client.query(
        `SELECT tenant.tenant_id,binding.team_id,version.revision FROM tenants tenant
         JOIN channel_bindings binding ON binding.tenant_id=tenant.tenant_id
           AND binding.platform=tenant.platform AND binding.bot_account_id=tenant.bot_account_id
         JOIN channel_binding_versions version ON version.bot_account_id=binding.bot_account_id AND version.channel_id=binding.channel_id
         WHERE tenant.platform='kook' AND tenant.bot_account_id=$1 AND tenant.guild_id=$2 AND binding.channel_id=$3
         FOR SHARE OF binding`,
        [this.botId, event.guildId, event.channelId],
      );
      const binding = current.rows[0];
      const expectedRevision = Number(job.bindingRevision ?? 0);
      if (!binding || binding.tenant_id !== team.tenantId || binding.team_id !== team.teamId
        || !Number.isSafeInteger(Number(binding.revision)) || Number(binding.revision) <= expectedRevision) {
        throw new Error('kook_ingress_binding_changed');
      }
      const updated = await client.query(
        `UPDATE kook_ingress_events SET tenant_id=$4,team_id=$5,binding_revision=$6
         WHERE bot_account_id=$1 AND event_id=$2 AND lease_token=$3 AND tenant_id IS NULL AND team_id IS NULL`,
        [this.botId, job.eventId, job.leaseToken, team.tenantId, team.teamId, String(binding.revision)],
      );
      if (!updated.rowCount) throw new Error('kook_ingress_binding_changed');
      job.boundTeam = { tenantId: team.tenantId, teamId: team.teamId };
      job.bindingRevision = String(binding.revision);
    });
  }
  async complete(job: KookIngressJob, reply: KookTextPayload | null,welcomeTarget?:VerifiedKookWelcomeTarget): Promise<void> {
    if (job.botAccountId !== this.botId)
      throw new Error('kook_bot_scope_mismatch');
    const payload = reply === null ? null : validateKookMessagePayload(reply);
    await transaction(this.pool, async (client) => {
      const result = await client.query(`SELECT * FROM kook_ingress_events WHERE bot_account_id=$1 AND event_id=$2
         AND status='processing' AND lease_token=$3 AND lease_until>now() AND expires_at>now() FOR UPDATE`, [this.botId, job.eventId, job.leaseToken]);
      const row = result.rows[0];
      if (!row)
        throw new Error('kook_ingress_lease_lost');
      const stored = row.event_json as {
        d?: unknown;
      };
      const parsed = parseKookRequest(stored.d, this.botId);
      if (!parsed)
        throw new Error('kook_ingress_payload_invalid');
      await this.requireCurrentBinding(client, {
        ...job, request: parsed.request,
        bindingRevision: row.binding_revision === null ? null : String(row.binding_revision),
        boundTeam: typeof row.tenant_id === 'string' && typeof row.team_id === 'string' ? { tenantId: row.tenant_id, teamId: row.team_id } : null,
      });
      if (payload) {
        const isWelcome=parsed.request.kind==='guild_join';
        if(isWelcome && (!isVerifiedKookWelcomeTarget(welcomeTarget)||welcomeTarget.botAccountId!==this.botId || welcomeTarget.guildId!==parsed.guildId)){
          throw Object.assign(new Error('kook_welcome_target_invalid'),{code:'kook_welcome_target_invalid'});
        }
        if(!isWelcome && welcomeTarget)throw new Error('kook_reply_destination_override');
        const targetKind=isWelcome?'channel':row.target_kind,targetId=isWelcome?welcomeTarget!.channelId:row.target_id;
        const key = createHash('sha256').update(`kook\0${this.botId}\0${job.eventId}\0reply`).digest('hex');
        await client.query(`INSERT INTO message_outbox(outbox_id,idempotency_key,platform,bot_account_id,tenant_id,team_id,
           channel_id,target_kind,target_id,source_event_id,payload_json,status,welcome_guild_id)
           VALUES ($1,$2,'kook',$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'pending',$11) ON CONFLICT (idempotency_key) DO NOTHING`, [randomUUID(), key, this.botId, row.tenant_id, row.team_id,targetKind==='channel'?targetId:null,
        targetKind,targetId,row.reply_to_message_id,JSON.stringify(payload),isWelcome?parsed.guildId:null]);
        if ((parsed.request.kind === 'group' || parsed.request.kind === 'direct')
          && (payload.type === 'text' || payload.type === 'kmarkdown')) {
          const conversationChannelId = parsed.channelId ?? `dm:${this.botId}:${parsed.userId}`;
          await client.query(`INSERT INTO kook_conversation_messages(
              bot_account_id,channel_id,message_id,speaker_kind,speaker_id,source_event_id,reply_to_message_id,content,expires_at
            ) VALUES ($1,$2,$3,'assistant',$4,$5,$6,$7,now()+interval '12 hours')
            ON CONFLICT (bot_account_id,channel_id,message_id) DO NOTHING`, [
            this.botId, conversationChannelId, `assistant:${job.eventId}`, this.botId,
            job.eventId, parsed.replyToMessageId, payload.content.slice(0, 1600),
          ]);
        }
      }
      await client.query(`UPDATE kook_ingress_events SET status='done',event_json=NULL,lease_token=NULL,lease_until=NULL,
         next_attempt_at=NULL,last_error_code=NULL,finished_at=now() WHERE bot_account_id=$1 AND event_id=$2`, [this.botId, job.eventId]);
    });
  }
  async fail(job: KookIngressJob, error: unknown): Promise<'retry' | 'dead'> {
    if (job.botAccountId !== this.botId)
      throw new Error('kook_bot_scope_mismatch');
    const code = errorCode(error);
    return transaction(this.pool, async (client) => {
      const result = await client.query(`SELECT attempt_count,expires_at FROM kook_ingress_events WHERE bot_account_id=$1 AND event_id=$2
         AND status='processing' AND lease_token=$3 FOR UPDATE`, [this.botId, job.eventId, job.leaseToken]);
      const row = result.rows[0];
      if (!row)
        throw new Error('kook_ingress_lease_lost');
      const dead = Number(row.attempt_count) >= this.maxAttempts || new Date(row.expires_at).getTime() <= Date.now()
        || ['kook_ingress_binding_changed','kook_welcome_target_invalid','kook_welcome_channel_unconfigured',
          'kook_channel_member_required','kook_target_channel_member_required','guild_team_ambiguous'].includes(code);
      const retryMs = Math.min(60000, this.baseRetryMs * 2 ** Math.min(Number(row.attempt_count) - 1, 20));
      await client.query(`UPDATE kook_ingress_events SET status=$4,lease_token=NULL,lease_until=NULL,last_error_code=$5,
         next_attempt_at=CASE WHEN $4='retry' THEN now()+($6::BIGINT*interval '1 millisecond') ELSE NULL END,
         event_json=CASE WHEN $4='dead' THEN NULL ELSE event_json END,
         finished_at=CASE WHEN $4='dead' THEN now() ELSE NULL END WHERE bot_account_id=$1 AND event_id=$2 AND lease_token=$3`, [this.botId, job.eventId, job.leaseToken, dead ? 'dead' : 'retry', code, retryMs]);
      if (dead) this.reportDiscard('processing', SAFE_PROCESSING_DIAGNOSTIC_REASONS.has(code) ? code : 'request_processing_failed',
        job.request.kind === 'group' ? job.request.event.channelId : undefined);
      return dead ? 'dead' : 'retry';
    });
  }
  async processOne(
    handler: KookRequestHandler,
    signal: AbortSignal,
    welcomeResolver?: KookGuildWelcomeResolver,
    groupChannelProvisioner?: KookGroupChannelProvisioner,
    guildJoinProvisioner?: KookGuildJoinProvisioner,
  ): Promise<KookIngressProcessResult> {
    if (signal.aborted)
      return 'empty';
    const job = await this.claimNext();
    if (!job)
      return 'empty';
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted)
      abort.abort();
    let renewalPending = false;
    const renewal = setInterval(() => {
      if (renewalPending)
        return;
      renewalPending = true;
      void this.pool.query(`UPDATE kook_ingress_events SET lease_until=now()+($4::BIGINT*interval '1 millisecond')
         WHERE bot_account_id=$1 AND event_id=$2 AND lease_token=$3 AND status='processing' AND lease_until>now() AND expires_at>now()`, [this.botId, job.eventId, job.leaseToken, this.leaseMs]).then(result => {
        if (!result.rowCount)
          abort.abort();
      }).catch(() => abort.abort()).finally(() => { renewalPending = false; });
    }, Math.max(100, Math.floor(this.leaseMs / 3)));
    try {
      if (job.request.kind === 'group' && !job.boundTeam && groupChannelProvisioner) {
        const team = await groupChannelProvisioner(job.request.event, abort.signal);
        await this.adoptProvisionedBinding(job, team);
      } else {
        await this.requireCurrentBinding(this.pool, job);
      }
      let reply:KookTextPayload|null,welcomeTarget:VerifiedKookWelcomeTarget|undefined;
      if(job.request.kind==='guild_join'){
        if(!welcomeResolver)throw new Error('kook_welcome_resolver_unavailable');
        const target=await welcomeResolver.resolve(job.request.event,abort.signal);
        if(!target)throw Object.assign(new Error('kook_welcome_channel_unconfigured'),{code:'kook_welcome_channel_unconfigured'});
        welcomeTarget=target;
        reply = guildJoinProvisioner
          ? await guildJoinProvisioner(job.request.event, target, abort.signal)
          : { type: 'text', content: '机器人已加入服务器，可以在绑定频道内直接询问 PUBG 数据。' };
      }else{reply=(await handler(job,abort.signal)) ?? null;}
      if (abort.signal.aborted)
        throw new Error('kook_ingress_processing_aborted');
      await this.complete(job, reply,welcomeTarget);
      return 'done';
    }
    catch (error) {
      return this.fail(job, error);
    }
    finally {
      clearInterval(renewal);
      signal.removeEventListener('abort', onAbort);
    }
  }
  async prune(before: Date): Promise<void> {
    if (!Number.isFinite(before.getTime()))
      throw new Error('kook_retention_cutoff_invalid');
    await this.pool.query(`UPDATE kook_ingress_events SET status='dead',event_json=NULL,lease_token=NULL,lease_until=NULL,
       last_error_code='request_expired',finished_at=now() WHERE bot_account_id=$1 AND expires_at<=now() AND status IN ('pending','processing','retry')`, [this.botId]);
    await this.pool.query("DELETE FROM kook_ingress_events WHERE bot_account_id=$1 AND status IN ('done','dead') AND finished_at<$2", [this.botId, before]);
    await this.pool.query("DELETE FROM pending_team_actions WHERE bot_account_id=$1 AND ((consumed_at IS NULL AND expires_at<=now()) OR consumed_at<now()-interval '1 day')", [this.botId]);
    await this.pool.query("DELETE FROM pending_account_claims WHERE bot_account_id=$1 AND ((consumed_at IS NULL AND expires_at<=now()) OR consumed_at<now()-interval '1 day')", [this.botId]);
    await this.pool.query("DELETE FROM pending_squad_setups WHERE bot_account_id=$1 AND ((consumed_at IS NULL AND expires_at<=now()) OR consumed_at<now()-interval '1 day')", [this.botId]);
    await this.pool.query('DELETE FROM kook_conversation_messages WHERE bot_account_id=$1 AND expires_at<=now()', [this.botId]);
    await this.pool.query('DELETE FROM kook_agent_runs WHERE bot_account_id=$1 AND expires_at<=now()', [this.botId]);
  }
}
