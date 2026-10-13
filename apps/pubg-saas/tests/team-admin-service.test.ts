import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { migratePublicDatabase, parseTrustedKookButtonClick, parseTrustedKookGroupMessage, TeamAdminService } from '../src/index.js';

const databaseUrl = process.env.PUBG_SAAS_TEST_DATABASE_URL;

function groupEvent(guildId: string, channelId: string, userId: string, botId: string) {
  return parseTrustedKookGroupMessage({
    s: 0,
    d: {
      channel_type: 'GROUP',
      type: 1,
      target_id: channelId,
      author_id: userId,
      content: 'admin action',
      msg_id: randomUUID(),
      msg_timestamp: Date.now(),
      extra: { guild_id: guildId, channel_type: 1, author: { id: userId, bot: false, roles: [] } },
    },
  }, botId)!;
}

test('team administration checks fresh privilege and scopes one-use confirmations to actor, channel and guild', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const suffix = randomUUID();
  const botId = `bot-${suffix}`;
  const guildA = `guild-a-${suffix}`;
  const guildB = `guild-b-${suffix}`;
  const userA = `user-a-${suffix}`;
  const userB = `user-b-${suffix}`;
  const channelA = `channel-a-${suffix}`;
  const channelA2 = `channel-a2-${suffix}`;
  const channelA3 = `channel-a3-${suffix}`;
  const channelA4 = `channel-a4-${suffix}`;
  const channelB = `channel-b-${suffix}`;
  let permitted = false;
  let permissionChecks = 0;
  const service = new TeamAdminService(pool, {
    async isGuildAdmin(guildId, userId) {
      permissionChecks += 1;
      return permitted && ((guildId === guildA && userId === userA) || (guildId === guildB && userId === userB));
    },
  });
  const eventA = groupEvent(guildA, channelA, userA, botId);
  const eventA2 = groupEvent(guildA, channelA2, userA, botId);
  const eventA3 = groupEvent(guildA, channelA3, userA, botId);
  const eventA4 = groupEvent(guildA, channelA4, userA, botId);
  const eventB = groupEvent(guildB, channelB, userB, botId);
  assert.ok(eventA && eventA2 && eventA3 && eventA4 && eventB);

  try {
    await migratePublicDatabase(pool);
    await assert.rejects(
      service.createSquad(eventA, { label: 'Same Name', pubgShard: 'steam', pubgAccountIds: [`p1-${suffix}`] }),
      /guild_admin_required/u,
    );
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM tenants WHERE guild_id = ANY($1::text[])', [[guildA, guildB]])).rows[0]?.count), 0);

    permitted = true;
    const squadA = await service.createSquad(eventA, {
      label: 'Same Name',
      pubgShard: 'steam',
      pubgAccountIds: [`p1-${suffix}`, `p2-${suffix}`],
    });
    const storedShard = await pool.query('SELECT pubg_shard FROM teams WHERE tenant_id=$1 AND team_id=$2', [squadA.tenantId, squadA.teamId]);
    assert.equal(storedShard.rows[0]?.pubg_shard, 'steam');
    const membersA = await pool.query('SELECT pubg_account_id FROM team_members WHERE tenant_id=$1 AND team_id=$2 ORDER BY pubg_account_id', [squadA.tenantId, squadA.teamId]);
    assert.equal(membersA.rowCount, 2);
    const channelBindingA = await pool.query('SELECT team_id FROM channel_bindings WHERE tenant_id=$1 AND channel_id=$2', [squadA.tenantId, channelA]);
    assert.equal(channelBindingA.rows[0]?.team_id, squadA.teamId);
    assert.deepEqual(await service.getBoundTeamStatus(eventA), {
      ...squadA,
      label: 'Same Name',
      pubgShard: 'steam',
      pubgAccountIds: [`p1-${suffix}`, `p2-${suffix}`],
      boundChannelCount: 1,
    });

    assert.deepEqual(await service.bindExistingSquad(eventA2, squadA.teamId), squadA);
    await assert.rejects(service.bindExistingSquad(eventB, squadA.teamId), /team_unavailable_in_guild/u);

    const addP3 = await service.prepareTeamAction(eventA, { kind: 'add_members', pubgAccountIds: [`p3-${suffix}`] });
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM team_members WHERE tenant_id=$1 AND team_id=$2', [squadA.tenantId, squadA.teamId])).rows[0]?.count), 2);
    await assert.rejects(service.confirmTeamAction(eventA2, addP3.confirmationToken), /team_action_confirmation_unavailable/u);
    await assert.rejects(service.confirmTeamAction(eventB, addP3.confirmationToken), /team_action_confirmation_unavailable/u);
    assert.deepEqual(await service.confirmTeamAction(eventA, addP3.confirmationToken), { kind: 'add_members', team: squadA });
    await assert.rejects(service.confirmTeamAction(eventA, addP3.confirmationToken), /team_action_confirmation_unavailable/u);

    const addP4 = await service.prepareTeamAction(eventA, { kind: 'add_members', pubgAccountIds: [`p4-${suffix}`] });
    const addP5 = await service.prepareTeamAction(eventA, { kind: 'add_members', pubgAccountIds: [`p5-${suffix}`] });
    await service.confirmTeamAction(eventA, addP4.confirmationToken);
    await assert.rejects(service.confirmTeamAction(eventA, addP5.confirmationToken), /team_roster_limit_exceeded/u);
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM team_members WHERE tenant_id=$1 AND team_id=$2', [squadA.tenantId, squadA.teamId])).rows[0]?.count), 4);

    const replace = await service.prepareTeamAction(eventA, { kind: 'replace_roster', pubgAccountIds: [`p1-${suffix}`, `p3-${suffix}`] });
    await service.confirmTeamAction(eventA, replace.confirmationToken);
    const replacedRoster = await pool.query('SELECT pubg_account_id FROM team_members WHERE tenant_id=$1 AND team_id=$2 ORDER BY pubg_account_id', [squadA.tenantId, squadA.teamId]);
    assert.deepEqual(replacedRoster.rows.map((row) => row.pubg_account_id), [`p1-${suffix}`, `p3-${suffix}`]);

    const buttonAction = await service.prepareTeamAction(eventA, { kind: 'add_members', pubgAccountIds: [`p6-${suffix}`] });
    const buttonEvent = (userId: string) => parseTrustedKookButtonClick({
      s: 0,
      d: {
        type: 255,
        channel_type: 'PERSON',
        msg_timestamp: Date.now(),
        extra: {
          type: 'message_btn_click',
          body: { msg_id: `card-${suffix}`, user_id: userId, value: buttonAction.confirmationToken, target_id: channelA },
        },
      },
    }, botId)!;
    await assert.rejects(service.confirmTeamActionFromButton(buttonEvent(userB)), /guild_admin_required/u);
    assert.deepEqual(await service.confirmTeamActionFromButton(buttonEvent(userA)), { kind: 'add_members', team: squadA });
    await assert.rejects(service.confirmTeamActionFromButton(buttonEvent(userA)), /team_action_confirmation_unavailable/u);

    await assert.rejects(
      service.createSquad(eventA, { label: 'Rollback', pubgShard: 'steam', pubgAccountIds: [`p9-${suffix}`] }),
      /channel_binding_conflict/u,
    );
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM teams WHERE tenant_id=$1', [squadA.tenantId])).rows[0]?.count), 1);

    const disposable = await service.createSquad(eventA3, {
      label: 'Disposable',
      pubgShard: 'steam',
      pubgAccountIds: [`p9-${suffix}`],
    });
    const pendingDisband = await service.prepareTeamAction(eventA3, { kind: 'disband_team' });
    await pool.query(
      `INSERT INTO message_inbox(platform,bot_account_id,source_event_id,tenant_id,team_id,channel_id)
       VALUES ('kook',$1,$2,$3,$4,$5)`,
      [botId, `inbox-${suffix}`, disposable.tenantId, disposable.teamId, channelA3],
    );
    await pool.query(
      `INSERT INTO message_outbox(outbox_id,idempotency_key,platform,bot_account_id,tenant_id,team_id,channel_id,target_id,payload_json,status)
       VALUES ($1,$2,'kook',$3,$4,$5,$6,$6,'{"content":"synthetic"}'::jsonb,'pending')`,
      [`outbox-${suffix}`, `outbox-key-${suffix}`, botId, disposable.tenantId, disposable.teamId, channelA3],
    );
    await pool.query(
      `INSERT INTO result_sets(tenant_id,team_id,platform,bot_account_id,user_id,channel_id,session_id,result_set_id,expires_at,result_json)
       VALUES ($1,$2,'kook',$3,$4,$5,$6,$7,now() + interval '1 hour','{}'::jsonb)`,
      [disposable.tenantId, disposable.teamId, botId, userA, channelA3, `session-${suffix}`, `result-${suffix}`],
    );
    await pool.query(
      `INSERT INTO session_contexts(tenant_id,team_id,platform,bot_account_id,user_id,channel_id,session_id,expires_at,context_json)
       VALUES ($1,$2,'kook',$3,$4,$5,$6,now() + interval '1 hour','{}'::jsonb)`,
      [disposable.tenantId, disposable.teamId, botId, userA, channelA3, `session-${suffix}`],
    );
    await pool.query(
      `INSERT INTO sync_state(tenant_id,team_id,state_key,checked_at,state_json) VALUES ($1,$2,$3,now(),'{}'::jsonb)`,
      [disposable.tenantId, disposable.teamId, `sync-${suffix}`],
    );
    await pool.query(
      `INSERT INTO telemetry_prefetch_runs(
         tenant_id,team_id,run_id,report_date,started_at,finished_at,trigger,discovered_match_count,
         new_match_count,candidate_match_count,fetched_count,cache_hit_count,unavailable_count,pending_count
       ) VALUES ($1,$2,$3,'2026-10-13',now(),now(),'test',0,0,0,0,0,0,0)`,
      [disposable.tenantId, disposable.teamId, `run-${suffix}`],
    );
    assert.deepEqual(await service.confirmTeamAction(eventA3, pendingDisband.confirmationToken), { kind: 'disband_team', team: disposable });
    assert.equal((await pool.query('SELECT 1 FROM teams WHERE tenant_id=$1 AND team_id=$2', [disposable.tenantId, disposable.teamId])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM message_inbox WHERE source_event_id=$1', [`inbox-${suffix}`])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM message_outbox WHERE outbox_id=$1', [`outbox-${suffix}`])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM result_sets WHERE result_set_id=$1', [`result-${suffix}`])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM session_contexts WHERE session_id=$1', [`session-${suffix}`])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM sync_state WHERE state_key=$1', [`sync-${suffix}`])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM telemetry_prefetch_runs WHERE run_id=$1', [`run-${suffix}`])).rowCount, 0);
    await assert.rejects(service.confirmTeamAction(eventA3, pendingDisband.confirmationToken), /team_action_confirmation_unavailable/u);

    const unbindOnly = await service.createSquad(eventA4, {
      label: 'Unbind Only',
      pubgShard: 'steam',
      pubgAccountIds: [`p10-${suffix}`],
    });
    await pool.query(
      `INSERT INTO message_inbox(platform,bot_account_id,source_event_id,tenant_id,team_id,channel_id)
       VALUES ('kook',$1,$2,$3,$4,$5)`,
      [botId, `inbox-unbind-${suffix}`, unbindOnly.tenantId, unbindOnly.teamId, channelA4],
    );
    await pool.query(
      `INSERT INTO message_outbox(outbox_id,idempotency_key,platform,bot_account_id,tenant_id,team_id,channel_id,target_id,payload_json,status)
       VALUES ($1,$2,'kook',$3,$4,$5,$6,$6,'{"content":"synthetic"}'::jsonb,'pending')`,
      [`outbox-unbind-${suffix}`, `outbox-unbind-key-${suffix}`, botId, unbindOnly.tenantId, unbindOnly.teamId, channelA4],
    );
    await pool.query(
      `INSERT INTO result_sets(tenant_id,team_id,platform,bot_account_id,user_id,channel_id,session_id,result_set_id,expires_at,result_json)
       VALUES ($1,$2,'kook',$3,$4,$5,$6,$7,now() + interval '1 hour','{}'::jsonb)`,
      [unbindOnly.tenantId, unbindOnly.teamId, botId, userA, channelA4, `session-unbind-${suffix}`, `result-unbind-${suffix}`],
    );
    await pool.query(
      `INSERT INTO session_contexts(tenant_id,team_id,platform,bot_account_id,user_id,channel_id,session_id,expires_at,context_json)
       VALUES ($1,$2,'kook',$3,$4,$5,$6,now() + interval '1 hour','{}'::jsonb)`,
      [unbindOnly.tenantId, unbindOnly.teamId, botId, userA, channelA4, `session-unbind-${suffix}`],
    );
    const pendingUnbind = await service.prepareTeamAction(eventA4, { kind: 'unbind_channel' });
    assert.deepEqual(await service.confirmTeamAction(eventA4, pendingUnbind.confirmationToken), { kind: 'unbind_channel', team: unbindOnly });
    assert.equal((await pool.query('SELECT 1 FROM channel_bindings WHERE tenant_id=$1 AND channel_id=$2', [unbindOnly.tenantId, channelA4])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM teams WHERE tenant_id=$1 AND team_id=$2', [unbindOnly.tenantId, unbindOnly.teamId])).rowCount, 1);
    assert.equal((await pool.query('SELECT 1 FROM message_inbox WHERE source_event_id=$1', [`inbox-unbind-${suffix}`])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM message_outbox WHERE outbox_id=$1', [`outbox-unbind-${suffix}`])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM result_sets WHERE result_set_id=$1', [`result-unbind-${suffix}`])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM session_contexts WHERE session_id=$1', [`session-unbind-${suffix}`])).rowCount, 0);

    const squadB = await service.createSquad(eventB, {
      label: 'Same Name',
      pubgShard: 'steam',
      pubgAccountIds: [`p1-${suffix}`, `p2-${suffix}`],
    });
    assert.notEqual(squadA.tenantId, squadB.tenantId);
    assert.equal((await pool.query('SELECT COUNT(*) AS count FROM teams WHERE label=$1', ['Same Name'])).rows[0]?.count, '2');
    assert.equal(permissionChecks, 29);
  } finally {
    await pool.query('DELETE FROM tenants WHERE guild_id = ANY($1::text[])', [[guildA, guildB]]).catch(() => undefined);
    await pool.query('DELETE FROM channel_identities WHERE platform=$1 AND bot_account_id=$2 AND user_id = ANY($3::text[])', ['kook', botId, [userA, userB]]).catch(() => undefined);
    await pool.end();
  }
});
