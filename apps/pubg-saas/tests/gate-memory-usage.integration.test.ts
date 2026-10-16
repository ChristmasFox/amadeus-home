import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { createMemoryUsageSignals } from '@agent/memory';
import {
  GateMemoryStore,
  KookIngressQueue,
  PublicQueryAuthorizer,
  migratePublicDatabase,
} from '../src/index.js';
import type { KookIngressJob } from '../src/application/kook-ingress-queue.js';

const databaseUrl = process.env.PUBG_SAAS_TEST_DATABASE_URL;
if (process.env.CI === 'true' && !databaseUrl) {
  throw new Error('gate_memory_usage_ci_database_required');
}

function directEvent(bot: string, actor: string, content: string) {
  return { type: 1, channel_type: 'PERSON', target_id: bot, author_id: actor,
    msg_id: randomUUID(), msg_timestamp: Date.now(), content };
}

test('recall/use signals are scoped, idempotent, expiring, and omit query text', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  const suffix = randomUUID().replaceAll('-', '');
  const bot = `bot-usage-${suffix}`, actor = `actor-${suffix}`;
  const queue = new KookIngressQueue(pool, { botAccountId: bot });
  const authority = new PublicQueryAuthorizer(pool, {
    isGuildMember: async () => true,
    isTextChannelMember: async () => true,
  }, { botAccountId: bot });
  const store = new GateMemoryStore(pool, authority);

  try {
    await migratePublicDatabase(pool);
    await pool.query(
      `INSERT INTO gate_memory_entries(
         bot_account_id,scope_kind,actor_id,channel_id,tenant_id,team_id,binding_revision,
         memory_key,content,source_event_id,source_kind,source_reliability
       ) VALUES ($1,'dm',$2,'','','',0,'favorite_map','喜欢艾伦格','synthetic-memory-source','user_confirmed',95)`,
      [bot, actor],
    );

    async function startDirect(content: string): Promise<KookIngressJob> {
      assert.equal(await queue.ingestGatewayEvent(directEvent(bot, actor, content)), 'accepted');
      const job = await queue.claimNext();
      assert.ok(job);
      return job;
    }
    async function signal(job: KookIngressJob, query: string, used: boolean): Promise<void> {
      const entries = await store.searchExact(job, 'favorite_map');
      assert.equal(entries.length, 1);
      const usage = createMemoryUsageSignals(query, entries);
      await store.recordUsageSignals(job, usage, 'recalled');
      await store.recordUsageSignals(job, usage, 'recalled');
      if (used) await store.recordUsageSignals(job, usage, 'used');
      await queue.complete(job, null);
    }

    const first = await startDirect('where do I usually land?');
    await signal(first, 'Where do I usually land?', true);
    const repeat = await startDirect('same question, normalized below');
    await signal(repeat, '  WHERE   do I usually land?  ', true);
    const distinct = await startDirect('which place do I prefer?');
    await signal(distinct, 'which place do I prefer?', false);

    const aggregate = await pool.query<{
      recalled: number; used: number; distinct_queries: number; expires_in_days: number;
    }>(
      `SELECT COUNT(*) FILTER (WHERE signal_kind='recalled')::INTEGER AS recalled,
         COUNT(*) FILTER (WHERE signal_kind='used')::INTEGER AS used,
         COUNT(DISTINCT query_fingerprint) FILTER (WHERE signal_kind='recalled')::INTEGER AS distinct_queries,
         MIN(CEIL(EXTRACT(EPOCH FROM (expires_at-now()))/86400))::INTEGER AS expires_in_days
       FROM gate_memory_usage_signals WHERE bot_account_id=$1 AND actor_id=$2 AND memory_key='favorite_map'`,
      [bot, actor],
    );
    assert.deepEqual(aggregate.rows[0], {
      recalled: 3, used: 2, distinct_queries: 2, expires_in_days: 90,
    });
    const serialized = await pool.query<{ serialized: string }>(
      `SELECT row_to_json(signal)::TEXT AS serialized FROM gate_memory_usage_signals signal
       WHERE bot_account_id=$1 AND actor_id=$2`,
      [bot, actor],
    );
    assert.equal(serialized.rows.length, 5);
    assert.ok(serialized.rows.every(row => !/where do I usually land|which place do I prefer/iu.test(row.serialized)));
    assert.ok(serialized.rows.every(row => !row.serialized.includes('content')));

    const forgetJob = await startDirect('forget my favorite map');
    const current = await store.searchExact(forgetJob, 'favorite_map');
    const forgetSignals = createMemoryUsageSignals('forget my favorite map', current);
    await store.recordUsageSignals(forgetJob, forgetSignals, 'recalled');
    await store.recordUsageSignals(forgetJob, forgetSignals, 'used');
    const candidateKey = createHash('sha256').update(`${bot}:${actor}:favorite_map`).digest('hex');
    await pool.query(
      `INSERT INTO gate_memory_consolidation_candidates(
         idempotency_key,bot_account_id,actor_id,workflow,consent_version,memory_key,content,candidate_kind,
         valid_until,source_event_ids
       ) VALUES ($1,$2,$3,'light',1,'favorite_map','喜欢艾伦格','stable_preference',NULL,ARRAY['synthetic-memory-source'])`,
      [candidateKey, bot, actor],
    );
    assert.equal(await store.forget(forgetJob, 'favorite_map'), true);
    await queue.complete(forgetJob, null);
    const clearedSignals = await pool.query(
      `SELECT 1 FROM gate_memory_usage_signals WHERE bot_account_id=$1 AND actor_id=$2 AND memory_key='favorite_map'`,
      [bot, actor],
    );
    assert.equal(clearedSignals.rowCount, 0, 'forget deletes the recall/use evidence for the forgotten key');
    const rejectedCandidate = await pool.query<{
      status: string; memory_key: string; content: string; source_event_ids: string[];
    }>(
      `SELECT status,memory_key,content,source_event_ids FROM gate_memory_consolidation_candidates
       WHERE bot_account_id=$1 AND actor_id=$2 AND idempotency_key=$3`,
      [bot, actor, candidateKey],
    );
    assert.deepEqual(rejectedCandidate.rows[0], {
      status: 'rejected', memory_key: 'rejected', content: '[rejected]', source_event_ids: [],
    });
  } finally {
    await pool.query('DELETE FROM gate_memory_usage_signals WHERE bot_account_id=$1', [bot]).catch(() => undefined);
    await pool.query('DELETE FROM gate_memory_consolidation_candidates WHERE bot_account_id=$1', [bot]).catch(() => undefined);
    await pool.query(`DELETE FROM gate_memory_embedding_jobs job USING gate_memory_entries memory
      WHERE memory.memory_id=job.memory_id AND memory.bot_account_id=$1`, [bot]).catch(() => undefined);
    await pool.query('DELETE FROM gate_memory_entries WHERE bot_account_id=$1', [bot]).catch(() => undefined);
    await pool.query('DELETE FROM kook_conversation_messages WHERE bot_account_id=$1', [bot]).catch(() => undefined);
    await pool.query('DELETE FROM message_outbox WHERE bot_account_id=$1', [bot]).catch(() => undefined);
    await pool.query('DELETE FROM kook_ingress_events WHERE bot_account_id=$1', [bot]).catch(() => undefined);
    await pool.end();
  }
});
