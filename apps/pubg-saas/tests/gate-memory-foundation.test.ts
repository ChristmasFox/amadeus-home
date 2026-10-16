import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { GateMemoryStore, rankGateMemories, validateGateMemoryDraft, migratePublicDatabase, KookIngressQueue, TeamAdminService, PublicQueryAuthorizer, parseTrustedKookGroupMessage } from '../src/index.js';
import type { GateMemoryScope, GateMemoryScopeResolver } from '../src/index.js';
import type { KookIngressJob } from '../src/application/kook-ingress-queue.js';

const url = process.env.PUBG_SAAS_TEST_DATABASE_URL;
if (process.env.CI === 'true' && !url) throw new Error('gate_memory_database_tests_must_not_skip_in_ci');
function fixtureJob(eventId: string): KookIngressJob {
  return { botAccountId: 'fixture', eventId, leaseToken: 'fixture',
    attemptCount: 1, bindingRevision: null, boundTeam: null,
    request: {} as KookIngressJob['request'] };
}

test('memory facts are bounded and keys are normalized', () => {
  assert.deepEqual(validateGateMemoryDraft({ key: ' Favorite_Map ', content: ' Erangel ' }),
    { key: 'favorite_map', content: 'Erangel' });
  assert.throws(() => validateGateMemoryDraft({ key: 'x', content: 'x'.repeat(801) }), /gate_memory_input_invalid/u);
  assert.throws(() => validateGateMemoryDraft({ key: 'x', content: 'bad\u0000fact' }), /gate_memory_input_invalid/u);
  assert.throws(() => rankGateMemories([], '', 1), /gate_memory_input_invalid/u);
  assert.throws(() => rankGateMemories([], 'test', 25), /gate_memory_limit_invalid/u);
});

test('Chinese bigrams recover related surface forms without claiming semantics', () => {
  const facts = [
    { key: 'favorite_map', content: '喜欢艾伦格地图', revision: 1, updatedAt: '2026-10-16' },
    { key: 'football', content: '喜欢看足球', revision: 1, updatedAt: '2026-10-16' },
  ];
  assert.deepEqual(rankGateMemories(facts, '喜欢艾伦格').map(e => e.key), ['favorite_map']);
  assert.deepEqual(rankGateMemories(facts, '在哪个地图玩得最多').map(e => e.key), ['favorite_map']);
  assert.deepEqual(rankGateMemories(facts, '平时踢什么球').map(e => e.key), []);
  assert.throws(() => validateGateMemoryDraft({ key: 'hidden', content: 'a\u200bb' }), /gate_memory_input_invalid/u);
  assert.throws(() => validateGateMemoryDraft({ key: 'rtl\u202e', content: 'ok' }), /gate_memory_input_invalid/u);
});

test('missing trusted ingress authority blocks every memory read/write before SQL', async () => {
  const denied = new GateMemoryStore({ query: async () => { throw new Error('sql_must_not_run'); } } as unknown as Pool,
    { resolveMemoryScope: async () => null });
  const job = fixtureJob('test');
  await assert.rejects(denied.listRecent(job), /gate_memory_scope_unavailable/u);
  await assert.rejects(denied.create(job, { key: 'k', content: 'value' }), /gate_memory_scope_unavailable/u);
  await assert.rejects(denied.forget(job, 'k'), /gate_memory_scope_unavailable/u);
});

test('real KOOK lease and scoped SQL guard isolate live DM and bound channel memories', { skip: !url }, async () => {
  const pool = new Pool({ connectionString: url, max: 5 });
  const id = randomUUID().replaceAll('-', '');
  const bot = 'bot-memory-' + id, actor = 'user-memory-' + id, guild = 'guild-memory-' + id,
    channel = 'channel-memory-' + id;
  const message = (eventId = randomUUID()) => ({
    s: 0, d: {
      type: 1, channel_type: 'GROUP', target_id: channel, author_id: actor, msg_id: eventId,
      msg_timestamp: Date.now(), content: '今晚打艾伦格',
      extra: { guild_id: guild, channel_type: 1, author: { id: actor, bot: false } },
    },
  });
  const dm = () => ({ s: 0, d: {
    type: 1, channel_type: 'PERSON', target_id: bot, author_id: actor, msg_id: randomUUID(),
    msg_timestamp: Date.now(), content: '我喜欢中文',
  } });
  let denied = false;
  let onMembershipCheck: (() => Promise<void>) | null = null;
  const permissions = {
    isGuildMember: async () => true,
    isTextChannelMember: async () => {
      if (onMembershipCheck) await onMembershipCheck();
      return !denied;
    },
  };
  const queue = new KookIngressQueue(pool, { botAccountId: bot });
  const auth = new PublicQueryAuthorizer(pool, permissions, { botAccountId: bot });
  const memory = new GateMemoryStore(pool, auth);
  try {
    await migratePublicDatabase(pool);
    const teams = new TeamAdminService(pool, { isGuildAdmin: async () => true });
    const setup = parseTrustedKookGroupMessage(message(), bot)!;
    const team = await teams.createSquad(setup, { label: 'Memory fixture', pubgShard: 'steam',
      pubgAccountIds: ['test-memory-' + id] });

    assert.equal(await queue.ingestGatewayEvent(dm()), 'accepted');
    const direct = await queue.claimNext(); assert.ok(direct);
    assert.equal(await memory.create(direct, { key: 'language', content: '默认中文' }), 'created');
    assert.equal((await memory.listRecent(direct))[0]?.content, '默认中文');
    assert.equal(await memory.revise(direct, { key: 'language', content: '默认日语' }, 1), true);
    assert.equal((await memory.searchLexical(direct, '日语'))[0]?.revision, 2);
    assert.equal(await memory.forget(direct, 'language'), true);
    assert.deepEqual(await memory.listRecent(direct), []);
    assert.equal(await memory.create(direct, { key: 'language', content: '旧租约不应复活' }), 'already_exists');
    await queue.complete(direct, null);
    await assert.rejects(memory.listRecent(direct), /public_query_ingress_unavailable/u);

    assert.equal(await queue.ingestGatewayEvent(message()), 'accepted');
    const group = await queue.claimNext(); assert.ok(group);
    const original = await auth.resolveMemoryScope(group);
    assert.equal(original?.kind, 'channel');
    assert.equal((await pool.query('SELECT 1 FROM public_query_sessions WHERE bot_account_id=$1', [bot])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM public_query_requests WHERE bot_account_id=$1', [bot])).rowCount, 0);
    assert.equal(await memory.create(group, { key: 'map_preference', content: '喜欢艾伦格地图' }), 'created');

    // Full-scope search: 150 fresher records cannot make the older relevant
    // memory disappear behind an arbitrary "latest 128" prefilter.
    const active = await auth.resolveMemoryScope(group);
    assert.equal(active?.kind, 'channel');
    if (!active || active.kind !== 'channel') return assert.fail('memory scope missing');
    await pool.query(`INSERT INTO gate_memory_entries
      (bot_account_id,scope_kind,channel_id,tenant_id,team_id,binding_revision,memory_key,content,source_event_id)
      SELECT $1,'channel',$2,$3,$4,$5::BIGINT,'noise_'||n,'普通闲聊',$6
      FROM generate_series(1,150) n`, [bot, channel, team.tenantId, team.teamId, active.bindingRevision, group.eventId]);
    const matches = await memory.searchLexical(group, '在哪个地图玩得最多');
    assert.equal(matches[0]?.key, 'map_preference');
    assert.equal((await pool.query('SELECT 1 FROM public_query_sessions WHERE bot_account_id=$1', [bot])).rowCount, 0);

    denied = true;
    assert.equal(await auth.resolveMemoryScope(group), null);
    await assert.rejects(memory.listRecent(group), /gate_memory_scope_unavailable/u);
    denied = false;

    // Rebind between external KOOK membership check and final DB lookup:
    // admission must fail closed without writing persistent sessions.
    onMembershipCheck = async () => {
      await pool.query('UPDATE channel_binding_versions SET revision=revision+1 WHERE bot_account_id=$1 AND channel_id=$2', [bot, channel]);
      onMembershipCheck = null;
    };
    assert.equal(await auth.resolveMemoryScope(group), null);
    // A stale server-scope object cannot bypass the SQL-level live fence.
    const stale = new GateMemoryStore(pool, { resolveMemoryScope: async () => original });
    assert.deepEqual(await stale.listRecent(group), []);
    assert.equal(await stale.create(group, { key: 'stale', content: '不应写入' }), 'already_exists');
    assert.equal((await pool.query("SELECT COUNT(*)::INTEGER AS count FROM gate_memory_entries WHERE bot_account_id=$1 AND memory_key='stale'", [bot])).rows[0]?.count, 0);
  } finally {
    await pool.query('DELETE FROM gate_memory_entries WHERE bot_account_id=$1', [bot]).catch(() => undefined);
    await pool.query('DELETE FROM usage_records WHERE bot_account_id=$1', [bot]).catch(() => undefined);
    for (const table of ['session_contexts', 'result_sets', 'kook_ingress_events',
      'message_outbox', 'channel_binding_versions', 'channel_identities', 'tenants']) {
      await pool.query('DELETE FROM ' + table + ' WHERE bot_account_id=$1', [bot]).catch(() => undefined);
    }
    await pool.end();
  }
});
