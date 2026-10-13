import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Pool } from 'pg';
import { emptyContext, type ResultSetRecord } from '@agent/pubg-domain';
import {
  KookIngressQueue, PublicQueryAuthorizer, PostgresPubgRepository, TeamAdminService, migratePublicDatabase,
  parseTrustedKookGroupMessage, type AuthorizedPublicQuery, type KookIngressJob, type PublicQueryPermissionChecker,
} from '../src/index.js';
const databaseUrl = process.env.PUBG_SAAS_TEST_DATABASE_URL;
function group(bot: string, guild: string, channel: string, user: string, id = randomUUID()) {
  return {
type: 1, channel_type: 'GROUP', target_id: channel, author_id: user, msg_id: id, msg_timestamp: Date.now(), content: '/pubg today',
    extra: { guild_id: guild, channel_type: 1, author: { id: user, bot: false, roles: [999] } }
};
}
function dm(bot: string, user: string, id = randomUUID()) {
  return { type: 1, channel_type: 'PERSON', target_id: bot, author_id: user, msg_id: id, msg_timestamp: Date.now(), content: 'last other user context and tenant: spoof' };
}
class Permissions implements PublicQueryPermissionChecker {
  denied = new Set<string>(); calls: string[] = []; fail = false;
  async isGuildMember(guild: string, user: string) { this.calls.push(`guild:${guild}:${user}`); if (this.fail) throw new Error('fixture_permission_unavailable'); return !this.denied.has(`${guild}:${user}`); }
  async isTextChannelMember(guild: string, channel: string, user: string) { this.calls.push(`channel:${guild}:${channel}:${user}`); if (this.fail) throw new Error('fixture_permission_unavailable'); return !this.denied.has(`${guild}:${user}`); }
}
async function fixture() {
  const pool = new Pool({ connectionString: databaseUrl, max: 8 }), suffix = randomUUID(), bot = `bot-${suffix}`, user = `user-${suffix}`, other = `other-${suffix}`, guild = `guild-${suffix}`, guildB = `guild-b-${suffix}`, channel = `channel-${suffix}`, channelB = `channel-b-${suffix}`, permissions = new Permissions();
  await migratePublicDatabase(pool);
  const teams = new TeamAdminService(pool, { isGuildAdmin: async () => true });
  const event = (g = guild, c = channel, u = user) => parseTrustedKookGroupMessage({ s: 0, d: group(bot, g, c, u) }, bot)!;
  const a = await teams.createSquad(event(), { label: 'Same squad name', pubgShard: 'steam', pubgAccountIds: [`player-${suffix}`] });
  const b = await teams.createSquad(event(guildB, channelB, other), { label: 'Same squad name', pubgShard: 'kakao', pubgAccountIds: [`player-${suffix}`] });
  const queue = new KookIngressQueue(pool, { botAccountId: bot, maxPendingPerUser: 100 });
  const auth = new PublicQueryAuthorizer(pool, permissions, { botAccountId: bot });
  async function admit(data: unknown): Promise<KookIngressJob> { assert.equal(await queue.ingestGatewayEvent(data), 'accepted'); const job = await queue.claimNext(); assert.ok(job); return job; }
  async function authorized(data: unknown, selection?: { tenantId: string; teamId: string }): Promise<AuthorizedPublicQuery> {
    const job = await admit(data), result = await auth.authorize(job, selection); assert.equal(result.kind, 'authorized'); if (result.kind !== 'authorized') throw new Error('fixture_authorization_failed'); await queue.complete(job, null); return result.query;
  }
  async function cleanup() {
    for (const table of ['session_contexts', 'result_sets', 'kook_ingress_events', 'message_outbox', 'channel_binding_versions', 'channel_identities', 'tenants']) await pool.query(`DELETE FROM ${table} WHERE bot_account_id=$1`, [bot]);
    await pool.end();
  }
  return { pool, bot, user, other, guild, guildB, channel, channelB, permissions, teams, event, a, b, queue, auth, admit, authorized, cleanup };
}

test('public query context comes from a live stored ingress and isolates guild, actor, channel and bot', { skip: !databaseUrl }, async () => {
  const f = await fixture(); try {
    const job = await f.admit(group(f.bot, f.guild, f.channel, f.other));
    const malicious = { ...job, boundTeam: f.b, request: { kind: 'group', event: f.event(f.guildB, f.channelB, f.user) } } as KookIngressJob;
    const result = await f.auth.authorize(malicious); assert.equal(result.kind, 'authorized'); if (result.kind !== 'authorized') return assert.fail();
    const a = result.query;
    assert.deepEqual({ tenantId: a.teamContext.tenantId, teamId: a.teamContext.teamId }, f.a);
    assert.equal(a.conversation.userId, f.other); assert.equal(a.conversation.channelId, f.channel);
    assert.equal(a.teamContext.team.players[0]?.name, a.teamContext.team.players[0]?.id);
    assert.equal(a.requestId.length, 64); assert.equal(a.requestId.includes(f.other), false);
    assert.equal((await f.pool.query('SELECT 1 FROM team_user_access WHERE bot_account_id=$1 AND user_id=$2 AND tenant_id=$3', [f.bot, f.other, f.a.tenantId])).rowCount, 0);
    await a.repository.setContext(emptyContext(a.conversation.sessionId));
    const replays = await Promise.all([f.auth.authorize(job), f.auth.authorize(job)]);
    for (const replay of replays) { assert.equal(replay.kind, 'authorized'); if (replay.kind === 'authorized') assert.equal(replay.query.conversation.sessionId, a.conversation.sessionId); }
    assert.equal((await f.pool.query('SELECT 1 FROM public_query_sessions WHERE bot_account_id=$1', [f.bot])).rowCount, 1);
    await f.queue.complete(job, null);
    const next = await f.authorized(group(f.bot, f.guild, f.channel, f.other)); assert.equal(next.conversation.sessionId, a.conversation.sessionId);
    assert.ok(await next.repository.getContext(next.conversation.sessionId));
    const otherActor = await f.authorized(group(f.bot, f.guild, f.channel, f.user)); assert.notEqual(otherActor.conversation.sessionId, a.conversation.sessionId); assert.equal(await otherActor.repository.getContext(otherActor.conversation.sessionId), null);
    const otherGuild = await f.authorized(group(f.bot, f.guildB, f.channelB, f.other)); assert.notEqual(otherGuild.conversation.sessionId, a.conversation.sessionId); assert.equal(otherGuild.teamContext.team.platform, 'kakao');
    const channel2 = `second-${f.channel}`; await f.teams.bindExistingSquad(f.event(f.guild, channel2), f.a.teamId);
    const otherChannel = await f.authorized(group(f.bot, f.guild, channel2, f.other)); assert.notEqual(otherChannel.conversation.sessionId, a.conversation.sessionId);
    const channel3 = `third-${f.channel}`;
    const c = await f.teams.createSquad(f.event(f.guild, channel3), { label: 'Same squad name', pubgShard: 'steam', pubgAccountIds: [`different-${f.a.teamId}`] });
    const sameGuildTeam = await f.authorized(group(f.bot, f.guild, channel3, f.other));
    assert.equal(sameGuildTeam.teamContext.tenantId, f.a.tenantId); assert.equal(sameGuildTeam.teamContext.teamId, c.teamId);
    assert.equal(await sameGuildTeam.repository.getContext(sameGuildTeam.conversation.sessionId), null);
    const forged = new PostgresPubgRepository(f.pool, a.teamContext, { ...a.conversation, userId: f.user }, { requireManagedSession: true });
    await assert.rejects(forged.countMatches(), /public_query_session_unavailable/u);
    await assert.rejects(f.auth.authorize(job), /public_query_ingress_unavailable/u);
    await assert.rejects(f.auth.authorize({ ...job, botAccountId: 'another-bot' }), /public_query_bot_scope_mismatch/u);
    assert.equal(f.permissions.calls.every(call => !call.includes('999')), true);
    const ledger = JSON.stringify((await f.pool.query('SELECT * FROM public_query_requests WHERE bot_account_id=$1', [f.bot])).rows);
    assert.equal(ledger.includes('last other user context'), false); assert.equal(ledger.includes('content'), false);
  } finally { await f.cleanup(); }
});

test('DM selection requires actor grants plus fresh guild membership and never reuses another team or account claim', { skip: !databaseUrl }, async () => {
  const f = await fixture(); try {
    const denied = await f.admit(dm(f.bot, f.other));
    // Other has only guild B's creator grant; choosing A cannot promote it.
    await assert.rejects(f.auth.authorize(denied, f.a), /public_query_access_denied/u); await f.queue.complete(denied, null);
    await f.teams.bindExistingSquad(f.event(f.guildB, f.channelB, f.user), f.b.teamId);
    const job = await f.admit(dm(f.bot, f.user));
    const choices = await f.auth.authorize(job); assert.equal(choices.kind, 'team_selection_required'); if (choices.kind === 'team_selection_required') assert.deepEqual(new Set(choices.choices.map(c => c.teamId)), new Set([f.a.teamId, f.b.teamId]));
    assert.equal((await f.pool.query('SELECT 1 FROM public_query_sessions WHERE bot_account_id=$1', [f.bot])).rowCount, 0);
    const selected = await f.auth.authorize(job, f.a); assert.equal(selected.kind, 'authorized'); if (selected.kind !== 'authorized') return assert.fail();
    const a = selected.query; await a.repository.setContext(emptyContext(a.conversation.sessionId));
    await assert.rejects(f.auth.authorize(job, f.b), /public_query_request_scope_changed/u);
    await f.queue.complete(job, null);
    const second = await f.authorized(dm(f.bot, f.user), f.b); assert.notEqual(second.conversation.sessionId, a.conversation.sessionId); assert.equal(await second.repository.getContext(second.conversation.sessionId), null);
    const ambiguous = await f.admit(dm(f.bot, f.user)); assert.equal((await f.auth.authorize(ambiguous)).kind, 'team_selection_required'); await f.queue.complete(ambiguous, null);
    f.permissions.denied.add(`${f.guild}:${f.user}`);
    const removed = await f.admit(dm(f.bot, f.user)); await assert.rejects(f.auth.authorize(removed, f.a), /public_query_access_denied/u); await f.queue.complete(removed, null);
    f.permissions.denied.clear();
    await f.pool.query('DELETE FROM team_user_access WHERE tenant_id=$1 AND team_id=$2 AND bot_account_id=$3 AND user_id=$4', [f.a.tenantId, f.a.teamId, f.bot, f.user]);
    await f.teams.bindExistingSquad(f.event(), f.a.teamId);
    await assert.rejects(a.repository.getContext(a.conversation.sessionId), /public_query_session_unavailable/u);
    const regranted = await f.authorized(dm(f.bot, f.user), f.a); assert.notEqual(regranted.conversation.sessionId, a.conversation.sessionId); assert.equal(await regranted.repository.getContext(regranted.conversation.sessionId), null);
    const ungranted = `ungranted-${f.user}`;
    await f.pool.query("INSERT INTO channel_identities(platform,bot_account_id,user_id) VALUES ('kook',$1,$2)", [f.bot, ungranted]);
    const teamPlayer = (await f.pool.query('SELECT pubg_account_id FROM team_members WHERE tenant_id=$1 AND team_id=$2', [f.a.tenantId, f.a.teamId])).rows[0]?.pubg_account_id;
    await f.pool.query("INSERT INTO account_claims(platform,bot_account_id,user_id,pubg_shard,pubg_account_id,claim_status) VALUES ('kook',$1,$2,'steam',$3,'self_declared')", [f.bot, ungranted, teamPlayer]);
    const claim = await f.admit(dm(f.bot, ungranted)); await assert.rejects(f.auth.authorize(claim), /public_query_access_denied/u); await f.queue.complete(claim, null);
  } finally { await f.cleanup(); }
});

test('roster, aliases, expiry and same-team rebind invalidate prior public follow-up state and queued authority', { skip: !databaseUrl }, async () => {
  const f = await fixture(); try {
    const old = await f.authorized(group(f.bot, f.guild, f.channel, f.user)); await old.repository.setContext(emptyContext(old.conversation.sessionId));
    await old.repository.setResultSet({ id: 'fixture-result', sessionId: old.conversation.sessionId, expiresAt: new Date(Date.now() + 60000).toISOString() } as ResultSetRecord);
    const player = old.teamContext.team.players[0]!.id;
    await f.pool.query('DELETE FROM team_members WHERE tenant_id=$1 AND team_id=$2', [f.a.tenantId, f.a.teamId]);
    await f.pool.query('INSERT INTO team_members(tenant_id,team_id,pubg_account_id,added_by_user_id) VALUES ($1,$2,$3,$4)', [f.a.tenantId, f.a.teamId, player, f.user]);
    await assert.rejects(old.repository.getContext(old.conversation.sessionId), /public_query_session_unavailable/u);
    const roster = await f.authorized(group(f.bot, f.guild, f.channel, f.user)); assert.notEqual(roster.conversation.sessionId, old.conversation.sessionId); assert.equal(await roster.repository.getResultSet(roster.conversation.sessionId, 'fixture-result'), null);
    await f.pool.query("INSERT INTO team_aliases(tenant_id,team_id,alias_key,pubg_account_id,display_alias) VALUES ($1,$2,'captain',$3,'Captain')", [f.a.tenantId, f.a.teamId, player]);
    await assert.rejects(roster.repository.countMatches(), /public_query_session_unavailable/u);
    const alias = await f.authorized(group(f.bot, f.guild, f.channel, f.user)); assert.deepEqual(alias.teamContext.team.players[0]?.aliases, ['Captain']);
    await f.pool.query('UPDATE public_query_sessions SET expires_at=now()-interval \'1 second\' WHERE session_id=$1', [alias.conversation.sessionId]);
    await assert.rejects(alias.repository.countMatches(), /public_query_session_unavailable/u);
    const afterExpiry = await f.authorized(group(f.bot, f.guild, f.channel, f.user)); assert.notEqual(afterExpiry.conversation.sessionId, alias.conversation.sessionId);
    const queued = group(f.bot, f.guild, f.channel, f.user); assert.equal(await f.queue.ingestGatewayEvent(queued), 'accepted');
    const pending = await f.teams.prepareTeamAction(f.event(), { kind: 'unbind_channel' }); await f.teams.confirmTeamAction(f.event(), pending.confirmationToken);
    await f.teams.bindExistingSquad(f.event(), f.a.teamId);
    await assert.rejects(afterExpiry.repository.countMatches(), /public_query_session_unavailable/u);
    assert.equal(await f.queue.processOne(async () => assert.fail('stale queued binding must not reach a planner'), new AbortController().signal), 'dead');
    const rebound = await f.authorized(group(f.bot, f.guild, f.channel, f.user)); assert.notEqual(rebound.conversation.sessionId, afterExpiry.conversation.sessionId);
    await f.auth.prune();
    assert.equal((await f.pool.query('SELECT 1 FROM session_contexts WHERE bot_account_id=$1 AND session_id=$2', [f.bot, alias.conversation.sessionId])).rowCount, 0);
    f.permissions.fail = true;
    const failed = await f.admit(group(f.bot, f.guild, f.channel, f.user)); await assert.rejects(f.auth.authorize(failed), /fixture_permission_unavailable/u); await f.queue.complete(failed, null);
  } finally { await f.cleanup(); }
});

test('authorization denies removed channel members, expired leases and grants changed during the permission check', { skip: !databaseUrl }, async () => {
  const f = await fixture(); try {
    f.permissions.denied.add(`${f.guild}:${f.other}`);
    const removed = await f.admit(group(f.bot, f.guild, f.channel, f.other)); await assert.rejects(f.auth.authorize(removed), /public_query_access_denied/u); await f.queue.complete(removed, null);
    assert.equal((await f.pool.query('SELECT 1 FROM public_query_sessions WHERE bot_account_id=$1', [f.bot])).rowCount, 0);
    const expired = await f.admit(group(f.bot, f.guild, f.channel, f.user));
    await f.pool.query('UPDATE kook_ingress_events SET lease_until=now()-interval \'1 second\' WHERE bot_account_id=$1 AND event_id=$2', [f.bot, expired.eventId]);
    await assert.rejects(f.auth.authorize(expired), /public_query_ingress_unavailable/u);
    await f.pool.query("UPDATE kook_ingress_events SET status='dead',event_json=NULL WHERE bot_account_id=$1 AND event_id=$2", [f.bot, expired.eventId]);
    const job = await f.admit(dm(f.bot, f.user));
    const auth = new PublicQueryAuthorizer(f.pool, {
      isTextChannelMember: async () => assert.fail('unexpected group query'),
      isGuildMember: async () => { await f.teams.bindExistingSquad(f.event(f.guildB, f.channelB), f.b.teamId); return true; },
    }, { botAccountId: f.bot });
    await assert.rejects(auth.authorize(job), /public_query_explicit_team_required/u); await f.queue.complete(job, null);
    assert.equal((await f.pool.query('SELECT 1 FROM public_query_requests WHERE bot_account_id=$1', [f.bot])).rowCount, 0);
  } finally { await f.cleanup(); }
});

test('query authorization migration never backfills queued group authority from a newer channel binding', { skip: !databaseUrl }, async () => {
  const admin = new Pool({ connectionString: databaseUrl, max: 1 }), schema = `query_upgrade_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`); const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 2 });
  try {
    for (const file of ['0001_public_schema.sql', '0002_kook_ingress.sql', '0003_onboarding.sql', '0004_guild_welcome.sql', '0005_sharded_match_cache.sql']) {
      await pool.query(await readFile(new URL(`../src/infrastructure/postgres/migrations/${file}`, import.meta.url), 'utf8'));
      await pool.query('INSERT INTO schema_migrations(migration_id) VALUES ($1)', [file]);
    }
    await pool.query(`INSERT INTO kook_ingress_events(bot_account_id,event_id,event_kind,user_id,target_kind,target_id,fingerprint,event_json,expires_at)
      VALUES ('fixture-bot','old-group','group','fixture-user','channel','fixture-channel','fixture','{"d":{"content":"old message"}}',now()+interval '1 hour'),
        ('fixture-bot','old-dm','direct','fixture-user','direct','fixture-user','fixture','{}',now()+interval '1 hour')`);
    await migratePublicDatabase(pool); await migratePublicDatabase(pool);
    assert.deepEqual((await pool.query("SELECT status,event_json,last_error_code FROM kook_ingress_events WHERE event_id='old-group'")).rows[0], { status: 'dead', event_json: null, last_error_code: 'kook_ingress_binding_revision_unknown' });
    assert.equal((await pool.query("SELECT status FROM kook_ingress_events WHERE event_id='old-dm'")).rows[0]?.status, 'pending');
    assert.equal((await pool.query('SELECT 1 FROM schema_migrations')).rowCount, 7);
  } finally { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
});
