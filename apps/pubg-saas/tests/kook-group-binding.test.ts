import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import {
  createKookGroupBindingHandler,
  KookGuildWelcomeApiClient,
  KookIngressQueue,
  migratePublicDatabase,
  parseTrustedKookGuildJoin,
  PublicPubgPlayerResolver,
  TeamAdminService,
  type KookGroupWriteIntent,
} from '../src/index.js';

const databaseUrl = process.env.PUBG_SAAS_TEST_DATABASE_URL;

function group(guild: string, channel: string, actor: string, content: string, mentions: string[] = []) {
  return {
    type: 1, channel_type: 'GROUP', target_id: channel, author_id: actor, content,
    msg_id: randomUUID(), msg_timestamp: Date.now(),
    extra: { guild_id: guild, channel_type: 1, author: { id: actor, bot: false }, mention: mentions },
  };
}

function direct(bot: string, actor: string, content: string) {
  return { type: 1, channel_type: 'PERSON', target_id: bot, author_id: actor, content, msg_id: randomUUID(), msg_timestamp: Date.now() };
}

test('group binding auto-provisions one guild team, verifies identities, gates delegation, and overwrites self claims', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  const suffix = randomUUID().replaceAll('-', '');
  const bot = `bot-${suffix}`, guildA = `guild-a-${suffix}`, guildB = `guild-b-${suffix}`;
  const channelA = `channel-a-${suffix}`, channelA2 = `channel-a2-${suffix}`, channelB = `channel-b-${suffix}`;
  const actor = `actor-${suffix}`, regular = `regular-${suffix}`, admin = `admin-${suffix}`;
  const target = `target-${suffix}`, stranger = `stranger-${suffix}`;
  const members = new Set([
    `${guildA}:${channelA}:${actor}`, `${guildA}:${channelA}:${regular}`, `${guildA}:${channelA}:${admin}`,
    `${guildA}:${channelA}:${target}`, `${guildA}:${channelA2}:${actor}`, `${guildA}:${channelA2}:${admin}`,
    `${guildB}:${channelB}:${regular}`,
  ]);
  const admins = new Set([`${guildA}:${admin}`]);
  let lookupCalls = 0;
  const promptInputs: string[] = [];
  const playerResolver = new PublicPubgPlayerResolver({
    apiKey: 'synthetic-test-only',
    admission: { async acquire() {}, async observe() {} },
    fetcher: async input => {
      lookupCalls += 1;
      const names = new URL(String(input)).searchParams.get('filter[playerNames]')?.split(',') ?? [];
      return new Response(JSON.stringify({ data: names.filter(name => name !== 'Unknown').flatMap(name => name === 'Ambiguous'
        ? ['account.ambiguous_a', 'account.ambiguous_b'].map(id => ({ type: 'player', id, attributes: { name } }))
        : [{ type: 'player', id: `account.${name.toLowerCase()}_${suffix}`, attributes: { name } }]) }));
    },
  });
  const teams = new TeamAdminService(pool, {
    async isGuildAdmin(guildId, userId) { return admins.has(`${guildId}:${userId}`); },
    async isTextChannelMember(guildId, channelId, userId) { return members.has(`${guildId}:${channelId}:${userId}`); },
  });
  const intents = {
    async parse(message: string): Promise<KookGroupWriteIntent> {
      promptInputs.push(message);
      if (message.includes('队名')) return { action: 'rename_team', teamName: '夜猫小队' };
      if (message.includes('他的')) return { action: 'declare_pubg_account', target: 'mentioned_member', pubgName: 'Charlie' };
      if (message.includes('Echo')) return { action: 'declare_pubg_account', target: 'self', pubgName: 'Echo' };
      return { action: 'declare_pubg_account', target: 'self', pubgName: 'Alpha' };
    },
  };
  const handler = createKookGroupBindingHandler({ teams, players: playerResolver, intents });
  const queue = new KookIngressQueue(pool, {
    botAccountId: bot, maxRequestsPerUserPerMinute: 100, maxRequestsPerChannelPerMinute: 300,
    maxRequestsPerTenantPerMinute: 500, maxRequestsPerBotPerMinute: 1000,
  });
  const signal = new AbortController().signal;
  const provision = async (event: Parameters<typeof teams.ensureGroupChannel>[0]) =>
    teams.ensureGroupChannel(event, event.guildId === guildA ? 'Guild A' : 'Guild B');

  async function send(event: ReturnType<typeof group>): Promise<{ content: string; eventId: string }> {
    assert.equal(await queue.ingestGatewayEvent(event), 'accepted');
    const processed = await queue.processOne(handler, signal, undefined, provision);
    if (processed !== 'done') {
      const failure = (await pool.query('SELECT last_error_code FROM kook_ingress_events WHERE bot_account_id=$1 AND event_id=$2', [bot, event.msg_id])).rows[0]?.last_error_code;
      assert.equal(processed, 'done', `ingress failed with safe code ${String(failure)}`);
    }
    const reply = (await pool.query(
      'SELECT source_event_id,payload_json FROM message_outbox WHERE bot_account_id=$1 AND source_event_id=$2', [bot, event.msg_id],
    )).rows[0];
    return { content: String(reply.payload_json.content), eventId: String(reply.source_event_id) };
  }

  try {
    await migratePublicDatabase(pool);

    const welcomeChannel = `welcome-${suffix}`;
    const welcomeApi = new KookGuildWelcomeApiClient({
      token: 'test-only', botAccountId: bot,
      fetcher: async input => {
        const url = new URL(String(input));
        const data = url.pathname.endsWith('/guild/view')
          ? { id: guildA, name: 'Fixture KOOK Server', welcome_channel_id: welcomeChannel }
          : { id: welcomeChannel, guild_id: guildA, type: 1, is_category: false };
        return new Response(JSON.stringify({ code: 0, data }));
      },
    });
    const joinData = {
      type: 255, channel_type: 'PERSON', target_id: bot, author_id: '1', msg_id: `join-${suffix}`, msg_timestamp: Date.now(),
      extra: { type: 'self_joined_guild', body: { guild_id: guildA } },
    };
    const join = parseTrustedKookGuildJoin(joinData, bot);
    assert.ok(join);
    assert.equal(await queue.ingestGatewayEvent(joinData), 'accepted');
    assert.equal(await queue.processOne(handler, signal, welcomeApi, provision, async (event, targetInfo) => {
      const team = await teams.provisionFromGuildJoin(event, targetInfo);
      assert.equal(team.teamId.length > 0, true);
      return { type: 'text', content: '服务器队伍已创建并绑定。' };
    }), 'done');
    const joinTeam = (await pool.query(
      `SELECT tenant.tenant_id,team.team_id,team.label FROM tenants tenant JOIN teams team ON team.tenant_id=tenant.tenant_id
       JOIN channel_bindings binding ON binding.tenant_id=team.tenant_id AND binding.team_id=team.team_id
       WHERE tenant.bot_account_id=$1 AND tenant.guild_id=$2 AND binding.channel_id=$3`, [bot, guildA, welcomeChannel],
    )).rows[0]!;
    assert.equal(joinTeam.label, 'Fixture KOOK Server');
    const joinReply = (await pool.query('SELECT target_kind,target_id,payload_json FROM message_outbox WHERE bot_account_id=$1 AND welcome_guild_id=$2', [bot, guildA])).rows[0];
    assert.deepEqual(joinReply, { target_kind: 'channel', target_id: welcomeChannel, payload_json: { type: 'text', content: '服务器队伍已创建并绑定。' } });

    const missing = await send(group(guildA, channelA, actor, '/pubg me Unknown'));
    assert.equal(missing.content, '查不到该 PUBG 账号');
    assert.equal((await pool.query('SELECT 1 FROM account_claims WHERE bot_account_id=$1', [bot])).rowCount, 0);
    const firstTeam = (await pool.query(
      `SELECT tenant.tenant_id,team.team_id,team.label,team.pubg_shard FROM tenants tenant
       JOIN teams team ON team.tenant_id=tenant.tenant_id WHERE tenant.bot_account_id=$1 AND tenant.guild_id=$2`, [bot, guildA],
    )).rows[0]!;
    assert.equal(firstTeam.label, 'Fixture KOOK Server');
    assert.equal(firstTeam.pubg_shard, 'steam');
    assert.equal((await pool.query('SELECT team_id FROM channel_bindings WHERE bot_account_id=$1 AND channel_id=$2', [bot, channelA])).rows[0]?.team_id, firstTeam.team_id);

    const first = await send(group(guildA, channelA, actor, '/pubg me Alpha'));
    assert.match(first.content, /已验证并绑定 PUBG 账号：Alpha/u);
    assert.deepEqual((await pool.query(
      'SELECT pubg_shard,pubg_account_id,claim_status FROM account_claims WHERE bot_account_id=$1 AND user_id=$2', [bot, actor],
    )).rows[0], { pubg_shard: 'steam', pubg_account_id: `account.alpha_${suffix}`, claim_status: 'verified' });
    assert.equal((await pool.query(
      'SELECT 1 FROM team_members WHERE tenant_id=$1 AND team_id=$2 AND pubg_account_id=$3',
      [firstTeam.tenant_id, firstTeam.team_id, `account.alpha_${suffix}`],
    )).rowCount, 1);

    const missingOverwrite = await send(group(guildA, channelA, actor, '/pubg me Unknown'));
    assert.equal(missingOverwrite.content, '查不到该 PUBG 账号');
    assert.equal((await pool.query('SELECT pubg_account_id FROM account_claims WHERE bot_account_id=$1 AND user_id=$2', [bot, actor])).rows[0]?.pubg_account_id, `account.alpha_${suffix}`);

    const ambiguous = await send(group(guildA, channelA, actor, '/pubg me Ambiguous'));
    assert.match(ambiguous.content, /对应多个账号/u);
    assert.equal((await pool.query('SELECT 1 FROM account_claims WHERE bot_account_id=$1 AND pubg_account_id LIKE $2', [bot, 'account.ambiguous_%'])).rowCount, 0);

    const conflict = await send(group(guildA, channelA, regular, '/pubg me Alpha'));
    assert.match(conflict.content, /已绑定给其他 KOOK 用户/u);
    assert.equal((await pool.query('SELECT 1 FROM account_claims WHERE bot_account_id=$1 AND user_id=$2', [bot, regular])).rowCount, 0);

    const overwritten = await send(group(guildA, channelA, actor, '/pubg me Bravo'));
    assert.match(overwritten.content, /Bravo/u);
    assert.equal((await pool.query('SELECT pubg_account_id FROM account_claims WHERE bot_account_id=$1 AND user_id=$2', [bot, actor])).rows[0]?.pubg_account_id, `account.bravo_${suffix}`);

    const naturalSelf = await send(group(guildA, channelA, actor, '我的 PUBG 账号是 Alpha'));
    assert.match(naturalSelf.content, /Alpha/u);
    const legacyGroupClaim = await send(group(guildA, channelA, actor, '/pubg claim steam Bravo'));
    assert.match(legacyGroupClaim.content, /Bravo/u);
    assert.equal((await pool.query('SELECT claim_status FROM account_claims WHERE bot_account_id=$1 AND user_id=$2', [bot, actor])).rows[0]?.claim_status, 'verified');

    const delegated = await send(group(guildA, channelA, admin, `<@${target}> 他的 PUBG 账号是 Charlie`, [target]));
    assert.match(delegated.content, /Charlie/u);
    assert.match(delegated.content, new RegExp(target, 'u'));
    assert.equal((await pool.query('SELECT pubg_account_id,claim_status FROM account_claims WHERE bot_account_id=$1 AND user_id=$2', [bot, target])).rows[0]?.pubg_account_id, `account.charlie_${suffix}`);
    assert.equal(promptInputs.at(-1)?.includes(target), false, 'KOOK mention IDs must not enter the model prompt');

    const beforeDeniedLookup = lookupCalls;
    const deniedDelegate = await send(group(guildA, channelA, regular, `<@${stranger}> 他的 PUBG 账号是 Charlie`, [stranger]));
    assert.match(deniedDelegate.content, /管理员代绑需要/u);
    assert.equal(lookupCalls, beforeDeniedLookup, 'unauthorized delegation must be denied before PUBG API lookup');
    assert.equal((await pool.query('SELECT 1 FROM account_claims WHERE bot_account_id=$1 AND user_id=$2', [bot, stranger])).rowCount, 0);

    const nonMemberDelegate = await send(group(guildA, channelA, admin, `<@${stranger}> 他的 PUBG 账号是 Charlie`, [stranger]));
    assert.match(nonMemberDelegate.content, /当前文字频道成员/u);
    assert.equal(lookupCalls, beforeDeniedLookup);

    const multipleMention = await send(group(guildA, channelA, admin, `<@${target}> <@${stranger}> 他的 PUBG 账号是 Charlie`, [target, stranger]));
    assert.match(multipleMention.content, /只 @ 一位/u);
    assert.equal(lookupCalls, beforeDeniedLookup);

    const missingMention = await send(group(guildA, channelA, admin, '他的 PUBG 账号是 Charlie'));
    assert.match(missingMention.content, /只 @ 一位/u);
    assert.equal(lookupCalls, beforeDeniedLookup);

    const nonMemberProvisionEvent = group(guildA, channelA2, stranger, '/pubg me Alpha');
    assert.equal(await queue.ingestGatewayEvent(nonMemberProvisionEvent), 'accepted');
    assert.equal(await queue.processOne(handler, signal, undefined, provision), 'dead');
    assert.equal((await pool.query('SELECT 1 FROM channel_bindings WHERE bot_account_id=$1 AND channel_id=$2', [bot, channelA2])).rowCount, 0);

    const secondChannelSelf = await send(group(guildA, channelA2, admin, '我的 PUBG 账号是 Echo'));
    assert.match(secondChannelSelf.content, /Echo/u);
    assert.equal((await pool.query('SELECT team_id FROM channel_bindings WHERE bot_account_id=$1 AND channel_id=$2', [bot, channelA2])).rows[0]?.team_id, firstTeam.team_id);
    assert.equal((await pool.query('SELECT pubg_account_id FROM account_claims WHERE bot_account_id=$1 AND user_id=$2', [bot, admin])).rows[0]?.pubg_account_id, `account.echo_${suffix}`);

    const renamed = await send(group(guildA, channelA, regular, '我们的队名是 夜猫小队'));
    assert.match(renamed.content, /夜猫小队/u);
    assert.equal((await pool.query('SELECT label FROM teams WHERE tenant_id=$1 AND team_id=$2', [firstTeam.tenant_id, firstTeam.team_id])).rows[0]?.label, '夜猫小队');

    const secondServer = await send(group(guildB, channelB, regular, '/pubg me Delta'));
    assert.match(secondServer.content, /Delta/u);
    const secondTeam = (await pool.query(
      `SELECT tenant.tenant_id,team.team_id,team.label FROM tenants tenant JOIN teams team ON team.tenant_id=tenant.tenant_id
       WHERE tenant.bot_account_id=$1 AND tenant.guild_id=$2`, [bot, guildB],
    )).rows[0]!;
    assert.notEqual(secondTeam.tenant_id, firstTeam.tenant_id);
    assert.equal(secondTeam.label, 'Guild B');
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM teams WHERE tenant_id=$1', [secondTeam.tenant_id])).rows[0]?.count, 1);

    const privateClaim = direct(bot, actor, '/pubg claim steam Alpha');
    assert.equal(await queue.ingestGatewayEvent(privateClaim), 'accepted');
    assert.equal(await queue.processOne(handler, signal), 'done');
    const privateReply = (await pool.query('SELECT payload_json FROM message_outbox WHERE bot_account_id=$1 AND source_event_id=$2', [bot, privateClaim.msg_id])).rows[0]?.payload_json;
    assert.match(String(privateReply.content), /群聊中发送/u);
    assert.equal((await pool.query('SELECT pubg_account_id FROM account_claims WHERE bot_account_id=$1 AND user_id=$2', [bot, actor])).rows[0]?.pubg_account_id, `account.bravo_${suffix}`);
  } finally {
    await pool.query('DELETE FROM message_outbox WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM kook_ingress_events WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM account_claims WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM tenants WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM channel_identities WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM channel_binding_versions WHERE bot_account_id=$1', [bot]);
    await pool.query("DELETE FROM pubg_accounts WHERE account_id LIKE 'account.%' AND account_id LIKE $1", [`%_${suffix}`]);
    await pool.end();
  }
});
