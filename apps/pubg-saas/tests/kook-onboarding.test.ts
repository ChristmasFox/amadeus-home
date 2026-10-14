import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { AccountClaimService, createKookManagementHandler, KookIngressQueue, migratePublicDatabase, parseTrustedKookGroupMessage, PublicPubgPlayerResolver, TeamAdminService, type KookTextPayload } from '../src/index.js';

const databaseUrl = process.env.PUBG_SAAS_TEST_DATABASE_URL;

function token(payload: KookTextPayload): string {
  assert.equal(payload.type, 'card');
  return (JSON.parse(payload.content) as Array<{ modules: Array<{ elements?: Array<{ value: string }> }> }>)[0]!.modules[2]!.elements![0]!.value;
}

test('legacy onboarding keeps team commands and prevents private account binding', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 8 }); const suffix = randomUUID();
  const bot = `bot-${suffix}`, guildA = `guildA-${suffix}`, guildB = `guildB-${suffix}`, actorA = `actorA-${suffix}`, actorB = `actorB-${suffix}`, regular = `regular-${suffix}`, channelA = `channelA-${suffix}`, channelB = `channelB-${suffix}`, channelA2 = `channelA2-${suffix}`;
  // This management-flow fixture intentionally issues many requests from the
  // same actor inside one minute; dedicated queue tests cover production caps.
  const queue = new KookIngressQueue(pool, {
    botAccountId: bot,
    baseRetryMs: 1,
    maxRequestsPerUserPerMinute: 100,
    maxRequestsPerChannelPerMinute: 250,
    maxRequestsPerTenantPerMinute: 500,
    maxRequestsPerBotPerMinute: 1000,
  });
  let lookups = 0, ownerAAllowed = true;
  let duringLookup: (() => Promise<void>) | null = null;
  const players = new PublicPubgPlayerResolver({
apiKey: 'public-fixture', admission: { async acquire() { }, async observe() { } }, fetcher: async (input) => {
      lookups++; const url = new URL(String(input));
      const names = url.searchParams.get('filter[playerNames]')!.split(',');
      if (duringLookup) { const work = duringLookup; duringLookup = null; await work(); }
      return new Response(JSON.stringify({ data: names.filter(name => name !== 'Missing').map(name => ({ type: 'player', id: `account.${name.toLowerCase()}_${suffix.replaceAll('-', '')}`, attributes: { name } })) }));
    }
});
  const teams = new TeamAdminService(pool, { async isGuildAdmin(g, u) { return (ownerAAllowed && g === guildA && u === actorA) || (g === guildB && u === actorB); } });
  const claims = new AccountClaimService(pool), handler = createKookManagementHandler({ teams, claims, players }), signal = new AbortController().signal;
  const group = (guild: string, channel: string, user: string, content: string) => ({ type: 1, channel_type: 'GROUP', target_id: channel, author_id: user, content, msg_id: randomUUID(), msg_timestamp: Date.now(), extra: { guild_id: guild, channel_type: 1, author: { id: user, bot: false } } });
  const click = (channel: string, user: string, value: string) => ({ type: 255, channel_type: 'PERSON', msg_id: randomUUID(), msg_timestamp: Date.now(), extra: { type: 'message_btn_click', body: { user_id: user, target_id: channel, msg_id: 'synthetic-card', value } } });
  async function send(data: unknown): Promise<KookTextPayload> {
    assert.equal(await queue.ingestGatewayEvent(data), 'accepted'); assert.equal(await queue.processOne(handler, signal), 'done');
    return (await pool.query('SELECT payload_json FROM message_outbox WHERE bot_account_id=$1 ORDER BY created_at DESC LIMIT 1', [bot])).rows[0]!.payload_json;
  }
  try {
    await migratePublicDatabase(pool);
    const denied = await send(group(guildA, channelA, regular, '/pubg create steam "Same Label" Alice Bob'));
    assert.match(denied.content, /管理员权限/u); assert.equal(lookups, 0);
    const partial = await send(group(guildA, channelA, actorA, '/pubg create steam "Same Label" Alice Missing'));
    assert.match(partial.content, /未找到.*Missing/u);
    assert.equal((await pool.query('SELECT 1 FROM pending_squad_setups WHERE bot_account_id=$1', [bot])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM tenants WHERE bot_account_id=$1', [bot])).rowCount, 0);

    const prepared = await send(group(guildA, channelA, actorA, '/pubg create steam "Same Label" Alice Bob'));
    assert.match(prepared.content, /Alice、Bob/u);
    const setupToken = token(prepared); assert.ok(setupToken.startsWith('setup:'));
    assert.equal((await pool.query('SELECT 1 FROM teams team JOIN tenants tenant ON tenant.tenant_id=team.tenant_id WHERE tenant.bot_account_id=$1', [bot])).rowCount, 0);
    assert.match((await send(click(channelA2, actorA, setupToken))).content, /失效/u);
    assert.match((await send(click(channelA, regular, setupToken))).content, /管理员权限/u);
    ownerAAllowed = false;
    assert.match((await send(click(channelA, actorA, setupToken))).content, /管理员权限/u);
    ownerAAllowed = true;
    const originalClick = click(channelA, actorA, setupToken);
    await queue.ingestGatewayEvent(originalClick);
    assert.equal(await queue.processOne(async (job, s) => { await handler(job, s); throw new Error('crash after committed create'); }, signal), 'retry');
    const squadA = (await pool.query('SELECT tenant_id,team_id FROM channel_bindings WHERE bot_account_id=$1 AND channel_id=$2', [bot, channelA])).rows[0]!;
    await pool.query('UPDATE kook_ingress_events SET next_attempt_at=now() WHERE bot_account_id=$1 AND event_id=$2', [bot, originalClick.msg_id]);
    assert.equal(await queue.processOne(handler, signal), 'done');
    assert.equal((await pool.query('SELECT 1 FROM teams WHERE tenant_id=$1', [squadA.tenant_id])).rowCount, 1);
    assert.deepEqual((await pool.query(
      "SELECT account_id,display_name FROM pubg_accounts WHERE shard='steam' AND account_id=ANY($1::text[]) ORDER BY account_id",
      [[`account.alice_${suffix.replaceAll('-', '')}`, `account.bob_${suffix.replaceAll('-', '')}`]],
    )).rows, [
      { account_id: `account.alice_${suffix.replaceAll('-', '')}`, display_name: 'Alice' },
      { account_id: `account.bob_${suffix.replaceAll('-', '')}`, display_name: 'Bob' },
    ]);
    assert.match((await send(click(channelA, actorA, setupToken))).content, /失效/u);

    const otherPrepared = await send(group(guildB, channelB, actorB, '/pubg create steam "Same Label" Alice Bob'));
    await send(click(channelB, actorB, token(otherPrepared)));
    const squadB = (await pool.query('SELECT tenant_id,team_id FROM channel_bindings WHERE bot_account_id=$1 AND channel_id=$2', [bot, channelB])).rows[0]!;
    assert.notEqual(squadA.tenant_id, squadB.tenant_id);
    assert.equal((await pool.query('SELECT 1 FROM team_members WHERE pubg_account_id=$1', [`account.alice_${suffix.replaceAll('-', '')}`])).rowCount, 2);
    assert.match((await send(group(guildB, `other-${channelB}`, actorB, `/pubg bind ${squadA.team_id}`))).content, /当前服务器/u);
    const list = await send(group(guildA, channelA, actorA, '/pubg teams'));
    assert.ok(list.content.includes(squadA.team_id)); assert.equal(list.content.includes(squadB.team_id), false);
    const bind = await send(group(guildA, channelA2, actorA, `/pubg bind ${squadA.team_id}`)); await send(click(channelA2, actorA, token(bind)));
    assert.equal((await pool.query('SELECT 1 FROM channel_bindings WHERE tenant_id=$1', [squadA.tenant_id])).rowCount, 2);
    const add = await send(group(guildA, channelA2, actorA, '/pubg add Charlie')); await send(click(channelA2, actorA, token(add)));
    assert.equal((await pool.query('SELECT 1 FROM team_members WHERE tenant_id=$1 AND team_id=$2', [squadA.tenant_id, squadA.team_id])).rowCount, 3);
    assert.equal((await pool.query("SELECT display_name FROM pubg_accounts WHERE shard='steam' AND account_id=$1", [`account.charlie_${suffix.replaceAll('-', '')}`])).rows[0]?.display_name, 'Charlie');
    const replace = await send(group(guildA, channelA2, actorA, '/pubg roster Bob')); await send(click(channelA2, actorA, token(replace)));
    assert.deepEqual((await pool.query('SELECT pubg_account_id FROM team_members WHERE tenant_id=$1 AND team_id=$2', [squadA.tenant_id, squadA.team_id])).rows, [{ pubg_account_id: `account.bob_${suffix.replaceAll('-', '')}` }]);

    const dm = (user: string) => ({ type: 1, channel_type: 'PERSON', target_id: bot, author_id: user, content: '/pubg claim steam Alice', msg_id: randomUUID(), msg_timestamp: Date.now() });
    const privateClaim = await send(dm(actorA));
    assert.match(privateClaim.content, /队伍群聊中/u);
    assert.equal((await pool.query('SELECT 1 FROM account_claims WHERE bot_account_id=$1', [bot])).rowCount, 0);

    // A previously issued setup cannot become valid again after another bind/unbind cycle.
    const staleEvent = group(guildA, `stale-${suffix}`, actorA, '/pubg create steam Old Alice');
    const stale = await send(staleEvent);
    const trusted = parseTrustedKookGroupMessage({ s: 0, d: staleEvent }, bot)!;
    await teams.bindExistingSquad(trusted, squadA.team_id);
    const unbind = await teams.prepareTeamAction(trusted, { kind: 'unbind_channel' }); await teams.confirmTeamAction(trusted, unbind.confirmationToken);
    assert.match((await send(click(staleEvent.target_id, actorA, token(stale)))).content, /失效/u);

    const replacementEvent = group(guildA, `replacement-${suffix}`, actorA, '/pubg status');
    const replacement = await teams.createSquad(parseTrustedKookGroupMessage({ s: 0, d: replacementEvent }, bot)!, { label: 'Other Team', pubgShard: 'steam', pubgAccountIds: [`account.dave_${suffix.replaceAll('-', '')}`] });
    duringLookup = async () => { await pool.query('UPDATE channel_bindings SET team_id=$1 WHERE tenant_id=$2 AND channel_id=$3', [replacement.teamId, replacement.tenantId, channelA2]); };
    const race = group(guildA, channelA2, actorA, '/pubg add Charlie');
    await queue.ingestGatewayEvent(race);
    assert.equal(await queue.processOne(handler, signal), 'dead');
    assert.equal((await pool.query('SELECT 1 FROM pending_team_actions WHERE tenant_id=$1 AND team_id=$2 AND consumed_at IS NULL', [replacement.tenantId, replacement.teamId])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM team_members WHERE tenant_id=$1 AND team_id=$2', [replacement.tenantId, replacement.teamId])).rowCount, 1);
  } finally {
    await pool.query('DELETE FROM message_outbox WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM kook_ingress_events WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM pending_squad_setups WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM pending_account_claims WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM account_claims WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM tenants WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM channel_identities WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM channel_binding_versions WHERE bot_account_id=$1', [bot]);
    await pool.end();
  }
});
