import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import {
  KookMessageQueue,
  migratePublicDatabase,
  parseTrustedKookGroupMessage,
  sanitizeKookAssistantReplyContent,
} from '../src/index.js';

const databaseUrl = process.env.PUBG_SAAS_TEST_DATABASE_URL;

function groupEvent(guildId: string, channelId: string, userId: string, botId: string, messageId = randomUUID()) {
  return parseTrustedKookGroupMessage({
    s: 0,
    d: {
      channel_type: 'GROUP',
      type: 1,
      target_id: channelId,
      author_id: userId,
      content: 'query stats',
      msg_id: messageId,
      msg_timestamp: Date.now(),
      extra: { guild_id: guildId, channel_type: 1, author: { id: userId, bot: false, roles: [] } },
    },
  }, botId)!;
}

test('sanitizes internal conversation labels while preserving normal prose and KOOK mention syntax', () => {
  assert.equal(sanitizeKookAssistantReplyContent('[回复成员1] 成员2说：你好，今晚开黑吗？'), '你好，今晚开黑吗？');
  assert.equal(sanitizeKookAssistantReplyContent('  回复成员 12：收到，我来看看。'), '收到，我来看看。');
  assert.equal(sanitizeKookAssistantReplyContent('成员1的战绩不错，队伍配合也很好。'), '成员1的战绩不错，队伍配合也很好。');
  assert.equal(sanitizeKookAssistantReplyContent('<@!123456> 你好！'), '<@!123456> 你好！');
  assert.equal(sanitizeKookAssistantReplyContent('[DEBUG] token=private'), '我刚才没整理好回复，可以再问我一次吗？');
  assert.equal(sanitizeKookAssistantReplyContent('```json\n{"intent":"query","queryPlan":{}}\n```'), '我刚才没整理好回复，可以再问我一次吗？');
  assert.equal(sanitizeKookAssistantReplyContent('{"type":"text","content":"[回复成员2] 已收到。"}'), '已收到。');
});

test('KOOK inbox dedupes events and outbox pins destinations, retries and leases delivery', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 6 });
  const suffix = randomUUID();
  const tenantId = `tenant-${suffix}`;
  const teamId = `team-${suffix}`;
  const botId = `bot-${suffix}`;
  const guildId = `guild-${suffix}`;
  const userId = `user-${suffix}`;
  const channelId = `channel-${suffix}`;
  const event = groupEvent(guildId, channelId, userId, botId);
  const queue = new KookMessageQueue(pool, {
    botAccountId: botId,
    maxAttempts: 2,
    baseRetryMs: 1,
    maxRetryMs: 1,
    random: () => 0.5,
  });
  assert.ok(event);

  try {
    await migratePublicDatabase(pool);
    await pool.query('INSERT INTO tenants(tenant_id,platform,bot_account_id,guild_id) VALUES ($1,\'kook\',$2,$3)', [tenantId, botId, guildId]);
    await pool.query('INSERT INTO teams(tenant_id,team_id,label,pubg_shard) VALUES ($1,$2,$3,\'steam\')', [tenantId, teamId, 'Queue fixture']);
    await pool.query(
      `INSERT INTO channel_bindings(tenant_id,platform,bot_account_id,channel_id,team_id,bound_by_user_id)
       VALUES ($1,'kook',$2,$3,$4,$5)`,
      [tenantId, botId, channelId, teamId, userId],
    );

    assert.deepEqual(await queue.acceptGroupEvent(event), {
      status: 'accepted',
      scope: { tenantId, teamId, botAccountId: botId, channelId, sourceEventId: event.messageId },
    });
    await assert.rejects(queue.acceptGroupEvent(groupEvent(guildId, channelId, userId, `other-${suffix}`)), /kook_bot_scope_mismatch/u);
    assert.equal((await queue.acceptGroupEvent(event)).status, 'duplicate');
    assert.equal((await queue.acceptGroupEvent(groupEvent(guildId, `unbound-${suffix}`, userId, botId))).status, 'unbound');

    const payloadWithAttemptedRedirect = { type: 'text', content: 'squad stats', channelId: `attacker-${suffix}` };
    const first = await queue.enqueueReply(event, payloadWithAttemptedRedirect);
    const duplicate = await queue.enqueueReply(event, payloadWithAttemptedRedirect);
    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(first.outboxId, duplicate.outboxId);

    let sends = 0;
    const firstAttempt = await queue.deliverOne({
      async send(destination, payload, nonce, replyToMessageId) {
        sends += 1;
        assert.equal(destination, channelId);
        assert.deepEqual(payload, { type: 'text', content: 'squad stats' });
        assert.equal(nonce, first.idempotencyKey);
        assert.equal(replyToMessageId, event.messageId);
        const error = new Error('provider detail must not be persisted');
        Object.assign(error, { code: 'temporarily_unavailable' });
        throw error;
      },
    });
    assert.equal(firstAttempt, 'retry');
    assert.equal(sends, 1);
    const failedState = await pool.query('SELECT status,last_error_code,lease_token,payload_json FROM message_outbox WHERE outbox_id=$1', [first.outboxId]);
    assert.deepEqual(failedState.rows[0], {
      status: 'retry',
      last_error_code: 'temporarily_unavailable',
      lease_token: null,
      payload_json: { type: 'text', content: 'squad stats' },
    });

    await pool.query('UPDATE message_outbox SET next_attempt_at=now() WHERE outbox_id=$1', [first.outboxId]);
    const claims = await Promise.all([queue.claimNextOutbox(), queue.claimNextOutbox()]);
    const job = claims.find((candidate) => candidate !== null);
    assert.ok(job);
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal(job.channelId, channelId);
    assert.equal(job.sourceEventId, event.messageId);
    assert.equal(job.attemptCount, 2);
    await queue.markSent(job);
    await assert.rejects(queue.markSent(job), /kook_outbox_lease_lost/u);
    const sentState = await pool.query('SELECT status,payload_json,lease_token FROM message_outbox WHERE outbox_id=$1', [first.outboxId]);
    assert.deepEqual(sentState.rows[0], { status: 'sent', payload_json: {}, lease_token: null });
  } finally {
    await pool.query('DELETE FROM message_outbox WHERE tenant_id=$1', [tenantId]).catch(() => undefined);
    await pool.query('DELETE FROM tenants WHERE tenant_id=$1', [tenantId]).catch(() => undefined);
    await pool.end();
  }
});
