import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Pool } from 'pg';
import type { Coverage, ResultSetRecord, SessionContextRecord, SourceInfo, TeamContext } from '@agent/pubg-domain';
import { createTeamContext, DeterministicQueryEngine, PubgDomainService, SqlitePubgRepository, SqlitePubgRepositoryAdapter } from '@agent/pubg-domain';
import { migratePublicDatabase, PostgresPubgRepository } from '../src/index.js';

const golden = JSON.parse(readFileSync(new URL('../../../packages/pubg-domain/tests/fixtures/shared-domain-golden.json', import.meta.url), 'utf8')) as {
  contract: string;
  matches: Array<Record<string, unknown>>;
  query: Record<string, unknown>;
  coverage: Coverage;
  source: SourceInfo;
  syntheticMatchIdsInRange: string[];
  expectedPlayers: Array<Record<string, string | number | null>>;
};

const databaseUrl = process.env.PUBG_SAAS_TEST_DATABASE_URL;

test('PostgreSQL tenant and conversation scope is enforced at the repository boundary', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 });
  const suffix = randomUUID();
  const tenantA = `tenant-a-${suffix}`;
  const tenantB = `tenant-b-${suffix}`;
  const teamA = `team-a-${suffix}`;
  const teamB = `team-b-${suffix}`;
  const channelA = `channel-a-${suffix}`;
  const channelB = `channel-b-${suffix}`;
  const accountA = `account-a-${suffix}`;
  const accountB = `account-b-${suffix}`;
  const sharedSession = `trusted-session-${suffix}`;
  const conversationA = {
    platform: 'kook' as const,
    kind: 'bound_channel' as const,
    botAccountId: 'test-bot',
    userId: `user-a-${suffix}`,
    channelId: channelA,
    sessionId: sharedSession,
  };
  const contextA: TeamContext = {
    tenantId: tenantA,
    teamId: teamA,
    team: { id: teamA, label: 'Squad A', platform: 'steam', players: [{ id: accountA, name: 'Same Nickname', aliases: [] }] },
  };
  const contextB: TeamContext = {
    tenantId: tenantB,
    teamId: teamB,
    team: { id: teamB, label: 'Squad B', platform: 'steam', players: [{ id: accountB, name: 'Same Nickname', aliases: [] }] },
  };

  try {
    await migratePublicDatabase(pool);
    await migratePublicDatabase(pool);
    assert.throws(() => new PostgresPubgRepository(pool, undefined as never), /invalid_team_context/u);
    await pool.query('INSERT INTO tenants(tenant_id, platform, bot_account_id, guild_id) VALUES ($1,$2,$3,$4),($5,$2,$3,$6)', [tenantA, 'kook', 'test-bot', `guild-a-${suffix}`, tenantB, `guild-b-${suffix}`]);
    await pool.query('INSERT INTO teams(tenant_id, team_id, label) VALUES ($1,$2,$3),($4,$5,$6)', [tenantA, teamA, 'Squad A', tenantB, teamB, 'Squad B']);
    await pool.query(
      `INSERT INTO channel_bindings(tenant_id, platform, bot_account_id, channel_id, team_id, bound_by_user_id)
       VALUES ($1,'kook','test-bot',$2,$3,'admin-a'),($4,'kook','test-bot',$5,$6,'admin-b')`,
      [tenantA, channelA, teamA, tenantB, channelB, teamB],
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO channel_bindings(tenant_id,platform,bot_account_id,channel_id,team_id,bound_by_user_id)
         VALUES ($1,'kook','test-bot',$2,$3,'admin-b')`,
        [tenantB, channelA, teamB],
      ),
      { code: '23505' },
    );
    await pool.query(
      `INSERT INTO channel_identities(platform, bot_account_id, user_id, display_name)
       VALUES ('kook','test-bot',$1,'Duplicate Nickname'),('kook','test-bot',$2,'Duplicate Nickname')`,
      [`user-a-${suffix}`, `user-b-${suffix}`],
    );

    const repoA = new PostgresPubgRepository(pool, contextA, conversationA);
    const repoB = new PostgresPubgRepository(pool, contextB, {
      ...conversationA,
      userId: `user-b-${suffix}`,
      channelId: channelB,
    });
    const unboundRepo = new PostgresPubgRepository(pool, contextA, { ...conversationA, channelId: `unbound-${suffix}` });
    await assert.rejects(unboundRepo.getContext(sharedSession), /conversation_channel_not_bound/u);
    const matchAt = Date.now();
    await repoA.upsertMatches([{
      matchId: `match-a-${suffix}`,
      shard: 'steam',
      createdAt: new Date(matchAt).toISOString(),
      timestamp: matchAt,
      matchType: 'official',
      gameMode: 'squad-fpp',
      mapName: 'Baltic_Main',
      duration: 900,
      patchVersion: 'test',
      players: [
        { accountId: accountA, playerName: 'Same Nickname', kills: 2, damage: 180 },
        { accountId: `opponent-${suffix}`, playerName: 'Opponent', kills: 1, damage: 90 },
      ],
    }]);
    await repoA.upsertMatches([{
      matchId: `match-b-${suffix}`,
      shard: 'steam',
      timestamp: matchAt + 1,
      matchType: 'official',
      gameMode: 'squad-fpp',
      mapName: 'Baltic_Main',
      duration: 900,
      patchVersion: 'test',
      players: [{ accountId: accountB, playerName: 'Same Nickname', kills: 4, damage: 360 }],
    }]);

    assert.equal(await repoA.countMatches(), 1);
    assert.equal(await repoB.countMatches(), 1);
    assert.deepEqual((await repoA.listMatches()).map((match) => match.matchId), [`match-a-${suffix}`]);
    assert.equal((await repoA.getMatch(`match-b-${suffix}`)), null);
    assert.equal((await repoA.getMatch(`match-a-${suffix}`))?.players.length, 2);

    const state = {
      key: 'team-sync',
      checkedAt: new Date(matchAt).toISOString(),
      coverage: { status: 'OK', complete: true } as never,
      source: { store: 'postgres' } as never,
      discoveredMatchIds: [`match-a-${suffix}`],
      failedMatchIds: [],
    };
    await repoA.setSyncState(state);
    assert.equal((await repoB.getSyncState('team-sync')), null);

    const context: SessionContextRecord = {
      schemaVersion: 3,
      sessionId: sharedSession,
      activeDomain: 'pubg',
      lastQuery: null,
      lastSelector: null,
      lastResultSetId: null,
      lastSubject: null,
      references: {},
      updatedAt: new Date(matchAt).toISOString(),
      expiresAt: new Date(matchAt + 60_000).toISOString(),
    };
    await repoA.setContext(context);
    assert.equal((await repoA.getContext(sharedSession))?.sessionId, sharedSession);
    assert.equal(await repoB.getContext(sharedSession), null);
    await assert.rejects(repoA.getContext(`forged-${suffix}`), /conversation_scope_mismatch/u);

    const directScope = {
      ...conversationA,
      kind: 'direct_team' as const,
      channelId: `dm-${suffix}`,
      sessionId: `dm-session-${suffix}`,
    };
    const directRepo = new PostgresPubgRepository(pool, contextA, directScope);
    await assert.rejects(directRepo.getContext(directScope.sessionId), /direct_team_access_denied/u);
    await pool.query(
      `INSERT INTO team_user_access(tenant_id,team_id,platform,bot_account_id,user_id,role,granted_by_user_id)
       VALUES ($1,$2,'kook','test-bot',$3,'requester','guild-admin')`,
      [tenantA, teamA, conversationA.userId],
    );
    await directRepo.setContext({ ...context, sessionId: directScope.sessionId });
    assert.equal((await directRepo.getContext(directScope.sessionId))?.sessionId, directScope.sessionId);

    const fakeResultSet = { id: 'rs-a', sessionId: sharedSession, expiresAt: new Date(matchAt + 60_000).toISOString() } as ResultSetRecord;
    await repoA.setResultSet(fakeResultSet);
    assert.equal(await repoB.getResultSet(sharedSession, 'rs-a'), null);
    await assert.rejects(repoA.setResultSet({ ...fakeResultSet, sessionId: `forged-${suffix}` }), /conversation_scope_mismatch/u);

    const publicService = new PubgDomainService({
      teamContext: contextA,
      repository: repoA,
      now: () => new Date(matchAt + 2_000),
    });
    const serviceResult = await publicService.queryStats({
      sessionId: sharedSession,
      selector: {
        type: 'time_range',
        from: new Date(matchAt - 60_000).toISOString(),
        to: new Date(matchAt + 60_000).toISOString(),
        timezone: 'Asia/Shanghai',
        businessDayStart: '06:00',
      },
      metrics: ['kills', 'kd', 'assists'],
    });
    assert.ok(serviceResult.resultSetId);
    const persistedServiceResult = await repoA.getResultSet(sharedSession, serviceResult.resultSetId!, new Date(matchAt + 3_000));
    assert.equal(persistedServiceResult?.source.store, 'postgres');

    const goldenContext = createTeamContext(tenantA, {
      id: teamA,
      label: 'Golden Team',
      platform: 'steam',
      players: [{ id: 'p1', name: 'Alice', aliases: [] }, { id: 'p2', name: 'Bob', aliases: [] }],
    });
    const goldenMatches = golden.matches.map((record) => ({ ...record, matchId: `${suffix}-${String(record.matchId)}` }));
    const sqlite = new SqlitePubgRepository(':memory:');
    try {
      const sqliteRepository = new SqlitePubgRepositoryAdapter(sqlite, goldenContext);
      const pgGoldenRepository = new PostgresPubgRepository(pool, goldenContext);
      await sqliteRepository.upsertMatches(goldenMatches);
      await pgGoldenRepository.upsertMatches(goldenMatches);
      const sqliteResult = new DeterministicQueryEngine({ teamContext: goldenContext, now: new Date('2026-09-17T00:00:00.000Z') })
        .execute(golden.query as never, await sqliteRepository.listMatches(), golden.coverage, golden.source);
      const postgresResult = new DeterministicQueryEngine({ teamContext: goldenContext, now: new Date('2026-09-17T00:00:00.000Z') })
        .execute(golden.query as never, await pgGoldenRepository.listMatches(), golden.coverage, golden.source);
      assert.deepEqual(postgresResult, sqliteResult);
      assert.deepEqual(postgresResult.evidence.matchIds, golden.syntheticMatchIdsInRange.map((matchId) => `${suffix}-${matchId}`));
      assert.deepEqual(postgresResult.data.rows.map((row) => {
        const expected = golden.expectedPlayers.find((item) => item.key === row.key)!;
        return Object.fromEntries(Object.keys(expected)
          .filter((key) => key !== 'key')
          .map((key) => [key, row.metrics[key] ?? null])
          .concat([['key', row.key]]));
      }), golden.expectedPlayers);
    } finally {
      sqlite.close();
    }

    const migrationRows = await pool.query('SELECT migration_id FROM schema_migrations');
    assert.equal(migrationRows.rows.filter((row) => row.migration_id === '0001_public_schema.sql').length, 1);
  } finally {
    await pool.query('DELETE FROM tenants WHERE tenant_id = ANY($1::text[])', [[tenantA, tenantB]]).catch(() => undefined);
    await pool.query('DELETE FROM matches WHERE match_id = ANY($1::text[])', [[`match-a-${suffix}`, `match-b-${suffix}`, ...golden.matches.map((record) => `${suffix}-${String(record.matchId)}`)]]).catch(() => undefined);
    await pool.query("DELETE FROM channel_identities WHERE platform='kook' AND bot_account_id='test-bot' AND user_id = ANY($1::text[])", [[`user-a-${suffix}`, `user-b-${suffix}`]]).catch(() => undefined);
    await pool.end();
  }
});
