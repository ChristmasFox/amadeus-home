import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { TrustedKookGroupMessage } from '../channels/kook/trusted-group-event.js';

export interface GuildAdminPermissionChecker {
  isGuildAdmin(guildId: string, userId: string): Promise<boolean>;
}

export interface CreateSquadInput {
  label: string;
  platform: string;
  /** Durable account IDs returned by PUBG API resolution and confirmed by the admin. */
  pubgAccountIds: string[];
}

export interface TeamReference {
  tenantId: string;
  teamId: string;
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
  constructor(private readonly pool: Pool, private readonly permissions: GuildAdminPermissionChecker) {}

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
    const platform = requiredText(input.platform, 'pubg_platform', 32);
    if (!/^[a-z0-9_-]+$/u.test(platform)) throw new Error('invalid_pubg_platform');
    const accountIds = normalizedAccountIds(input.pubgAccountIds);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tenantId = await this.getOrCreateTenant(client, event);
      await this.touchActor(client, event, tenantId);
      const teamId = randomUUID();
      await client.query('INSERT INTO teams(tenant_id,team_id,label) VALUES ($1,$2,$3)', [tenantId, teamId, label]);
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

  async addMembersToBoundSquad(event: TrustedKookGroupMessage, accountIdsInput: string[]): Promise<TeamReference> {
    await this.requireFreshGuildAdmin(event);
    if (!Array.isArray(accountIdsInput) || !accountIdsInput.length || accountIdsInput.length > 4) {
      throw new Error('invalid_pubg_account_ids');
    }
    const accountIds = [...new Set(accountIdsInput.map((value) => requiredText(value, 'pubg_account_id')))];
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tenant = await client.query(
        `SELECT tenant_id FROM tenants WHERE platform='kook' AND bot_account_id=$1 AND guild_id=$2 FOR UPDATE`,
        [event.botAccountId, event.guildId],
      );
      const tenantId = tenant.rows[0]?.tenant_id;
      if (typeof tenantId !== 'string' || !tenantId) throw new Error('channel_not_bound');
      const binding = await client.query(
        `SELECT team_id FROM channel_bindings
         WHERE tenant_id=$1 AND platform='kook' AND bot_account_id=$2 AND channel_id=$3 FOR UPDATE`,
        [tenantId, event.botAccountId, event.channelId],
      );
      const teamId = binding.rows[0]?.team_id;
      if (typeof teamId !== 'string' || !teamId) throw new Error('channel_not_bound');
      const lockedTeam = await client.query(
        'SELECT 1 FROM teams WHERE tenant_id=$1 AND team_id=$2 FOR UPDATE',
        [tenantId, teamId],
      );
      if (!lockedTeam.rowCount) throw new Error('channel_not_bound');
      const current = await client.query(
        'SELECT pubg_account_id FROM team_members WHERE tenant_id=$1 AND team_id=$2 FOR UPDATE',
        [tenantId, teamId],
      );
      const combined = new Set<string>([
        ...current.rows.map((row) => String(row.pubg_account_id)),
        ...accountIds,
      ]);
      if (combined.size > 4) throw new Error('team_roster_limit_exceeded');
      await this.touchActor(client, event, tenantId);
      for (const accountId of accountIds) {
        await client.query(
          `INSERT INTO team_members(tenant_id,team_id,pubg_account_id,added_by_user_id)
           VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,team_id,pubg_account_id) DO NOTHING`,
          [tenantId, teamId, accountId, event.userId],
        );
      }
      await this.grantTeamAccess(client, event, tenantId, teamId, 'admin');
      await client.query('COMMIT');
      return { tenantId, teamId };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }
}
