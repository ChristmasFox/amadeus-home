import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import {
  AccountClaimService,
  GateMemoryConsolidationConsentService,
  GateMemoryConsolidationWorker,
  KookIngressQueue,
  PublicQueryAuthorizer,
  composeKookRequestHandlers,
  createKookPublicQueryHandler,
  createKookManagementHandler,
  migratePublicDatabase,
} from '../src/index.js';
import type { GateMemoryConsolidationPlanner } from '../src/application/gate-memory-consolidation.js';
import type { KookIngressJob } from '../src/application/kook-ingress-queue.js';
import type { KookOnboardingServices } from '../src/application/kook-onboarding-handler.js';

const databaseUrl = process.env.PUBG_SAAS_TEST_DATABASE_URL;
if (process.env.CI === 'true' && !databaseUrl) {
  throw new Error('gate_memory_consolidation_ci_database_required');
}

function directEvent(bot: string, actor: string, content: string) {
  return { type: 1, channel_type: 'PERSON', target_id: bot, author_id: actor,
    msg_id: randomUUID(), msg_timestamp: Date.now(), content };
}

function candidate(content: string, key = 'favorite_map') {
  return [{ confidence: 'high', subject: 'self', kind: 'stable_preference', key,
    content, evidence: content, validity: 'stable' }];
}

test('consent-versioned Light/REM batches read only admitted DM sources and persist pending candidates', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  const suffix = randomUUID().replaceAll('-', '');
  const bot = `bot-consolidation-${suffix}`, actor = `actor-${suffix}`, other = `other-${suffix}`;
  const queue = new KookIngressQueue(pool, { botAccountId: bot });
  const consent = new GateMemoryConsolidationConsentService(pool, bot);
  const signal = new AbortController().signal;
  const plannerCalls: Array<{ workflow: string; messages: readonly { content: string; createdAt: string }[] }> = [];
  let nextCandidates: unknown[] = [];
  let beforePlannerReturn: (() => Promise<void>) | null = null;
  const planner: GateMemoryConsolidationPlanner = {
    async plan(input) {
      plannerCalls.push(input);
      const hook = beforePlannerReturn;
      beforePlannerReturn = null;
      await hook?.();
      return nextCandidates;
    },
  };
  const writer = new GateMemoryConsolidationWorker(pool, bot, planner, { maxRemBatch: 4, timeoutMs: 2_000 });

  try {
    await migratePublicDatabase(pool);

    async function startDirect(user: string, content: string) {
      const event = directEvent(bot, user, content);
      assert.equal(await queue.ingestGatewayEvent(event), 'accepted');
      const job = await queue.claimNext(); assert.ok(job);
      return job;
    }
    async function finish(job: KookIngressJob): Promise<void> { await queue.complete(job, null); }
    const management = createKookManagementHandler({} as unknown as KookOnboardingServices, consent);
    const operatorDisabledManagement = createKookManagementHandler(
      {} as unknown as KookOnboardingServices, consent, { autoLearnEnabled: false },
    );
    const publicWithoutModel = createKookPublicQueryHandler({
      authorizer: new PublicQueryAuthorizer(pool, {
        isGuildMember: async () => true,
        isTextChannelMember: async () => true,
      }, { botAccountId: bot }),
      claims: new AccountClaimService(pool),
      memoryConsolidationConsent: consent,
    });
    const commandHandler = composeKookRequestHandlers(publicWithoutModel, management);

    const blockedOptIn = await startDirect(actor, '/pubg memory light on');
    const blockedOptInReply = await operatorDisabledManagement(blockedOptIn, signal);
    assert.match(blockedOptInReply?.content ?? '', /全局关闭.*无法重新开启/u);
    await finish(blockedOptIn);
    assert.equal((await pool.query(
      "SELECT 1 FROM gate_memory_consolidation_consents WHERE bot_account_id=$1 AND actor_id=$2 AND workflow='light'",
      [bot, actor],
    )).rowCount, 0, 'an operator-disabled auto-learning flag cannot save apparent user consent');

    const enableLight = await startDirect(actor, '/pubg memory light on');
    const liveLease = await pool.query<{ event_kind: string; user_id: string; target_kind: string; target_id: string; status: string; token_matches: boolean; lease_live: boolean }>(
      `SELECT event_kind,user_id,target_kind,target_id,status,lease_token=$3 AS token_matches,lease_until>now() AS lease_live
       FROM kook_ingress_events WHERE bot_account_id=$1 AND event_id=$2`, [bot, enableLight.eventId, enableLight.leaseToken],
    );
    assert.deepEqual(liveLease.rows[0], { event_kind: 'direct', user_id: actor, target_kind: 'direct', target_id: actor,
      status: 'processing', token_matches: true, lease_live: true });
    const enabledReply = await commandHandler(enableLight, signal);
    assert.match(enabledReply?.content ?? '', /Light 自动记忆已开启/u);
    await finish(enableLight);
    const lightConsent = await pool.query<{ consent_version: string; enabled: boolean }>(
      "SELECT consent_version::TEXT AS consent_version,enabled FROM gate_memory_consolidation_consents WHERE bot_account_id=$1 AND actor_id=$2 AND workflow='light'",
      [bot, actor],
    );
    assert.deepEqual(lightConsent.rows[0], { consent_version: '1', enabled: true });

    const lightText = '请记住我喜欢艾伦格';
    const lightJob = await startDirect(actor, lightText);
    const agentlessReply = await publicWithoutModel(lightJob, signal);
    assert.match(agentlessReply?.content ?? '', /公共助手还没连上模型/u);
    await finish(lightJob);
    const admission = await pool.query<{ status: string; source_event_id: string; consent_version: string; serialized: string }>(
      `SELECT admission.status,admission.source_event_id,admission.consent_version::TEXT AS consent_version,
        row_to_json(admission)::TEXT AS serialized FROM gate_memory_consolidation_admissions admission
       WHERE bot_account_id=$1 AND actor_id=$2 AND source_event_id=$3 AND workflow='light'`, [bot, actor, lightJob.eventId],
    );
    assert.equal(admission.rows[0]?.status, 'pending');
    assert.equal(admission.rows[0]?.consent_version, '1');
    assert.doesNotMatch(admission.rows[0]?.serialized ?? '', /请记住我喜欢艾伦格/u, 'admission stores no transcript content');

    nextCandidates = candidate('喜欢艾伦格');
    const lightRun = await writer.processNext('light');
    assert.deepEqual(lightRun, { status: 'processed', workflow: 'light', admitted: 1, candidates: 1 });
    assert.deepEqual(plannerCalls[0]?.messages.map(item => item.content), [lightText]);
    const savedCandidate = await pool.query<{ candidate_id: string; status: string; memory_key: string; content: string; source_event_ids: string[]; expected_revision: string | null }>(
      `SELECT candidate_id,status,memory_key,content,source_event_ids,expected_revision::TEXT AS expected_revision
       FROM gate_memory_consolidation_candidates WHERE bot_account_id=$1 AND actor_id=$2`, [bot, actor],
    );
    assert.deepEqual(savedCandidate.rows[0], {
      candidate_id: savedCandidate.rows[0]?.candidate_id,
      status: 'promoted', memory_key: 'favorite_map', content: '喜欢艾伦格',
      source_event_ids: [lightJob.eventId], expected_revision: '1',
    });
    assert.match(savedCandidate.rows[0]?.candidate_id ?? '', /^[0-9a-f-]{36}$/iu);
    const listCandidates = await startDirect(actor, '/pubg memory candidates');
    const listed = await management(listCandidates, signal);
    assert.match(listed?.content ?? '', /目前没有待确认/u);
    await finish(listCandidates);
    const promotedFact = await pool.query<{ content: string; source_kind: string; revision: string }>(
      `SELECT content,source_kind,revision::TEXT AS revision FROM gate_memory_entries
       WHERE bot_account_id=$1 AND actor_id=$2 AND memory_key='favorite_map'`, [bot, actor],
    );
    assert.deepEqual(promotedFact.rows[0], { content: '喜欢艾伦格', source_kind: 'trusted_ingress', revision: '1' });
    assert.equal((await pool.query("SELECT COUNT(*)::INTEGER AS count FROM gate_memory_embedding_jobs WHERE memory_id=(SELECT memory_id FROM gate_memory_entries WHERE bot_account_id=$1 AND actor_id=$2 AND memory_key='favorite_map') AND source_revision=1", [bot, actor])).rows[0]?.count, 1);
    assert.deepEqual(await writer.processNext('light'), { status: 'SKIPPED_NO_ELIGIBLE_CORPUS', workflow: 'light' });

    // An extraction cannot promote a prompt injection or sensitive disclosure.
    const unsafeText = '请记住我的 API key 是 sk-example-sensitive-value';
    const unsafeJob = await startDirect(actor, unsafeText);
    assert.equal(await consent.admitCurrentMessage(unsafeJob), 2);
    await finish(unsafeJob);
    nextCandidates = [{ confidence: 'high', subject: 'self', kind: 'stable_preference', key: 'secret',
      content: '我的 API key 是 sk-example-sensitive-value', evidence: unsafeText, validity: 'stable' }];
    const unsafeRun = await writer.processNext('light');
    assert.deepEqual(unsafeRun, { status: 'processed', workflow: 'light', admitted: 1, candidates: 0 });
    assert.equal((await pool.query("SELECT COUNT(*)::INTEGER AS count FROM gate_memory_consolidation_candidates WHERE bot_account_id=$1 AND memory_key='secret'", [bot])).rows[0]?.count, 0);

    const crashJob = await startDirect(actor, '这条消息在 worker 重启后仍可恢复');
    assert.equal(await consent.admitCurrentMessage(crashJob), 2);
    await finish(crashJob);
    const simulatedLease = randomUUID();
    await pool.query(
      `UPDATE gate_memory_consolidation_admissions SET status='processing',lease_token=$3::uuid,
         lease_until=now()-interval '1 second' WHERE bot_account_id=$1 AND actor_id=$2 AND source_event_id=$4 AND workflow='light'`,
      [bot, actor, simulatedLease, crashJob.eventId],
    );
    nextCandidates = [];
    const recovered = await writer.processNext('light');
    assert.deepEqual(recovered, { status: 'processed', workflow: 'light', admitted: 1, candidates: 0 });
    assert.equal((await pool.query("SELECT status FROM gate_memory_consolidation_admissions WHERE bot_account_id=$1 AND source_event_id=$2 AND workflow='light'", [bot, crashJob.eventId])).rows[0]?.status, 'done');

    // REM batches remain within one actor and one consent generation.
    const enableRem = await startDirect(actor, '/pubg memory rem on');
    await management(enableRem, signal);
    await finish(enableRem);
    // Default-on REM has also seen earlier fixture messages; isolate this
    // scenario so it asserts batching/provenance rather than prior fixture history.
    await pool.query(
      "DELETE FROM gate_memory_consolidation_admissions WHERE bot_account_id=$1 AND actor_id=$2 AND workflow='rem'",
      [bot, actor],
    );
    const remA = await startDirect(actor, '最近我更喜欢用 M416');
    assert.equal(await consent.admitCurrentMessage(remA), 2, 'both explicitly enabled workflows receive separate scoped admissions');
    await finish(remA);
    const remB = await startDirect(actor, '我在海岛常常选 M416');
    assert.equal(await consent.admitCurrentMessage(remB), 2);
    await finish(remB);
    await pool.query(
      `INSERT INTO gate_memory_entries(bot_account_id,scope_kind,actor_id,channel_id,tenant_id,team_id,binding_revision,
        memory_key,content,source_event_id,source_kind,source_reliability)
       VALUES ($1,'dm',$2,'','','',0,'main_weapon','当前偏好 AKM','synthetic-seed','user_confirmed',95)`, [bot, actor],
    );
    const otherMessage = await startDirect(other, '另一个用户也喜欢 M416');
    assert.equal(await consent.admitCurrentMessage(otherMessage), 2);
    await finish(otherMessage);
    nextCandidates = [{ confidence: 'high', subject: 'self', kind: 'stable_preference', key: 'main_weapon',
      content: '更喜欢用 M416', evidence: '最近我更喜欢用 M416', validity: 'stable' }];
    const remRun = await writer.processNext('rem');
    assert.deepEqual(remRun, { status: 'processed', workflow: 'rem', admitted: 2, candidates: 1 });
    assert.deepEqual(plannerCalls.at(-1)?.messages.map(item => item.content), [
      '最近我更喜欢用 M416', '我在海岛常常选 M416',
    ]);
    const remCandidate = await pool.query<{ source_event_ids: string[]; status: string }>(
      "SELECT source_event_ids,status FROM gate_memory_consolidation_candidates WHERE bot_account_id=$1 AND memory_key='main_weapon'", [bot],
    );
    assert.deepEqual(remCandidate.rows[0], { source_event_ids: [remA.eventId], status: 'promoted' },
      'candidate provenance references only the source that actually supported its evidence');
    assert.equal((await pool.query(
      "SELECT content,revision::TEXT AS revision FROM gate_memory_entries WHERE bot_account_id=$1 AND actor_id=$2 AND memory_key='main_weapon'",
      [bot, actor],
    )).rows[0]?.content, '更喜欢用 M416');


    // Consent revocation invalidates queued admissions and pending candidates.
    const revoke = await startDirect(actor, '/pubg memory rem off');
    const revokedReply = await management(revoke, signal);
    assert.match(revokedReply?.content ?? '', /待处理消息已失效.*候选会被撤回/u);
    await finish(revoke);
    const revoked = await pool.query<{ status: string; candidate_count: number }>(
      `SELECT admission.status,(SELECT COUNT(*)::INTEGER FROM gate_memory_consolidation_candidates candidate
         WHERE candidate.bot_account_id=$1 AND candidate.actor_id=$2 AND candidate.memory_key='main_weapon'
           AND candidate.status IN ('pending_confirmation','conflict')) AS candidate_count
       FROM gate_memory_consolidation_admissions admission
       WHERE admission.bot_account_id=$1 AND admission.actor_id=$2 AND admission.workflow='rem'
         AND admission.source_event_id=$3`,
      [bot, actor, remA.eventId],
    );
    assert.deepEqual(revoked.rows[0], { status: 'done', candidate_count: 0 });
    const stale = await writer.processNext('rem');
    assert.deepEqual(stale, { status: 'SKIPPED_NO_ELIGIBLE_CORPUS', workflow: 'rem' });

    // A revoked consent between admission and execution fails before planning.
    const onAgain = await startDirect(actor, '/pubg memory light off');
    await management(onAgain, signal);
    await finish(onAgain);
    const laterEnable = await startDirect(actor, '/pubg memory light on');
    await management(laterEnable, signal);
    await finish(laterEnable);
    const revokedBeforeRead = await startDirect(actor, '我通常选择沙漠地图');
    assert.equal(await consent.admitCurrentMessage(revokedBeforeRead), 1);
    await finish(revokedBeforeRead);
    const disable = await startDirect(actor, '/pubg memory light off');
    await management(disable, signal);
    await finish(disable);
    const beforeCalls = plannerCalls.length;
    const noConsentRun = await writer.processNext('light');
    assert.deepEqual(noConsentRun, { status: 'SKIPPED_NO_ELIGIBLE_CORPUS', workflow: 'light' });
    assert.equal(plannerCalls.length, beforeCalls, 'revoked consent is rejected before the planner sees text');
    assert.equal((await pool.query("SELECT status FROM gate_memory_consolidation_admissions WHERE bot_account_id=$1 AND source_event_id=$2", [bot, revokedBeforeRead.eventId])).rows[0]?.status, 'skipped');

    // Group traffic has no admission path, even when DM consent exists.
    const groupEvent = { type: 1, channel_type: 'GROUP', target_id: `channel-${suffix}`,
      author_id: actor, msg_id: randomUUID(), msg_timestamp: Date.now(), content: '请记住我喜欢群聊地图',
      extra: { guild_id: `guild-${suffix}`, channel_type: 1, author: { id: actor, bot: false } } };
    assert.equal(await queue.ingestGatewayEvent(groupEvent), 'accepted');
    const groupJob = await queue.claimNext(); assert.ok(groupJob);
    assert.equal(await consent.admitCurrentMessage(groupJob), 0);
    await finish(groupJob);
    assert.equal((await pool.query("SELECT COUNT(*)::INTEGER AS count FROM gate_memory_consolidation_admissions WHERE bot_account_id=$1 AND source_event_id=$2", [bot, groupJob.eventId])).rows[0]?.count, 0);

    // Consent can be revoked after the metadata check and text read but before
    // candidate persistence; the final transaction must reject that write.
    const raceEnable = await startDirect(actor, '/pubg memory light on');
    await management(raceEnable, signal);
    await finish(raceEnable);
    const raceMessage = await startDirect(actor, '我通常选择沙漠地图');
    assert.equal(await consent.admitCurrentMessage(raceMessage), 1);
    await finish(raceMessage);
    const raceOff = await startDirect(actor, '/pubg memory light off');
    beforePlannerReturn = async () => {
      const result = await management(raceOff, signal);
      assert.match(result?.content ?? '', /待处理消息已失效/u);
      await finish(raceOff);
    };
    nextCandidates = candidate('我通常选择沙漠地图', 'map_rotation');
    assert.deepEqual(await writer.processNext('light'), {
      status: 'skipped', workflow: 'light', reason: 'consent_revoked', admitted: 1,
    });
    assert.equal((await pool.query(
      "SELECT COUNT(*)::INTEGER AS count FROM gate_memory_consolidation_candidates WHERE bot_account_id=$1 AND actor_id=$2 AND memory_key='map_rotation'",
      [bot, actor],
    )).rows[0]?.count, 0, 'a revoked worker lease cannot persist a candidate after planner completion');
  } finally {
    await pool.query('DELETE FROM gate_memory_consolidation_candidates WHERE bot_account_id=$1', [bot]).catch(() => undefined);
    await pool.query('DELETE FROM gate_memory_consolidation_admissions WHERE bot_account_id=$1', [bot]).catch(() => undefined);
    await pool.query('DELETE FROM gate_memory_consolidation_checkpoints WHERE bot_account_id=$1', [bot]).catch(() => undefined);
    await pool.query('DELETE FROM gate_memory_consolidation_consents WHERE bot_account_id=$1', [bot]).catch(() => undefined);
    await pool.query(`DELETE FROM gate_memory_embedding_jobs job USING gate_memory_entries memory
      WHERE memory.memory_id=job.memory_id AND memory.bot_account_id=$1`, [bot]).catch(() => undefined);
    await pool.query('DELETE FROM gate_memory_entries WHERE bot_account_id=$1', [bot]).catch(() => undefined);
    await pool.query('DELETE FROM kook_conversation_messages WHERE bot_account_id=$1', [bot]).catch(() => undefined);
    await pool.query('DELETE FROM message_outbox WHERE bot_account_id=$1', [bot]).catch(() => undefined);
    await pool.query('DELETE FROM kook_ingress_events WHERE bot_account_id=$1', [bot]).catch(() => undefined);
    await pool.end();
  }
});
