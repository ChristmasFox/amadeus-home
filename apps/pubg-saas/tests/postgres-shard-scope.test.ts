import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Pool } from 'pg';
import { createTeamContext, TelemetryWorker } from '@agent/pubg-domain';
import { migratePublicDatabase, PostgresPubgRepository } from '../src/index.js';

const databaseUrl = process.env.PUBG_SAAS_TEST_DATABASE_URL;

test('public matches and telemetry retain shard identity, registered roster and direct-access boundaries', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 }), suffix = randomUUID(), tenant = `tenant-${suffix}`, bot = `bot-${suffix}`, account = `shared-${suffix}`, other = `other-${suffix}`, collision = `collision-${suffix}`, foreign = `foreign-${suffix}`, bad = `bad-${suffix}`;
  const context = (id: string, shard: string, member: string) => createTeamContext(tenant, { id: `${id}-${suffix}`, label: id, platform: shard, players: [{ id: member, name: member, aliases: [] }] });
  const steam = context('steam', 'steam', account), kakao = context('kakao', 'kakao', account), outside = context('outside', 'steam', other);
  const a = new PostgresPubgRepository(pool, steam), b = new PostgresPubgRepository(pool, kakao), c = new PostgresPubgRepository(pool, outside);
  const match = (id: string, shard: string, member: string, kills: number) => ({ matchId: id, shard, timestamp: Date.now(), matchType: 'official', gameMode: 'squad-fpp', mapName: 'Baltic_Main', duration: 900, players: [{ accountId: member, playerName: member, kills, damage: 100 }] });
  const key = { matchId: collision, parserVersion: 'fixture-parser', featureVersion: 'fixture-features' };
  const attempted = (id: string, count: number) => ({ matchId: id, parserVersion: key.parserVersion, featureVersion: key.featureVersion, status: 'PENDING' as const, attemptCount: count, lastAttemptedAt: null, nextRetryAt: null, updatedAt: new Date().toISOString() });
  try {
    await migratePublicDatabase(pool);
    await pool.query("INSERT INTO tenants(tenant_id,platform,bot_account_id,guild_id) VALUES ($1,'kook',$2,$3)", [tenant, bot, `guild-${suffix}`]);
    for (const team of [steam, kakao, outside]) {
      await pool.query('INSERT INTO teams(tenant_id,team_id,label,pubg_shard) VALUES ($1,$2,$3,$4)', [tenant, team.teamId, team.team.label, team.team.platform]);
      await pool.query("INSERT INTO team_members(tenant_id,team_id,pubg_account_id,added_by_user_id) VALUES ($1,$2,$3,'fixture')", [tenant, team.teamId, team.team.players[0]!.id]);
    }
    const sharedMatch = match(collision, 'steam', account, 2);
    sharedMatch.players.push({ accountId: other, playerName: other, kills: 9, damage: 100 });
    await a.upsertMatches([sharedMatch]);
    await b.upsertMatches([match(collision, 'kakao', account, 9)]);
    await c.upsertMatches([match(foreign, 'steam', other, 7)]);
    assert.equal((await a.getMatch(collision))?.players.find(player => player.accountId === account)?.kills, 2); assert.equal((await b.getMatch(collision))?.players[0]?.kills, 9);
    assert.equal((await a.listMatches())[0]?.shard, 'steam'); assert.equal((await b.listMatches())[0]?.shard, 'kakao');
    assert.equal(await a.countMatches(), 1); assert.equal(await b.countMatches(), 1);
    await assert.rejects(a.upsertMatches([match(bad, 'kakao', account, 99)]), /repository_shard_mismatch/u);
    assert.equal((await a.getMatch(collision))?.players.find(player => player.accountId === account)?.kills, 2);
    const sharedRecord = await a.getMatch(collision); assert.ok(sharedRecord);
    const raw = [{ _T: 'LogPlayerTakeDamage', attacker: { accountId: account }, victim: { accountId: other }, damage: 9, damageTypeCategory: 'Damage_Bullet', timeSeconds: 1, common: { isGame: true } }];
    const worker = (team: typeof steam.team, store: PostgresPubgRepository) => new TelemetryWorker({ team, store, featureVersion: key.featureVersion, downloader: { async download() { return raw; } } });
    const steamFacts = await worker(steam.team, a).ensure(sharedRecord);
    const outsideFacts = await worker(outside.team, c).ensure(sharedRecord);
    assert.equal(steamFacts.status, 'FETCHED'); assert.deepEqual(steamFacts.facts?.players.map(player => player.playerId), [account]);
    assert.equal(outsideFacts.status, 'FETCHED'); assert.equal(outsideFacts.cacheLookup, 'MISS'); assert.deepEqual(outsideFacts.facts?.players.map(player => player.playerId), [other]);
    await b.set({ ...key, facts: { marker: 'kakao' } as never, createdAt: new Date().toISOString() });
    await c.set({ ...key, matchId: foreign, facts: { marker: 'foreign' } as never, createdAt: new Date().toISOString() });
    assert.deepEqual((await worker(steam.team, a).ensure(sharedRecord)).facts?.players.map(player => player.playerId), [account]);
    assert.deepEqual((await worker(outside.team, c).ensure(sharedRecord)).facts?.players.map(player => player.playerId), [other]);
    assert.deepEqual((await b.get(key))?.facts, { marker: 'kakao' });
    assert.equal(await a.get({ ...key, matchId: foreign }), null);
    await assert.rejects(a.set({ ...key, matchId: foreign, facts: {} as never, createdAt: new Date().toISOString() }), /telemetry_match_not_in_team/u);
    await a.setTelemetryPrefetchAttempt(attempted(collision, 1)); await b.setTelemetryPrefetchAttempt(attempted(collision, 2)); await c.setTelemetryPrefetchAttempt(attempted(collision, 3)); await c.setTelemetryPrefetchAttempt(attempted(foreign, 4));
    assert.equal((await a.getTelemetryPrefetchAttempt(key))?.attemptCount, 1); assert.equal((await b.getTelemetryPrefetchAttempt(key))?.attemptCount, 2); assert.equal((await c.getTelemetryPrefetchAttempt(key))?.attemptCount, 3);
    assert.deepEqual((await a.listDueTelemetryPrefetchAttempts(key.parserVersion, key.featureVersion, new Date())).map(row => row.matchId), [collision]);
    const renamed = new PostgresPubgRepository(pool, { ...steam, team: { ...steam.team, players: [{ ...steam.team.players[0]!, aliases: ['renamed-private-alias'] }] } });
    assert.equal(await renamed.get(key), null);
    assert.equal(await a.getTelemetryPrefetchAttempt({ ...key, matchId: foreign }), null);
    const forged = new PostgresPubgRepository(pool, { ...steam, team: { ...steam.team, players: [{ id: other, name: 'spoof', aliases: [] }] } });
    await assert.rejects(forged.listMatches(), /repository_team_scope_mismatch/u);
    const denied = new PostgresPubgRepository(pool, steam, { platform: 'kook', kind: 'direct_team', botAccountId: bot, userId: 'ungranted-actor', channelId: 'direct-channel', sessionId: 'server-session' });
    await assert.rejects(denied.countMatches(), /direct_team_access_denied/u);
    await assert.rejects(denied.getMatch(collision), /direct_team_access_denied/u);
    await pool.query("INSERT INTO team_members(tenant_id,team_id,pubg_account_id,added_by_user_id) VALUES ($1,$2,'changed-roster','fixture')", [tenant, steam.teamId]);
    await assert.rejects(a.listMatches(), /repository_team_scope_mismatch/u);
  } finally { await pool.query('DELETE FROM tenants WHERE tenant_id=$1', [tenant]); await pool.query('DELETE FROM matches WHERE match_id=ANY($1::TEXT[])', [[collision, foreign, bad]]); await pool.end(); }
});

async function legacySchema(): Promise<{ admin: Pool; pool: Pool; schema: string }> {
  const admin = new Pool({ connectionString: databaseUrl, max: 1 }), schema = `shard_upgrade_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 2 });
  for (const file of ['0001_public_schema.sql', '0002_kook_ingress.sql', '0003_onboarding.sql', '0004_guild_welcome.sql']) {
    await pool.query(await readFile(new URL(`../src/infrastructure/postgres/migrations/${file}`, import.meta.url), 'utf8'));
    await pool.query('INSERT INTO schema_migrations(migration_id) VALUES ($1)', [file]);
  }
  return { admin, pool, schema };
}
async function cleanupLegacy(state: { admin: Pool; pool: Pool; schema: string }) { await state.pool.end(); await state.admin.query(`DROP SCHEMA ${state.schema} CASCADE`); await state.admin.end(); }

test('shard migration backfills match facts and team-scoped telemetry migration evicts unowned shared cache rows', { skip: !databaseUrl }, async () => {
  const state = await legacySchema(); const { pool } = state;
  try {
    await pool.query("INSERT INTO matches(match_id,shard,timestamp_ms,match_type,game_mode,is_competitive,map_name,duration,patch_version,schema_version,fetched_at,source) VALUES ('legacy-match','kakao',1,'official','squad-fpp',true,'fixture-map',900,'fixture',3,now(),'fixture')");
    await pool.query("INSERT INTO match_players(match_id,account_id,player_name,display_name,kills,assists,damage,dbnos,revives,headshot_kills,survival_time,longest_kill,death_semantics) VALUES ('legacy-match','legacy-player','fixture','fixture',2,0,100,0,0,0,900,0,'unknown')");
    await pool.query("INSERT INTO telemetry_features(match_id,parser_version,feature_version,facts_json,created_at) VALUES ('legacy-match','p','f','{\"marker\":\"retained\"}',now())");
    await pool.query("INSERT INTO telemetry_prefetch_attempts(match_id,parser_version,feature_version,status,updated_at) VALUES ('legacy-match','p','f','PENDING',now())");
    await migratePublicDatabase(pool); await migratePublicDatabase(pool);
    assert.deepEqual((await pool.query('SELECT shard,kills FROM match_players')).rows, [{ shard: 'kakao', kills: 2 }]);
    assert.equal((await pool.query('SELECT 1 FROM telemetry_features')).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM telemetry_prefetch_attempts')).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM telemetry_team_features')).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM schema_migrations')).rowCount, 10);
  } finally { await cleanupLegacy(state); }
});

test('an unresolved legacy telemetry shard aborts migration atomically instead of inventing or dropping data', { skip: !databaseUrl }, async () => {
  const state = await legacySchema(); const { pool, schema } = state;
  try {
    await pool.query("INSERT INTO telemetry_features(match_id,parser_version,feature_version,facts_json,created_at) VALUES ('unknown-match','p','f','{\"marker\":\"retain-me\"}',now())");
    await assert.rejects(migratePublicDatabase(pool), /public_match_shard_backfill_unresolved/u);
    assert.equal((await pool.query("SELECT 1 FROM schema_migrations WHERE migration_id='0005_sharded_match_cache.sql'")).rowCount, 0);
    assert.equal((await pool.query("SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name='match_players' AND column_name='shard'", [schema])).rowCount, 0);
    assert.deepEqual((await pool.query('SELECT facts_json FROM telemetry_features')).rows[0]?.facts_json, { marker: 'retain-me' });
  } finally { await cleanupLegacy(state); }
});
