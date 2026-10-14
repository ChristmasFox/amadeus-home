import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { TrustedKookButtonClick } from '../channels/kook/trusted-button-event.js';
import type { TrustedKookGroupMessage } from '../channels/kook/trusted-group-event.js';
import { isVerifiedKookWelcomeTarget, type TrustedKookGuildJoin, type VerifiedKookWelcomeTarget } from '../channels/kook/guild-welcome.js';
import { parseStoredTeamLeaderboardMetric, parseTeamLeaderboardMetric, type TeamLeaderboardMetric } from '../contracts/team-preferences.js';
import { normalizeTeamAlias, normalizeTeamMemberLookup } from '../contracts/team-aliases.js';

type TeamConfirmationActor = Pick<TrustedKookGroupMessage, 'platform' | 'botAccountId' | 'guildId' | 'userId' | 'channelId'>;

export interface GuildAdminPermissionChecker {
  isGuildAdmin(guildId: string, userId: string): Promise<boolean>;
  isTextChannelMember?(guildId: string, channelId: string, userId: string): Promise<boolean>;
}

export interface CreateSquadInput {
  label: string;
  pubgShard: string;
  /** Durable account IDs returned by PUBG API resolution and confirmed by the admin. */
  pubgAccountIds: string[];
  /** Official display names returned with the same resolved account IDs. */
  resolvedPlayers?: ResolvedPubgAccount[];
}

export interface ResolvedPubgAccount { accountId: string; displayName: string }

export interface TeamReference {
  tenantId: string;
  teamId: string;
}

export interface PreparedSquadSetup {
  confirmationToken: string;
  expiresAt: string;
  label: string;
  pubgShard: string;
  memberCount: number;
}

export interface GuildTeamSummary extends TeamReference {
  label: string;
  pubgShard: string;
  memberCount: number;
}

export type PendingTeamAction =
  | { kind: 'add_members'; pubgAccountIds: string[]; resolvedPlayers?: ResolvedPubgAccount[] }
  | { kind: 'replace_roster'; pubgAccountIds: string[]; resolvedPlayers?: ResolvedPubgAccount[] }
  | { kind: 'set_team_alias'; pubgAccountId: string; alias: string }
  | { kind: 'delete_team_alias'; alias: string }
  | { kind: 'set_leaderboard_metric'; metric: TeamLeaderboardMetric }
  | { kind: 'delete_leaderboard_metric' }
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

export interface TeamAliasEntry {
  pubgAccountId: string;
  playerName: string;
  alias: string;
}

export type ConfirmedTeamAction =
  | { kind: 'add_members' | 'replace_roster' | 'set_team_alias' | 'delete_team_alias' | 'set_leaderboard_metric' | 'delete_leaderboard_metric' | 'unbind_channel'; team: TeamReference }
  | { kind: 'disband_team'; team: TeamReference };

export interface TeamAdminServiceOptions {
  confirmationTtlMs?: number;
}

function requiredText(value: string, key: string, maxLength = 256): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`invalid_${key}`);
  return normalized;
}

function teamLabel(value: string): string {
  const label = requiredText(value, 'team_label', 80);
  if (/[\u0000-\u001f\u007f]/u.test(label)) throw new Error('invalid_team_label');
  return label;
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

function normalizedResolvedPlayers(value: unknown, accountIds: string[]): ResolvedPubgAccount[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== accountIds.length) throw new Error('invalid_resolved_pubg_players');
  const names = new Map<string, string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalid_resolved_pubg_players');
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.accountId !== 'string' || typeof candidate.displayName !== 'string') throw new Error('invalid_resolved_pubg_players');
    const accountId = requiredText(candidate.accountId, 'pubg_account_id');
    const displayName = requiredText(candidate.displayName, 'pubg_display_name', 100);
    if (!accountIds.includes(accountId) || names.has(accountId) || /[\u0000-\u001f]/u.test(displayName)) throw new Error('invalid_resolved_pubg_players');
    names.set(accountId, displayName);
  }
  if (names.size !== accountIds.length) throw new Error('invalid_resolved_pubg_players');
  return accountIds.map(accountId => ({ accountId, displayName: names.get(accountId)! }));
}

function normalizedSquadInput(value: CreateSquadInput): CreateSquadInput {
  if (!value || typeof value !== 'object') throw new Error('invalid_squad_setup');
  const label = requiredText(value.label, 'team_label', 80), pubgShard = requiredText(value.pubgShard, 'pubg_shard', 32);
  if (!/^[a-z0-9_-]+$/u.test(pubgShard)) throw new Error('invalid_pubg_shard');
  const pubgAccountIds = normalizedAccountIds(value.pubgAccountIds);
  const resolvedPlayers = normalizedResolvedPlayers(value.resolvedPlayers, pubgAccountIds);
  return { label, pubgShard, pubgAccountIds, ...(resolvedPlayers ? { resolvedPlayers } : {}) };
}

function parsePendingAction(value: unknown): PendingTeamAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('team_action_invalid');
  const action = value as Record<string, unknown>;
  switch (action.kind) {
    case 'add_members':
    case 'replace_roster': {
      const pubgAccountIds = normalizedAccountIds(action.pubgAccountIds as string[]);
      const resolvedPlayers = normalizedResolvedPlayers(action.resolvedPlayers, pubgAccountIds);
      if (action.kind === 'add_members') return { kind: 'add_members', pubgAccountIds, ...(resolvedPlayers ? { resolvedPlayers } : {}) };
      return { kind: 'replace_roster', pubgAccountIds, ...(resolvedPlayers ? { resolvedPlayers } : {}) };
    }
    case 'unbind_channel':
    case 'disband_team':
      return { kind: action.kind };
    case 'set_leaderboard_metric': {
      const metric = parseTeamLeaderboardMetric(action.metric);
      if (!metric) throw new Error('team_preference_metric_invalid');
      return { kind: action.kind, metric };
    }
    case 'delete_leaderboard_metric':
      return { kind: action.kind };
    case 'set_team_alias':
      if (typeof action.pubgAccountId !== 'string') throw new Error('team_action_invalid');
      return { kind: action.kind, pubgAccountId: requiredText(action.pubgAccountId, 'pubg_account_id'), alias: normalizeTeamAlias(action.alias).displayAlias };
    case 'delete_team_alias':
      return { kind: action.kind, alias: normalizeTeamAlias(action.alias).displayAlias };
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

  private async requireFreshGuildAdmin(event: Pick<TeamConfirmationActor, 'platform' | 'botAccountId' | 'guildId' | 'userId'>): Promise<void> {
    if (event.platform !== 'kook') throw new Error('unsupported_platform');
    const allowed = await this.permissions.isGuildAdmin(event.guildId, event.userId);
    if (!allowed) throw new Error('guild_admin_required');
  }

  private async getOrCreateTenant(client: PoolClient, event: TeamConfirmationActor): Promise<string> {
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

  private async touchActor(
    client: PoolClient,
    event: Pick<TeamConfirmationActor, 'botAccountId' | 'userId'>,
    tenantId: string,
  ): Promise<void> {
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
    event: Pick<TeamConfirmationActor, 'botAccountId' | 'userId'>,
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

  private async persistResolvedPlayers(client: PoolClient, shard: string, players: ResolvedPubgAccount[] | undefined): Promise<void> {
    for (const player of players ?? []) {
      await client.query(
        `INSERT INTO pubg_accounts(shard,account_id,display_name,last_resolved_at)
         VALUES ($1,$2,$3,now()) ON CONFLICT (shard,account_id) DO UPDATE
         SET display_name=EXCLUDED.display_name,last_resolved_at=now()`,
        [shard, player.accountId, player.displayName],
      );
    }
  }

  private async bindChannel(
    client: PoolClient,
    event: TeamConfirmationActor,
    tenantId: string,
    teamId: string,
  ): Promise<void> {
    await client.query('INSERT INTO channel_binding_versions(bot_account_id,channel_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [event.botAccountId, event.channelId]);
    await client.query('SELECT revision FROM channel_binding_versions WHERE bot_account_id=$1 AND channel_id=$2 FOR UPDATE', [event.botAccountId, event.channelId]);
    const inserted = await client.query(
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
    if (inserted.rowCount) await client.query('UPDATE channel_binding_versions SET revision=revision+1 WHERE bot_account_id=$1 AND channel_id=$2', [event.botAccountId, event.channelId]);
  }

  private async ensureSingleGuildTeam(
    client: PoolClient,
    event: TeamConfirmationActor,
    defaultLabel: string,
  ): Promise<TeamReference> {
    const tenantId = await this.getOrCreateTenant(client, event);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`kook-guild-team:${event.botAccountId}:${event.guildId}`]);
    const teams = await client.query('SELECT team_id FROM teams WHERE tenant_id=$1 ORDER BY created_at,team_id FOR UPDATE', [tenantId]);
    if (teams.rows.length > 1) throw new Error('guild_team_ambiguous');
    if (teams.rows.length === 1 && typeof teams.rows[0]?.team_id === 'string') {
      return { tenantId, teamId: teams.rows[0].team_id };
    }
    const teamId = randomUUID();
    await client.query('INSERT INTO teams(tenant_id,team_id,label,pubg_shard) VALUES ($1,$2,$3,\'steam\')', [tenantId, teamId, teamLabel(defaultLabel)]);
    return { tenantId, teamId };
  }

  /** A verified KOOK bot-join event creates the guild's one default Steam team
   * and binds only the API-verified welcome/default text channel. */
  async provisionFromGuildJoin(event: TrustedKookGuildJoin, target: VerifiedKookWelcomeTarget): Promise<TeamReference> {
    if (!isVerifiedKookWelcomeTarget(target) || event.botAccountId !== target.botAccountId || event.guildId !== target.guildId) {
      throw new Error('kook_welcome_target_invalid');
    }
    const actor: TeamConfirmationActor = {
      platform: 'kook', botAccountId: event.botAccountId, guildId: event.guildId,
      channelId: target.channelId, userId: event.botAccountId,
    };
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const team = await this.ensureSingleGuildTeam(client, actor, target.guildName || 'KOOK服务器');
      await this.bindChannel(client, actor, team.tenantId, team.teamId);
      await client.query('COMMIT');
      return team;
    } catch (error) {
      await rollbackQuietly(client);
      if (isUniqueViolation(error)) throw new Error('channel_binding_conflict');
      throw error;
    } finally { client.release(); }
  }

  /** A new text channel can join its guild's single team only after a fresh
   * KOOK channel-membership check for the message author. */
  async ensureGroupChannel(event: TrustedKookGroupMessage, defaultLabel: string): Promise<TeamReference> {
    if (event.platform !== 'kook' || !this.permissions.isTextChannelMember) throw new Error('kook_permission_check_unavailable');
    if (!await this.permissions.isTextChannelMember(event.guildId, event.channelId, event.userId)) {
      throw new Error('kook_channel_member_required');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const team = await this.ensureSingleGuildTeam(client, event, defaultLabel);
      await this.touchActor(client, event, team.tenantId);
      await this.bindChannel(client, event, team.tenantId, team.teamId);
      await this.grantTeamAccess(client, event, team.tenantId, team.teamId, 'member');
      await client.query('COMMIT');
      return team;
    } catch (error) {
      await rollbackQuietly(client);
      if (isUniqueViolation(error)) throw new Error('channel_binding_conflict');
      throw error;
    } finally { client.release(); }
  }

  async renameBoundTeam(event: TrustedKookGroupMessage, expectedTeam: TeamReference, labelInput: string): Promise<void> {
    if (!this.permissions.isTextChannelMember) throw new Error('kook_permission_check_unavailable');
    if (!await this.permissions.isTextChannelMember(event.guildId, event.channelId, event.userId)) {
      throw new Error('kook_channel_member_required');
    }
    const label = teamLabel(labelInput);
    const result = await this.pool.query(
      `UPDATE teams team SET label=$5
       FROM tenants tenant, channel_bindings binding
       WHERE tenant.tenant_id=$1 AND tenant.platform='kook' AND tenant.bot_account_id=$2 AND tenant.guild_id=$3
         AND binding.tenant_id=tenant.tenant_id AND binding.platform=tenant.platform
         AND binding.bot_account_id=tenant.bot_account_id AND binding.channel_id=$4
         AND team.tenant_id=tenant.tenant_id AND team.team_id=binding.team_id AND team.team_id=$6`,
      [expectedTeam.tenantId, event.botAccountId, event.guildId, event.channelId, label, expectedTeam.teamId],
    );
    if (!result.rowCount) throw new Error('team_action_scope_changed');
  }

  async assertAccountClaimAllowed(event: TrustedKookGroupMessage, targetUserIdInput: string): Promise<void> {
    const targetUserId = requiredText(targetUserIdInput, 'user_id', 128);
    if (!this.permissions.isTextChannelMember) throw new Error('kook_permission_check_unavailable');
    if (!await this.permissions.isTextChannelMember(event.guildId, event.channelId, event.userId)) {
      throw new Error('kook_channel_member_required');
    }
    if (targetUserId !== event.userId) {
      await this.requireFreshGuildAdmin(event);
      if (!await this.permissions.isTextChannelMember(event.guildId, event.channelId, targetUserId)) {
        throw new Error('kook_target_channel_member_required');
      }
    }
  }

  /** Persists a PUBG API-resolved identity, its team membership, and the
   * KOOK actor mapping atomically. Member delegation is checked against the
   * live guild-admin and text-channel-membership APIs before the transaction. */
  async claimVerifiedAccount(
    event: TrustedKookGroupMessage,
    expectedTeam: TeamReference,
    targetUserIdInput: string,
    shardInput: string,
    account: ResolvedPubgAccount,
  ): Promise<void> {
    const targetUserId = requiredText(targetUserIdInput, 'user_id', 128);
    const shard = requiredText(shardInput, 'pubg_shard', 32);
    const accountId = requiredText(account.accountId, 'pubg_account_id', 128);
    const displayName = requiredText(account.displayName, 'pubg_display_name', 100);
    if (!/^(steam|kakao|psn|xbox)$/u.test(shard) || !/^account\.[A-Za-z0-9_-]{1,128}$/u.test(accountId)
      || /[\u0000-\u001f\u007f]/u.test(displayName)) throw new Error('public_pubg_lookup_invalid_response');
    await this.assertAccountClaimAllowed(event, targetUserId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`pubg-claim:kook:${event.botAccountId}:${shard}:${accountId}`]);
      const binding = await client.query(
        `SELECT tenant.tenant_id,binding.team_id FROM tenants tenant JOIN channel_bindings binding
           ON binding.tenant_id=tenant.tenant_id AND binding.platform=tenant.platform AND binding.bot_account_id=tenant.bot_account_id
         WHERE tenant.platform='kook' AND tenant.bot_account_id=$1 AND tenant.guild_id=$2 AND binding.channel_id=$3 FOR UPDATE OF binding`,
        [event.botAccountId, event.guildId, event.channelId],
      );
      const row = binding.rows[0];
      if (!row || row.tenant_id !== expectedTeam.tenantId || row.team_id !== expectedTeam.teamId) throw new Error('team_action_scope_changed');
      await client.query('SELECT 1 FROM teams WHERE tenant_id=$1 AND team_id=$2 FOR UPDATE', [expectedTeam.tenantId, expectedTeam.teamId]);
      const targetIdentity = { botAccountId: event.botAccountId, userId: targetUserId };
      await this.touchActor(client, targetIdentity, expectedTeam.tenantId);
      await this.persistResolvedPlayers(client, shard, [{ accountId, displayName }]);
      await client.query(
        `INSERT INTO team_members(tenant_id,team_id,pubg_account_id,added_by_user_id)
         VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,team_id,pubg_account_id)
         DO UPDATE SET added_by_user_id=EXCLUDED.added_by_user_id`,
        [expectedTeam.tenantId, expectedTeam.teamId, accountId, event.userId],
      );
      await client.query(
        `INSERT INTO account_claims(platform,bot_account_id,user_id,pubg_shard,pubg_account_id,claim_status,claimed_at)
         VALUES ('kook',$1,$2,$3,$4,'verified',now())
         ON CONFLICT (platform,bot_account_id,user_id) DO UPDATE
         SET pubg_shard=EXCLUDED.pubg_shard,pubg_account_id=EXCLUDED.pubg_account_id,claim_status='verified',claimed_at=now()`,
        [event.botAccountId, targetUserId, shard, accountId],
      );
      await client.query(
        `INSERT INTO team_user_access(tenant_id,team_id,platform,bot_account_id,user_id,role,granted_by_user_id)
         VALUES ($1,$2,'kook',$3,$4,'member',$5)
         ON CONFLICT (tenant_id,team_id,platform,bot_account_id,user_id)
         DO UPDATE SET role=CASE WHEN team_user_access.role='admin' THEN 'admin' ELSE 'member' END,
           granted_by_user_id=EXCLUDED.granted_by_user_id,granted_at=now()`,
        [expectedTeam.tenantId, expectedTeam.teamId, event.botAccountId, targetUserId, event.userId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await rollbackQuietly(client);
      if (isUniqueViolation(error)) throw new Error('account_claim_conflict');
      throw error;
    } finally { client.release(); }
  }

  async createSquad(event: TrustedKookGroupMessage, input: CreateSquadInput): Promise<TeamReference> {
    await this.requireFreshGuildAdmin(event);
    const normalized = normalizedSquadInput(input);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const team = await this.insertSquad(client, event, normalized, randomUUID());
      await client.query('COMMIT');
      return team;
    } catch (error) {
      await rollbackQuietly(client);
      if (isUniqueViolation(error)) throw new Error('channel_binding_conflict');
      throw error;
    } finally {
      client.release();
    }
  }

  private async insertSquad(client: PoolClient, event: TeamConfirmationActor, input: CreateSquadInput, teamId: string): Promise<TeamReference> {
    const tenantId = await this.getOrCreateTenant(client, event);
    await this.touchActor(client, event, tenantId);
    await client.query('INSERT INTO teams(tenant_id,team_id,label,pubg_shard) VALUES ($1,$2,$3,$4)', [tenantId, teamId, input.label, input.pubgShard]);
    for (const accountId of input.pubgAccountIds) {
      await client.query('INSERT INTO team_members(tenant_id,team_id,pubg_account_id,added_by_user_id) VALUES ($1,$2,$3,$4)', [tenantId, teamId, accountId, event.userId]);
    }
    await this.persistResolvedPlayers(client, input.pubgShard, input.resolvedPlayers);
    await this.bindChannel(client, event, tenantId, teamId);
    await this.grantTeamAccess(client, event, tenantId, teamId, 'admin');
    return { tenantId, teamId };
  }

  async assertGuildAdmin(event: TrustedKookGroupMessage): Promise<void> {
    await this.requireFreshGuildAdmin(event);
  }

  async listGuildTeams(event: TrustedKookGroupMessage): Promise<GuildTeamSummary[]> {
    await this.requireFreshGuildAdmin(event);
    const result = await this.pool.query(
      `SELECT tenant.tenant_id,team.team_id,team.label,team.pubg_shard,COUNT(member.pubg_account_id)::INTEGER AS member_count
       FROM tenants tenant JOIN teams team ON team.tenant_id=tenant.tenant_id
       LEFT JOIN team_members member ON member.tenant_id=team.tenant_id AND member.team_id=team.team_id
       WHERE tenant.platform='kook' AND tenant.bot_account_id=$1 AND tenant.guild_id=$2
       GROUP BY tenant.tenant_id,team.team_id,team.label,team.pubg_shard,team.created_at ORDER BY team.created_at,team.team_id LIMIT 50`,
      [event.botAccountId, event.guildId],
    );
    return result.rows.map(row => ({ tenantId: row.tenant_id, teamId: row.team_id, label: row.label, pubgShard: row.pubg_shard, memberCount: Number(row.member_count) }));
  }

  async prepareSquadCreation(event: TrustedKookGroupMessage, input: CreateSquadInput): Promise<PreparedSquadSetup> {
    await this.requireFreshGuildAdmin(event);
    return this.prepareSquadSetup(event, 'create', randomUUID(), normalizedSquadInput(input));
  }

  async prepareSquadBinding(event: TrustedKookGroupMessage, teamIdInput: string): Promise<PreparedSquadSetup> {
    await this.requireFreshGuildAdmin(event);
    return this.prepareSquadSetup(event, 'bind', requiredText(teamIdInput, 'team_id'), null);
  }

  private async prepareSquadSetup(event: TrustedKookGroupMessage, action: 'create' | 'bind', teamId: string, input: CreateSquadInput | null): Promise<PreparedSquadSetup> {
    const token = randomBytes(32).toString('base64url'), expiresAt = new Date(Date.now() + this.confirmationTtlMs);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`squad-setup:${event.botAccountId}:${event.guildId}:${event.userId}`]);
      const bound = await client.query("SELECT 1 FROM channel_bindings WHERE platform='kook' AND bot_account_id=$1 AND channel_id=$2", [event.botAccountId, event.channelId]);
      if (bound.rowCount) throw new Error('channel_binding_conflict');
      await client.query('INSERT INTO channel_binding_versions(bot_account_id,channel_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [event.botAccountId, event.channelId]);
      const revision = await client.query('SELECT revision FROM channel_binding_versions WHERE bot_account_id=$1 AND channel_id=$2 FOR SHARE', [event.botAccountId, event.channelId]);
      let summary = input ? { label: input.label, pubgShard: input.pubgShard, memberCount: input.pubgAccountIds.length } : null;
      if (action === 'bind') {
        const existing = await client.query(
          `SELECT team.label,team.pubg_shard,COUNT(member.pubg_account_id)::INTEGER AS member_count
           FROM tenants tenant JOIN teams team ON team.tenant_id=tenant.tenant_id
           LEFT JOIN team_members member ON member.tenant_id=team.tenant_id AND member.team_id=team.team_id
           WHERE tenant.platform='kook' AND tenant.bot_account_id=$1 AND tenant.guild_id=$2 AND team.team_id=$3
           GROUP BY team.label,team.pubg_shard`, [event.botAccountId, event.guildId, teamId],
        );
        const row = existing.rows[0]; if (!row) throw new Error('team_unavailable_in_guild');
        summary = { label: row.label, pubgShard: row.pubg_shard, memberCount: Number(row.member_count) };
      }
      await client.query("DELETE FROM pending_squad_setups WHERE bot_account_id=$1 AND ((consumed_at IS NULL AND expires_at<=now()) OR consumed_at<now()-interval '1 day')", [event.botAccountId]);
      const pending = await client.query('SELECT COUNT(*)::INTEGER AS count FROM pending_squad_setups WHERE bot_account_id=$1 AND guild_id=$2 AND actor_user_id=$3 AND consumed_at IS NULL AND expires_at>now()', [event.botAccountId, event.guildId, event.userId]);
      if (Number(pending.rows[0]?.count) >= 10) throw new Error('too_many_pending_team_actions');
      await client.query(
        `INSERT INTO pending_squad_setups(token_hash,platform,bot_account_id,guild_id,channel_id,actor_user_id,action,team_id,payload_json,expires_at,expected_channel_revision)
         VALUES ($1,'kook',$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
        [tokenDigest(token), event.botAccountId, event.guildId, event.channelId, event.userId, action, teamId, JSON.stringify(input ?? {}), expiresAt, revision.rows[0]?.revision],
      );
      await client.query('COMMIT');
      return { confirmationToken: token, expiresAt: expiresAt.toISOString(), ...summary! };
    } catch (error) { await rollbackQuietly(client); throw error; } finally { client.release(); }
  }

  async confirmSquadSetupFromButton(click: TrustedKookButtonClick): Promise<{ kind: 'create' | 'bind'; team: TeamReference }> {
    if (!click.sourceTargetId || !click.eventId || !/^[A-Za-z0-9_-]{43}$/u.test(click.value)) throw new Error('squad_setup_confirmation_unavailable');
    const scope = await this.pool.query('SELECT guild_id FROM pending_squad_setups WHERE token_hash=$1 AND bot_account_id=$2 AND channel_id=$3', [tokenDigest(click.value), click.botAccountId, click.sourceTargetId]);
    const guildId = scope.rows[0]?.guild_id; if (typeof guildId !== 'string') throw new Error('squad_setup_confirmation_unavailable');
    const actor: TeamConfirmationActor = { platform: 'kook', botAccountId: click.botAccountId, guildId, channelId: click.sourceTargetId, userId: click.userId };
    await this.requireFreshGuildAdmin(actor);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const pending = await client.query(
        `SELECT * FROM pending_squad_setups WHERE token_hash=$1 AND bot_account_id=$2 AND guild_id=$3 AND channel_id=$4 AND actor_user_id=$5
         AND ((consumed_at IS NULL AND expires_at>now()) OR (consumed_event_id=$6 AND consumed_at>now()-interval '1 day')) FOR UPDATE`,
        [tokenDigest(click.value), click.botAccountId, guildId, click.sourceTargetId, click.userId, click.eventId],
      );
      const row = pending.rows[0]; if (!row) throw new Error('squad_setup_confirmation_unavailable');
      if (row.consumed_at) {
        await client.query('COMMIT'); return { kind: row.action, team: { tenantId: row.result_tenant_id, teamId: row.team_id } };
      }
      const tenantId = await this.getOrCreateTenant(client, actor);
      const revision = await client.query('SELECT revision FROM channel_binding_versions WHERE bot_account_id=$1 AND channel_id=$2 FOR UPDATE', [click.botAccountId, click.sourceTargetId]);
      if (!revision.rowCount || String(revision.rows[0]?.revision) !== String(row.expected_channel_revision)) throw new Error('squad_setup_confirmation_unavailable');
      const existingBinding = await client.query("SELECT 1 FROM channel_bindings WHERE platform='kook' AND bot_account_id=$1 AND channel_id=$2", [click.botAccountId, click.sourceTargetId]);
      if (existingBinding.rowCount) throw new Error('channel_binding_conflict');
      let team: TeamReference;
      if (row.action === 'create') {
        const input = normalizedSquadInput(row.payload_json as CreateSquadInput);
        team = await this.insertSquad(client, actor, input, row.team_id);
      } else {
        const available = await client.query('SELECT 1 FROM teams WHERE tenant_id=$1 AND team_id=$2 FOR UPDATE', [tenantId, row.team_id]);
        if (!available.rowCount) throw new Error('team_unavailable_in_guild');
        await this.touchActor(client, actor, tenantId);
        await this.bindChannel(client, actor, tenantId, row.team_id);
        await this.grantTeamAccess(client, actor, tenantId, row.team_id, 'admin');
        team = { tenantId, teamId: row.team_id };
      }
      await client.query("UPDATE pending_squad_setups SET consumed_at=now(),consumed_event_id=$2,result_tenant_id=$3,payload_json='{}'::jsonb WHERE token_hash=$1", [tokenDigest(click.value), click.eventId, team.tenantId]);
      await client.query('COMMIT'); return { kind: row.action, team };
    } catch (error) { await rollbackQuietly(client); if (isUniqueViolation(error)) throw new Error('channel_binding_conflict'); throw error; } finally { client.release(); }
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

  async getLeaderboardMetricPreference(event: TrustedKookGroupMessage, expectedTeam?: TeamReference): Promise<TeamLeaderboardMetric | null> {
    const result = await this.pool.query(
      `SELECT binding.tenant_id,binding.team_id,preference.preference_json
       FROM tenants tenant
       JOIN channel_bindings binding ON binding.tenant_id=tenant.tenant_id
         AND binding.platform=tenant.platform AND binding.bot_account_id=tenant.bot_account_id
       LEFT JOIN team_preferences preference ON preference.tenant_id=binding.tenant_id
         AND preference.team_id=binding.team_id AND preference.preference_key='leaderboard_metric'
       WHERE tenant.platform='kook' AND tenant.bot_account_id=$1 AND tenant.guild_id=$2
         AND binding.channel_id=$3`,
      [event.botAccountId, event.guildId, event.channelId],
    );
    const row = result.rows[0];
    if (!row || typeof row.tenant_id !== 'string' || typeof row.team_id !== 'string') throw new Error('channel_not_bound');
    if (expectedTeam && (row.tenant_id !== expectedTeam.tenantId || row.team_id !== expectedTeam.teamId)) throw new Error('team_action_scope_changed');
    return parseStoredTeamLeaderboardMetric(row.preference_json);
  }

  async resolveTeamAliasTarget(
    event: TrustedKookGroupMessage,
    playerName: string,
    expectedTeam?: TeamReference,
  ): Promise<{ pubgAccountId: string; playerName: string }> {
    await this.requireFreshGuildAdmin(event);
    const result = await this.pool.query(
      `SELECT binding.tenant_id,binding.team_id,member.pubg_account_id,
              COALESCE(account.display_name,member.pubg_account_id) AS player_name,alias.display_alias
       FROM tenants tenant
       JOIN channel_bindings binding ON binding.tenant_id=tenant.tenant_id
         AND binding.platform=tenant.platform AND binding.bot_account_id=tenant.bot_account_id
       JOIN teams team ON team.tenant_id=binding.tenant_id AND team.team_id=binding.team_id
       JOIN team_members member ON member.tenant_id=team.tenant_id AND member.team_id=team.team_id
       LEFT JOIN pubg_accounts account ON account.shard=team.pubg_shard AND account.account_id=member.pubg_account_id
       LEFT JOIN team_aliases alias ON alias.tenant_id=member.tenant_id AND alias.team_id=member.team_id
         AND alias.pubg_account_id=member.pubg_account_id
       WHERE tenant.platform='kook' AND tenant.bot_account_id=$1 AND tenant.guild_id=$2
         AND binding.channel_id=$3 ORDER BY member.pubg_account_id,alias.alias_key`,
      [event.botAccountId, event.guildId, event.channelId],
    );
    const first = result.rows[0];
    if (!first) throw new Error('channel_not_bound');
    if (expectedTeam && (first.tenant_id !== expectedTeam.tenantId || first.team_id !== expectedTeam.teamId)) throw new Error('team_action_scope_changed');
    const target = normalizeTeamMemberLookup(requiredText(playerName, 'player_name', 100));
    const candidates = new Map<string, string>();
    for (const row of result.rows) {
      const accountId = String(row.pubg_account_id);
      if ([accountId, String(row.player_name), ...(row.display_alias ? [String(row.display_alias)] : [])]
        .some(candidate => normalizeTeamMemberLookup(candidate) === target)) {
        candidates.set(accountId, String(row.player_name));
      }
    }
    if (!candidates.size) throw new Error('team_alias_member_not_found');
    if (candidates.size > 1) throw new Error('team_alias_member_ambiguous');
    const [pubgAccountId, resolvedName] = [...candidates.entries()][0]!;
    return { pubgAccountId, playerName: resolvedName };
  }

  async listTeamAliases(event: TrustedKookGroupMessage, expectedTeam?: TeamReference): Promise<TeamAliasEntry[]> {
    const result = await this.pool.query(
      `SELECT binding.tenant_id,binding.team_id,member.pubg_account_id,
              COALESCE(account.display_name,member.pubg_account_id) AS player_name,
              alias.alias_key,alias.display_alias
       FROM tenants tenant
       JOIN channel_bindings binding ON binding.tenant_id=tenant.tenant_id
         AND binding.platform=tenant.platform AND binding.bot_account_id=tenant.bot_account_id
       JOIN teams team ON team.tenant_id=binding.tenant_id AND team.team_id=binding.team_id
       LEFT JOIN team_members member ON member.tenant_id=team.tenant_id AND member.team_id=team.team_id
       LEFT JOIN pubg_accounts account ON account.shard=team.pubg_shard AND account.account_id=member.pubg_account_id
       LEFT JOIN team_aliases alias ON alias.tenant_id=member.tenant_id AND alias.team_id=member.team_id
         AND alias.pubg_account_id=member.pubg_account_id
       WHERE tenant.platform='kook' AND tenant.bot_account_id=$1 AND tenant.guild_id=$2
         AND binding.channel_id=$3 ORDER BY member.pubg_account_id,alias.alias_key`,
      [event.botAccountId, event.guildId, event.channelId],
    );
    const first = result.rows[0];
    if (!first || typeof first.tenant_id !== 'string' || typeof first.team_id !== 'string') throw new Error('channel_not_bound');
    if (expectedTeam && (first.tenant_id !== expectedTeam.tenantId || first.team_id !== expectedTeam.teamId)) throw new Error('team_action_scope_changed');
    return result.rows.filter(row => typeof row.alias_key === 'string' && typeof row.display_alias === 'string')
      .map(row => ({ pubgAccountId: String(row.pubg_account_id), playerName: String(row.player_name), alias: String(row.display_alias) }));
  }

  async prepareTeamAction(event: TrustedKookGroupMessage, actionInput: PendingTeamAction, expectedTeam?: TeamReference): Promise<PreparedTeamAction> {
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
      if (expectedTeam && (tenantId !== expectedTeam.tenantId || teamId !== expectedTeam.teamId)) throw new Error('team_action_scope_changed');
      const team = await client.query('SELECT 1 FROM teams WHERE tenant_id=$1 AND team_id=$2 FOR UPDATE', [tenantId, teamId]);
      if (!team.rowCount) throw new Error('channel_not_bound');
      if (action.kind === 'add_members') {
        const members = await client.query('SELECT pubg_account_id FROM team_members WHERE tenant_id=$1 AND team_id=$2', [tenantId, teamId]);
        const roster = new Set<string>([...members.rows.map((row) => String(row.pubg_account_id)), ...action.pubgAccountIds]);
        if (roster.size > 4) throw new Error('team_roster_limit_exceeded');
      }
      await client.query("DELETE FROM pending_team_actions WHERE bot_account_id=$1 AND ((consumed_at IS NULL AND expires_at <= now()) OR consumed_at < now() - interval '1 day')", [event.botAccountId]);
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
    return this.confirmTeamActionForActor(event, tokenInput);
  }

  /** Resolves the token's actor/channel scope and rechecks live guild admin.
   * Exact event redeliveries recover receipts, including after unbind/disband. */
  async confirmTeamActionFromButton(click: TrustedKookButtonClick): Promise<ConfirmedTeamAction> {
    const channelId = click.sourceTargetId;
    if (!channelId) throw new Error('team_action_confirmation_unavailable');
    if (!/^[A-Za-z0-9_-]{43}$/u.test(click.value)) throw new Error('team_action_confirmation_unavailable');
    const result = await this.pool.query(
      `SELECT guild_id FROM pending_team_actions WHERE platform='kook' AND bot_account_id=$1
       AND channel_id=$2 AND token_hash=$3`,
      [click.botAccountId, channelId, tokenDigest(click.value)],
    );
    const guildId = result.rows[0]?.guild_id;
    if (typeof guildId !== 'string' || !guildId) throw new Error('team_action_confirmation_unavailable');
    const actor: TeamConfirmationActor = {
      platform: 'kook',
      botAccountId: click.botAccountId,
      guildId,
      userId: click.userId,
      channelId,
    };
    await this.requireFreshGuildAdmin(actor);
    return this.confirmTeamActionForActor(actor, click.value, click.eventId);
  }

  private async confirmTeamActionForActor(event: TeamConfirmationActor, tokenInput: string, receiptEventId: string | null = null): Promise<ConfirmedTeamAction> {
    const token = requiredText(tokenInput, 'confirmation_token', 64);
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) throw new Error('team_action_confirmation_unavailable');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const pending = await client.query(
        `SELECT pending.action, pending.payload_json, pending.tenant_id, pending.team_id,pending.consumed_at,pending.consumed_event_id
         FROM pending_team_actions pending
         WHERE pending.token_hash=$1 AND pending.platform='kook' AND pending.bot_account_id=$2 AND pending.guild_id=$3
           AND pending.actor_user_id=$4 AND pending.channel_id=$5
           AND ((pending.expires_at > now() AND pending.consumed_at IS NULL)
             OR ($6::TEXT IS NOT NULL AND pending.consumed_event_id=$6 AND pending.consumed_at>now()-interval '1 day'))
         FOR UPDATE OF pending`,
        [tokenDigest(token), event.botAccountId, event.guildId, event.userId, event.channelId, receiptEventId],
      );
      const row = pending.rows[0];
      if (!row || typeof row.tenant_id !== 'string' || typeof row.team_id !== 'string') {
        throw new Error('team_action_confirmation_unavailable');
      }
      const team: TeamReference = { tenantId: row.tenant_id, teamId: row.team_id };
      if (row.consumed_at) {
        if (!['add_members', 'replace_roster', 'set_team_alias', 'delete_team_alias', 'set_leaderboard_metric', 'delete_leaderboard_metric', 'unbind_channel', 'disband_team'].includes(row.action)) throw new Error('team_action_confirmation_unavailable');
        await client.query('COMMIT');
        return { kind: row.action as ConfirmedTeamAction['kind'], team };
      }
      const action = parsePendingAction({
        ...(row.payload_json as Record<string, unknown>),
        kind: row.action,
      });
      const binding = await client.query(
        `SELECT 1 FROM channel_bindings WHERE tenant_id=$1 AND team_id=$2 AND platform='kook'
         AND bot_account_id=$3 AND channel_id=$4 FOR SHARE`,
        [team.tenantId, team.teamId, event.botAccountId, event.channelId],
      );
      if (!binding.rowCount) throw new Error('team_action_confirmation_unavailable');
      const lockedTeam = await client.query('SELECT pubg_shard FROM teams WHERE tenant_id=$1 AND team_id=$2 FOR UPDATE', [team.tenantId, team.teamId]);
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
          await this.persistResolvedPlayers(client, String(lockedTeam.rows[0]!.pubg_shard), action.resolvedPlayers);
          await client.query('DELETE FROM sync_state WHERE tenant_id=$1 AND team_id=$2', [team.tenantId, team.teamId]);
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
          await this.persistResolvedPlayers(client, String(lockedTeam.rows[0]!.pubg_shard), action.resolvedPlayers);
          await client.query('DELETE FROM sync_state WHERE tenant_id=$1 AND team_id=$2', [team.tenantId, team.teamId]);
          break;
        }
        case 'set_team_alias': {
          const alias = normalizeTeamAlias(action.alias);
          const members = await client.query(
            `SELECT member.pubg_account_id,COALESCE(account.display_name,member.pubg_account_id) AS player_name,
                    existing.alias_key,existing.pubg_account_id AS alias_owner
             FROM team_members member JOIN teams team ON team.tenant_id=member.tenant_id AND team.team_id=member.team_id
             LEFT JOIN pubg_accounts account ON account.shard=team.pubg_shard AND account.account_id=member.pubg_account_id
             LEFT JOIN team_aliases existing ON existing.tenant_id=member.tenant_id AND existing.team_id=member.team_id
               AND existing.pubg_account_id=member.pubg_account_id
             WHERE member.tenant_id=$1 AND member.team_id=$2`,
            [team.tenantId, team.teamId],
          );
          if (!members.rows.some(row => row.pubg_account_id === action.pubgAccountId)) throw new Error('team_alias_member_not_found');
          for (const member of members.rows) {
            const accountId = String(member.pubg_account_id);
            const nameCollision = [accountId, String(member.player_name)].some(value => normalizeTeamMemberLookup(value) === alias.key);
            if (accountId !== action.pubgAccountId && (nameCollision || member.alias_key === alias.key)) throw new Error('team_alias_conflict');
          }
          const saved = await client.query(
            `INSERT INTO team_aliases(tenant_id,team_id,alias_key,pubg_account_id,display_alias)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (tenant_id,team_id,alias_key) DO UPDATE
             SET display_alias=EXCLUDED.display_alias
             WHERE team_aliases.pubg_account_id=EXCLUDED.pubg_account_id`,
            [team.tenantId, team.teamId, alias.key, action.pubgAccountId, alias.displayAlias],
          );
          if (saved.rowCount !== 1) throw new Error('team_alias_conflict');
          break;
        }
        case 'delete_team_alias': {
          const alias = normalizeTeamAlias(action.alias);
          await client.query('DELETE FROM team_aliases WHERE tenant_id=$1 AND team_id=$2 AND alias_key=$3', [team.tenantId, team.teamId, alias.key]);
          break;
        }
        case 'set_leaderboard_metric': {
          await client.query(
            `INSERT INTO team_preferences(tenant_id,team_id,preference_key,preference_json,updated_by_user_id)
             VALUES ($1,$2,'leaderboard_metric',jsonb_build_object('metric',$3::text),$4)
             ON CONFLICT (tenant_id,team_id,preference_key) DO UPDATE
             SET preference_json=EXCLUDED.preference_json,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=now()`,
            [team.tenantId, team.teamId, action.metric, event.userId],
          );
          break;
        }
        case 'delete_leaderboard_metric': {
          await client.query(
            `DELETE FROM team_preferences WHERE tenant_id=$1 AND team_id=$2 AND preference_key='leaderboard_metric'`,
            [team.tenantId, team.teamId],
          );
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
          await client.query('INSERT INTO channel_binding_versions(bot_account_id,channel_id,revision) VALUES ($1,$2,1) ON CONFLICT (bot_account_id,channel_id) DO UPDATE SET revision=channel_binding_versions.revision+1', [event.botAccountId, event.channelId]);
          await client.query(
            `DELETE FROM pending_team_actions
             WHERE tenant_id=$1 AND team_id=$2 AND bot_account_id=$3 AND channel_id=$4 AND token_hash<>$5 AND consumed_at IS NULL`,
            [team.tenantId, team.teamId, event.botAccountId, event.channelId, tokenDigest(token)],
          );
          break;
        }
        case 'disband_team': {
          const boundChannels = await client.query("SELECT bot_account_id,channel_id FROM channel_bindings WHERE tenant_id=$1 AND team_id=$2 FOR UPDATE", [team.tenantId, team.teamId]);
          for (const channel of boundChannels.rows) {
            await client.query('INSERT INTO channel_binding_versions(bot_account_id,channel_id,revision) VALUES ($1,$2,1) ON CONFLICT (bot_account_id,channel_id) DO UPDATE SET revision=channel_binding_versions.revision+1', [channel.bot_account_id, channel.channel_id]);
          }
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
             WHERE tenant_id=$1 AND team_id=$2 AND token_hash<>$3 AND consumed_at IS NULL`,
            [team.tenantId, team.teamId, tokenDigest(token)],
          );
          const disbanded = await client.query('DELETE FROM teams WHERE tenant_id=$1 AND team_id=$2', [team.tenantId, team.teamId]);
          if (disbanded.rowCount !== 1) throw new Error('team_action_confirmation_unavailable');
          break;
        }
      }

      await client.query("UPDATE pending_team_actions SET consumed_at=now(),consumed_event_id=$2,payload_json='{}'::jsonb WHERE token_hash=$1", [tokenDigest(token), receiptEventId]);
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
