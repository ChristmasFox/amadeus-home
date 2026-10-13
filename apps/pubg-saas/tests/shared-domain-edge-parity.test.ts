import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Pool } from 'pg';
import {
  CanonicalQuerySchema, createTeamContext, DeterministicQueryEngine, PubgDomainService, SqlitePubgRepository,
  SqlitePubgRepositoryAdapter, TelemetryWorker, type Coverage, type PubgRepositoryPort, type SourceInfo, type TeamConfig,
  type ReviewEvidence, type TeamDamageQueryInput, type ToolEnvelope,
} from '@agent/pubg-domain';
import { migratePublicDatabase, PostgresPubgRepository } from '../src/index.js';
const databaseUrl = process.env.PUBG_SAAS_TEST_DATABASE_URL;
interface EdgeFixture {
  contract: string; now: string; team: TeamConfig; matches: Array<{ matchId: string; players: Array<{ accountId: string }> }>;
  coverage: Coverage; source: SourceInfo;
  cases: Array<{ id: string; now?: string; query: Record<string, unknown>; coverage?: Partial<Coverage>; expected: { status: string; matchIds: string[]; metrics: Record<string, Record<string, number | null>> } }>;
  telemetry: Record<string, unknown[]>; damageExpected: Record<string, [number, number]>;
}
const original = JSON.parse(readFileSync(new URL('../../../packages/pubg-domain/tests/fixtures/shared-edge-cases.json', import.meta.url), 'utf8')) as EdgeFixture;
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
