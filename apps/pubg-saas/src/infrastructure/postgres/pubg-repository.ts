import type {
  NormalizedMatch,
  NormalizedPlayer,
  ResultSetRecord,
  SessionContextRecord,
  TeamContext,
  TelemetryFeatureKey,
  TelemetryFeatureRecord,
  TelemetryPrefetchAttempt,
  TelemetryPrefetchAttemptStatus,
  TelemetryPrefetchRun,
  PubgRepositoryPort,
  SyncState,
  UpsertMatchesResult,
  MatchWriteMetadata,
} from '@agent/pubg-domain';
import { normalizeRecords, parseTeamContext } from '@agent/pubg-domain';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

export interface TrustedConversationScope {
  platform: 'kook';
  kind: 'bound_channel' | 'direct_team';
  botAccountId: string;
  userId: string;
  channelId: string;
  /** Server-derived opaque ID; never copy this from a model/tool argument. */
  sessionId: string;
}

export interface PostgresPubgRepositoryOptions {
  /** Public query runtime must use a live, server-created session ledger row. */
  requireManagedSession?: boolean;
}

function requiredText(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`invalid_${name}`);
  return normalized;
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function objectValue<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value === null || value === undefined ? fallback : value as T;
}

function rowToPlayer(row: QueryResultRow): NormalizedPlayer {
  return {
    accountId: String(row.account_id),
    playerName: String(row.player_name ?? row.account_id),
    displayName: String(row.display_name ?? row.player_name ?? row.account_id),
    rank: nullableNumber(row.rank),
    kills: number(row.kills),
    assists: number(row.assists),
    damage: number(row.damage),
    dbnos: number(row.dbnos),
    revives: number(row.revives),
    headshotKills: number(row.headshot_kills),
    survivalTime: number(row.survival_time),
    longestKill: number(row.longest_kill),
    deaths: nullableNumber(row.deaths),
    deathSemantics: String(row.death_semantics ?? 'unknown') as NormalizedPlayer['deathSemantics'],
  };
}

function rowToMatch(row: QueryResultRow, players: NormalizedPlayer[]): NormalizedMatch {
  return {
    schemaVersion: number(row.schema_version, 3),
    matchId: String(row.match_id),
    shard: String(row.shard ?? 'steam'),
    createdAt: row.created_at === null || row.created_at === undefined ? null : String(row.created_at),
    timestamp: number(row.timestamp_ms),
    matchType: String(row.match_type ?? ''),
    gameMode: String(row.game_mode ?? ''),
    isCompetitive: boolean(row.is_competitive),
    mapName: String(row.map_name ?? ''),
    duration: number(row.duration),
    patchVersion: String(row.patch_version ?? ''),
    players,
    telemetryUrl: row.telemetry_url ? String(row.telemetry_url) : null,
  };
}

function runFromRow(row: QueryResultRow): TelemetryPrefetchRun {
  return {
    runId: String(row.run_id),
    reportDate: String(row.report_date),
    startedAt: new Date(row.started_at).toISOString(),
    finishedAt: new Date(row.finished_at).toISOString(),
    trigger: String(row.trigger) as TelemetryPrefetchRun['trigger'],
    discoveredMatchCount: number(row.discovered_match_count),
    newMatchCount: number(row.new_match_count),
    candidateMatchCount: number(row.candidate_match_count),
    fetchedCount: number(row.fetched_count),
    cacheHitCount: number(row.cache_hit_count),
    unavailableCount: number(row.unavailable_count),
    pendingCount: number(row.pending_count),
    failedMatchIds: objectValue<string[]>(row.failed_match_ids_json, []),
  };
}

function attemptFromRow(row: QueryResultRow): TelemetryPrefetchAttempt {
  return {
    matchId: String(row.match_id),
    parserVersion: String(row.parser_version),
    featureVersion: String(row.feature_version),
    status: String(row.status) as TelemetryPrefetchAttemptStatus,
    attemptCount: number(row.attempt_count),
    lastAttemptedAt: row.last_attempted_at ? new Date(row.last_attempted_at).toISOString() : null,
    nextRetryAt: row.next_retry_at ? new Date(row.next_retry_at).toISOString() : null,
    ...(row.error ? { error: String(row.error) } : {}),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function withTransaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await action(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve the original error */ }
    throw error;
  } finally {
    client.release();
  }
}

/** PostgreSQL implementation for the public deployment. Its team and optional
 * conversation scopes are fixed from server-verified authorization state. */
export class PostgresPubgRepository implements PubgRepositoryPort {
  readonly store = 'postgres';
  readonly scope: TeamContext;
  readonly conversation: TrustedConversationScope | null;
  private readonly accountIds: string[];
  private readonly shard: string;

  constructor(
    private readonly pool: Pool,
    scope: TeamContext,
    conversation: TrustedConversationScope | null = null,
    private readonly options: PostgresPubgRepositoryOptions = {},
  ) {
    if (options.requireManagedSession && !conversation) throw new Error('conversation_scope_required');
    this.scope = parseTeamContext(scope);
    this.shard = this.scope.team.platform;
    this.accountIds = this.scope.team.players.map((player) => player.id);
    if (conversation && conversation.kind !== 'bound_channel' && conversation.kind !== 'direct_team') {
      throw new Error('invalid_conversation_scope');
    }
    this.conversation = conversation ? {
      platform: 'kook',
      kind: conversation.kind,
      botAccountId: requiredText(conversation.botAccountId, 'bot_account_id'),
      userId: requiredText(conversation.userId, 'user_id'),
      channelId: requiredText(conversation.channelId, 'channel_id'),
      sessionId: requiredText(conversation.sessionId, 'session_id'),
    } : null;
  }

  private async assertTeamScope(): Promise<void> {
    const result = await this.pool.query(
      `SELECT team.pubg_shard,COALESCE(array_agg(member.pubg_account_id ORDER BY member.pubg_account_id)
       FILTER (WHERE member.pubg_account_id IS NOT NULL),'{}') AS accounts
       FROM teams team LEFT JOIN team_members member ON member.tenant_id=team.tenant_id AND member.team_id=team.team_id
       WHERE team.tenant_id=$1 AND team.team_id=$2 GROUP BY team.pubg_shard`, [this.scope.tenantId, this.scope.teamId],
    );
    const row = result.rows[0];
    if (!row || row.pubg_shard !== this.shard || !Array.isArray(row.accounts)
      || row.accounts.length !== this.accountIds.length || row.accounts.some((account: unknown) => !this.accountIds.includes(String(account)))) throw new Error('repository_team_scope_mismatch');
  }

  private async assertReadScope(): Promise<void> {
    if (this.conversation) await this.assertConversation(this.conversation.sessionId);
    else await this.assertTeamScope();
  }

  private async assertConversation(sessionId: string): Promise<TrustedConversationScope> {
    await this.assertTeamScope();
    const trusted = this.conversation;
    if (!trusted) throw new Error('conversation_scope_required');
    if (sessionId !== trusted.sessionId) throw new Error('conversation_scope_mismatch');
    if (this.options.requireManagedSession) {
      const session = await this.pool.query(
        `SELECT 1 FROM public_query_sessions session JOIN teams team
         ON team.tenant_id=session.tenant_id AND team.team_id=session.team_id
         WHERE session.tenant_id=$1 AND session.team_id=$2 AND session.platform=$3 AND session.bot_account_id=$4
           AND session.user_id=$5 AND session.channel_id=$6 AND session.session_id=$7 AND session.kind=$8
           AND session.expires_at>now() AND session.team_revision=team.query_revision
           AND (session.kind='direct_team' OR session.binding_revision=COALESCE(
             (SELECT revision FROM channel_binding_versions WHERE bot_account_id=$4 AND channel_id=$6),0))`,
        [this.scope.tenantId, this.scope.teamId, trusted.platform, trusted.botAccountId, trusted.userId, trusted.channelId, sessionId, trusted.kind],
      );
      if (!session.rowCount) throw new Error('public_query_session_unavailable');
    }
    if (trusted.kind === 'bound_channel') {
      const binding = await this.pool.query(
        `SELECT 1 FROM channel_bindings
         WHERE tenant_id = $1 AND team_id = $2 AND platform = $3
           AND bot_account_id = $4 AND channel_id = $5`,
        [this.scope.tenantId, this.scope.teamId, trusted.platform, trusted.botAccountId, trusted.channelId],
      );
      if (!binding.rowCount) throw new Error('conversation_channel_not_bound');
    } else {
      const grant = await this.pool.query(
        `SELECT 1 FROM team_user_access
         WHERE tenant_id = $1 AND team_id = $2 AND platform = $3
           AND bot_account_id = $4 AND user_id = $5`,
        [this.scope.tenantId, this.scope.teamId, trusted.platform, trusted.botAccountId, trusted.userId],
      );
      if (!grant.rowCount) throw new Error('direct_team_access_denied');
    }
    return trusted;
  }

  async countMatches(): Promise<number> {
    await this.assertReadScope();
    const result = await this.pool.query(
      `SELECT COUNT(*)::bigint AS count FROM matches AS match
       WHERE match.shard=$2 AND EXISTS (
         SELECT 1 FROM match_players AS member
         WHERE member.shard=match.shard AND member.match_id = match.match_id AND member.account_id = ANY($1::text[])
       )`,
      [this.accountIds, this.shard],
    );
    return number(result.rows[0]?.count);
  }

  async getMatch(matchId: string): Promise<NormalizedMatch | null> {
    await this.assertReadScope();
    const result = await this.pool.query(
      `SELECT match.* FROM matches AS match
       WHERE match.match_id = $1 AND match.shard=$3 AND EXISTS (
         SELECT 1 FROM match_players AS member
         WHERE member.shard=match.shard AND member.match_id = match.match_id AND member.account_id = ANY($2::text[])
       )`,
      [matchId, this.accountIds, this.shard],
    );
    const row = result.rows[0];
    if (!row) return null;
    const players = await this.pool.query('SELECT * FROM match_players WHERE match_id = $1 AND shard=$2 ORDER BY account_id', [matchId, this.shard]);
    return rowToMatch(row, players.rows.map(rowToPlayer));
  }

  async listMatches(options: { fromMs?: number; toMs?: number; limit?: number } = {}): Promise<NormalizedMatch[]> {
    await this.assertReadScope();
    const clauses = ['match.shard=$2', 'EXISTS (SELECT 1 FROM match_players AS member WHERE member.shard=match.shard AND member.match_id = match.match_id AND member.account_id = ANY($1::text[]))'];
    const values: unknown[] = [this.accountIds, this.shard];
    if (options.fromMs !== undefined) { values.push(options.fromMs); clauses.push(`match.timestamp_ms >= $${values.length}`); }
    if (options.toMs !== undefined) { values.push(options.toMs); clauses.push(`match.timestamp_ms < $${values.length}`); }
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 10000), 1), 10000);
    values.push(limit);
    const selected = await this.pool.query(
      `SELECT match.* FROM matches AS match WHERE ${clauses.join(' AND ')}
       ORDER BY match.timestamp_ms ASC, match.match_id ASC LIMIT $${values.length}`,
      values,
    );
    if (!selected.rowCount) return [];
    const matchIds = selected.rows.map((row) => String(row.match_id));
    const players = await this.pool.query(
      `SELECT player.*, selected.timestamp_ms AS selected_timestamp
       FROM unnest($1::text[]) AS chosen(match_id)
       JOIN matches AS selected ON selected.match_id = chosen.match_id AND selected.shard=$2
       JOIN match_players AS player ON player.match_id = selected.match_id AND player.shard=selected.shard
       ORDER BY selected.timestamp_ms ASC, selected.match_id ASC, player.account_id ASC`,
      [matchIds, this.shard],
    );
    const byMatch = new Map<string, NormalizedPlayer[]>();
    for (const player of players.rows) {
      const id = String(player.match_id);
      const group = byMatch.get(id) ?? [];
      group.push(rowToPlayer(player));
      byMatch.set(id, group);
    }
    return selected.rows.map((row) => rowToMatch(row, byMatch.get(String(row.match_id)) ?? []));
  }

  async upsertMatches(input: unknown[], metadata: MatchWriteMetadata = {}): Promise<UpsertMatchesResult> {
    await this.assertReadScope();
    const individuallyNormalized = input.flatMap((item) => normalizeRecords([item]));
    if (individuallyNormalized.some(match => match.shard !== this.shard)) throw new Error('repository_shard_mismatch');
    const records = normalizeRecords(input).filter((match) => match.matchId && Number.isFinite(match.timestamp));
    const duplicateInputs = Math.max(0, individuallyNormalized.length - records.length);
    const invalidInputs = Math.max(0, input.length - individuallyNormalized.length);
    const fetchedAt = metadata.fetchedAt ?? new Date().toISOString();
    let inserted = 0;
    let updated = 0;
    await withTransaction(this.pool, async (client) => {
      for (const match of records) {
        const prior = await client.query('SELECT 1 FROM matches WHERE match_id = $1 AND shard=$2', [match.matchId, this.shard]);
        await client.query(
          `INSERT INTO matches (
             match_id, shard, created_at, timestamp_ms, match_type, game_mode, is_competitive,
             map_name, duration, patch_version, telemetry_url, schema_version, parser_version,
             fetched_at, source, checked_player_ids_json, raw_json
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb)
           ON CONFLICT (shard,match_id) DO UPDATE SET
             shard=EXCLUDED.shard, created_at=EXCLUDED.created_at, timestamp_ms=EXCLUDED.timestamp_ms,
             match_type=EXCLUDED.match_type, game_mode=EXCLUDED.game_mode,
             is_competitive=EXCLUDED.is_competitive, map_name=EXCLUDED.map_name,
             duration=EXCLUDED.duration, patch_version=EXCLUDED.patch_version,
             telemetry_url=EXCLUDED.telemetry_url, schema_version=EXCLUDED.schema_version,
             parser_version=EXCLUDED.parser_version, fetched_at=EXCLUDED.fetched_at,
             source=EXCLUDED.source, checked_player_ids_json=EXCLUDED.checked_player_ids_json,
             raw_json=EXCLUDED.raw_json`,
          [match.matchId, match.shard, match.createdAt, match.timestamp, match.matchType, match.gameMode,
          match.isCompetitive, match.mapName, match.duration, match.patchVersion, match.telemetryUrl ?? null,
          match.schemaVersion, metadata.parserVersion ?? null, fetchedAt, metadata.source ?? 'unknown',
          JSON.stringify(metadata.checkedPlayerIds ?? match.players.map((player) => player.accountId)),
          metadata.rawJson === undefined ? null : JSON.stringify(metadata.rawJson)],
        );
        await client.query('DELETE FROM match_players WHERE match_id = $1 AND shard=$2', [match.matchId, this.shard]);
        for (const player of match.players) {
          await client.query(
            `INSERT INTO match_players (
              match_id, account_id, player_name, display_name, rank, kills, assists, damage,
              dbnos, revives, headshot_kills, survival_time, longest_kill, deaths, death_semantics,shard
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
            [match.matchId, player.accountId, player.playerName, player.displayName, player.rank,
            player.kills, player.assists, player.damage, player.dbnos, player.revives,
            player.headshotKills, player.survivalTime, player.longestKill, player.deaths, player.deathSemantics, this.shard],
          );
        }
        if (prior.rowCount) updated += 1;
        else inserted += 1;
      }
    });
    return { inserted, updated, duplicateInputs, invalidInputs };
  }

  async setSyncState(state: SyncState): Promise<void> {
    await this.assertReadScope();
    await this.pool.query(
      `INSERT INTO sync_state(tenant_id, team_id, state_key, checked_at, state_json)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT (tenant_id, team_id, state_key) DO UPDATE
       SET checked_at=EXCLUDED.checked_at, state_json=EXCLUDED.state_json`,
      [this.scope.tenantId, this.scope.teamId, state.key, state.checkedAt, JSON.stringify(state)],
    );
  }

  async getSyncState(key: string): Promise<SyncState | null> {
    await this.assertReadScope();
    const result = await this.pool.query(
      'SELECT state_json FROM sync_state WHERE tenant_id=$1 AND team_id=$2 AND state_key=$3',
      [this.scope.tenantId, this.scope.teamId, key],
    );
    return result.rows[0] ? objectValue<SyncState | null>(result.rows[0].state_json, null) : null;
  }

  async get(key: TelemetryFeatureKey): Promise<TelemetryFeatureRecord | null> {
    if (!await this.getMatch(key.matchId)) return null;
    const result = await this.pool.query(
      `SELECT facts_json, created_at FROM telemetry_features
       WHERE match_id=$1 AND parser_version=$2 AND feature_version=$3 AND shard=$4`,
      [key.matchId, key.parserVersion, key.featureVersion, this.shard],
    );
    const row = result.rows[0];
    if (!row) return null;
    const facts = objectValue<unknown>(row.facts_json, null);
    if (!facts || typeof facts !== 'object') return null;
    return { ...key, facts: facts as TelemetryFeatureRecord['facts'], createdAt: new Date(row.created_at).toISOString() };
  }

  async set(record: TelemetryFeatureRecord): Promise<void> {
    if (!await this.getMatch(record.matchId)) throw new Error('telemetry_match_not_in_team');
    await this.pool.query(
      `INSERT INTO telemetry_features(match_id, parser_version, feature_version, facts_json, created_at,shard)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6)
       ON CONFLICT (shard,match_id, parser_version, feature_version) DO UPDATE
       SET facts_json=EXCLUDED.facts_json, created_at=EXCLUDED.created_at`,
      [record.matchId, record.parserVersion, record.featureVersion, JSON.stringify(record.facts), record.createdAt, this.shard],
    );
  }

  async getTelemetryPrefetchAttempt(key: TelemetryFeatureKey): Promise<TelemetryPrefetchAttempt | null> {
    if (!await this.getMatch(key.matchId)) return null;
    const result = await this.pool.query(
      `SELECT * FROM telemetry_prefetch_attempts
       WHERE match_id=$1 AND parser_version=$2 AND feature_version=$3 AND shard=$4`,
      [key.matchId, key.parserVersion, key.featureVersion, this.shard],
    );
    return result.rows[0] ? attemptFromRow(result.rows[0]) : null;
  }

  async listDueTelemetryPrefetchAttempts(parserVersion: string, featureVersion: string, now: Date, limit = 100): Promise<TelemetryPrefetchAttempt[]> {
    await this.assertReadScope();
    const bounded = Math.min(Math.max(Math.trunc(limit), 1), 1000);
    const result = await this.pool.query(
      `SELECT attempt.* FROM telemetry_prefetch_attempts attempt
       WHERE parser_version=$1 AND feature_version=$2 AND attempt.shard=$5
         AND EXISTS (SELECT 1 FROM match_players member WHERE member.shard=attempt.shard AND member.match_id=attempt.match_id AND member.account_id=ANY($6::TEXT[]))
         AND status IN ('PENDING','UNAVAILABLE') AND (next_retry_at IS NULL OR next_retry_at <= $3)
       ORDER BY COALESCE(next_retry_at, '-infinity'::timestamptz), updated_at, match_id
       LIMIT $4`,
      [parserVersion, featureVersion, now, bounded, this.shard, this.accountIds],
    );
    return result.rows.map(attemptFromRow);
  }

  async setTelemetryPrefetchAttempt(attempt: TelemetryPrefetchAttempt): Promise<void> {
    if (!await this.getMatch(attempt.matchId)) throw new Error('telemetry_match_not_in_team');
    await this.pool.query(
      `INSERT INTO telemetry_prefetch_attempts(
         match_id, parser_version, feature_version, status, attempt_count,
         last_attempted_at, next_retry_at, error, updated_at,shard
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (shard,match_id, parser_version, feature_version) DO UPDATE SET
         status=EXCLUDED.status, attempt_count=EXCLUDED.attempt_count,
         last_attempted_at=EXCLUDED.last_attempted_at, next_retry_at=EXCLUDED.next_retry_at,
         error=EXCLUDED.error, updated_at=EXCLUDED.updated_at`,
      [attempt.matchId, attempt.parserVersion, attempt.featureVersion, attempt.status,
      attempt.attemptCount, attempt.lastAttemptedAt, attempt.nextRetryAt, attempt.error ?? null, attempt.updatedAt, this.shard],
    );
  }

  async recordTelemetryPrefetchRun(run: TelemetryPrefetchRun): Promise<void> {
    await this.assertReadScope();
    await this.pool.query(
      `INSERT INTO telemetry_prefetch_runs(
         tenant_id, team_id, run_id, report_date, started_at, finished_at, trigger,
         discovered_match_count, new_match_count, candidate_match_count, fetched_count,
         cache_hit_count, unavailable_count, pending_count, failed_match_ids_json
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
       ON CONFLICT (tenant_id, team_id, run_id) DO UPDATE SET
         report_date=EXCLUDED.report_date, started_at=EXCLUDED.started_at,
         finished_at=EXCLUDED.finished_at, trigger=EXCLUDED.trigger,
         discovered_match_count=EXCLUDED.discovered_match_count, new_match_count=EXCLUDED.new_match_count,
         candidate_match_count=EXCLUDED.candidate_match_count, fetched_count=EXCLUDED.fetched_count,
         cache_hit_count=EXCLUDED.cache_hit_count, unavailable_count=EXCLUDED.unavailable_count,
         pending_count=EXCLUDED.pending_count, failed_match_ids_json=EXCLUDED.failed_match_ids_json`,
      [this.scope.tenantId, this.scope.teamId, run.runId, run.reportDate, run.startedAt, run.finishedAt,
      run.trigger, run.discoveredMatchCount, run.newMatchCount, run.candidateMatchCount,
      run.fetchedCount, run.cacheHitCount, run.unavailableCount, run.pendingCount,
      JSON.stringify([...new Set(run.failedMatchIds)])],
    );
  }

  async listTelemetryPrefetchRuns(reportDate: string): Promise<TelemetryPrefetchRun[]> {
    await this.assertReadScope();
    const result = await this.pool.query(
      `SELECT * FROM telemetry_prefetch_runs
       WHERE tenant_id=$1 AND team_id=$2 AND report_date=$3 ORDER BY started_at, run_id`,
      [this.scope.tenantId, this.scope.teamId, reportDate],
    );
    return result.rows.map(runFromRow);
  }

  async setResultSet(record: ResultSetRecord): Promise<void> {
    const conversation = await this.assertConversation(record.sessionId);
    await this.pool.query(
      `INSERT INTO result_sets(
         tenant_id, team_id, platform, bot_account_id, user_id, channel_id, session_id,
         result_set_id, expires_at, result_json
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       ON CONFLICT (tenant_id, team_id, platform, bot_account_id, user_id, channel_id, session_id, result_set_id)
       DO UPDATE SET expires_at=EXCLUDED.expires_at, result_json=EXCLUDED.result_json`,
      [this.scope.tenantId, this.scope.teamId, conversation.platform, conversation.botAccountId,
      conversation.userId, conversation.channelId, conversation.sessionId, record.id,
      record.expiresAt, JSON.stringify(record)],
    );
  }

  async getResultSet(sessionId: string, resultSetId: string, now = new Date()): Promise<ResultSetRecord | null> {
    const conversation = await this.assertConversation(sessionId);
    const result = await this.pool.query(
      `SELECT result_json FROM result_sets
       WHERE tenant_id=$1 AND team_id=$2 AND platform=$3 AND bot_account_id=$4
         AND user_id=$5 AND channel_id=$6 AND session_id=$7 AND result_set_id=$8 AND expires_at>$9`,
      [this.scope.tenantId, this.scope.teamId, conversation.platform, conversation.botAccountId,
      conversation.userId, conversation.channelId, conversation.sessionId, resultSetId, now],
    );
    return result.rows[0] ? objectValue<ResultSetRecord | null>(result.rows[0].result_json, null) : null;
  }

  async setContext(context: SessionContextRecord): Promise<void> {
    const conversation = await this.assertConversation(context.sessionId);
    await this.pool.query(
      `INSERT INTO session_contexts(
         tenant_id, team_id, platform, bot_account_id, user_id, channel_id, session_id,
         expires_at, context_json
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       ON CONFLICT (tenant_id, team_id, platform, bot_account_id, user_id, channel_id, session_id)
       DO UPDATE SET expires_at=EXCLUDED.expires_at, context_json=EXCLUDED.context_json`,
      [this.scope.tenantId, this.scope.teamId, conversation.platform, conversation.botAccountId,
      conversation.userId, conversation.channelId, conversation.sessionId,
      context.expiresAt, JSON.stringify(context)],
    );
  }

  async getContext(sessionId: string, now = new Date()): Promise<SessionContextRecord | null> {
    const conversation = await this.assertConversation(sessionId);
    const result = await this.pool.query(
      `SELECT context_json FROM session_contexts
       WHERE tenant_id=$1 AND team_id=$2 AND platform=$3 AND bot_account_id=$4
         AND user_id=$5 AND channel_id=$6 AND session_id=$7 AND expires_at>$8`,
      [this.scope.tenantId, this.scope.teamId, conversation.platform, conversation.botAccountId,
      conversation.userId, conversation.channelId, conversation.sessionId, now],
    );
    return result.rows[0] ? objectValue<SessionContextRecord | null>(result.rows[0].context_json, null) : null;
  }

  async cleanupExpired(now = new Date()): Promise<void> {
    await this.assertReadScope();
    await this.pool.query('DELETE FROM result_sets WHERE tenant_id=$1 AND team_id=$2 AND expires_at <= $3', [this.scope.tenantId, this.scope.teamId, now]);
    await this.pool.query('DELETE FROM session_contexts WHERE tenant_id=$1 AND team_id=$2 AND expires_at <= $3', [this.scope.tenantId, this.scope.teamId, now]);
  }
}
