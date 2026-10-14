import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { MockLanguageModelV4 } from 'ai/test';
import {
  AccountClaimService,
  createKookGroupBindingHandler,
  createKookPublicQueryHandler,
  composeKookRequestHandlers,
  executeKookNaturalWrite,
  KookGuildWelcomeApiClient,
  KookIngressQueue,
  migratePublicDatabase,
  parseTrustedKookGuildJoin,
  PublicQueryAuthorizer,
  PublicPubgPlayerResolver,
  TeamAdminService,
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

const agentUsage = {
  inputTokens: { total: 8, noCache: 8, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function agentResponse(content: Array<Record<string, unknown>>, finish: 'stop' | 'tool-calls' = 'stop'): never {
  return { content, finishReason: { unified: finish, raw: finish }, usage: agentUsage, warnings: [] } as never;
}

function agentToolCall(toolName: string, input: unknown) {
  return agentResponse([{ type: 'tool-call', toolCallId: randomUUID(), toolName, input: JSON.stringify(input) }], 'tool-calls');
}

function agentText(text: string) {
  return agentResponse([{ type: 'text', text }]);
}

test('group binding auto-provisions one guild team, verifies identities, gates delegation, and overwrites self claims', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  const suffix = randomUUID().replaceAll('-', '');
  const bot = `bot-${suffix}`, guildA = `guild-a-${suffix}`, guildB = `guild-b-${suffix}`;
  const channelA = `channel-a-${suffix}`, channelA2 = `channel-a2-${suffix}`, channelB = `channel-b-${suffix}`;
  const actor = `actor-${suffix}`, regular = `regular-${suffix}`, admin = `admin-${suffix}`, fallbackActor = `fallback-${suffix}`;
  const target = `target-${suffix}`, stranger = `stranger-${suffix}`;
  const members = new Set([
    `${guildA}:${channelA}:${actor}`, `${guildA}:${channelA}:${regular}`, `${guildA}:${channelA}:${admin}`, `${guildA}:${channelA}:${fallbackActor}`,
    `${guildA}:${channelA}:${target}`, `${guildA}:${channelA2}:${actor}`, `${guildA}:${channelA2}:${admin}`,
    `${guildB}:${channelB}:${regular}`,
  ]);
  const admins = new Set([`${guildA}:${admin}`]);
  let lookupCalls = 0;
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
  const bindingServices = { teams, players: playerResolver };
  const legacyHandler = createKookGroupBindingHandler(bindingServices);
  // This test adapter simulates the AI SDK selecting the restricted write
  // tool. Production does not inspect phrases or classify messages here.
  const handler = async (job: Parameters<typeof legacyHandler>[0], signal: AbortSignal) => {
    const legacy = await legacyHandler(job, signal);
    if (legacy !== undefined) return legacy;
    if (job.request.kind !== 'group') return null;
    const content = job.request.event.content;
    const self = /^我的 PUBG 账号是\s+(.+)$/u.exec(content);
    if (self) return { type: 'text' as const, content: (await executeKookNaturalWrite(job, bindingServices,
      { kind: 'declare_pubg_account', target: 'self', pubgName: self[1]! }, signal)).message };
    const delegatedMarker = '他的 PUBG 账号是';
    if (content.includes(delegatedMarker)) return { type: 'text' as const, content: (await executeKookNaturalWrite(job, bindingServices,
      { kind: 'declare_pubg_account', target: 'mentioned_member', pubgName: content.slice(content.indexOf(delegatedMarker) + delegatedMarker.length).trim() }, signal)).message };
    const rename = /^我们的队名是\s+(.+)$/u.exec(content);
    if (rename) return { type: 'text' as const, content: (await executeKookNaturalWrite(job, bindingServices,
      { kind: 'rename_team', teamName: rename[1]! }, signal)).message };
    return null;
  };
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

    const unrelated = group(guildA, channelA, actor, '今晚的比赛几点开始？');
    assert.equal(await queue.ingestGatewayEvent(unrelated), 'accepted');
    assert.equal(await queue.processOne(legacyHandler, signal, undefined, provision), 'done');
    assert.equal((await pool.query('SELECT 1 FROM message_outbox WHERE bot_account_id=$1 AND source_event_id=$2', [bot, unrelated.msg_id])).rowCount, 0,
      'the deterministic binding handler leaves ordinary chat to the Agent route');

    const first = await send(group(guildA, channelA, actor, '/pubg me Alpha'));
    assert.match(first.content, /已验证并绑定 PUBG 账号：Alpha/u);
    const modelUnavailableCommand = await send(group(guildA, channelA, fallbackActor, '/pubg me Fallback'));
    assert.match(modelUnavailableCommand.content, /Fallback/u);
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
    assert.match(delegated.content, /@成员/u);
    assert.doesNotMatch(delegated.content, new RegExp(target, 'u'), 'KOOK mention IDs stay outside model-facing tool results');
    assert.equal((await pool.query('SELECT pubg_account_id,claim_status FROM account_claims WHERE bot_account_id=$1 AND user_id=$2', [bot, target])).rows[0]?.pubg_account_id, `account.charlie_${suffix}`);

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

    for (let index = 1; index <= 4; index += 1) {
      const rosterUser = `roster-${index}-${suffix}`;
      members.add(`${guildA}:${channelA}:${rosterUser}`);
      const joined = await send(group(guildA, channelA, rosterUser, `我的 PUBG 账号是 Roster${index}`));
      assert.match(joined.content, new RegExp(`Roster${index}`, 'u'));
    }
    assert.equal(Number((await pool.query(
      'SELECT COUNT(*) AS count FROM team_members WHERE tenant_id=$1 AND team_id=$2', [firstTeam.tenant_id, firstTeam.team_id],
    )).rows[0]?.count), 8);

    const fullRosterRebind = await send(group(guildA, channelA, actor, '我的 PUBG 账号是 Omega'));
    assert.match(fullRosterRebind.content, /Omega/u, 'replacing the actor\'s own account is allowed at the eight-member cap');
    assert.equal(Number((await pool.query(
      'SELECT COUNT(*) AS count FROM team_members WHERE tenant_id=$1 AND team_id=$2', [firstTeam.tenant_id, firstTeam.team_id],
    )).rows[0]?.count), 8);

    const ninthUser = `roster-9-${suffix}`;
    members.add(`${guildA}:${channelA}:${ninthUser}`);
    const fullTeam = await send(group(guildA, channelA, ninthUser, '我的 PUBG 账号是 Roster9'));
    assert.match(fullTeam.content, /队伍已绑定 8 名玩家|8 名玩家.*名额已满/u);
    assert.equal((await pool.query(
      'SELECT 1 FROM account_claims WHERE bot_account_id=$1 AND user_id=$2', [bot, ninthUser],
    )).rowCount, 0, 'the server-side cap rejects a ninth claim without persisting it');

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
    assert.equal((await pool.query('SELECT pubg_account_id FROM account_claims WHERE bot_account_id=$1 AND user_id=$2', [bot, actor])).rows[0]?.pubg_account_id, `account.omega_${suffix}`);
  } finally {
    await pool.query('DELETE FROM kook_agent_runs WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM kook_conversation_messages WHERE bot_account_id=$1', [bot]);
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

test('Agent account-binding tools use trusted mentions, real lookup results, and persist authorization denials', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  const suffix = randomUUID().replaceAll('-', '');
  const bot = `agent-bot-${suffix}`, guild = `agent-guild-${suffix}`, channel = `agent-channel-${suffix}`;
  const member = `member-${suffix}`, admin = `admin-${suffix}`, target = `target-${suffix}`, nonAdmin = `non-admin-${suffix}`;
  const admins = new Set([`${guild}:${admin}`]);
  const channelMembers = new Set([member, admin, target, nonAdmin]);
  let permissionUnavailableUser: string | null = null;
  let lookupCalls = 0;
  const teams = new TeamAdminService(pool, {
    async isGuildAdmin(guildId, userId) { return admins.has(`${guildId}:${userId}`); },
    async isTextChannelMember(guildId, channelId, userId) {
      if (userId === permissionUnavailableUser) throw new Error('kook_permission_check_unavailable');
      return guildId === guild && channelId === channel && channelMembers.has(userId);
    },
  });
  const players = new PublicPubgPlayerResolver({
    apiKey: 'synthetic-test-only',
    admission: { async acquire() {}, async observe() {} },
    fetcher: async input => {
      lookupCalls += 1;
      const names = new URL(String(input)).searchParams.get('filter[playerNames]')?.split(',') ?? [];
      return new Response(JSON.stringify({ data: names.filter(name => name !== 'Unknown').map(name => ({
        type: 'player', id: `account.${name.toLowerCase()}_${suffix}`, attributes: { name },
      })) }));
    },
  });
  const model = new MockLanguageModelV4({ doGenerate: [
    agentToolCall('declare_pubg_account', { target: 'self', pubgName: 'Alpha' }),
    agentText('已经查到并绑定你的 PUBG 账号 Alpha。'),
    agentToolCall('declare_pubg_account', { target: 'mentioned_member', pubgName: 'Bravo' }),
    agentText('已经查到并为被 @ 的队员绑定 PUBG 账号 Bravo。'),
    agentToolCall('declare_pubg_account', { target: 'mentioned_member', pubgName: 'Charlie' }),
    agentText('当前操作者不是管理员，代绑没有执行。'),
    agentToolCall('declare_pubg_account', { target: 'self', pubgName: 'Unknown' }),
    agentText('查不到该 PUBG 账号，所以没有记录。'),
    agentToolCall('declare_pubg_account', { target: 'self', pubgName: 'Delta' }),
    agentText('权限服务暂时不可用，我没有改动账号绑定。'),
  ] });
  const diagnostics: unknown[] = [];
  const bindingServices = { teams, players };
  const handler = composeKookRequestHandlers(
    createKookGroupBindingHandler(bindingServices),
    createKookPublicQueryHandler({
      authorizer: new PublicQueryAuthorizer(pool, {
        async isGuildMember(guildId, userId) { return guildId === guild && channelMembers.has(userId); },
        async isTextChannelMember(guildId, channelId, userId) {
          return guildId === guild && channelId === channel && channelMembers.has(userId);
        },
      }, { botAccountId: bot }),
      claims: new AccountClaimService(pool),
      agent: { model, provider: 'synthetic-provider', modelId: 'synthetic-agent-model' },
      executeNaturalWrite: (job, intent, signal) => executeKookNaturalWrite(job, bindingServices, intent, signal),
      onAgentDiagnostic: event => diagnostics.push(event),
    }),
  );
  const queue = new KookIngressQueue(pool, {
    botAccountId: bot,
    maxRequestsPerUserPerMinute: 100,
    maxRequestsPerChannelPerMinute: 300,
    maxRequestsPerTenantPerMinute: 500,
    maxRequestsPerBotPerMinute: 1000,
  });
  const signal = new AbortController().signal;

  async function send(event: ReturnType<typeof group>): Promise<string> {
    assert.equal(await queue.ingestGatewayEvent(event), 'accepted');
    assert.equal(await queue.processOne(
      async (job, abortSignal) => (await handler(job, abortSignal)) ?? null,
      signal,
      undefined,
      async trustedEvent => teams.ensureGroupChannel(trustedEvent, 'Agent Fixture Squad'),
    ), 'done');
    const row = (await pool.query(
      'SELECT payload_json FROM message_outbox WHERE bot_account_id=$1 AND source_event_id=$2', [bot, event.msg_id],
    )).rows[0];
    assert.ok(row);
    return String(row.payload_json.content);
  }

  try {
    await migratePublicDatabase(pool);
    const selfEvent = group(guild, channel, member, '我的 PUBG 账号是 Alpha');
    assert.match(await send(selfEvent), /已经查到并绑定/u);
    assert.deepEqual((await pool.query(
      'SELECT pubg_account_id,claim_status FROM account_claims WHERE bot_account_id=$1 AND user_id=$2', [bot, member],
    )).rows[0], { pubg_account_id: `account.alpha_${suffix}`, claim_status: 'verified' });

    const delegatedEvent = group(guild, channel, admin, `<@${target}> 他的 PUBG 账号是 Bravo`, [target]);
    assert.match(await send(delegatedEvent), /为被 @ 的队员绑定/u);
    assert.deepEqual((await pool.query(
      'SELECT pubg_account_id,claim_status FROM account_claims WHERE bot_account_id=$1 AND user_id=$2', [bot, target],
    )).rows[0], { pubg_account_id: `account.bravo_${suffix}`, claim_status: 'verified' });
    assert.equal(JSON.stringify(model.doGenerateCalls).includes(target), false,
      'the Agent receives the mention label but never the trusted KOOK target ID');

    const lookupsBeforeDenial = lookupCalls;
    const deniedEvent = group(guild, channel, nonAdmin, `<@${target}> 他的 PUBG 账号是 Charlie`, [target]);
    assert.match(await send(deniedEvent), /不是管理员/u);
    assert.equal(lookupCalls, lookupsBeforeDenial, 'authorization is checked before the real account lookup');
    assert.equal((await pool.query(
      'SELECT 1 FROM account_claims WHERE bot_account_id=$1 AND user_id=$2', [bot, nonAdmin],
    )).rowCount, 0);
    assert.deepEqual((await pool.query(
      'SELECT outcome,failure_code FROM kook_agent_runs WHERE bot_account_id=$1 AND event_id=$2', [bot, deniedEvent.msg_id],
    )).rows[0], { outcome: 'authorization_denied', failure_code: 'guild_admin_required' });

    const missingEvent = group(guild, channel, member, '我的 PUBG 账号是 Unknown');
    assert.match(await send(missingEvent), /查不到该 PUBG 账号/u);
    assert.equal((await pool.query(
      'SELECT 1 FROM account_claims WHERE bot_account_id=$1 AND user_id=$2', [bot, member],
    )).rowCount, 1, 'a lookup miss does not replace the existing account claim');

    const lookupsBeforeUnavailable = lookupCalls;
    const unavailableEvent = group(guild, channel, member, '我的 PUBG 账号是 Delta');
    permissionUnavailableUser = member;
    let unavailableReply = '';
    try {
      unavailableReply = await send(unavailableEvent);
    } finally {
      permissionUnavailableUser = null;
    }
    assert.match(unavailableReply, /权限服务暂时不可用/u);
    assert.equal(lookupCalls, lookupsBeforeUnavailable, 'account resolution waits until the permission check succeeds');
    assert.deepEqual((await pool.query(
      'SELECT outcome,failure_code FROM kook_agent_runs WHERE bot_account_id=$1 AND event_id=$2', [bot, unavailableEvent.msg_id],
    )).rows[0], { outcome: 'tool_degraded', failure_code: 'kook_permission_check_unavailable' });
    assert.ok(diagnostics.some(value => JSON.stringify(value).includes('"stage":"authorization"')
      && JSON.stringify(value).includes('kook_permission_check_unavailable')));
    assert.equal(JSON.stringify(diagnostics).includes(unavailableEvent.msg_id), false);
  } finally {
    await pool.query('DELETE FROM kook_agent_runs WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM kook_conversation_messages WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM message_outbox WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM kook_ingress_events WHERE bot_account_id=$1', [bot]);
    await pool.query("DELETE FROM account_claims WHERE platform='kook' AND bot_account_id=$1", [bot]);
    await pool.query('DELETE FROM usage_records WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM tenants WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM pubg_accounts WHERE shard=$1 AND account_id=ANY($2::text[])', [
      'steam', [`account.alpha_${suffix}`, `account.bravo_${suffix}`],
    ]);
    await pool.query('DELETE FROM channel_identities WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM channel_binding_versions WHERE bot_account_id=$1', [bot]);
    await pool.end();
  }
});
