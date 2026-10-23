import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Pool } from 'pg';
import { buildPubgToolPresentation, type PubgToolName } from '@rine-kit/presentation';
import {
  CanonicalQuerySchema, createTeamContext, DeterministicQueryEngine, PubgDomainService, SqlitePubgRepository,
  SqlitePubgRepositoryAdapter, TelemetryWorker, type Coverage, type PubgRepositoryPort, type SourceInfo, type TeamConfig,
  type Metric, type ReviewEvidence, type TeamDamageQueryInput, type ToolEnvelope,
} from '@rine-kit/pubg-domain';
import { migratePublicDatabase, PostgresPubgRepository } from '../src/index.js';
const databaseUrl = process.env.PUBG_SAAS_TEST_DATABASE_URL;
interface EdgeFixture {
  contract: string; now: string; team: TeamConfig; matches: Array<{ matchId: string; players: Array<{ accountId: string }> }>;
  coverage: Coverage; source: SourceInfo;
  cases: Array<{ id: string; now?: string; query: Record<string, unknown>; coverage?: Partial<Coverage>; expected: { status: string; matchIds: string[]; metrics: Record<string, Record<string, number | null>> } }>;
  telemetry: Record<string, unknown[]>; damageExpected: Record<string, [number, number]>;
}
const original = JSON.parse(readFileSync(new URL('./fixtures/shared-edge-cases.json', import.meta.url), 'utf8')) as EdgeFixture;

function presentEnvelope(envelope: ToolEnvelope, toolName: PubgToolName, teamDamage?: { aggregateByActor?: boolean }) {
  return buildPubgToolPresentation(toolName, {
    status: envelope.status,
    data: envelope.data,
    dataUpdatedAt: envelope.asOf,
    queryResolved: envelope.queryResolved,
    evidenceRefs: envelope.evidenceRefs,
    coverage: {
      status: envelope.coverage.status,
      complete: envelope.coverage.complete,
      freshness: envelope.coverage.freshness,
      checkedAt: envelope.coverage.checkedAt ?? null,
      coverageStart: envelope.coverage.coverageStart ?? null,
      coverageEnd: envelope.coverage.coverageEnd ?? null,
      sourceUnavailable: envelope.coverage.sourceUnavailable,
    },
    ...(teamDamage ? { teamDamage } : {}),
  }, { now: envelope.asOf, includeCoverage: true });
}

async function fixture() {
  const suffix = randomUUID(), tenant = `tenant-${suffix}`, bot = `bot-${suffix}`, channel = `channel-${suffix}`, user = `user-${suffix}`, session = `session-${suffix}`, directory = mkdtempSync(join(tmpdir(), 'pubg-shared-edge-'));
  const names = new Map([original.team.id, ...original.team.players.map(player => player.id), ...original.matches.map(match => match.matchId)].map(id => [id, `${suffix}-${id}`]));
  function remap(value: unknown): unknown {
    if (typeof value === 'string') return names.get(value) ?? value;
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [names.get(key) ?? key, remap(item)]));
    return value;
  }
  const input = remap(original) as EdgeFixture, context = createTeamContext(tenant, input.team), pool = new Pool({ connectionString: databaseUrl, max: 5 });
  await migratePublicDatabase(pool);
  await pool.query("INSERT INTO tenants(tenant_id,platform,bot_account_id,guild_id) VALUES ($1,'kook',$2,$3)", [tenant, bot, `guild-${suffix}`]);
  await pool.query('INSERT INTO teams(tenant_id,team_id,label,pubg_shard) VALUES ($1,$2,$3,$4)', [tenant, context.teamId, input.team.label, input.team.platform]);
  for (const player of input.team.players) await pool.query('INSERT INTO team_members(tenant_id,team_id,pubg_account_id,added_by_user_id) VALUES ($1,$2,$3,$4)', [tenant, context.teamId, player.id, user]);
  await pool.query("INSERT INTO channel_bindings(tenant_id,platform,bot_account_id,channel_id,team_id,bound_by_user_id) VALUES ($1,'kook',$2,$3,$4,$5)", [tenant, bot, channel, context.teamId, user]);
  const path = join(directory, 'fixture.sqlite'), sqlite = new SqlitePubgRepository(path), privateRepo = new SqlitePubgRepositoryAdapter(sqlite, context), conversation = { platform: 'kook' as const, kind: 'bound_channel' as const, botAccountId: bot, userId: user, channelId: channel, sessionId: session }, publicRepo = new PostgresPubgRepository(pool, context, conversation);
  await privateRepo.upsertMatches(input.matches); await publicRepo.upsertMatches(input.matches);
  let privateClosed = false;
  function closePrivate() { if (!privateClosed) { sqlite.close(); privateClosed = true; } }
  return {
input, context, pool, path, closePrivate, privateRepo, publicRepo, conversation, session, names,
    async cleanup() { closePrivate(); await pool.query('DELETE FROM tenants WHERE tenant_id=$1', [tenant]); await pool.query('DELETE FROM matches WHERE match_id=ANY($1::TEXT[])', [input.matches.map(match => match.matchId)]); await pool.query('DELETE FROM session_contexts WHERE bot_account_id=$1', [bot]); await pool.query('DELETE FROM result_sets WHERE bot_account_id=$1', [bot]); await pool.end(); rmSync(directory, { recursive: true, force: true }); }
  };
}
test('SQLite and PostgreSQL share the independently checked stat, rank, time, zero and coverage edge golden', { skip: !databaseUrl }, async () => {
  const f = await fixture(); try {
    assert.deepEqual(await f.publicRepo.listMatches(), await f.privateRepo.listMatches());
    for (const scenario of f.input.cases) {
      const query = CanonicalQuerySchema.parse({
version: 3, queryId: scenario.id, domain: 'pubg', subject: { type: 'team', ids: [] }, operation: 'report',
        selector: { type: 'relative_period', value: 'yesterday' }, groupBy: 'player', metrics: ['kills', 'kd', 'revives', 'rank'],
        orderBy: { metric: 'kills', direction: 'desc' }, limit: null,
        reference: { sessionId: f.session, selectorExplicit: true, subjectExplicit: true, planner: 'provided' }, ...scenario.query
});
      const engine = new DeterministicQueryEngine({ teamContext: f.context, now: new Date(scenario.now ?? f.input.now) }), coverage = { ...f.input.coverage, ...scenario.coverage };
      const privateResult = engine.execute(query, await f.privateRepo.listMatches(), coverage, f.input.source), publicResult = engine.execute(query, await f.publicRepo.listMatches(), coverage, f.input.source);
      assert.deepEqual(publicResult, privateResult, scenario.id); assert.equal(publicResult.status, scenario.expected.status); assert.deepEqual(publicResult.evidence.matchIds, scenario.expected.matchIds);
      for (const [key, metrics] of Object.entries(scenario.expected.metrics)) {
        const row = publicResult.data.rows.find(item => item.key === key); assert.ok(row, `${scenario.id}: missing row ${key}`);
        for (const [metric, value] of Object.entries(metrics)) assert.equal(row.metrics[metric], value, `${scenario.id}: ${key}.${metric}`);
      }
    }
  } finally { await f.cleanup(); }
});

test('SQLite and PostgreSQL resolve named periods and produce identical stats presentations', { skip: !databaseUrl }, async () => {
  const f = await fixture(); try {
    const service = (repository: PubgRepositoryPort) => new PubgDomainService({
      teamContext: f.context,
      repository,
      now: () => new Date(f.input.now),
    });
    const sqlite = service(f.privateRepo), postgres = service(f.publicRepo);
    const expectedRanges: Record<string, [string, string]> = {
      today: ['2026-09-18T22:00:00.000Z', f.input.now],
      yesterday: ['2026-09-17T22:00:00.000Z', '2026-09-18T22:00:00.000Z'],
      last_night: ['2026-09-18T10:00:00.000Z', '2026-09-18T22:00:00.000Z'],
      last_7_days: ['2026-09-12T00:30:00.000Z', f.input.now],
      previous_7_days: ['2026-09-05T00:30:00.000Z', '2026-09-12T00:30:00.000Z'],
      this_week: ['2026-09-13T22:00:00.000Z', f.input.now],
      last_week: ['2026-09-06T22:00:00.000Z', '2026-09-13T22:00:00.000Z'],
    };
    for (const [period, [start, end]] of Object.entries(expectedRanges)) {
      const input = { sessionId: f.session, selector: { type: 'relative_period' as const, value: period }, metrics: ['matches', 'kills', 'damage'] as Metric[], refresh: false };
      const [privateEnvelope, publicEnvelope] = await Promise.all([sqlite.queryStats(input), postgres.queryStats(input)]);
      assert.deepEqual(publicEnvelope.data, privateEnvelope.data, `${period} stats`);
      assert.deepEqual(publicEnvelope.evidenceRefs, privateEnvelope.evidenceRefs, `${period} evidence`);
      const resolved = publicEnvelope.queryResolved.resolvedSelector as { start: string; end: string };
      assert.deepEqual([resolved.start, resolved.end], [start, end], `${period} resolved range`);
      const privatePresentation = presentEnvelope(privateEnvelope, 'pubg_query_stats');
      const publicPresentation = presentEnvelope(publicEnvelope, 'pubg_query_stats');
      assert.deepEqual(publicPresentation.presentation, privatePresentation.presentation, `${period} structured presentation`);
      assert.equal(publicPresentation.displayText, privatePresentation.displayText, `${period} rendered presentation`);
      assert.equal(publicPresentation.presentation.coverage?.freshness, privatePresentation.presentation.coverage?.freshness);
    }
    const recentDaysInput = {
      sessionId: f.session,
      selector: { type: 'recent_days' as const, count: 3 },
      metrics: ['matches', 'kills', 'damage'] as Metric[],
      refresh: false,
    };
    const [privateRecentDays, publicRecentDays] = await Promise.all([
      sqlite.queryStats(recentDaysInput), postgres.queryStats(recentDaysInput),
    ]);
    const resolvedRecentDays = publicRecentDays.queryResolved.resolvedSelector as { start: string; end: string };
    assert.deepEqual([resolvedRecentDays.start, resolvedRecentDays.end], ['2026-09-16T22:00:00.000Z', f.input.now]);
    assert.deepEqual(publicRecentDays.data, privateRecentDays.data, 'recent three business days stats');
    assert.deepEqual(publicRecentDays.evidenceRefs, privateRecentDays.evidenceRefs, 'recent three business days evidence');
    const privateRecentPresentation = presentEnvelope(privateRecentDays, 'pubg_query_stats');
    const publicRecentPresentation = presentEnvelope(publicRecentDays, 'pubg_query_stats');
    assert.deepEqual(publicRecentPresentation.presentation, privateRecentPresentation.presentation, 'recent three days structured presentation');
    assert.equal(publicRecentPresentation.displayText, privateRecentPresentation.displayText, 'recent three days rendered presentation');
  } finally { await f.cleanup(); }
});

test('SQLite and PostgreSQL preserve damage/kick/melee facts, evidence, cache versions, partial unknowns and successful zero', { skip: !databaseUrl }, async () => {
  const f = await fixture(); try {
    const service = (repo: PubgRepositoryPort, version: string, mode: 'full' | 'partial' | 'zero' | 'unavailable') => new PubgDomainService({
teamContext: f.context, repository: repo, now: () => new Date(f.input.now),
      telemetryWorker: new TelemetryWorker({
team: f.input.team, store: repo, featureVersion: version,
        ...(mode === 'unavailable' ? {} : { downloader: { async download(match) { if (mode === 'partial' && match.matchId === f.names.get('late')) throw new Error('fixture_telemetry_unavailable'); return { events: mode === 'zero' ? [] : f.input.telemetry[match.matchId] ?? [] }; } } }),
      }),
    });
    async function pair(left: PubgDomainService, right: PubgDomainService, filter: Partial<TeamDamageQueryInput> = {}): Promise<ToolEnvelope<Record<string, unknown>>> {
      const input: TeamDamageQueryInput = { sessionId: f.session, selector: { type: 'relative_period', value: 'yesterday' }, refresh: false, ...filter };
      const a = await left.queryTeamDamage(input), b = await right.queryTeamDamage(input); assert.deepEqual(b, a); return b as ToolEnvelope<Record<string, unknown>>;
    }
    const privateFull = service(f.privateRepo, 'edge-full', 'full'), publicFull = service(f.publicRepo, 'edge-full', 'full');
    const all = await pair(privateFull, publicFull); assert.equal(all.status, 'ok'); assert.deepEqual([all.data.totalHitCount, all.data.totalDamage], f.input.damageExpected.all);
    const sqliteDisplay = presentEnvelope(await privateFull.queryTeamDamage({ sessionId: f.session, selector: { type: 'relative_period', value: 'yesterday' }, refresh: false }), 'pubg_query_team_damage', { aggregateByActor: true });
    const postgresDisplay = presentEnvelope(await publicFull.queryTeamDamage({ sessionId: f.session, selector: { type: 'relative_period', value: 'yesterday' }, refresh: false }), 'pubg_query_team_damage', { aggregateByActor: true });
    assert.deepEqual(postgresDisplay.presentation, sqliteDisplay.presentation, 'friendly damage presentation');
    assert.equal(postgresDisplay.presentation.type, 'pubg_team_damage');
    if (postgresDisplay.presentation.type === 'pubg_team_damage') {
      assert.equal(postgresDisplay.presentation.rankingBasis, 'damage');
      assert.ok(postgresDisplay.presentation.actorTotals?.every(total => total.damage !== null && total.hitCount !== null));
    }
    assert.deepEqual(all.evidenceRefs.matchIds, [f.names.get('boundary'), f.names.get('late')]);
    for (const [kind, filter] of Object.entries({ kick: { actorPlayer: 'a', victimPlayer: 'b', source: 'MELEE' as const, meleeKind: 'KICK' as const }, punch: { source: 'MELEE' as const, meleeKind: 'PUNCH' as const }, melee: { source: 'MELEE' as const } })) {
      const result = await pair(privateFull, publicFull, filter); assert.deepEqual([result.data.totalHitCount, result.data.totalDamage], f.input.damageExpected[kind]);
    }
    const key = { matchId: f.names.get('boundary')!, parserVersion: new TelemetryWorker({ team: f.input.team }).parserVersion, featureVersion: 'edge-full' };
    const privateFacts = await f.privateRepo.get(key), publicFacts = await f.publicRepo.get(key); assert.ok(privateFacts); assert.ok(publicFacts); assert.deepEqual(publicFacts.facts, privateFacts.facts); assert.equal(publicFacts.facts.combat.events.length, 0);
    for (const fact of publicFacts.facts.teamDamage ?? []) {
      const derivedEvidence: ReviewEvidence | undefined = publicFacts.facts.evidence.find(item => item.id === `evidence-${fact.id}`); assert.ok(derivedEvidence);
      assert.deepEqual(derivedEvidence.eventIds, fact.evidenceIds);
    }
    const partial = await pair(service(f.privateRepo, 'edge-partial', 'partial'), service(f.publicRepo, 'edge-partial', 'partial'));
    assert.equal(partial.status, 'partial'); assert.equal(partial.data.totalHitCount, null); assert.equal(partial.data.totalDamage, null);
    assert.deepEqual([partial.data.knownHitCount, partial.data.knownDamage], f.input.damageExpected.partialKnown); assert.equal(partial.coverage.complete, false); assert.deepEqual(partial.coverage.failedMatchIds, [f.names.get('late')]);
    const partialPresentation = presentEnvelope(partial, 'pubg_query_team_damage', { aggregateByActor: true }).presentation;
    assert.equal(partialPresentation.type, 'pubg_team_damage');
    if (partialPresentation.type === 'pubg_team_damage') {
      assert.equal(partialPresentation.rankingBasis, 'knownDamage');
      assert.ok(partialPresentation.actorTotals?.every(total => total.damage === null && total.hitCount === null));
    }
    const unknown = await pair(service(f.privateRepo, 'edge-unavailable', 'unavailable'), service(f.publicRepo, 'edge-unavailable', 'unavailable'));
    assert.equal(unknown.status, 'partial'); assert.equal(unknown.data.totalHitCount, null); assert.equal(unknown.data.totalDamage, null); assert.equal(unknown.data.knownHitCount, 0);
    const zero = await pair(service(f.privateRepo, 'edge-zero', 'zero'), service(f.publicRepo, 'edge-zero', 'zero'));
    assert.equal(zero.status, 'ok'); assert.deepEqual([zero.data.totalHitCount, zero.data.totalDamage], f.input.damageExpected.knownZero); assert.equal(zero.coverage.complete, true);
    // The private adapter reopens its own file; the public adapter uses a new
    // pool. Both must serve the persisted facts with no telemetry downloader.
    f.closePrivate(); const reopened = new SqlitePubgRepository(f.path), publicPool = new Pool({ connectionString: databaseUrl, max: 3 });
    try {
      const reopenedPrivate = new SqlitePubgRepositoryAdapter(reopened, f.context), reopenedPublic = new PostgresPubgRepository(publicPool, f.context, f.conversation);
      const cached = await pair(service(reopenedPrivate, 'edge-full', 'unavailable'), service(reopenedPublic, 'edge-full', 'unavailable'));
      assert.equal(cached.status, 'ok'); assert.deepEqual([cached.data.totalHitCount, cached.data.totalDamage], f.input.damageExpected.all);
      assert.deepEqual((cached.data.telemetry as { statusCounts: unknown }).statusCounts, { HIT: 2 });
    } finally { reopened.close(); await publicPool.end(); }
  } finally { await f.cleanup(); }
});
