import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { TrustedKookGroupMessage } from '../channels/kook/trusted-group-event.js';

export interface GuildAdminPermissionChecker {
  isGuildAdmin(guildId: string, userId: string): Promise<boolean>;
}

export interface CreateSquadInput {
  label: string;
  pubgShard: string;
  /** Durable account IDs returned by PUBG API resolution and confirmed by the admin. */
  pubgAccountIds: string[];
}

export interface TeamReference {
  tenantId: string;
  teamId: string;
}

export type PendingTeamAction =
  | { kind: 'add_members'; pubgAccountIds: string[] }
  | { kind: 'replace_roster'; pubgAccountIds: string[] }
  | { kind: 'unbind_channel' }
  | { kind: 'disband_team' };

export interface PreparedTeamAction {
  confirmationToken: string;
  expiresAt: string;
  team: TeamReference;
}

export interface BoundTeamStatus extends TeamReference {
  label: string;
  pubgShard: string;
  pubgAccountIds: string[];
  boundChannelCount: number;
}

export type ConfirmedTeamAction =
  | { kind: 'add_members' | 'replace_roster' | 'unbind_channel'; team: TeamReference }
  | { kind: 'disband_team'; team: TeamReference };

export interface TeamAdminServiceOptions {
  confirmationTtlMs?: number;
}

function requiredText(value: string, key: string, maxLength = 256): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`invalid_${key}`);
  return normalized;
}

function normalizedAccountIds(values: string[]): string[] {
  if (!Array.isArray(values)) throw new Error('invalid_pubg_account_ids');
  const accountIds = values.map((value) => requiredText(value, 'pubg_account_id'));
  const unique = [...new Set(accountIds)];
  if (!unique.length || unique.length > 4 || unique.length !== accountIds.length) {
    throw new Error('invalid_pubg_account_ids');
  }
  return unique;
}

function parsePendingAction(value: unknown): PendingTeamAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('team_action_invalid');
  const action = value as Record<string, unknown>;
  switch (action.kind) {
    case 'add_members':
    case 'replace_roster':
      return { kind: action.kind, pubgAccountIds: normalizedAccountIds(action.pubgAccountIds as string[]) };
    case 'unbind_channel':
    case 'disband_team':
      return { kind: action.kind };
    default:
      throw new Error('team_action_invalid');
  }
}

function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try { await client.query('ROLLBACK'); } catch { /* preserve the original error */ }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === '23505');
}

/** Transactional team setup. The caller supplies only a context returned by
 * parseTrustedKookGroupMessage; each state change independently checks current
 * KOOK ownership/admin status before touching PostgreSQL. */
export class TeamAdminService {
  private readonly confirmationTtlMs: number;

  constructor(
    private readonly pool: Pool,
    private readonly permissions: GuildAdminPermissionChecker,
    options: TeamAdminServiceOptions = {},
  ) {
    this.confirmationTtlMs = options.confirmationTtlMs ?? 10 * 60_000;
    if (!Number.isSafeInteger(this.confirmationTtlMs) || this.confirmationTtlMs < 1_000 || this.confirmationTtlMs > 15 * 60_000) {
      throw new Error('team_action_confirmation_ttl_invalid');
    }
  }

  private async requireFreshGuildAdmin(event: TrustedKookGroupMessage): Promise<void> {
    if (event.platform !== 'kook') throw new Error('unsupported_platform');
    const allowed = await this.permissions.isGuildAdmin(event.guildId, event.userId);
    if (!allowed) throw new Error('guild_admin_required');
  }

  private async getOrCreateTenant(client: PoolClient, event: TrustedKookGroupMessage): Promise<string> {
    await client.query(
      `INSERT INTO tenants(tenant_id, platform, bot_account_id, guild_id)
       VALUES ($1,'kook',$2,$3)
       ON CONFLICT (platform, bot_account_id, guild_id) DO NOTHING`,
      [randomUUID(), event.botAccountId, event.guildId],
    );
    const tenant = await client.query(
      `SELECT tenant_id FROM tenants
       WHERE platform='kook' AND bot_account_id=$1 AND guild_id=$2 FOR UPDATE`,
      [event.botAccountId, event.guildId],
    );
    const tenantId = tenant.rows[0]?.tenant_id;
    if (typeof tenantId !== 'string' || !tenantId) throw new Error('tenant_resolution_failed');
    return tenantId;
  }

  private async touchActor(client: PoolClient, event: TrustedKookGroupMessage, tenantId: string): Promise<void> {
    await client.query(
      `INSERT INTO channel_identities(platform,bot_account_id,user_id)
       VALUES ('kook',$1,$2) ON CONFLICT (platform,bot_account_id,user_id) DO NOTHING`,
      [event.botAccountId, event.userId],
    );
    await client.query(
      `INSERT INTO tenant_users(tenant_id,platform,bot_account_id,user_id)
       VALUES ($1,'kook',$2,$3) ON CONFLICT (tenant_id,platform,bot_account_id,user_id) DO NOTHING`,
      [tenantId, event.botAccountId, event.userId],
    );
  }

  private async grantTeamAccess(
    client: PoolClient,
    event: TrustedKookGroupMessage,
    tenantId: string,
    teamId: string,
    role: 'requester' | 'member' | 'admin',
  ): Promise<void> {
    await client.query(
      `INSERT INTO team_user_access(tenant_id,team_id,platform,bot_account_id,user_id,role,granted_by_user_id)
       VALUES ($1,$2,'kook',$3,$4,$5,$4)
       ON CONFLICT (tenant_id,team_id,platform,bot_account_id,user_id)
       DO UPDATE SET role=EXCLUDED.role, granted_by_user_id=EXCLUDED.granted_by_user_id, granted_at=now()`,
      [tenantId, teamId, event.botAccountId, event.userId, role],
    );
  }

  private async bindChannel(
    client: PoolClient,
    event: TrustedKookGroupMessage,
    tenantId: string,
    teamId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO channel_bindings(tenant_id,platform,bot_account_id,channel_id,team_id,bound_by_user_id)
       VALUES ($1,'kook',$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [tenantId, event.botAccountId, event.channelId, teamId, event.userId],
    );
    const binding = await client.query(
      `SELECT tenant_id, team_id FROM channel_bindings
       WHERE platform='kook' AND bot_account_id=$1 AND channel_id=$2 FOR UPDATE`,
      [event.botAccountId, event.channelId],
    );
    const row = binding.rows[0];
    if (!row || row.tenant_id !== tenantId || row.team_id !== teamId) throw new Error('channel_binding_conflict');
  }

  async createSquad(event: TrustedKookGroupMessage, input: CreateSquadInput): Promise<TeamReference> {
    await this.requireFreshGuildAdmin(event);
    const label = requiredText(input.label, 'team_label', 80);
    const pubgShard = requiredText(input.pubgShard, 'pubg_shard', 32);
    if (!/^[a-z0-9_-]+$/u.test(pubgShard)) throw new Error('invalid_pubg_shard');
    const accountIds = normalizedAccountIds(input.pubgAccountIds);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tenantId = await this.getOrCreateTenant(client, event);
      await this.touchActor(client, event, tenantId);
      const teamId = randomUUID();
      await client.query('INSERT INTO teams(tenant_id,team_id,label,pubg_shard) VALUES ($1,$2,$3,$4)', [tenantId, teamId, label, pubgShard]);
      for (const accountId of accountIds) {
        await client.query(
          `INSERT INTO team_members(tenant_id,team_id,pubg_account_id,added_by_user_id)
           VALUES ($1,$2,$3,$4)`,
          [tenantId, teamId, accountId, event.userId],
        );
      }
      await this.bindChannel(client, event, tenantId, teamId);
      await this.grantTeamAccess(client, event, tenantId, teamId, 'admin');
      await client.query('COMMIT');
      return { tenantId, teamId };
    } catch (error) {
      await rollbackQuietly(client);
      if (isUniqueViolation(error)) throw new Error('channel_binding_conflict');
      throw error;
    } finally {
      client.release();
    }
  }

  async bindExistingSquad(event: TrustedKookGroupMessage, teamIdInput: string): Promise<TeamReference> {
    await this.requireFreshGuildAdmin(event);
    const teamId = requiredText(teamIdInput, 'team_id');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tenantId = await this.getOrCreateTenant(client, event);
      const team = await client.query(
        'SELECT 1 FROM teams WHERE tenant_id=$1 AND team_id=$2 FOR UPDATE',
        [tenantId, teamId],
      );
      if (!team.rowCount) throw new Error('team_unavailable_in_guild');
      await this.touchActor(client, event, tenantId);
      await this.bindChannel(client, event, tenantId, teamId);
      await this.grantTeamAccess(client, event, tenantId, teamId, 'admin');
      await client.query('COMMIT');
      return { tenantId, teamId };
    } catch (error) {
      await rollbackQuietly(client);
      if (isUniqueViolation(error)) throw new Error('channel_binding_conflict');
      throw error;
    } finally {
      client.release();
    }
  }

  async getBoundTeamStatus(event: TrustedKookGroupMessage): Promise<BoundTeamStatus> {
    await this.requireFreshGuildAdmin(event);
    const result = await this.pool.query(
      `SELECT t.tenant_id, team.team_id, team.label, team.pubg_shard,
              COALESCE(array_agg(DISTINCT member.pubg_account_id ORDER BY member.pubg_account_id)
                       FILTER (WHERE member.pubg_account_id IS NOT NULL), '{}') AS pubg_account_ids,
              COUNT(DISTINCT binding.channel_id)::INTEGER AS bound_channel_count
       FROM tenants t
       JOIN channel_bindings current_binding
         ON current_binding.tenant_id=t.tenant_id AND current_binding.platform=t.platform
        AND current_binding.bot_account_id=t.bot_account_id
       JOIN teams team ON team.tenant_id=current_binding.tenant_id AND team.team_id=current_binding.team_id
       LEFT JOIN team_members member ON member.tenant_id=team.tenant_id AND member.team_id=team.team_id
       LEFT JOIN channel_bindings binding ON binding.tenant_id=team.tenant_id AND binding.team_id=team.team_id
       WHERE t.platform='kook' AND t.bot_account_id=$1 AND t.guild_id=$2
         AND current_binding.channel_id=$3
       GROUP BY t.tenant_id, team.team_id, team.label, team.pubg_shard`,
      [event.botAccountId, event.guildId, event.channelId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('channel_not_bound');
    return {
      tenantId: String(row.tenant_id),
      teamId: String(row.team_id),
      label: String(row.label),
      pubgShard: String(row.pubg_shard),
      pubgAccountIds: Array.isArray(row.pubg_account_ids) ? row.pubg_account_ids.map(String) : [],
      boundChannelCount: Number(row.bound_channel_count),
    };
  }

  async prepareTeamAction(event: TrustedKookGroupMessage, actionInput: PendingTeamAction): Promise<PreparedTeamAction> {
    await this.requireFreshGuildAdmin(event);
    const action = parsePendingAction(actionInput);
    const confirmationToken = randomBytes(32).toString('base64url');
    const confirmationId = randomUUID();
    const expiresAt = new Date(Date.now() + this.confirmationTtlMs);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const scope = await client.query(
        `SELECT tenant.tenant_id, binding.team_id
         FROM tenants tenant
         JOIN channel_bindings binding
           ON binding.tenant_id=tenant.tenant_id AND binding.platform=tenant.platform
          AND binding.bot_account_id=tenant.bot_account_id
         WHERE tenant.platform='kook' AND tenant.bot_account_id=$1 AND tenant.guild_id=$2
           AND binding.channel_id=$3
         FOR UPDATE OF tenant,binding`,
        [event.botAccountId, event.guildId, event.channelId],
      );
      const tenantId = scope.rows[0]?.tenant_id;
      const teamId = scope.rows[0]?.team_id;
      if (typeof tenantId !== 'string' || typeof teamId !== 'string') throw new Error('channel_not_bound');
      const team = await client.query('SELECT 1 FROM teams WHERE tenant_id=$1 AND team_id=$2 FOR UPDATE', [tenantId, teamId]);
      if (!team.rowCount) throw new Error('channel_not_bound');
      if (action.kind === 'add_members') {
        const members = await client.query('SELECT pubg_account_id FROM team_members WHERE tenant_id=$1 AND team_id=$2', [tenantId, teamId]);
        const roster = new Set<string>([...members.rows.map((row) => String(row.pubg_account_id)), ...action.pubgAccountIds]);
        if (roster.size > 4) throw new Error('team_roster_limit_exceeded');
      }
      await client.query("DELETE FROM pending_team_actions WHERE expires_at <= now() OR consumed_at < now() - interval '1 day'");
      const pendingCount = await client.query(
        `SELECT COUNT(*)::INTEGER AS count FROM pending_team_actions
         WHERE tenant_id=$1 AND team_id=$2 AND actor_user_id=$3 AND consumed_at IS NULL AND expires_at > now()`,
        [tenantId, teamId, event.userId],
      );
      if (Number(pendingCount.rows[0]?.count) >= 10) throw new Error('too_many_pending_team_actions');
      await client.query(
        `INSERT INTO pending_team_actions(
           confirmation_id,token_hash,tenant_id,team_id,platform,bot_account_id,guild_id,
           actor_user_id,channel_id,action,payload_json,expires_at
         ) VALUES ($1,$2,$3,$4,'kook',$5,$6,$7,$8,$9,$10::jsonb,$11)`,
        [confirmationId, tokenDigest(confirmationToken), tenantId, teamId, event.botAccountId, event.guildId,
          event.userId, event.channelId, action.kind, JSON.stringify(action), expiresAt],
      );
      await client.query('COMMIT');
      return { confirmationToken, expiresAt: expiresAt.toISOString(), team: { tenantId, teamId } };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async confirmTeamAction(event: TrustedKookGroupMessage, tokenInput: string): Promise<ConfirmedTeamAction> {
    await this.requireFreshGuildAdmin(event);
    const token = requiredText(tokenInput, 'confirmation_token', 64);
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) throw new Error('team_action_confirmation_unavailable');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const pending = await client.query(
        `SELECT action, payload_json, tenant_id, team_id
         FROM pending_team_actions
         WHERE token_hash=$1 AND platform='kook' AND bot_account_id=$2 AND guild_id=$3
           AND actor_user_id=$4 AND channel_id=$5 AND expires_at > now() AND consumed_at IS NULL
         FOR UPDATE`,
        [tokenDigest(token), event.botAccountId, event.guildId, event.userId, event.channelId],
      );
      const row = pending.rows[0];
      if (!row || typeof row.tenant_id !== 'string' || typeof row.team_id !== 'string') {
        throw new Error('team_action_confirmation_unavailable');
      }
      const team: TeamReference = { tenantId: row.tenant_id, teamId: row.team_id };
      const action = parsePendingAction({
        ...(row.payload_json as Record<string, unknown>),
        kind: row.action,
      });
      const lockedTeam = await client.query('SELECT 1 FROM teams WHERE tenant_id=$1 AND team_id=$2 FOR UPDATE', [team.tenantId, team.teamId]);
      if (!lockedTeam.rowCount) throw new Error('team_action_confirmation_unavailable');
      await this.touchActor(client, event, team.tenantId);
      await this.grantTeamAccess(client, event, team.tenantId, team.teamId, 'admin');

      switch (action.kind) {
        case 'add_members': {
          const current = await client.query(
            'SELECT pubg_account_id FROM team_members WHERE tenant_id=$1 AND team_id=$2 FOR UPDATE',
            [team.tenantId, team.teamId],
          );
          const combined = new Set<string>([
            ...current.rows.map((member) => String(member.pubg_account_id)),
            ...action.pubgAccountIds,
          ]);
          if (combined.size > 4) throw new Error('team_roster_limit_exceeded');
          for (const accountId of action.pubgAccountIds) {
            await client.query(
              `INSERT INTO team_members(tenant_id,team_id,pubg_account_id,added_by_user_id)
               VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,team_id,pubg_account_id) DO NOTHING`,
              [team.tenantId, team.teamId, accountId, event.userId],
            );
          }
          break;
        }
        case 'replace_roster': {
          await client.query(
            'DELETE FROM team_members WHERE tenant_id=$1 AND team_id=$2 AND NOT (pubg_account_id = ANY($3::text[]))',
            [team.tenantId, team.teamId, action.pubgAccountIds],
          );
          for (const accountId of action.pubgAccountIds) {
            await client.query(
              `INSERT INTO team_members(tenant_id,team_id,pubg_account_id,added_by_user_id)
               VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,team_id,pubg_account_id) DO NOTHING`,
              [team.tenantId, team.teamId, accountId, event.userId],
            );
          }
          break;
        }
        case 'unbind_channel': {
          await client.query(
            `DELETE FROM message_outbox
             WHERE tenant_id=$1 AND team_id=$2 AND platform='kook' AND bot_account_id=$3 AND channel_id=$4`,
            [team.tenantId, team.teamId, event.botAccountId, event.channelId],
          );
          await client.query(
            `DELETE FROM message_inbox
             WHERE tenant_id=$1 AND team_id=$2 AND platform='kook' AND bot_account_id=$3 AND channel_id=$4`,
            [team.tenantId, team.teamId, event.botAccountId, event.channelId],
          );
          await client.query(
            `DELETE FROM result_sets
             WHERE tenant_id=$1 AND team_id=$2 AND platform='kook' AND bot_account_id=$3 AND channel_id=$4`,
            [team.tenantId, team.teamId, event.botAccountId, event.channelId],
          );
          await client.query(
            `DELETE FROM session_contexts
             WHERE tenant_id=$1 AND team_id=$2 AND platform='kook' AND bot_account_id=$3 AND channel_id=$4`,
            [team.tenantId, team.teamId, event.botAccountId, event.channelId],
          );
          const unbound = await client.query(
            `DELETE FROM channel_bindings
             WHERE tenant_id=$1 AND platform='kook' AND bot_account_id=$2 AND channel_id=$3 AND team_id=$4`,
            [team.tenantId, event.botAccountId, event.channelId, team.teamId],
          );
          if (unbound.rowCount !== 1) throw new Error('team_action_confirmation_unavailable');
          await client.query(
            `DELETE FROM pending_team_actions
             WHERE tenant_id=$1 AND team_id=$2 AND bot_account_id=$3 AND channel_id=$4 AND token_hash<>$5`,
            [team.tenantId, team.teamId, event.botAccountId, event.channelId, tokenDigest(token)],
          );
          break;
        }
        case 'disband_team': {
          await client.query(
            `DELETE FROM message_outbox WHERE tenant_id=$1 AND team_id=$2`,
            [team.tenantId, team.teamId],
          );
          await client.query(
            `DELETE FROM message_inbox WHERE tenant_id=$1 AND team_id=$2`,
            [team.tenantId, team.teamId],
          );
          await client.query('DELETE FROM result_sets WHERE tenant_id=$1 AND team_id=$2', [team.tenantId, team.teamId]);
          await client.query('DELETE FROM session_contexts WHERE tenant_id=$1 AND team_id=$2', [team.tenantId, team.teamId]);
          await client.query('DELETE FROM sync_state WHERE tenant_id=$1 AND team_id=$2', [team.tenantId, team.teamId]);
          await client.query('DELETE FROM telemetry_prefetch_runs WHERE tenant_id=$1 AND team_id=$2', [team.tenantId, team.teamId]);
          await client.query(
            `DELETE FROM pending_team_actions
             WHERE tenant_id=$1 AND team_id=$2 AND token_hash<>$3`,
            [team.tenantId, team.teamId, tokenDigest(token)],
          );
          const disbanded = await client.query('DELETE FROM teams WHERE tenant_id=$1 AND team_id=$2', [team.tenantId, team.teamId]);
          if (disbanded.rowCount !== 1) throw new Error('team_action_confirmation_unavailable');
          break;
        }
      }

      await client.query('UPDATE pending_team_actions SET consumed_at=now() WHERE token_hash=$1', [tokenDigest(token)]);
      await client.query('COMMIT');
      return { kind: action.kind, team };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }
}
