import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { MockLanguageModelV4 } from 'ai/test';
import {
  AccountClaimService,
  KookIngressQueue,
  KookMessageQueue,
  migratePublicDatabase,
  PublicQueryAuthorizer,
  createKookPublicQueryHandler,
} from '../src/index.js';

const databaseUrl = process.env.PUBG_SAAS_TEST_DATABASE_URL;
const usage = {
  inputTokens: { total: 8, noCache: 8, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function modelText(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    finishReason: { unified: 'stop' as const, raw: 'stop' }, usage, warnings: [],
  };
}

function group(bot: string, guild: string, channel: string, user: string, content: string, quote?: string) {
  return {
    type: 1, channel_type: 'GROUP', target_id: channel, author_id: user, content,
    msg_id: randomUUID(), msg_timestamp: Date.now(),
    extra: {
      guild_id: guild, channel_type: 1,
      author: { id: user, bot: false },
      ...(quote ? { quote: { msg_id: quote } } : {}),
    },
  };
}

test('unbound human group messages reach Agent, produce outbox replies, preserve quotes/speakers, and fall back on model failure', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  const suffix = randomUUID().replaceAll('-', '');
  const bot = `bot-${suffix}`, guild = `guild-${suffix}`, channel = `channel-${suffix}`;
  const userA = `user-a-${suffix}`, userB = `user-b-${suffix}`;
  const diagnostics: unknown[] = [];
  const queue = new KookIngressQueue(pool, {
    botAccountId: bot,
    maxRequestsPerUserPerMinute: 100,
    maxRequestsPerChannelPerMinute: 300,
    maxRequestsPerTenantPerMinute: 500,
    maxRequestsPerBotPerMinute: 1000,
  });
  const permissions = { isGuildMember: async () => true, isTextChannelMember: async () => true };
  const authorizer = new PublicQueryAuthorizer(pool, permissions, { botAccountId: bot });
  const agentModel = new MockLanguageModelV4({ doGenerate: [
    modelText('你好！今天想聊游戏，还是已经准备好今晚的开黑阵容？'),
    modelText('当然可以，几点集合？我先把跳伞点从海里划掉。'),
    modelText('可以叫上 @成员，今晚先约个集合时间。'),
    modelText('收到，我们接着刚才的话题聊。'),
  ] });
  const handler = createKookPublicQueryHandler({
    authorizer,
    claims: new AccountClaimService(pool),
    agent: { model: agentModel, provider: 'fixture-provider', modelId: 'fixture-model' },
    onAgentDiagnostic: event => diagnostics.push(event),
  });
  const signal = new AbortController().signal;
  async function process(event: ReturnType<typeof group>) {
    assert.equal(await queue.ingestGatewayEvent(event), 'accepted');
    assert.equal(await queue.processOne(async (job, abortSignal) => (await handler(job, abortSignal)) ?? null, signal), 'done');
  }
  try {
    await migratePublicDatabase(pool);
    const hello = group(bot, guild, channel, userA, '你好');
    await process(hello);
    const first = (await pool.query('SELECT payload_json,tenant_id,team_id,target_id FROM message_outbox WHERE bot_account_id=$1 AND source_event_id=$2', [bot, hello.msg_id])).rows[0];
    assert.equal(first?.payload_json.content, '你好！今天想聊游戏，还是已经准备好今晚的开黑阵容？');
    assert.equal(first?.tenant_id, null);
    assert.equal(first?.team_id, null);
    assert.equal(first?.target_id, channel);
    assert.equal((await pool.query('SELECT 1 FROM teams WHERE tenant_id IN (SELECT tenant_id FROM tenants WHERE bot_account_id=$1 AND guild_id=$2)', [bot, guild])).rowCount, 0,
      'ordinary chat does not require auto-provisioning a PUBG team');
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM kook_conversation_messages WHERE bot_account_id=$1 AND channel_id=$2', [bot, channel])).rows[0]?.count, 2);

    const outbox = new KookMessageQueue(pool, { botAccountId: bot });
    let sentReplyTo: string | null = null;
    assert.equal(await outbox.deliverOne({
      async send(targetId, payload, _nonce, replyTo) {
        assert.equal(targetId, channel);
        assert.match(payload.content, /你好/u);
        sentReplyTo = replyTo ?? null;
        return 'remote-bot-message-1';
      },
    }), 'sent');
    assert.equal(sentReplyTo, hello.msg_id);
    assert.equal((await pool.query('SELECT 1 FROM kook_conversation_messages WHERE bot_account_id=$1 AND channel_id=$2 AND message_id=$3', [bot, channel, 'remote-bot-message-1'])).rowCount, 1);

    const gameNight = group(bot, guild, channel, userA, '今晚开黑吗', 'remote-bot-message-1');
    await process(gameNight);
    const second = (await pool.query('SELECT payload_json FROM message_outbox WHERE bot_account_id=$1 AND source_event_id=$2', [bot, gameNight.msg_id])).rows[0]?.payload_json;
    assert.equal(second.content, '当然可以，几点集合？我先把跳伞点从海里划掉。');

    const mentionEvent = group(bot, guild, channel, userA, `<@${userB}> 今晚要不要一起开黑？`);
    await process(mentionEvent);
    const sanitizedHistory = (await pool.query(
      'SELECT content FROM kook_conversation_messages WHERE bot_account_id=$1 AND channel_id=$2 AND message_id=$3',
      [bot, channel, mentionEvent.msg_id],
    )).rows[0]?.content;
    assert.equal(sanitizedHistory, '@成员 今晚要不要一起开黑？');
    const mentionPrompt = JSON.stringify(agentModel.doGenerateCalls[2]?.prompt);
    assert.match(mentionPrompt, /@成员 今晚要不要一起开黑/u);
    assert.equal(mentionPrompt.includes(userB), false, 'KOOK mention IDs never enter the model prompt');

    const otherSpeaker = group(bot, guild, channel, userB, '那我们几点集合？', 'remote-bot-message-1');
    assert.equal(await queue.ingestGatewayEvent(otherSpeaker), 'accepted');
    const job = await queue.claimNext();
    assert.ok(job);
    const window = await authorizer.loadAgentConversation(job);
    assert.equal(window.currentSpeakerLabel, '成员1');
    assert.equal(window.currentQuoteContext, '当前消息引用了助手：“你好！今天想聊游戏，还是已经准备好今晚的开黑阵容？”');
    assert.match(window.turns.map(turn => turn.content).join('\n'), /\[成员2\] 你好/u);
    assert.match(window.turns.map(turn => turn.content).join('\n'), /\[回复成员2\]/u);
    assert.doesNotMatch(JSON.stringify(window), new RegExp(`${userA}|${userB}|${bot}|${guild}|${channel}`, 'u'), 'model context must use speaker labels, not KOOK IDs');
    const otherReply = await handler(job, signal);
    await queue.complete(job, otherReply ?? null);

    const failEvent = group(bot, guild, channel, userA, '你还在吗？');
    const failedModel = new MockLanguageModelV4({ doGenerate: async () => { throw new Error('private provider detail and secret'); } });
    const failureHandler = createKookPublicQueryHandler({
      authorizer,
      claims: new AccountClaimService(pool),
      agent: { model: failedModel, provider: 'fixture-provider', modelId: 'fixture-model' },
      onAgentDiagnostic: event => diagnostics.push(event),
    });
    assert.equal(await queue.ingestGatewayEvent(failEvent), 'accepted');
    assert.equal(await queue.processOne(async (leased, abortSignal) => (await failureHandler(leased, abortSignal)) ?? null, signal), 'done');
    const fallback = (await pool.query('SELECT payload_json FROM message_outbox WHERE bot_account_id=$1 AND source_event_id=$2', [bot, failEvent.msg_id])).rows[0]?.payload_json;
    assert.match(fallback.content, /遇到一点技术问题/u);
    assert.doesNotMatch(JSON.stringify(fallback), /private provider detail|secret/u);
    assert.deepEqual((await pool.query('SELECT outcome,failure_code FROM kook_agent_runs WHERE bot_account_id=$1 AND event_id=$2', [bot, failEvent.msg_id])).rows[0], {
      outcome: 'provider_fallback', failure_code: 'agent_provider_error',
    });
    assert.equal(JSON.stringify(diagnostics).includes('private provider detail'), false);
    assert.equal(JSON.stringify(diagnostics).includes(failEvent.msg_id), false, 'logs expose only a hashed request key');

    const emptyEvent = group(bot, guild, channel, userA, '你有听到吗？');
    const emptyResponseHandler = createKookPublicQueryHandler({
      authorizer,
      claims: new AccountClaimService(pool),
      agent: { model: new MockLanguageModelV4({ doGenerate: async () => modelText('') }), provider: 'fixture-provider', modelId: 'fixture-model' },
      onAgentDiagnostic: event => diagnostics.push(event),
    });
    assert.equal(await queue.ingestGatewayEvent(emptyEvent), 'accepted');
    assert.equal(await queue.processOne(async (leased, abortSignal) =>
      (await emptyResponseHandler(leased, abortSignal)) ?? null, signal), 'done');
    const emptyReply = (await pool.query(
      'SELECT payload_json FROM message_outbox WHERE bot_account_id=$1 AND source_event_id=$2', [bot, emptyEvent.msg_id],
    )).rows[0]?.payload_json;
    assert.match(emptyReply.content, /遇到一点技术问题/u);
    assert.deepEqual((await pool.query(
      'SELECT outcome,failure_code FROM kook_agent_runs WHERE bot_account_id=$1 AND event_id=$2', [bot, emptyEvent.msg_id],
    )).rows[0], { outcome: 'provider_fallback', failure_code: 'public_agent_empty_response' });
    assert.equal(JSON.stringify(diagnostics).includes(emptyEvent.msg_id), false);
  } finally {
    await pool.query('DELETE FROM kook_agent_runs WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM kook_conversation_messages WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM message_outbox WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM kook_ingress_events WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM tenants WHERE bot_account_id=$1', [bot]);
    await pool.end();
  }
});
