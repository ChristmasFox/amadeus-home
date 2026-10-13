import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { AccountClaimService, createKookManagementHandler, KookIngressQueue, migratePublicDatabase, parseTrustedKookDirectMessage, parseTrustedKookGroupMessage, TeamAdminService } from '../src/index.js';
const databaseUrl = process.env.PUBG_SAAS_TEST_DATABASE_URL;
test('management confirms unbind/unclaim once and recovers receipts after a crash before reply completion', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 6 });
  const suffix = randomUUID();
  const bot = `bot-${suffix}`, guild = `guild-${suffix}`, channel = `channel-${suffix}`, actor = `actor-${suffix}`, other = `other-${suffix}`;
  const group = { type: 1, channel_type: 'GROUP', target_id: channel, author_id: actor, content: '/pubg unbind', msg_id: `prepare-${suffix}`, msg_timestamp: Date.now(), extra: { guild_id: guild, channel_type: 1, author: { id: actor, bot: false } } };
  const direct = { type: 1, channel_type: 'PERSON', target_id: bot, author_id: actor, content: '/pubg unclaim', msg_id: `dm-prepare-${suffix}`, msg_timestamp: Date.now() };
  const queue = new KookIngressQueue(pool, { botAccountId: bot, baseRetryMs: 1 });
  let permissionChecks = 0;
  const teams = new TeamAdminService(pool, { async isGuildAdmin(g, u) { permissionChecks++; return g === guild && u === actor; } });
  const claims = new AccountClaimService(pool);
  const handler = createKookManagementHandler({ teams, claims });
  const signal = new AbortController().signal;
  try {
    await migratePublicDatabase(pool);
    const squad = await teams.createSquad(parseTrustedKookGroupMessage({ s: 0, d: group }, bot)!, { label: 'Fixture Squad', pubgShard: 'steam', pubgAccountIds: [`account-${suffix}`] });
    assert.equal(await queue.ingestGatewayEvent(group), 'accepted');
    assert.equal(await queue.processOne(handler, signal), 'done');
    const card = (await pool.query("SELECT payload_json FROM message_outbox WHERE bot_account_id=$1 AND target_kind='channel'", [bot])).rows[0]?.payload_json;
    const teamToken = (JSON.parse(card.content) as Array<{
      modules: Array<{
        elements?: Array<{
          value: string;
        }>;
      }>;
    }>)[0]?.modules[2]?.elements?.[0]?.value;
    assert.ok(teamToken?.startsWith('team:'));
    const click = { type: 255, channel_type: 'PERSON', msg_id: `click-${suffix}`, msg_timestamp: Date.now(), extra: { type: 'message_btn_click', body: { user_id: actor, msg_id: 'original-card', target_id: channel, value: teamToken } } };
    assert.equal(await queue.ingestGatewayEvent(click), 'accepted');
    assert.equal(await queue.processOne(async (job, s) => { await handler(job, s); throw new Error('simulated crash after commit'); }, signal), 'retry');
    assert.equal((await pool.query('SELECT 1 FROM channel_bindings WHERE bot_account_id=$1', [bot])).rowCount, 0);
    await pool.query("UPDATE kook_ingress_events SET next_attempt_at=now() WHERE bot_account_id=$1 AND event_id=$2", [bot, click.msg_id]);
    assert.equal(await queue.processOne(handler, signal), 'done');
    const receipt = (await pool.query("SELECT payload_json,target_id FROM message_outbox WHERE bot_account_id=$1 AND target_kind='direct'", [bot])).rows[0];
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
    assert.equal(permissionChecks, 5); // create, prepare, mutation, exact recovery, new-click denial
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
