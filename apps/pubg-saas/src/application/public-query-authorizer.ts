import { createHash, randomUUID } from 'node:crypto';
import { createTeamContext, type TeamContext } from '@agent/pubg-domain/core';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { parseKookRequest } from '../channels/kook/request-event.js';
import type { TrustedKookDirectMessage, TrustedKookGroupMessage } from '../channels/kook/trusted-group-event.js';
import { sanitizeKookAssistantReplyContent } from './kook-message-queue.js';
import { PostgresPubgRepository, type TrustedConversationScope } from '../infrastructure/postgres/pubg-repository.js';
import type { KookIngressJob } from './kook-ingress-queue.js';
import { MAX_TEAM_ROSTER_SIZE } from '../contracts/team-roster.js';

type MessageEvent = TrustedKookGroupMessage | TrustedKookDirectMessage;
export interface PublicQueryPermissionChecker {
  isGuildMember(guildId: string, userId: string): Promise<boolean>;
  isTextChannelMember(guildId: string, channelId: string, userId: string): Promise<boolean>;
}
export interface PublicQueryTeamSelection { tenantId: string; teamId: string }
export interface PublicQueryTeamChoice extends PublicQueryTeamSelection { label: string; pubgShard: string }
export interface KookAgentConversationTurn { role: 'user' | 'assistant'; content: string }
export interface KookAgentConversationWindow {
  turns: KookAgentConversationTurn[];
  currentSpeakerLabel: string;
  currentQuoteContext: string | null;
}
export interface KookAgentRunRecord {
  modelId: string | null;
  outcome: 'replied' | 'authorization_denied' | 'provider_fallback' | 'tool_degraded' | 'model_unconfigured';
  failureCode: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}
export interface PublicQueryAuthorizerOptions {
  botAccountId: string;
  sessionTtlMs?: number;
  maxTeamChoices?: number;
}
const authorizedQuery = Symbol('authorized-public-pubg-query');
export interface AuthorizedPublicQuery {
  readonly [authorizedQuery]: true;
  readonly requestId: string;
  readonly teamContext: TeamContext;
  readonly conversation: TrustedConversationScope;
  readonly repository: PostgresPubgRepository;
}
export type PublicQueryAuthorization = { kind: 'authorized'; query: AuthorizedPublicQuery }
  | { kind: 'team_selection_required'; choices: PublicQueryTeamChoice[] };

function requiredId(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new Error('public_query_selection_invalid');
  return value.trim();
}
function sameTeam(row: QueryResultRow, selection: PublicQueryTeamSelection): boolean {
  return row.tenant_id === selection.tenantId && row.team_id === selection.teamId;
}
function choice(row: QueryResultRow): PublicQueryTeamChoice {
  return { tenantId: String(row.tenant_id), teamId: String(row.team_id), label: String(row.label), pubgShard: String(row.pubg_shard) };
}

/** Public queries begin only from an active durable ingress lease. Caller/model
 * tenant fields, event objects and session IDs are never authority. Group reads
 * do not create DM grants; an account claim does not imply guild/team access. */
export class PublicQueryAuthorizer {
  private readonly botId: string;
  private readonly ttlMs: number;
  private readonly maxChoices: number;
  constructor(private readonly pool: Pool, private readonly permissions: PublicQueryPermissionChecker, options: PublicQueryAuthorizerOptions) {
    this.botId = requiredId(options.botAccountId);
    this.ttlMs = options.sessionTtlMs ?? 12 * 60 * 60000;
    this.maxChoices = options.maxTeamChoices ?? 20;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs < 1000 || this.ttlMs > 24 * 60 * 60000
      || !Number.isSafeInteger(this.maxChoices) || this.maxChoices < 2 || this.maxChoices > 200) throw new Error('public_query_limits_invalid');
  }

  private async storedJob(client: Pool | PoolClient, job: KookIngressJob, lock = false): Promise<KookIngressJob> {
    if (job.botAccountId !== this.botId) throw new Error('public_query_bot_scope_mismatch');
    const result = await client.query(
      `SELECT * FROM kook_ingress_events WHERE bot_account_id=$1 AND event_id=$2 AND lease_token=$3
       AND status='processing' AND lease_until>now() AND expires_at>now()${lock ? ' FOR UPDATE' : ''}`,
      [this.botId, job.eventId, job.leaseToken],
    );
    const row = result.rows[0];
    const parsed = parseKookRequest(row?.event_json?.d, this.botId);
    if (!row || !parsed || parsed.eventId !== job.eventId || !['group', 'direct'].includes(parsed.request.kind)
      || parsed.request.kind !== row.event_kind || parsed.userId !== row.user_id || parsed.guildId !== row.guild_id
      || parsed.channelId !== row.channel_id || createHash('sha256').update(JSON.stringify(parsed.envelope)).digest('hex') !== row.fingerprint) {
      throw new Error('public_query_ingress_unavailable');
    }
    return {
      botAccountId: this.botId, eventId: job.eventId, leaseToken: job.leaseToken, attemptCount: Number(row.attempt_count), request: parsed.request,
      boundTeam: typeof row.tenant_id === 'string' && typeof row.team_id === 'string' ? { tenantId: row.tenant_id, teamId: row.team_id } : null,
      bindingRevision: row.binding_revision === null ? null : String(row.binding_revision),
    };
  }

  private async targets(client: Pool | PoolClient, job: KookIngressJob, selection: PublicQueryTeamSelection | undefined, lock = false): Promise<QueryResultRow[]> {
    if (job.request.kind === 'group') {
      if (selection) throw new Error('public_query_group_selection_forbidden');
      const event = job.request.event;
      const result = await client.query(
        `SELECT team.*,tenant.guild_id FROM tenants tenant JOIN teams team ON team.tenant_id=tenant.tenant_id
         JOIN channel_bindings binding ON binding.tenant_id=team.tenant_id AND binding.team_id=team.team_id
           AND binding.platform=tenant.platform AND binding.bot_account_id=tenant.bot_account_id
         WHERE tenant.platform='kook' AND tenant.bot_account_id=$1 AND tenant.guild_id=$2 AND binding.channel_id=$3
         ${lock ? 'FOR SHARE OF team,binding' : ''}`, [this.botId, event.guildId, event.channelId],
      );
      const version = await client.query(`SELECT revision FROM channel_binding_versions WHERE bot_account_id=$1 AND channel_id=$2${lock ? ' FOR SHARE' : ''}`, [this.botId, event.channelId]);
      if (!job.boundTeam || !result.rows[0] || !sameTeam(result.rows[0], job.boundTeam)
        || job.bindingRevision !== String(version.rows[0]?.revision ?? 0)) throw new Error('public_query_binding_changed');
      return result.rows;
    }
    if (job.request.kind !== 'direct') throw new Error('public_query_message_required');
    const result = await client.query(
      `SELECT team.*,tenant.guild_id FROM tenants tenant JOIN teams team ON team.tenant_id=tenant.tenant_id
       JOIN team_user_access access ON access.tenant_id=team.tenant_id AND access.team_id=team.team_id
         AND access.platform=tenant.platform AND access.bot_account_id=tenant.bot_account_id
       WHERE tenant.platform='kook' AND tenant.bot_account_id=$1 AND access.user_id=$2
         ${selection ? 'AND team.tenant_id=$4 AND team.team_id=$5' : ''}
       ORDER BY team.tenant_id,team.team_id LIMIT $3 ${lock ? 'FOR SHARE OF team,access' : ''}`,
      [this.botId, job.request.event.userId, this.maxChoices + 1, ...(selection ? [selection.tenantId, selection.teamId] : [])],
    );
    if (result.rows.length > this.maxChoices) throw new Error('public_query_explicit_team_required');
    return result.rows;
  }

  async authorize(jobInput: KookIngressJob, selected?: PublicQueryTeamSelection): Promise<PublicQueryAuthorization> {
    const selection = selected ? { tenantId: requiredId(selected.tenantId), teamId: requiredId(selected.teamId) } : undefined;
    const job = await this.storedJob(this.pool, jobInput);
    const candidates = await this.targets(this.pool, job, selection);
    const event = job.request.event as MessageEvent;
    const eligible: QueryResultRow[] = [];
    for (const target of candidates) {
      const allowed = job.request.kind === 'group'
        ? await this.permissions.isTextChannelMember(String(target.guild_id), job.request.event.channelId, event.userId)
        : await this.permissions.isGuildMember(String(target.guild_id), event.userId);
      if (allowed) eligible.push(target);
    }
    if (!eligible.length) throw new Error('public_query_access_denied');
    if (eligible.length > 1) return { kind: 'team_selection_required', choices: eligible.map(choice) };
    const selectedTarget = choice(eligible[0]!);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await this.storedJob(client, jobInput, true);
      if (current.request.kind === 'direct' && !selection && (await this.targets(client, current, undefined, true)).length !== 1) {
        throw new Error('public_query_explicit_team_required');
      }
      const target = (await this.targets(client, current, current.request.kind === 'direct' ? selectedTarget : undefined, true)).find(row => sameTeam(row, selectedTarget));
      if (!target) throw new Error('public_query_access_denied');
      const currentEvent = current.request.event as MessageEvent;
      if (currentEvent.userId !== event.userId || current.request.kind !== job.request.kind) throw new Error('public_query_ingress_unavailable');
      const kind = current.request.kind === 'group' ? 'bound_channel' : 'direct_team';
      const channel = current.request.kind === 'group' ? current.request.event.channelId : `dm:${this.botId}:${event.userId}`;
      const scope = [selectedTarget.tenantId, selectedTarget.teamId, this.botId, event.userId, channel, kind];
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify(['public-query-session', ...scope])]);
      const members = await client.query(
        `SELECT member.pubg_account_id,account.display_name AS official_name,COALESCE(array_agg(alias.display_alias ORDER BY alias.alias_key)
         FILTER (WHERE alias.alias_key IS NOT NULL),'{}') AS aliases
         FROM team_members member JOIN teams team ON team.tenant_id=member.tenant_id AND team.team_id=member.team_id
         LEFT JOIN pubg_accounts account ON account.shard=team.pubg_shard AND account.account_id=member.pubg_account_id
         LEFT JOIN team_aliases alias ON alias.tenant_id=member.tenant_id
           AND alias.team_id=member.team_id AND alias.pubg_account_id=member.pubg_account_id
         WHERE member.tenant_id=$1 AND member.team_id=$2 GROUP BY member.pubg_account_id,account.display_name ORDER BY member.pubg_account_id`, scope.slice(0, 2),
      );
      if (!members.rowCount || members.rowCount > MAX_TEAM_ROSTER_SIZE) throw new Error('public_query_roster_unavailable');
      const teamContext = createTeamContext(selectedTarget.tenantId, {
        id: selectedTarget.teamId, label: String(target.label), platform: String(target.pubg_shard),
        // Fall back to the stable account ID until a public official name has
        // been persisted; never import the private default roster.
        players: members.rows.map(member => ({ id: String(member.pubg_account_id), name: String(member.official_name ?? member.pubg_account_id), aliases: member.aliases.map(String) })),
      });
      const revision = String(target.query_revision), bindingRevision = kind === 'bound_channel' ? current.bindingRevision : null;
      const previous = await client.query(
        `SELECT session.* FROM public_query_requests request JOIN public_query_sessions session ON session.session_id=request.session_id
         WHERE request.bot_account_id=$1 AND request.event_id=$2`, [this.botId, current.eventId],
      );
      let sessionId: string;
      if (previous.rowCount) {
        const row = previous.rows[0]!;
        if (!sameTeam(row, selectedTarget) || row.user_id !== event.userId || row.channel_id !== channel || row.kind !== kind
          || String(row.team_revision) !== revision || (row.binding_revision === null ? null : String(row.binding_revision)) !== bindingRevision
          || new Date(row.expires_at).getTime() <= Date.now()) throw new Error('public_query_request_scope_changed');
        sessionId = String(row.session_id);
      } else {
        const existing = await client.query(
          `SELECT session_id FROM public_query_sessions WHERE tenant_id=$1 AND team_id=$2 AND bot_account_id=$3
           AND user_id=$4 AND channel_id=$5 AND kind=$6 AND team_revision=$7 AND binding_revision IS NOT DISTINCT FROM $8::BIGINT
           AND expires_at>now() ORDER BY updated_at DESC,session_id LIMIT 1 FOR UPDATE`, [...scope, revision, bindingRevision],
        );
        sessionId = existing.rows[0] ? String(existing.rows[0].session_id) : randomUUID();
        await client.query(
          `INSERT INTO public_query_sessions(session_id,tenant_id,team_id,platform,bot_account_id,user_id,channel_id,kind,team_revision,binding_revision,expires_at)
           VALUES ($1,$2,$3,'kook',$4,$5,$6,$7,$8,$9,now()+($10::BIGINT*interval '1 millisecond'))
           ON CONFLICT (session_id) DO UPDATE SET expires_at=EXCLUDED.expires_at,updated_at=now()`, [sessionId, ...scope, revision, bindingRevision, this.ttlMs],
        );
        const requestId = createHash('sha256').update(JSON.stringify(['kook', this.botId, current.eventId])).digest('hex');
        await client.query('INSERT INTO public_query_requests(bot_account_id,event_id,request_id,session_id) VALUES ($1,$2,$3,$4)', [this.botId, current.eventId, requestId, sessionId]);
      }
      const conversation: TrustedConversationScope = { platform: 'kook', kind, botAccountId: this.botId, userId: event.userId, channelId: channel, sessionId };
      const query: AuthorizedPublicQuery = {
        [authorizedQuery]: true, requestId: createHash('sha256').update(JSON.stringify(['kook', this.botId, current.eventId])).digest('hex'),
        teamContext, conversation, repository: new PostgresPubgRepository(this.pool, teamContext, conversation, { requireManagedSession: true }),
      };
      await client.query('COMMIT');
      return { kind: 'authorized', query };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  /** Returns a small, speaker-labeled window from this trusted channel/DM.
   * IDs stay in PostgreSQL and are used only to resolve quoted-message links. */
  async loadAgentConversation(jobInput: KookIngressJob, limit = 12): Promise<KookAgentConversationWindow> {
    const job = await this.storedJob(this.pool, jobInput);
    if (job.request.kind !== 'group' && job.request.kind !== 'direct') return { turns: [], currentSpeakerLabel: '成员1', currentQuoteContext: null };
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error('public_agent_history_limit_invalid');
    const userId = job.request.event.userId;
    const channelId = job.request.kind === 'group' ? job.request.event.channelId : `dm:${this.botId}:${userId}`;
    const result = await this.pool.query(
      `SELECT message_id,speaker_kind,speaker_id,reply_to_message_id,content
       FROM kook_conversation_messages
       WHERE bot_account_id=$1 AND channel_id=$2 AND expires_at>now() AND message_id<>$3
       ORDER BY created_at DESC,message_id DESC LIMIT $4`,
      [this.botId, channelId, job.eventId, limit],
    );
    const rows = result.rows.reverse().map(row => ({
      messageId: String(row.message_id),
      kind: row.speaker_kind === 'assistant' ? 'assistant' as const : 'human' as const,
      speakerId: String(row.speaker_id),
      replyTo: typeof row.reply_to_message_id === 'string' ? row.reply_to_message_id : null,
      content: String(row.content).slice(0, 1600),
    }));
    const labels = new Map<string, string>([[this.botId, '助手'], [userId, '成员1']]);
    let nextLabel = 2;
    const labelFor = (speakerId: string) => {
      if (speakerId === this.botId) return '助手';
      let label = labels.get(speakerId);
      if (!label) { label = `成员${nextLabel++}`; labels.set(speakerId, label); }
      return label;
    };
    const byId = new Map(rows.map(row => [row.messageId, row]));
    const currentQuoteId = job.request.kind === 'group' ? job.request.event.quotedMessageId : null;
    const currentQuote = currentQuoteId ? byId.get(currentQuoteId) : undefined;
    const currentQuoteContext = currentQuote
      ? `引用内容来自${labelFor(currentQuote.speakerId)}：“${currentQuote.content.slice(0, 240)}”`
      : null;
    let totalCharacters = 0;
    const turns: KookAgentConversationTurn[] = [];
    for (const row of rows) {
      const target = row.replyTo ? byId.get(row.replyTo) : undefined;
      const relation = target
        ? `（回复对象${labelFor(target.speakerId)}，引用：“${target.content.slice(0, 240)}”）`
        : '';
      const content = row.kind === 'human'
        ? `${labelFor(row.speakerId)}说：${relation}${row.content}`
        : sanitizeKookAssistantReplyContent(row.content);
      if (totalCharacters + content.length > 6000) break;
      turns.push({ role: row.kind === 'assistant' ? 'assistant' : 'user', content });
      totalCharacters += content.length;
    }
    return { turns, currentSpeakerLabel: '成员1', currentQuoteContext };
  }

  /** Stores only outcome, model identifier, token totals and trusted actor scope.
   * No prompt, completion, tool input, or raw provider error is retained. */
  async recordAgentRun(jobInput: KookIngressJob, record: KookAgentRunRecord): Promise<void> {
    const job = await this.storedJob(this.pool, jobInput);
    if (job.request.kind !== 'group' && job.request.kind !== 'direct') throw new Error('public_agent_message_required');
    if (record.failureCode !== null && !/^[a-z0-9_]{1,64}$/u.test(record.failureCode)) throw new Error('public_agent_failure_code_invalid');
    await this.pool.query(
      `INSERT INTO kook_agent_runs(bot_account_id,event_id,user_id,channel_id,model_id,outcome,failure_code,
        input_tokens,output_tokens,total_tokens,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+interval '30 days')
       ON CONFLICT (bot_account_id,event_id) DO UPDATE SET model_id=EXCLUDED.model_id,outcome=EXCLUDED.outcome,
        failure_code=EXCLUDED.failure_code,input_tokens=EXCLUDED.input_tokens,output_tokens=EXCLUDED.output_tokens,
        total_tokens=EXCLUDED.total_tokens,expires_at=EXCLUDED.expires_at`,
      [this.botId, job.eventId, job.request.event.userId,
        job.request.kind === 'group' ? job.request.event.channelId : `dm:${this.botId}:${job.request.event.userId}`,
        record.modelId, record.outcome, record.failureCode, record.inputTokens, record.outputTokens, record.totalTokens],
    );
  }

  /** Removes expired metadata and unreachable result/context rows, scoped to
   * this public bot. Usage details are retained for at most 30 days. */
  async prune(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`WITH expired AS (
        SELECT ctid FROM public_query_sessions
        WHERE bot_account_id=$1 AND expires_at<=now()
        ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED
      ) DELETE FROM public_query_sessions session USING expired WHERE session.ctid=expired.ctid`, [this.botId]);
      for (const table of ['session_contexts', 'result_sets']) {
        await client.query(`WITH expired AS (
          SELECT saved.ctid FROM ${table} saved
          WHERE saved.platform='kook' AND saved.bot_account_id=$1
            AND (saved.expires_at<=now() OR NOT EXISTS (
              SELECT 1 FROM public_query_sessions session WHERE session.session_id=saved.session_id
                AND session.bot_account_id=saved.bot_account_id AND session.expires_at>now()))
          ORDER BY saved.expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED
        ) DELETE FROM ${table} saved USING expired WHERE saved.ctid=expired.ctid`, [this.botId]);
      }
      await client.query(`WITH expired AS (
        SELECT usage_id FROM usage_records
        WHERE platform='kook' AND bot_account_id=$1 AND recorded_at<=now()-interval '30 days'
        ORDER BY recorded_at LIMIT 1000 FOR UPDATE SKIP LOCKED
      ) DELETE FROM usage_records usage USING expired WHERE usage.usage_id=expired.usage_id`, [this.botId]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
  }
}
