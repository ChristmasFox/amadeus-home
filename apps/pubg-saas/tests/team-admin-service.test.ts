import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { migratePublicDatabase, parseTrustedKookGroupMessage, TeamAdminService } from '../src/index.js';

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

test('team administration verifies current guild privilege and commits tenant/team/channel/member state atomically', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const suffix = randomUUID();
  const botId = `bot-${suffix}`;
  const guildA = `guild-a-${suffix}`;
  const guildB = `guild-b-${suffix}`;
  const userA = `user-a-${suffix}`;
  const userB = `user-b-${suffix}`;
  const channelA = `channel-a-${suffix}`;
  const channelB = `channel-b-${suffix}`;
  const channelA2 = `channel-a2-${suffix}`;
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
  const eventB = groupEvent(guildB, channelB, userB, botId);
  assert.ok(eventA && eventA2 && eventB);

  try {
    await migratePublicDatabase(pool);
    await assert.rejects(
      service.createSquad(eventA, { label: 'Same Name', platform: 'steam', pubgAccountIds: [`p1-${suffix}`] }),
      /guild_admin_required/u,
    );
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM tenants WHERE guild_id = ANY($1::text[])', [[guildA, guildB]])).rows[0]?.count), 0);

    permitted = true;
    const squadA = await service.createSquad(eventA, {
      label: 'Same Name',
      platform: 'steam',
      pubgAccountIds: [`p1-${suffix}`, `p2-${suffix}`],
    });
    const membersA = await pool.query('SELECT pubg_account_id FROM team_members WHERE tenant_id=$1 AND team_id=$2 ORDER BY pubg_account_id', [squadA.tenantId, squadA.teamId]);
    assert.equal(membersA.rowCount, 2);
    const channelBindingA = await pool.query('SELECT team_id FROM channel_bindings WHERE tenant_id=$1 AND channel_id=$2', [squadA.tenantId, channelA]);
    assert.equal(channelBindingA.rows[0]?.team_id, squadA.teamId);

    assert.deepEqual(await service.bindExistingSquad(eventA2, squadA.teamId), squadA);
    await assert.rejects(service.bindExistingSquad(eventB, squadA.teamId), /team_unavailable_in_guild/u);

    assert.deepEqual(await service.addMembersToBoundSquad(eventA, [`p3-${suffix}`]), squadA);
    await assert.rejects(
      service.addMembersToBoundSquad(eventA, [`p4-${suffix}`, `p5-${suffix}`]),
      /team_roster_limit_exceeded/u,
    );
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM team_members WHERE tenant_id=$1 AND team_id=$2', [squadA.tenantId, squadA.teamId])).rows[0]?.count), 3);

    await assert.rejects(
      service.createSquad(eventA, { label: 'Rollback', platform: 'steam', pubgAccountIds: [`p9-${suffix}`] }),
      /channel_binding_conflict/u,
    );
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM teams WHERE tenant_id=$1', [squadA.tenantId])).rows[0]?.count), 1);

    const squadB = await service.createSquad(eventB, {
      label: 'Same Name',
      platform: 'steam',
      pubgAccountIds: [`p1-${suffix}`, `p2-${suffix}`],
    });
    assert.notEqual(squadA.tenantId, squadB.tenantId);
    assert.equal((await pool.query('SELECT COUNT(*) AS count FROM teams WHERE label=$1', ['Same Name'])).rows[0]?.count, '2');
    assert.equal(permissionChecks, 8);
  } finally {
    await pool.query('DELETE FROM tenants WHERE guild_id = ANY($1::text[])', [[guildA, guildB]]).catch(() => undefined);
    await pool.query('DELETE FROM channel_identities WHERE platform=$1 AND bot_account_id=$2 AND user_id = ANY($3::text[])', ['kook', botId, [userA, userB]]).catch(() => undefined);
    await pool.end();
  }
});
