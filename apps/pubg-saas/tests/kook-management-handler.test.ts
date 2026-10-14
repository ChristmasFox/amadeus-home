import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { AccountClaimService, createKookManagementHandler, KOOK_PUBLIC_PRIVACY_NOTICE, KookIngressQueue, migratePublicDatabase, parseTrustedKookDirectMessage, parseTrustedKookGroupMessage, TeamAdminService } from '../src/index.js';
import { parseKookRequest } from '../src/channels/kook/request-event.js';
import { parseKookManagementCommand } from '../src/channels/kook/management-command.js';
import type { KookIngressJob, KookOnboardingServices } from '../src/index.js';
const databaseUrl = process.env.PUBG_SAAS_TEST_DATABASE_URL;

function teamConfirmationToken(payload: unknown): string | undefined {
  const card = typeof payload === 'string' ? JSON.parse(payload) as { content?: unknown } : payload as { content?: unknown };
  if (typeof card?.content !== 'string') return undefined;
  const modules = JSON.parse(card.content) as Array<{ modules?: Array<{ elements?: Array<{ value?: string }> }> }>;
  return modules[0]?.modules?.[2]?.elements?.[0]?.value;
}

test('privacy help is available in DMs and unbound groups without database or model calls', async () => {
  assert.deepEqual(parseKookManagementCommand('/pubg privacy'), { kind: 'privacy' });
  assert.deepEqual(parseKookManagementCommand('/pubg preference'), { kind: 'preference' });
  assert.deepEqual(parseKookManagementCommand('/pubg preference kills'), { kind: 'preference_set', metric: 'kills' });
  assert.deepEqual(parseKookManagementCommand('/pubg preference delete'), { kind: 'preference_delete' });
  assert.deepEqual(parseKookManagementCommand('/pubg preference tenant-other'), { kind: 'invalid' });
  assert.deepEqual(parseKookManagementCommand('/pubg alias set "Alice Smith" Captain'), { kind: 'alias_set', playerName: 'Alice Smith', alias: 'Captain' });
  assert.deepEqual(parseKookManagementCommand('/pubg alias delete Captain'), { kind: 'alias_delete', alias: 'Captain' });
  assert.deepEqual(parseKookManagementCommand('/pubg alias list'), { kind: 'alias_list' });
  assert.deepEqual(parseKookManagementCommand('/pubg me "Player One"'), { kind: 'me', name: 'Player One' });
  assert.match(KOOK_PUBLIC_PRIVACY_NOTICE, /默认排行榜指标.*管理员标识.*preference delete.*查询别名.*alias delete/u);
  const handler = createKookManagementHandler({} as unknown as KookOnboardingServices);
  const bot = 'privacy-bot';
  for (const kind of ['direct', 'group'] as const) {
    const event = {
      type: 1,
      channel_type: kind === 'direct' ? 'PERSON' : 'GROUP',
      target_id: kind === 'direct' ? bot : 'privacy-channel',
      author_id: 'privacy-actor',
      content: '/pubg privacy',
      msg_id: `privacy-${kind}`,
      msg_timestamp: Date.now(),
      ...(kind === 'group' ? { extra: { guild_id: 'privacy-guild', channel_type: 1, author: { id: 'privacy-actor', bot: false } } } : {}),
    };
    const parsed = parseKookRequest(event, bot);
    assert.ok(parsed);
    const job: KookIngressJob = {
      botAccountId: bot,
      eventId: parsed.eventId,
      leaseToken: 'fixture-lease',
      attemptCount: 1,
      request: parsed.request,
      bindingRevision: null,
      boundTeam: null,
    };
    assert.deepEqual(await handler(job, new AbortController().signal), {
      type: 'text',
      content: KOOK_PUBLIC_PRIVACY_NOTICE,
    });
  }
});

test('management confirms unbind/unclaim once and recovers receipts after a crash before reply completion', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 6 });
  const suffix = randomUUID();
  const bot = `bot-${suffix}`, guild = `guild-${suffix}`, channel = `channel-${suffix}`, actor = `actor-${suffix}`, other = `other-${suffix}`;
  const preferenceSetActor = `prefset-${suffix}`, preferenceDeleteActor = `prefdel-${suffix}`;
  const aliasSetActor = `alias-set-${suffix}`, aliasDeleteActor = `alias-del-${suffix}`;
  const group = { type: 1, channel_type: 'GROUP', target_id: channel, author_id: actor, content: '/pubg unbind', msg_id: `prepare-${suffix}`, msg_timestamp: Date.now(), extra: { guild_id: guild, channel_type: 1, author: { id: actor, bot: false } } };
  const direct = { type: 1, channel_type: 'PERSON', target_id: bot, author_id: actor, content: '/pubg unclaim', msg_id: `dm-prepare-${suffix}`, msg_timestamp: Date.now() };
  const queue = new KookIngressQueue(pool, { botAccountId: bot, baseRetryMs: 1 });
  let permissionChecks = 0;
  const admins = new Set([actor, preferenceSetActor, preferenceDeleteActor, aliasSetActor, aliasDeleteActor]);
  const teams = new TeamAdminService(pool, { async isGuildAdmin(g, u) { permissionChecks++; return g === guild && admins.has(u); } });
  const claims = new AccountClaimService(pool);
  const handler = createKookManagementHandler({ teams, claims });
  const signal = new AbortController().signal;
  try {
    await migratePublicDatabase(pool);
    const squad = await teams.createSquad(parseTrustedKookGroupMessage({ s: 0, d: group }, bot)!, { label: 'Fixture Squad', pubgShard: 'steam', pubgAccountIds: [`account-${suffix}`] });
    const preferenceSetEvent = { ...group, author_id: preferenceSetActor, extra: { ...group.extra, author: { ...group.extra.author, id: preferenceSetActor } }, content: '/pubg preference kills', msg_id: `pref-set-${suffix}` };
    assert.equal(await queue.ingestGatewayEvent(preferenceSetEvent), 'accepted');
    assert.equal(await queue.processOne(handler, signal), 'done');
    const preferenceCard = (await pool.query('SELECT payload_json FROM message_outbox WHERE bot_account_id=$1 AND target_kind=\'channel\' ORDER BY created_at DESC LIMIT 1', [bot])).rows[0]?.payload_json;
    const preferenceToken = teamConfirmationToken(preferenceCard);
    assert.ok(preferenceToken?.startsWith('team:'));
    const preferenceClick = { type: 255, channel_type: 'PERSON', msg_id: `pref-click-${suffix}`, msg_timestamp: Date.now(), extra: { type: 'message_btn_click', body: { user_id: preferenceSetActor, msg_id: 'preference-card', target_id: channel, value: preferenceToken } } };
    assert.equal(await queue.ingestGatewayEvent(preferenceClick), 'accepted');
    assert.equal(await queue.processOne(handler, signal), 'done');
    assert.deepEqual((await pool.query("SELECT preference_json,updated_by_user_id FROM team_preferences WHERE tenant_id=$1 AND team_id=$2 AND preference_key='leaderboard_metric'", [squad.tenantId, squad.teamId])).rows[0], { preference_json: { metric: 'kills' }, updated_by_user_id: preferenceSetActor });
    const preferenceShowEvent = { ...group, content: '/pubg preference', msg_id: `pref-show-${suffix}` };
    assert.equal(await queue.ingestGatewayEvent(preferenceShowEvent), 'accepted');
    assert.equal(await queue.processOne(handler, signal), 'done');
    const preferenceShow = (await pool.query('SELECT payload_json FROM message_outbox WHERE bot_account_id=$1 AND target_kind=\'channel\' ORDER BY created_at DESC LIMIT 1', [bot])).rows[0]?.payload_json;
    assert.match(preferenceShow.content, /默认排行榜：击杀榜/u);
    const preferenceDeleteEvent = { ...group, author_id: preferenceDeleteActor, extra: { ...group.extra, author: { ...group.extra.author, id: preferenceDeleteActor } }, content: '/pubg preference delete', msg_id: `pref-delete-${suffix}` };
    assert.equal(await queue.ingestGatewayEvent(preferenceDeleteEvent), 'accepted');
    assert.equal(await queue.processOne(handler, signal), 'done');
    const preferenceDeleteCard = (await pool.query('SELECT payload_json FROM message_outbox WHERE bot_account_id=$1 AND target_kind=\'channel\' ORDER BY created_at DESC LIMIT 1', [bot])).rows[0]?.payload_json;
    const preferenceDeleteToken = teamConfirmationToken(preferenceDeleteCard);
    assert.ok(preferenceDeleteToken?.startsWith('team:'));
    const preferenceDeleteClick = { ...preferenceClick, msg_id: `pref-delete-click-${suffix}`, extra: { ...preferenceClick.extra, body: { ...preferenceClick.extra.body, user_id: preferenceDeleteActor, value: preferenceDeleteToken } } };
    assert.equal(await queue.ingestGatewayEvent(preferenceDeleteClick), 'accepted');
    assert.equal(await queue.processOne(handler, signal), 'done');
    assert.equal((await pool.query("SELECT 1 FROM team_preferences WHERE tenant_id=$1 AND team_id=$2 AND preference_key='leaderboard_metric'", [squad.tenantId, squad.teamId])).rowCount, 0);
    const aliasSetEvent = { ...group, author_id: aliasSetActor, extra: { ...group.extra, author: { ...group.extra.author, id: aliasSetActor } }, content: `/pubg alias set account-${suffix} Captain`, msg_id: `alias-set-${suffix}` };
    assert.equal(await queue.ingestGatewayEvent(aliasSetEvent), 'accepted');
    assert.equal(await queue.processOne(handler, signal), 'done');
    const aliasCard = (await pool.query("SELECT payload_json FROM message_outbox WHERE bot_account_id=$1 AND target_kind='channel' AND payload_json->>'content' LIKE '%确认添加队员别名%' ORDER BY created_at DESC LIMIT 1", [bot])).rows[0]?.payload_json;
    const aliasToken = teamConfirmationToken(aliasCard);
    assert.ok(aliasToken?.startsWith('team:'));
    const aliasClick = { ...preferenceClick, msg_id: `alias-click-${suffix}`, extra: { ...preferenceClick.extra, body: { ...preferenceClick.extra.body, user_id: aliasSetActor, value: aliasToken } } };
    assert.equal(await queue.ingestGatewayEvent(aliasClick), 'accepted');
    assert.equal(await queue.processOne(handler, signal), 'done');
    assert.equal((await pool.query("SELECT 1 FROM team_aliases WHERE tenant_id=$1 AND team_id=$2 AND alias_key='captain' AND pubg_account_id=$3", [squad.tenantId, squad.teamId, `account-${suffix}`])).rowCount, 1);
    const aliasListEvent = { ...group, content: '/pubg alias list', msg_id: `alias-list-${suffix}` };
    assert.equal(await queue.ingestGatewayEvent(aliasListEvent), 'accepted');
    assert.equal(await queue.processOne(handler, signal), 'done');
    const aliasList = (await pool.query("SELECT payload_json FROM message_outbox WHERE bot_account_id=$1 AND target_kind='channel' AND payload_json->>'content' LIKE '%本队伍的查询别名%' ORDER BY created_at DESC LIMIT 1", [bot])).rows[0]?.payload_json;
    assert.match(aliasList.content, /Captain/u);
    const aliasDeleteEvent = { ...group, author_id: aliasDeleteActor, extra: { ...group.extra, author: { ...group.extra.author, id: aliasDeleteActor } }, content: '/pubg alias delete Captain', msg_id: `alias-delete-${suffix}` };
    assert.equal(await queue.ingestGatewayEvent(aliasDeleteEvent), 'accepted');
    assert.equal(await queue.processOne(handler, signal), 'done');
    const aliasDeleteCard = (await pool.query("SELECT payload_json FROM message_outbox WHERE bot_account_id=$1 AND target_kind='channel' AND payload_json->>'content' LIKE '%确认删除队员别名%' ORDER BY created_at DESC LIMIT 1", [bot])).rows[0]?.payload_json;
    const aliasDeleteToken = teamConfirmationToken(aliasDeleteCard);
    assert.ok(aliasDeleteToken?.startsWith('team:'));
    const aliasDeleteClick = { ...aliasClick, msg_id: `alias-delete-click-${suffix}`, extra: { ...aliasClick.extra, body: { ...aliasClick.extra.body, user_id: aliasDeleteActor, value: aliasDeleteToken } } };
    assert.equal(await queue.ingestGatewayEvent(aliasDeleteClick), 'accepted');
    assert.equal(await queue.processOne(handler, signal), 'done');
    assert.equal((await pool.query("SELECT 1 FROM team_aliases WHERE tenant_id=$1 AND team_id=$2 AND alias_key='captain'", [squad.tenantId, squad.teamId])).rowCount, 0);
    assert.equal(await queue.ingestGatewayEvent(group), 'accepted');
    assert.equal(await queue.processOne(handler, signal), 'done');
    const card = (await pool.query("SELECT payload_json FROM message_outbox WHERE bot_account_id=$1 AND target_kind='channel' AND payload_json->>'content' LIKE '%确认解绑频道%' ORDER BY created_at DESC LIMIT 1", [bot])).rows[0]?.payload_json;
    const teamToken = teamConfirmationToken(card);
    assert.ok(teamToken?.startsWith('team:'));
    const click = { type: 255, channel_type: 'PERSON', msg_id: `click-${suffix}`, msg_timestamp: Date.now(), extra: { type: 'message_btn_click', body: { user_id: actor, msg_id: 'original-card', target_id: channel, value: teamToken } } };
    assert.equal(await queue.ingestGatewayEvent(click), 'accepted');
    assert.equal(await queue.processOne(async (job, s) => { await handler(job, s); throw new Error('simulated crash after commit'); }, signal), 'retry');
    assert.equal((await pool.query('SELECT 1 FROM channel_bindings WHERE bot_account_id=$1', [bot])).rowCount, 0);
    await pool.query("UPDATE kook_ingress_events SET next_attempt_at=now() WHERE bot_account_id=$1 AND event_id=$2", [bot, click.msg_id]);
    assert.equal(await queue.processOne(handler, signal), 'done');
    const receipt = (await pool.query("SELECT payload_json,target_id FROM message_outbox WHERE bot_account_id=$1 AND target_kind='direct' AND payload_json->>'content' LIKE '%当前频道已解绑%' ORDER BY created_at DESC LIMIT 1", [bot])).rows[0];
    assert.equal(receipt?.target_id, actor);
    assert.match(receipt?.payload_json.content, /已解绑/u);
    assert.equal((await pool.query('SELECT 1 FROM teams WHERE tenant_id=$1 AND team_id=$2', [squad.tenantId, squad.teamId])).rowCount, 1);
    assert.deepEqual((await pool.query('SELECT payload_json FROM pending_team_actions WHERE bot_account_id=$1', [bot])).rows[0]?.payload_json, {});
    const freshClick = { ...click, msg_id: `new-click-${suffix}` };
    assert.equal(await queue.ingestGatewayEvent(freshClick), 'accepted');
    assert.equal(await queue.processOne(handler, signal), 'done');
    const replayReply = (await pool.query("SELECT payload_json FROM message_outbox WHERE bot_account_id=$1 ORDER BY created_at DESC LIMIT 1", [bot])).rows[0]?.payload_json;
    assert.match(replayReply.content, /失效/u);
    const dmEvent = parseTrustedKookDirectMessage({ s: 0, d: direct }, bot)!;
    const preparedClaim = await claims.prepareClaim(dmEvent, { pubgShard: 'steam', pubgAccountId: `account-${suffix}` });
    await claims.confirm(dmEvent, preparedClaim.confirmationToken);
    assert.equal(await queue.ingestGatewayEvent(direct), 'accepted');
    assert.equal(await queue.processOne(handler, signal), 'done');
    const claimCard = (await pool.query("SELECT payload_json FROM message_outbox WHERE bot_account_id=$1 AND payload_json->>'type'='card' ORDER BY created_at DESC LIMIT 1", [bot])).rows[0]?.payload_json;
    const claimToken = (JSON.parse(claimCard.content) as Array<{
      modules: Array<{
        elements?: Array<{
          value: string;
        }>;
      }>;
    }>)[0]?.modules[2]?.elements?.[0]?.value;
    assert.ok(claimToken?.startsWith('claim:'));
    const unclaimClick = { ...click, msg_id: `unclaim-${suffix}`, extra: { type: 'message_btn_click', body: { user_id: actor, msg_id: 'private-card', target_id: '', value: claimToken } } };
    assert.equal(await queue.ingestGatewayEvent(unclaimClick), 'accepted');
    assert.equal(await queue.processOne(async (job, s) => { await handler(job, s); throw new Error('simulated crash after unclaim'); }, signal), 'retry');
    assert.equal(await claims.getMyClaim(dmEvent), null);
    await pool.query("UPDATE kook_ingress_events SET next_attempt_at=now() WHERE bot_account_id=$1 AND event_id=$2", [bot, unclaimClick.msg_id]);
    assert.equal(await queue.processOne(handler, signal), 'done');
    const userMismatch = { ...unclaimClick, msg_id: `unauthorized-${suffix}`, extra: { ...unclaimClick.extra, body: { ...unclaimClick.extra.body, user_id: other } } };
    await queue.ingestGatewayEvent(userMismatch);
    assert.equal(await queue.processOne(handler, signal), 'done');
    const denied = (await pool.query("SELECT payload_json,target_id FROM message_outbox WHERE bot_account_id=$1 ORDER BY created_at DESC LIMIT 1", [bot])).rows[0];
    assert.equal(denied?.target_id, other);
    assert.match(denied?.payload_json.content, /失效/u);
    assert.equal(permissionChecks, 14); // create, preference and alias confirmation, unbind, recovery and new-click denial
  }
  finally {
    await pool.query('DELETE FROM message_outbox WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM kook_ingress_events WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM pending_account_claims WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM account_claims WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM tenants WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM channel_identities WHERE bot_account_id=$1', [bot]);
    await pool.end();
  }
});
