import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { GateMemoryStore, rankGateMemories, validateGateMemoryDraft, migratePublicDatabase } from '../src/index.js';
import type { GateMemoryScope, GateMemoryScopeResolver } from '../src/index.js';
import type { KookIngressJob } from '../src/application/kook-ingress-queue.js';

const url = process.env.PUBG_SAAS_TEST_DATABASE_URL;
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

test('lexical fallback never pretends unrelated paraphrases are semantic hits', () => {
  const facts = [
    { key: 'favorite_map', content: '喜欢艾伦格地图', revision: 1, updatedAt: '2026-10-16' },
    { key: 'football', content: '喜欢看足球', revision: 1, updatedAt: '2026-10-16' },
  ];
  assert.deepEqual(rankGateMemories(facts, '喜欢艾伦格').map(e => e.key), ['favorite_map']);
  assert.deepEqual(rankGateMemories(facts, '在哪个地图玩得最多'), []);
});

test('missing trusted ingress authority blocks every memory read/write before SQL', async () => {
  const denied = new GateMemoryStore({ query: async () => { throw new Error('sql_must_not_run'); } } as unknown as Pool,
    { resolveMemoryScope: async () => null });
  const job = fixtureJob('test');
  await assert.rejects(denied.listRecent(job), /gate_memory_scope_unavailable/u);
  await assert.rejects(denied.create(job, { key: 'k', content: 'value' }), /gate_memory_scope_unavailable/u);
  await assert.rejects(denied.forget(job, 'k'), /gate_memory_scope_unavailable/u);
});

test('durable memory isolates bot, DM actor, channel, team and binding generation', { skip: !url }, async () => {
  const pool = new Pool({ connectionString: url, max: 3 });
  const id = randomUUID().replaceAll('-', '');
  let scope: GateMemoryScope = { kind: 'dm', botAccountId: `bot-a-` + id, actorId: `user-a-` + id };
  let checks = 0;
  const authority: GateMemoryScopeResolver = {
    resolveMemoryScope: async () => { checks++; return scope; },
  };
  const memory = new GateMemoryStore(pool, authority);
  const job = fixtureJob(`event-` + id);
  try {
    await migratePublicDatabase(pool);
    assert.equal(await memory.create(job, { key: 'language', content: '默认中文' }), 'created');
    assert.equal(await memory.create(job, { key: 'language', content: '不能覆盖' }), 'already_exists');
    assert.equal((await memory.listRecent(job))[0]?.content, '默认中文');
    assert.equal(await memory.revise(job, { key: 'language', content: '默认日语' }, 9), false);
    assert.equal(await memory.revise(job, { key: 'language', content: '默认日语' }, 1), true);
    assert.equal((await memory.searchLexical(job, '日语'))[0]?.revision, 2);
    scope = { kind: 'dm', botAccountId: `bot-a-` + id, actorId: `user-b-` + id };
    assert.deepEqual(await memory.listRecent(job), []);
    scope = { kind: 'dm', botAccountId: `bot-b-` + id, actorId: `user-a-` + id };
    assert.deepEqual(await memory.listRecent(job), []);
    scope = { kind: 'channel', botAccountId: `bot-a-` + id, channelId: `channel-a-` + id,
      tenantId: `tenant-a-` + id, teamId: `team-a-` + id, bindingRevision: '1' };
    assert.deepEqual(await memory.listRecent(job), []);
    assert.equal(await memory.create(job, { key: 'meeting', content: '周末下午四点组队' }), 'created');
    scope = { ...scope, bindingRevision: '2' };
    assert.deepEqual(await memory.listRecent(job), []);
    scope = { ...scope, bindingRevision: '1', channelId: `channel-b-` + id };
    assert.deepEqual(await memory.listRecent(job), []);
    scope = { ...scope, channelId: `channel-a-` + id, teamId: `team-b-` + id };
    assert.deepEqual(await memory.listRecent(job), []);
    scope = { ...scope, teamId: `team-a-` + id, tenantId: `tenant-b-` + id };
    assert.deepEqual(await memory.listRecent(job), []);
    scope = { ...scope, tenantId: `tenant-a-` + id };
    assert.equal((await memory.listRecent(job))[0]?.content, '周末下午四点组队');
    assert.equal(await memory.forget(job, 'meeting'), true);
    assert.deepEqual(await memory.listRecent(job), []);
    assert.equal(await memory.create(job, { key: 'meeting', content: '旧消息重放' }), 'already_exists');
    assert.equal(await memory.forget(job, 'meeting'), false);
    assert.ok(checks >= 16, 'authority must be reconstructed per operation');
    scope = { ...scope, bindingRevision: '0' };
    await assert.rejects(memory.listRecent(job), /gate_memory_scope_invalid/u);
  } finally {
    await pool.query('DELETE FROM gate_memory_entries WHERE bot_account_id IN ($1,$2)',
      [`bot-a-` + id, `bot-b-` + id]).catch(() => undefined);
    await pool.end();
  }
});
