import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { GateMemoryStore, GateMemoryIndexWorker, rankGateMemories, memorySearchTokens, validateGateMemoryDraft, migratePublicDatabase, KookIngressQueue, TeamAdminService, PublicQueryAuthorizer, parseTrustedKookGroupMessage } from '../src/index.js';
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
  assert.equal(rankGateMemories(facts, '喜欢艾伦格')[0]?.key, 'favorite_map');
  assert.deepEqual(rankGateMemories(facts, '在哪个地图玩得最多').map(e => e.key), ['favorite_map']);
  assert.deepEqual(rankGateMemories(facts, '平时踢什么球').map(e => e.key), []);
  assert.throws(() => validateGateMemoryDraft({ key: 'hidden', content: 'a\u200bb' }), /gate_memory_input_invalid/u);
  assert.throws(() => validateGateMemoryDraft({ key: 'rtl\u202e', content: 'ok' }), /gate_memory_input_invalid/u);
  assert.deepEqual(memorySearchTokens('abc中文'), ['abc', '中文']);
  assert.deepEqual(memorySearchTokens('猫'), []);
  assert.deepEqual(memorySearchTokens('🐈'), []);
  assert.equal(rankGateMemories(facts, '图')[0]?.key, 'favorite_map');
  assert.equal(rankGateMemories([{ ...facts[0]!, content: 'abc中文' }], 'abc中文')[0]?.key, 'favorite_map');
  assert.deepEqual(validateGateMemoryDraft({ key: 'emoji', content: '一家人👨‍👩‍👧、猫🐈️' }),
    { key: 'emoji', content: '一家人👨‍👩‍👧、猫🐈️' });
  assert.throws(() => validateGateMemoryDraft({ key: 'hidden', content: 'a\u200db' }), /gate_memory_input_invalid/u);
  assert.throws(() => validateGateMemoryDraft({ key: 'hidden', content: 'a\u200cb' }), /gate_memory_input_invalid/u);
});

test('missing trusted ingress authority blocks every memory read/write before SQL', async () => {
  const denied = new GateMemoryStore({ query: async () => { throw new Error('sql_must_not_run'); } } as unknown as Pool,
    { resolveMemoryScope: async () => null });
  const job = fixtureJob('test');
  await assert.rejects(denied.listRecent(job), /gate_memory_scope_unavailable/u);
  await assert.rejects(denied.create(job, { key: 'k', content: 'value' }), /gate_memory_scope_unavailable/u);
  await assert.rejects(denied.forget(job, 'k'), /gate_memory_scope_unavailable/u);
});

test('lexical timeout policy rejects invalid values', () => {
  assert.throws(() => new GateMemoryStore({} as Pool, { resolveMemoryScope: async () => null }, { lexicalSearchTimeoutMs: 0 }), /gate_memory_lexical_timeout_invalid/u);
  assert.throws(() => new GateMemoryStore({} as Pool, { resolveMemoryScope: async () => null }, { lexicalSearchTimeoutMs: 10_001 }), /gate_memory_lexical_timeout_invalid/u);
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
  const searchMetrics: Array<{ mode: string; reason: string | null; durationMs: number }> = [];
  const memory = new GateMemoryStore(pool, auth, {
    onSearchMetric: metric => searchMetrics.push(metric),
  });
  try {
    await migratePublicDatabase(pool);
    const teams = new TeamAdminService(pool, { isGuildAdmin: async () => true });
    const setup = parseTrustedKookGroupMessage(message(), bot)!;
    const team = await teams.createSquad(setup, { label: 'Memory fixture', pubgShard: 'steam',
      pubgAccountIds: ['test-memory-' + id] });

    assert.equal(await queue.ingestGatewayEvent(dm().d), 'accepted');
    const direct = await queue.claimNext(); assert.ok(direct);
    assert.equal(await memory.create(direct, { key: 'language', content: '默认中文' }), 'created');
    assert.equal((await memory.listRecent(direct))[0]?.content, '默认中文');
    assert.equal(await memory.revise(direct, { key: 'language', content: '默认日语' }, 1), true);
    assert.equal((await memory.searchLexical(direct, '日语'))[0]?.revision, 2);
    assert.equal(await memory.create(direct, { key: 'mixed', content: 'abc中文' }), 'created');
    assert.equal((await memory.searchLexical(direct, '中文'))[0]?.key, 'mixed');
    assert.equal((await memory.searchLexical(direct, 'abc中文'))[0]?.key, 'mixed');
    assert.equal(await memory.forget(direct, 'language'), true);
    assert.equal((await memory.listRecent(direct)).some(item => item.key === 'language'), false);
    assert.equal(await memory.create(direct, { key: 'language', content: '旧租约不应复活' }), 'already_exists');
    assert.equal(await memory.rememberAgain(direct, { key: 'language', content: '不能用旧事件恢复' }, 3), false);
    await queue.complete(direct, null);
    await assert.rejects(memory.listRecent(direct), /public_query_ingress_unavailable/u);
    assert.equal(await queue.ingestGatewayEvent(dm().d), 'accepted');
    const nextDm = await queue.claimNext(); assert.ok(nextDm);
    assert.equal(await memory.rememberAgain(nextDm, { key: 'language', content: '明确重新记住日语' }, 3), true);
    assert.equal((await memory.listRecent(nextDm))[0]?.content, '明确重新记住日语');
    await queue.complete(nextDm, null);

    assert.equal(await queue.ingestGatewayEvent(message().d), 'accepted');
    const group = await queue.claimNext(); assert.ok(group);
    const original = await auth.resolveMemoryScope(group);
    assert.equal(original?.kind, 'channel');
    assert.equal((await pool.query('SELECT 1 FROM public_query_sessions WHERE bot_account_id=$1', [bot])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM public_query_requests WHERE bot_account_id=$1', [bot])).rowCount, 0);
    assert.equal(await memory.create(group, { key: 'map_preference', content: '喜欢艾伦格地图' }), 'created');
    assert.equal((await memory.searchLexical(group, '艾'))[0]?.key, 'map_preference');
    assert.equal((await memory.searchLexical(group, '图'))[0]?.key, 'map_preference');
    const disabledSearch = await memory.searchWithFallback(group, '喜欢艾伦格', null);
    assert.equal(disabledSearch.mode, 'lexical_only');
    assert.equal(disabledSearch.reason, 'semantic_unconfigured');
    assert.equal(disabledSearch.entries[0]?.key, 'map_preference');
    assert.equal(searchMetrics.at(-1)?.mode, 'lexical_only');
    assert.equal(searchMetrics.at(-1)?.reason, 'semantic_unconfigured');
    assert.ok((searchMetrics.at(-1)?.durationMs ?? -1) >= 0);
    let embeddingCalls = 0;
    const fixtureProvider = {
      contract: { providerId: 'gate-openai-compatible' as const, modelId: 'fixture', dimensions: 3,
        normalization: 'l2_unit' as const, indexVersion: 1 },
      dailyTokenBudget: 10_000, dailyRequestBudget: 100,
      async embedMany() { embeddingCalls += 1; throw new Error('must-not-call-without-vector-schema'); },
    };
    const noVectorSearch = await memory.searchWithFallback(group, '喜欢艾伦格', fixtureProvider);
    assert.equal(noVectorSearch.mode, 'lexical_only');
    assert.equal(noVectorSearch.reason, 'vector_index_unavailable');
    assert.equal(embeddingCalls, 0, 'standard PostgreSQL never sends a paid embedding request without the optional vector index');
    assert.equal(await new GateMemoryIndexWorker(pool, null).processOne(), 'semantic_unconfigured');
    const queuedChanges = await pool.query(
      `SELECT memory.memory_key,job.source_revision,job.operation FROM gate_memory_embedding_jobs job
       JOIN gate_memory_entries memory ON memory.memory_id=job.memory_id
       WHERE memory.bot_account_id=$1 AND memory.memory_key IN ('language','map_preference')
       ORDER BY memory.memory_key,job.source_revision`, [bot],
    );
    assert.deepEqual(queuedChanges.rows.map(row => [row.memory_key, String(row.source_revision), row.operation]), [
      ['language', '1', 'upsert'], ['language', '2', 'upsert'], ['language', '3', 'delete'],
      ['language', '4', 'upsert'], ['map_preference', '1', 'upsert'],
    ]);

    // Full-scope search: 150 fresher records cannot make the older relevant
    // memory disappear behind an arbitrary "latest 128" prefilter.
    const active = await auth.resolveMemoryScope(group);
    assert.equal(active?.kind, 'channel');
    if (!active || active.kind !== 'channel') return assert.fail('memory scope missing');
    await pool.query(`INSERT INTO gate_memory_entries
      (bot_account_id,scope_kind,channel_id,tenant_id,team_id,binding_revision,memory_key,content,source_event_id)
      SELECT $1,'channel',$2,$3,$4,$5::BIGINT,'noise_'||n,'普通闲聊',$6
      FROM generate_series(1,150) n`, [bot, channel, team.tenantId, team.teamId, active.bindingRevision, group.eventId]);
    await pool.query(`INSERT INTO gate_memory_entries
      (bot_account_id,scope_kind,channel_id,tenant_id,team_id,binding_revision,memory_key,content,source_event_id)
      SELECT $1,'channel','other-channel-'||n,'other-tenant-'||n,'other-team-'||n,1,'other_noise_'||n,'无关合成记录',$2
      FROM generate_series(1,10000) n`, [bot, group.eventId]);

    const matches = await memory.searchLexical(group, '在哪个地图玩得最多');
    assert.equal(matches[0]?.key, 'map_preference');
    await pool.query('ANALYZE gate_memory_entries');
    const plan = await pool.query(`EXPLAIN
      SELECT memory_key,content FROM gate_memory_entries
      WHERE bot_account_id=$1 AND scope_kind='channel' AND actor_id=''
        AND channel_id=$2 AND tenant_id=$3 AND team_id=$4 AND binding_revision=$5::BIGINT
        AND revoked_at IS NULL
        AND (lower(memory_key) LIKE $6 ESCAPE '#' OR lower(content) LIKE $6 ESCAPE '#')`,
    [bot, channel, team.tenantId, team.teamId, active.bindingRevision, '%在哪个地图玩得最多%']);
    const planText = plan.rows.map(row => String(row['QUERY PLAN'])).join('\n');
    assert.match(planText, /idx_gate_memory_scope_recent/u);
    console.log('GATE_MEMORY_LEXICAL_EXPLAIN=' + planText.replaceAll('\n', ' | '));
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
    await assert.rejects(stale.create(group, { key: 'stale', content: '不应写入' }), /gate_memory_scope_unavailable/u);
    assert.equal((await pool.query("SELECT COUNT(*)::INTEGER AS count FROM gate_memory_entries WHERE bot_account_id=$1 AND memory_key='stale'", [bot])).rows[0]?.count, 0);
  } finally {
    await pool.query('DELETE FROM gate_memory_embedding_usage_daily WHERE bot_account_id=$1', [bot]).catch(() => undefined);
    await pool.query('DELETE FROM gate_memory_entries WHERE bot_account_id=$1', [bot]).catch(() => undefined);
    await pool.query('DELETE FROM usage_records WHERE bot_account_id=$1', [bot]).catch(() => undefined);
    for (const table of ['session_contexts', 'result_sets', 'kook_ingress_events',
      'message_outbox', 'channel_binding_versions', 'channel_identities', 'tenants']) {
      await pool.query('DELETE FROM ' + table + ' WHERE bot_account_id=$1', [bot]).catch(() => undefined);
    }
    await pool.end();
  }
});
