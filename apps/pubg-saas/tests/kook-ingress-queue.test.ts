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
test('trusted arbitrary messages are admitted and only malformed events emit content-free drop diagnostics', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const suffix = randomUUID();
  const f = await fixture(pool, suffix);
  const diagnostics: unknown[] = [];
  const queue = new KookIngressQueue(pool, {
    botAccountId: f.bot,
    onDiscard: diagnostic => diagnostics.push(diagnostic),
  });
  try {
    assert.equal(await queue.ingestGatewayEvent(group(f.bot, `accepted-${suffix}-1`, f.guild, f.channel, f.user, 'ordinary unrelated chatter')), 'accepted');
    assert.equal(await queue.ingestGatewayEvent(group(f.bot, `accepted-${suffix}-2`, f.guild, f.channel, f.user, 'ordinary unrelated chatter')), 'accepted');
    assert.deepEqual(diagnostics, []);

    const malformed = group(f.bot, `malformed-${suffix}`, f.guild, '6115211415447433', f.user, 'sensitive untrusted content');
    malformed.extra.author.id = 'forged-actor';
    assert.equal(await queue.ingestGatewayEvent(malformed), 'ignored');
    assert.deepEqual(diagnostics[0], {
      event: 'kook_ingress_discarded', stage: 'trusted_group', reason: 'actor_id_mismatch', count: 1, channelId: '6115211415447433',
    });
    const serialized = JSON.stringify(diagnostics);
    for (const excluded of ['ordinary unrelated chatter', 'sensitive untrusted content', 'forged-actor', 'must-not-be-stored']) {
      assert.equal(serialized.includes(excluded), false);
    }
    assert.equal((await pool.query('SELECT 1 FROM kook_ingress_events WHERE bot_account_id=$1', [f.bot])).rowCount, 2);
  } finally {
    await cleanup(pool, f.bot);
  }
});

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
    const ordinary = { ...event, msg_id: `ordinary-${suffix}`, content: 'ordinary channel conversation' };
    assert.equal(await restarted.ingestGatewayEvent(ordinary), 'accepted');
    assert.equal(await restarted.processOne(async () => null, new AbortController().signal), 'done');
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

    const limitedEvent = group(f.bot, `limited-${suffix}`, f.guild, f.channel, f.user);
    assert.equal(await restarted.ingestGatewayEvent(limitedEvent), 'accepted');
    assert.equal(await restarted.processOne(async () => ({ type: 'text', content: 'rate limited reply' }), new AbortController().signal), 'done');
    const oneAttemptQueue = new KookMessageQueue(pool, { botAccountId: f.bot, maxAttempts: 1 });
    const rateLimitError = Object.assign(new Error('kook_message_api_rate_limited'), {
      code: 'kook_message_api_rate_limited', retryAfterMs: 120_000,
    });
    assert.equal(await oneAttemptQueue.deliverOne({ async send() { throw rateLimitError; } }), 'retry');
    const delayed = (await pool.query(
      'SELECT status,last_error_code,EXTRACT(EPOCH FROM (next_attempt_at-now()))*1000 AS wait_ms FROM message_outbox WHERE bot_account_id=$1 AND source_event_id=$2',
      [f.bot, limitedEvent.msg_id],
    )).rows[0];
    assert.equal(delayed?.status, 'retry');
    assert.equal(delayed?.last_error_code, 'kook_message_api_rate_limited');
    assert.ok(Number(delayed?.wait_ms) >= 119_000);
    await pool.query('UPDATE message_outbox SET next_attempt_at=now() WHERE bot_account_id=$1 AND source_event_id=$2', [f.bot, limitedEvent.msg_id]);
    assert.equal(await oneAttemptQueue.deliverOne({ async send() {} }), 'sent');
  }
  finally {
    await cleanup(pool, f.bot);
  }
});
test('ingress bounds admission, preserves channel conversation order, and rejects a changed team binding', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 6 });
  const suffix = randomUUID();
  const f = await fixture(pool, suffix);
  const diagnostics: unknown[] = [];
  const queue = new KookIngressQueue(pool, { botAccountId: f.bot, maxPending: 3, onDiscard: diagnostic => diagnostics.push(diagnostic) });
  try {
    const first = group(f.bot, `a-${suffix}`, f.guild, f.channel, f.user);
    assert.equal(await queue.ingestGatewayEvent(first), 'accepted');
    assert.equal(await queue.ingestGatewayEvent(group(f.bot, `b-${suffix}`, f.guild, f.channel, f.user)), 'accepted');
    assert.equal(await queue.ingestGatewayEvent(group(f.bot, `c-${suffix}`, f.guild, f.channel, f.user)), 'accepted');
    assert.equal(await queue.ingestGatewayEvent(group(f.bot, `overflow-${suffix}`, f.guild, f.channel, f.user)), 'ignored');
    assert.deepEqual(diagnostics[0], { event: 'kook_ingress_discarded', stage: 'admission', reason: 'kook_ingress_capacity_exceeded', count: 1 });
    const job = await queue.claimNext();
    assert.ok(job);
    assert.equal(job.eventId, first.msg_id);
    await queue.fail(job, new Error('transient'));
    assert.equal(await queue.claimNext(), null); // later channel message cannot overtake this retry
    await pool.query("UPDATE kook_ingress_events SET status='done',event_json=NULL WHERE bot_account_id=$1 AND event_id=$2", [f.bot, `c-${suffix}`]);
    assert.equal(await queue.ingestGatewayEvent(group(f.bot, `other-${suffix}`, f.guild, f.channel, `other-${f.user}`)), 'accepted');
    assert.equal(await queue.claimNext(), null); // preserve shared channel turn order across actors
    await pool.query("UPDATE kook_ingress_events SET status='done',event_json=NULL WHERE bot_account_id=$1 AND event_id=$2", [f.bot, `other-${suffix}`]);
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
test('ingress accepts more than ten events per user per minute without local request throttles', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const suffix = randomUUID();
  const f = await fixture(pool, suffix);
  const queue = new KookIngressQueue(pool, { botAccountId: f.bot });
  try {
    for (let index = 0; index < 11; index += 1) {
      assert.equal(await queue.ingestGatewayEvent(
        group(f.bot, `burst-${index}-${suffix}`, f.guild, f.channel, f.user),
      ), 'accepted');
    }
    assert.equal(Number((await pool.query('SELECT COUNT(*)::INTEGER AS count FROM kook_ingress_events WHERE bot_account_id=$1', [f.bot])).rows[0]?.count), 11);
  }
  finally { await cleanup(pool, f.bot); }
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
    assert.deepEqual((await pool.query('SELECT target_kind,target_id,source_event_id,reply_to_message_id,reply_part,reply_part_count FROM message_outbox')).rows[0], {
      target_kind: 'channel', target_id: 'synthetic-channel', source_event_id: null,
      reply_to_message_id: null, reply_part: 0, reply_part_count: 1,
    });
    assert.equal((await pool.query("SELECT 1 FROM schema_migrations WHERE migration_id='0012_privacy_retention_indexes.sql'")).rowCount, 1);
    assert.equal((await pool.query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='kook_message_daily_reservations' AND column_name='reservation_hash'")).rowCount, 1);
    assert.equal((await pool.query("SELECT 1 FROM schema_migrations WHERE migration_id='0020_persistent_query_context.sql'")).rowCount, 1);
  }
  finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
