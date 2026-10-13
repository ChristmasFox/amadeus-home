import { createHash, randomUUID } from 'node:crypto';
import { createTeamContext, type TeamContext } from '@agent/pubg-domain/core';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { parseKookRequest } from '../channels/kook/request-event.js';
import type { TrustedKookDirectMessage, TrustedKookGroupMessage } from '../channels/kook/trusted-group-event.js';
import { PostgresPubgRepository, type TrustedConversationScope } from '../infrastructure/postgres/pubg-repository.js';
import type { KookIngressJob } from './kook-ingress-queue.js';

type MessageEvent = TrustedKookGroupMessage | TrustedKookDirectMessage;
export interface PublicQueryPermissionChecker {
  isGuildMember(guildId: string, userId: string): Promise<boolean>;
  isTextChannelMember(guildId: string, channelId: string, userId: string): Promise<boolean>;
}
export interface PublicQueryTeamSelection { tenantId: string; teamId: string }
export interface PublicQueryTeamChoice extends PublicQueryTeamSelection { label: string; pubgShard: string }
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
      if (!members.rowCount || members.rowCount > 4) throw new Error('public_query_roster_unavailable');
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

  /** Removes expired metadata and unreachable result/context rows, scoped to
   * this public bot. No user content is retained in the authorization ledger. */
  async prune(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const table of ['session_contexts', 'result_sets']) {
        await client.query(`DELETE FROM ${table} saved WHERE saved.platform='kook' AND saved.bot_account_id=$1
          AND NOT EXISTS (SELECT 1 FROM public_query_sessions session WHERE session.session_id=saved.session_id
            AND session.bot_account_id=saved.bot_account_id AND session.expires_at>now())`, [this.botId]);
      }
      await client.query('DELETE FROM public_query_sessions WHERE bot_account_id=$1 AND expires_at<=now()', [this.botId]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
  }
}
