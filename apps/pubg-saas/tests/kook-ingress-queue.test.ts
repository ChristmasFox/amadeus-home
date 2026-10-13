import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Pool } from 'pg';
import { KookIngressQueue, KookMessageQueue, migratePublicDatabase, type KookTextPayload } from '../src/index.js';
const databaseUrl = process.env.PUBG_SAAS_TEST_DATABASE_URL;
function group(botId: string, id: string, guild: string, channel: string, user: string, content = '/pubg status') {
  return {
    type: 1, channel_type: 'GROUP', target_id: channel, author_id: user, content, msg_id: id, msg_timestamp: Date.now(),
    verify_token: 'must-not-be-stored', extra: { guild_id: guild, channel_type: 1, author: { id: user, bot: false, username: 'excluded-name', roles: [987] } }
  };
}
function direct(botId: string, id: string, user: string) {
  return { type: 1, channel_type: 'PERSON', target_id: botId, author_id: user, content: '/pubg claim', msg_id: id, msg_timestamp: Date.now() };
}
async function fixture(pool: Pool, suffix: string) {
  const bot = `bot-${suffix}`, tenant = `tenant-${suffix}`, team = `team-${suffix}`, guild = `guild-${suffix}`, channel = `channel-${suffix}`, user = `actor-${suffix}`;
  await migratePublicDatabase(pool);
  await pool.query("INSERT INTO tenants(tenant_id,platform,bot_account_id,guild_id) VALUES ($1,'kook',$2,$3)", [tenant, bot, guild]);
  await pool.query("INSERT INTO teams(tenant_id,team_id,label,pubg_shard) VALUES ($1,$2,'fixture','steam')", [tenant, team]);
  await pool.query("INSERT INTO channel_bindings(tenant_id,platform,bot_account_id,channel_id,team_id,bound_by_user_id) VALUES ($1,'kook',$2,$3,$4,$5)", [tenant, bot, channel, team, user]);
  return { bot, tenant, team, guild, channel, user };
}
async function cleanup(pool: Pool, bot: string) {
  await pool.query('DELETE FROM message_outbox WHERE bot_account_id=$1', [bot]);
  await pool.query('DELETE FROM message_inbox WHERE bot_account_id=$1', [bot]);
  await pool.query('DELETE FROM kook_ingress_events WHERE bot_account_id=$1', [bot]);
  await pool.query('DELETE FROM tenants WHERE bot_account_id=$1', [bot]);
  await pool.end();
}
test('durable ingress resumes after restart, owns its destinations, and atomically scrubs completed requests', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 6 });
  const suffix = randomUUID();
  const f = await fixture(pool, suffix);
  const queue = new KookIngressQueue(pool, { botAccountId: f.bot, baseRetryMs: 1 });
  const event = group(f.bot, `event-${suffix}`, f.guild, f.channel, f.user);
  try {
    assert.equal(await queue.ingestGatewayEvent(event), 'accepted');
    assert.equal(await queue.ingestGatewayEvent(event), 'duplicate');
    await assert.rejects(queue.ingestGatewayEvent({ ...event, target_id: 'redirect' }), /kook_ingress_event_conflict/u);
    const row = (await pool.query('SELECT event_json FROM kook_ingress_events WHERE bot_account_id=$1', [f.bot])).rows[0];
    const stored = JSON.stringify(row?.event_json);
    assert.equal(stored.includes('excluded-name'), false);
    assert.equal(stored.includes('must-not-be-stored'), false);
    assert.equal(stored.includes('roles'), false);
    const restarted = new KookIngressQueue(pool, { botAccountId: f.bot, baseRetryMs: 1 });
    const claims = await Promise.all([restarted.claimNext(), restarted.claimNext()]);
    const job = claims.find(Boolean)!;
    assert.ok(job);
    assert.equal(claims.filter(Boolean).length, 1);
    assert.deepEqual(job.boundTeam, { tenantId: f.tenant, teamId: f.team });
    assert.equal(await restarted.fail(job, new Error('raw provider/message detail')), 'retry');
    await pool.query('UPDATE kook_ingress_events SET next_attempt_at=now() WHERE bot_account_id=$1', [f.bot]);
    const result = await restarted.processOne(async (recovered) => {
      assert.equal(recovered.attemptCount, 2);
      assert.equal(recovered.request.kind, 'group');
      return { type: 'text', content: 'checked facts', targetId: 'attacker', tenantId: 'spoof' } as KookTextPayload;
    }, new AbortController().signal);
    assert.equal(result, 'done');
    const done = (await pool.query('SELECT status,event_json,lease_token FROM kook_ingress_events WHERE bot_account_id=$1', [f.bot])).rows[0];
    assert.deepEqual(done, { status: 'done', event_json: null, lease_token: null });
    const reply = (await pool.query('SELECT target_kind,target_id,payload_json FROM message_outbox WHERE bot_account_id=$1', [f.bot])).rows[0];
    assert.deepEqual(reply, { target_kind: 'channel', target_id: f.channel, payload_json: { type: 'text', content: 'checked facts' } });
    assert.equal(await restarted.ingestGatewayEvent(event), 'duplicate');
    assert.equal(await restarted.processOne(async () => assert.fail('duplicate dispatched'), new AbortController().signal), 'empty');
    assert.equal(await restarted.ingestGatewayEvent({ ...event, msg_id: `ordinary-${suffix}`, content: 'ordinary channel conversation' }), 'ignored');
    const dm = direct(f.bot, `dm-${suffix}`, f.user);
    assert.equal(await restarted.ingestGatewayEvent(dm), 'accepted');
    assert.equal(await restarted.processOne(async (received) => {
      assert.equal(received.request.kind, 'direct');
      assert.equal(received.boundTeam, null);
      return { type: 'text', content: 'private state' };
    }, new AbortController().signal), 'done');
    const outbox = new KookMessageQueue(pool, { botAccountId: f.bot });
    const destinations: string[] = [];
    const sender = { async send(target: string) { destinations.push(`channel:${target}`); }, async sendDirect(target: string) { destinations.push(`actor:${target}`); } };
    assert.equal(await outbox.deliverOne(sender), 'sent');
    assert.equal(await outbox.deliverOne(sender), 'sent');
    assert.deepEqual(destinations, [`channel:${f.channel}`, `actor:${f.user}`]);
  }
  finally {
    await cleanup(pool, f.bot);
  }
});
test('ingress bounds admission and preserves actor order while rejecting a changed team binding', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 6 });
  const suffix = randomUUID();
  const f = await fixture(pool, suffix);
  const queue = new KookIngressQueue(pool, { botAccountId: f.bot, maxPending: 3, maxPendingPerUser: 2 });
  try {
    const first = group(f.bot, `a-${suffix}`, f.guild, f.channel, f.user);
    assert.equal(await queue.ingestGatewayEvent(first), 'accepted');
    assert.equal(await queue.ingestGatewayEvent(group(f.bot, `b-${suffix}`, f.guild, f.channel, f.user)), 'accepted');
    await assert.rejects(queue.ingestGatewayEvent(group(f.bot, `c-${suffix}`, f.guild, f.channel, f.user)), /capacity_exceeded/u);
    const job = await queue.claimNext();
    assert.ok(job);
    assert.equal(job.eventId, first.msg_id);
    await queue.fail(job, new Error('transient'));
    assert.equal(await queue.claimNext(), null); // later message cannot overtake this actor's retry
    assert.equal(await queue.ingestGatewayEvent(group(f.bot, `other-${suffix}`, f.guild, f.channel, `other-${f.user}`)), 'accepted');
    const other = await queue.claimNext();
    assert.ok(other);
    assert.notEqual(other.eventId, job.eventId);
    await queue.complete(other, null);
    await pool.query('DELETE FROM channel_bindings WHERE bot_account_id=$1', [f.bot]);
    await pool.query('UPDATE kook_ingress_events SET next_attempt_at=now() WHERE bot_account_id=$1', [f.bot]);
    assert.equal(await queue.processOne(async () => assert.fail('stale team dispatched'), new AbortController().signal), 'dead');
    const dead = (await pool.query("SELECT last_error_code,event_json FROM kook_ingress_events WHERE bot_account_id=$1 AND event_id=$2", [f.bot, first.msg_id])).rows[0];
    assert.deepEqual(dead, { last_error_code: 'kook_ingress_binding_changed', event_json: null });
    await pool.query('UPDATE kook_ingress_events SET expires_at=now()-interval \'1 second\' WHERE bot_account_id=$1', [f.bot]);
    await queue.prune(new Date(Date.now() - 60000));
    assert.equal((await pool.query("SELECT 1 FROM kook_ingress_events WHERE bot_account_id=$1 AND event_json IS NOT NULL", [f.bot])).rowCount, 0);
  }
  finally {
    await cleanup(pool, f.bot);
  }
});
test('additive migrations upgrade an applied schema and preserve existing outbox destinations', { skip: !databaseUrl }, async () => {
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  const schema = `migration_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 2 });
  try {
    await pool.query(await readFile(new URL('../src/infrastructure/postgres/migrations/0001_public_schema.sql', import.meta.url), 'utf8'));
    await pool.query('ALTER TABLE message_outbox DROP COLUMN source_event_id');
    await pool.query("INSERT INTO schema_migrations(migration_id) VALUES ('0001_public_schema.sql')");
    await pool.query("INSERT INTO message_outbox(outbox_id,idempotency_key,platform,bot_account_id,tenant_id,team_id,channel_id,payload_json,status) VALUES ('old','old','kook','synthetic-bot','synthetic-tenant','synthetic-team','synthetic-channel','{}','pending')");
    await migratePublicDatabase(pool);
    await migratePublicDatabase(pool);
    assert.deepEqual((await pool.query('SELECT target_kind,target_id,source_event_id FROM message_outbox')).rows[0], { target_kind: 'channel', target_id: 'synthetic-channel', source_event_id: null });
    assert.equal((await pool.query('SELECT 1 FROM schema_migrations')).rowCount, 3);
  }
  finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
