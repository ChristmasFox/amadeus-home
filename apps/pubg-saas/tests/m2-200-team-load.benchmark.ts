/**
 * Synthetic M2 benchmark. Run explicitly with:
 *   PUBG_SAAS_TEST_DATABASE_URL=... pnpm --filter @agent/pubg-saas exec tsx tests/m2-200-team-load.benchmark.ts
 *   PUBG_SAAS_BENCH_QUERIES_PER_TEAM=30 replays 6,000 scoped query tasks plus
 *   a 200-contender PostgreSQL global-admission/429-reset simulation.
 *   PUBG_SAAS_BENCH_MATCHES_PER_TEAM=200 seeds 160,000 match-player rows.
 *   PUBG_SAAS_BENCH_TASK_INTERVAL_MS=100 staggers query-task starts over time.
 *
 * This is a local, bounded simulation; it is not a production capacity test.
 */
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type QueryResult } from 'pg';
import { createTeamContext } from '@agent/pubg-domain/core';
import { migratePublicDatabase } from '../src/infrastructure/postgres/migrate.js';
import { PostgresPubgRepository } from '../src/infrastructure/postgres/pubg-repository.js';
import { PostgresPublicPubgAdmission } from '../src/infrastructure/pubg/request-limiter.js';
import { PublicSyncWorker } from '../src/application/public-sync-worker.js';

const TEAM_COUNT = 200;
const PLAYERS_PER_TEAM = 4;
const MATCHES_PER_TEAM = boundedInteger(process.env.PUBG_SAAS_BENCH_MATCHES_PER_TEAM, 2, 2, 500, 'benchmark_matches_per_team_invalid');
const MATCH_LIST_WINDOW = 3;
const TEST_DATABASE_URL = process.env.PUBG_SAAS_TEST_DATABASE_URL;
const CONCURRENCY = boundedInteger(
  process.env.PUBG_SAAS_BENCH_CONCURRENCY,
  8,
  1,
  16,
  'benchmark_concurrency_invalid',
);
// At most 10,000 query tasks: 200 teams × 50 requests/team.
const QUERIES_PER_TEAM = boundedInteger(process.env.PUBG_SAAS_BENCH_QUERIES_PER_TEAM, 1, 1, 50);
const TASK_INTERVAL_MS = boundedInteger(process.env.PUBG_SAAS_BENCH_TASK_INTERVAL_MS, 0, 0, 1_000, 'benchmark_task_interval_invalid');

interface QuerySample {
  phase: string;
  elapsedMs: number;
  failed: boolean;
  verb: string;
}

interface PhaseSamples {
  queries: number;
  failures: number;
  elapsedMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  queriesPerSecond: number;
  queryVerbs: Record<string, number>;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  errorCode: string = 'benchmark_queries_per_team_invalid',
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(errorCode);
  }
  return parsed;
}

function assertSafeTestDatabase(connectionString: string | undefined): URL {
  if (!connectionString) throw new Error('PUBG_SAAS_TEST_DATABASE_URL_required');
  const url = new URL(connectionString);
  const host = url.hostname.toLowerCase();
  const database = decodeURIComponent(url.pathname.replace(/^\//u, ''));
  const localHost = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
  if (!localHost.has(host) || database !== 'pubg_test') {
    throw new Error('benchmark_refuses_non_local_pubg_test_database');
  }
  return url;
}

function sqlVerb(args: unknown[]): string {
  const first = args[0];
  const sql = typeof first === 'string'
    ? first
    : first && typeof first === 'object' && 'text' in first && typeof first.text === 'string'
      ? first.text
      : '';
  return sql.trim().split(/\s+/u).slice(0, 2).join(' ').toUpperCase() || 'UNKNOWN';
}

function instrumentPool(pool: Pool, samples: QuerySample[], phase: () => string): Pool {
  const instrumentClient = (client: PoolClient): PoolClient => new Proxy(client, {
    get(target, property, receiver) {
      if (property !== 'query') return Reflect.get(target, property, receiver);
      return (...args: unknown[]) => measureQuery(samples, phase(), sqlVerb(args), () =>
        Reflect.apply(target.query, target, args) as Promise<QueryResult>);
    },
  });

  return new Proxy(pool, {
    get(target, property, receiver) {
      if (property === 'query') {
        return (...args: unknown[]) => measureQuery(samples, phase(), sqlVerb(args), () =>
          Reflect.apply(target.query, target, args) as Promise<QueryResult>);
      }
      if (property === 'connect') {
        return async (...args: unknown[]) => instrumentClient(await Reflect.apply(target.connect, target, args) as PoolClient);
      }
      return Reflect.get(target, property, receiver);
    },
  }) as Pool;
}

async function measureQuery<T>(
  samples: QuerySample[],
  activePhase: string,
  verb: string,
  action: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  let failed = false;
  try {
    return await action();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    samples.push({ phase: activePhase, elapsedMs: performance.now() - started, failed, verb });
  }
}

function percentile(values: number[], rank: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(rank * sorted.length) - 1)] ?? 0;
}

function summarize(samples: QuerySample[], phase: string, elapsedMs: number): PhaseSamples {
  const selected = samples.filter(sample => sample.phase === phase);
  const durations = selected.map(sample => sample.elapsedMs);
  const queryVerbs: Record<string, number> = {};
  for (const sample of selected) queryVerbs[sample.verb] = (queryVerbs[sample.verb] ?? 0) + 1;
  return {
    queries: selected.length,
    failures: selected.filter(sample => sample.failed).length,
    elapsedMs: round(elapsedMs),
    p50Ms: round(percentile(durations, 0.5)),
    p95Ms: round(percentile(durations, 0.95)),
    p99Ms: round(percentile(durations, 0.99)),
    queriesPerSecond: round(elapsedMs > 0 ? selected.length / (elapsedMs / 1000) : 0),
    queryVerbs,
  };
}

async function simulateGlobalPubgAdmission(pool: Pool): Promise<{
  configuredRequestsPerMinute: number;
  concurrentTeams: number;
  immediatelyAdmitted: number;
  initiallyDeferred: number;
  post429Blocked: number;
  resetPermitGranted: boolean;
  providerObservedLimitEnforced: boolean;
  failures: string[];
}> {
  const admission = new PostgresPublicPubgAdmission(pool, 10, 0);
  const burst = await Promise.all(Array.from({ length: TEAM_COUNT }, () => admission.tryAcquire()));
  const immediatelyAdmitted = burst.filter(waitMs => waitMs === 0).length;
  const initiallyDeferred = burst.filter(waitMs => waitMs > 0).length;
  const failures: string[] = [];
  if (immediatelyAdmitted !== 1 || initiallyDeferred !== TEAM_COUNT - 1) {
    failures.push('global_admission_did_not_serialize_team_burst');
  }

  await admission.observe(new Headers({
    'x-ratelimit-limit': '2',
    'x-ratelimit-remaining': '0',
    'x-ratelimit-reset': String(Math.ceil(Date.now() / 1000) + 60),
  }), 429);
  const after429 = await Promise.all(Array.from({ length: TEAM_COUNT }, () => admission.tryAcquire()));
  const post429Blocked = after429.filter(waitMs => waitMs > 50_000).length;
  if (post429Blocked !== TEAM_COUNT) failures.push('provider_429_pause_not_shared');

  await pool.query(
    `UPDATE pubg_api_admission
     SET blocked_until=NULL,next_request_at=clock_timestamp()-interval '1 second',
         reserved_at=clock_timestamp()-interval '1 second'
     WHERE quota_scope='public-pubg'`,
  );
  const resetPermitGranted = await admission.tryAcquire() === 0;
  if (!resetPermitGranted) failures.push('global_admission_did_not_resume_after_reset');
  const providerObservedLimitEnforced = await admission.tryAcquire() > 29_000;
  if (!providerObservedLimitEnforced) failures.push('provider_observed_limit_not_enforced');

  return {
    configuredRequestsPerMinute: 10,
    concurrentTeams: TEAM_COUNT,
    immediatelyAdmitted,
    initiallyDeferred,
    post429Blocked,
    resetPermitGranted,
    providerObservedLimitEnforced,
    failures,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

async function concurrentMap<T>(count: number, concurrency: number, task: (index: number) => Promise<T>): Promise<T[]> {
  const results = new Array<T>(count);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(count, concurrency) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= count) return;
      results[index] = await task(index);
    }
  }));
  return results;
}

async function staggeredMap<T>(
  count: number,
  concurrency: number,
  taskIntervalMs: number,
  task: (index: number) => Promise<T>,
): Promise<T[]> {
  if (taskIntervalMs === 0) return concurrentMap(count, concurrency, task);
  const results = new Array<T>(count);
  const startedAt = performance.now();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(count, concurrency) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= count) return;
      const waitMs = startedAt + index * taskIntervalMs - performance.now();
      if (waitMs > 0) await new Promise<void>(resolve => setTimeout(resolve, waitMs));
      results[index] = await task(index);
    }
  }));
  return results;
}

function collectPoolPeaks(pool: Pool): { stop: () => Record<string, number> } {
  let peakTotal = 0;
  let peakActive = 0;
  let peakWaiting = 0;
  const timer = setInterval(() => {
    peakTotal = Math.max(peakTotal, pool.totalCount);
    peakActive = Math.max(peakActive, pool.totalCount - pool.idleCount);
    peakWaiting = Math.max(peakWaiting, pool.waitingCount);
  }, 10);
  timer.unref();
  return {
    stop: () => {
      clearInterval(timer);
      return { peakTotal, peakActive, peakWaiting };
    },
  };
}

function collectProcessMemoryPeaks(): {
  stop: () => {
    sampleIntervalMs: number;
    baselineRssBytes: number;
    peakRssBytes: number;
    peakHeapUsedBytes: number;
    peakExternalBytes: number;
    peakArrayBuffersBytes: number;
  };
} {
  const baseline = process.memoryUsage();
  let peakRssBytes = baseline.rss;
  let peakHeapUsedBytes = baseline.heapUsed;
  let peakExternalBytes = baseline.external;
  let peakArrayBuffersBytes = baseline.arrayBuffers;
  const sample = () => {
    const memory = process.memoryUsage();
    peakRssBytes = Math.max(peakRssBytes, memory.rss);
    peakHeapUsedBytes = Math.max(peakHeapUsedBytes, memory.heapUsed);
    peakExternalBytes = Math.max(peakExternalBytes, memory.external);
    peakArrayBuffersBytes = Math.max(peakArrayBuffersBytes, memory.arrayBuffers);
  };
  const timer = setInterval(sample, 10);
  timer.unref();
  return {
    stop: () => {
      clearInterval(timer);
      sample();
      return {
        sampleIntervalMs: 10,
        baselineRssBytes: baseline.rss,
        peakRssBytes,
        peakHeapUsedBytes,
        peakExternalBytes,
        peakArrayBuffersBytes,
      };
    },
  };
}

async function seedSyntheticFixture(pool: Pool, suffix: string) {
  const tenants: string[] = [];
  const guilds: string[] = [];
  const botAccountId = `m2-bot-${suffix}`;
  const teams: Array<{ tenantId: string; teamId: string; accounts: string[]; users: string[]; matches: string[] }> = [];

  for (let index = 0; index < TEAM_COUNT; index += 1) {
    const tenantId = `m2-tenant-${suffix}-${index}`;
    const teamId = `m2-team-${suffix}-${index}`;
    const accounts = Array.from({ length: PLAYERS_PER_TEAM }, (_, playerIndex) => `account.m2_${suffix}_${index}_${playerIndex}`);
    const users = Array.from({ length: PLAYERS_PER_TEAM }, (_, playerIndex) => `m2-user-${suffix}-${index}-${playerIndex}`);
    const matches = Array.from({ length: MATCHES_PER_TEAM }, (_, matchIndex) => `m2-match-${suffix}-${index}-${matchIndex}`);
    tenants.push(tenantId);
    guilds.push(`m2-guild-${suffix}-${index}`);
    teams.push({ tenantId, teamId, accounts, users, matches });
  }

  await pool.query(
    `INSERT INTO tenants(tenant_id,platform,bot_account_id,guild_id)
     SELECT tenant_id,'kook',$3,guild_id FROM unnest($1::text[],$2::text[]) AS fixture(tenant_id,guild_id)`,
    [tenants, guilds, botAccountId],
  );
  await pool.query(
    `INSERT INTO teams(tenant_id,team_id,label,pubg_shard)
     SELECT tenant_id,team_id,'Synthetic M2 Team','steam' FROM unnest($1::text[],$2::text[]) AS fixture(tenant_id,team_id)`,
    [teams.map(team => team.tenantId), teams.map(team => team.teamId)],
  );
  const memberTenantIds: string[] = [];
  const memberTeamIds: string[] = [];
  const memberAccountIds: string[] = [];
  for (const team of teams) {
    for (const accountId of team.accounts) {
      memberTenantIds.push(team.tenantId);
      memberTeamIds.push(team.teamId);
      memberAccountIds.push(accountId);
    }
  }
  await pool.query(
    `INSERT INTO team_members(tenant_id,team_id,pubg_account_id,added_by_user_id)
     SELECT tenant_id,team_id,pubg_account_id,'m2-synthetic-fixture'
     FROM unnest($1::text[],$2::text[],$3::text[]) AS fixture(tenant_id,team_id,pubg_account_id)`,
    [memberTenantIds, memberTeamIds, memberAccountIds],
  );
  const userTenantIds: string[] = [];
  const userIds: string[] = [];
  const claimedAccounts: string[] = [];
  for (const team of teams) {
    for (const [index, userId] of team.users.entries()) {
      userTenantIds.push(team.tenantId);
      userIds.push(userId);
      claimedAccounts.push(team.accounts[index]!);
    }
  }
  await pool.query(
    `INSERT INTO channel_identities(platform,bot_account_id,user_id,display_name)
     SELECT 'kook',$1,user_id,'Synthetic User' FROM unnest($2::text[]) AS fixture(user_id)`,
    [botAccountId, userIds],
  );
  await pool.query(
    `INSERT INTO tenant_users(tenant_id,platform,bot_account_id,user_id)
     SELECT tenant_id,'kook',$3,user_id FROM unnest($1::text[],$2::text[]) AS fixture(tenant_id,user_id)`,
    [userTenantIds, userIds, botAccountId],
  );
  await pool.query(
    `INSERT INTO account_claims(platform,bot_account_id,user_id,pubg_shard,pubg_account_id,claim_status)
     SELECT 'kook',$1,user_id,'steam',account_id,'verified'
     FROM unnest($2::text[],$3::text[]) AS fixture(user_id,account_id)`,
    [botAccountId, userIds, claimedAccounts],
  );

  const matchIds: string[] = [];
  const timestamps: string[] = [];
  const playerMatchIds: string[] = [];
  const playerAccountIds: string[] = [];
  const playerNames: string[] = [];
  const ranks: number[] = [];
  const kills: number[] = [];
  const damages: number[] = [];
  for (const [teamIndex, team] of teams.entries()) {
    for (const [matchIndex, matchId] of team.matches.entries()) {
      matchIds.push(matchId);
      timestamps.push(new Date(Date.now() - (matchIndex + 1) * 60_000).toISOString());
      for (const [playerIndex, accountId] of team.accounts.entries()) {
        playerMatchIds.push(matchId);
        playerAccountIds.push(accountId);
        playerNames.push(`Synthetic-${teamIndex}-${playerIndex}`);
        ranks.push(playerIndex + 1);
        kills.push((teamIndex + matchIndex + playerIndex) % 8);
        damages.push(100 + teamIndex + matchIndex * 10 + playerIndex);
      }
    }
  }
  const timestampMs = timestamps.map(value => Date.parse(value));
  await pool.query(
    `INSERT INTO matches(match_id,shard,created_at,timestamp_ms,match_type,game_mode,is_competitive,map_name,duration,patch_version,schema_version,fetched_at,source,checked_player_ids_json)
     SELECT match_id,'steam',created_at,timestamp_ms,'synthetic','squad-fpp',false,'Synthetic_Map',1200,'m2-benchmark',3,now(),'m2-synthetic', '[]'::jsonb
     FROM unnest($1::text[],$2::text[],$3::bigint[]) AS fixture(match_id,created_at,timestamp_ms)`,
    [matchIds, timestamps, timestampMs],
  );
  const rowCount = playerMatchIds.length;
  await pool.query(
    `INSERT INTO match_players(shard,match_id,account_id,player_name,display_name,rank,kills,assists,damage,dbnos,revives,headshot_kills,survival_time,longest_kill,deaths,death_semantics)
     SELECT 'steam',match_id,account_id,player_name,player_name,rank,kills,0,damage,0,0,0,900,0,1,'synthetic'
     FROM unnest($1::text[],$2::text[],$3::text[],$4::float8[],$5::float8[],$6::float8[]) AS fixture(match_id,account_id,player_name,rank,kills,damage)`,
    [playerMatchIds, playerAccountIds, playerNames, ranks, kills, damages],
  );

  return {
    teams,
    contexts: teams.map((team, index) => createTeamContext(team.tenantId, {
      id: team.teamId,
      label: `Synthetic Team ${index}`,
      platform: 'steam',
      players: team.accounts.map((id, playerIndex) => ({ id, name: `Synthetic-${index}-${playerIndex}`, aliases: [] })),
    })),
    expectedMatchCount: MATCHES_PER_TEAM,
    fixtures: { tenants: tenants.length, teams: teams.length, users: userIds.length, rosterAccounts: memberAccountIds.length, matches: matchIds.length, matchPlayers: rowCount },
  };
}

async function main(): Promise<void> {
  const databaseUrl = assertSafeTestDatabase(TEST_DATABASE_URL);
  const schema = `m2_bench_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  let pool: Pool | undefined;
  let sampler: ReturnType<typeof collectPoolPeaks> | undefined;
  let processMemorySampler: ReturnType<typeof collectProcessMemoryPeaks> | undefined;
  const samples: QuerySample[] = [];
  let phase = 'idle';

  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: TEST_DATABASE_URL, options: `-c search_path=${schema}`, max: Math.min(32, CONCURRENCY * 2 + 4) });
    await migratePublicDatabase(pool);
    processMemorySampler = collectProcessMemoryPeaks();
    const fixture = await seedSyntheticFixture(pool, randomUUID().replaceAll('-', '').slice(0, 12));

    const measuredPool = instrumentPool(pool, samples, () => phase);
    const peakSampler = collectPoolPeaks(pool);
    sampler = peakSampler;
    const queryConcurrency = CONCURRENCY;
    const queryStarted = performance.now();
    phase = 'authorized_queries';
    const queryFailures: Array<{ code: string; index: number }> = [];
    const expectedQueryTasks = fixture.contexts.length * QUERIES_PER_TEAM;
    const queryResults = await staggeredMap(expectedQueryTasks, queryConcurrency, TASK_INTERVAL_MS, async index => {
      try {
        const teamIndex = index % fixture.contexts.length;
        const context = fixture.contexts[teamIndex]!;
        const team = fixture.teams[teamIndex]!;
        const repository = new PostgresPubgRepository(measuredPool, context);
        const [count, visible] = await Promise.all([
          repository.countMatches(),
          repository.listMatches({ limit: MATCH_LIST_WINDOW }),
        ]);
        const expectedWindowMatches = Math.min(fixture.expectedMatchCount, MATCH_LIST_WINDOW);
        if (count !== fixture.expectedMatchCount || visible.length !== expectedWindowMatches) {
          throw new Error('authorized_match_count_mismatch');
        }
        if (visible.some(match => !team.matches.includes(match.matchId)
          || match.players.some(player => !team.accounts.includes(player.accountId)))) {
          throw new Error('authorized_result_scope_mismatch');
        }
        const first = visible[0];
        if (!first || (await repository.getMatch(first.matchId))?.players.length !== PLAYERS_PER_TEAM) {
          throw new Error('authorized_get_match_mismatch');
        }
        const nextTeam = fixture.teams[(index + 1) % fixture.teams.length]!;
        if (await repository.getMatch(nextTeam.matches[0]!) !== null) {
          throw new Error('cross_tenant_match_visible');
        }
        return { ok: true, queries: 4 };
      } catch (error) {
        queryFailures.push({ code: safeErrorCode(error), index });
        return { ok: false, queries: 0 };
      }
    });
    const queryElapsedMs = performance.now() - queryStarted;
    phase = 'idle';
    const queryPhase = summarize(samples, 'authorized_queries', queryElapsedMs);
    const validQueryTasks = queryResults.filter(result => result.ok).length;

    phase = 'worker_reads';
    const workerStarted = performance.now();
    const workerConcurrency = Math.min(CONCURRENCY, 8);
    const workerFailures: Array<{ code: string; worker: number; teamsFailed: number }> = [];
    const workerResults = await concurrentMap(workerConcurrency, workerConcurrency, async workerIndex => {
      try {
        const worker = new PublicSyncWorker(measuredPool, {
          apiKey: 'synthetic-only-never-sent-to-network',
          admission: { acquire: async () => undefined, observe: async () => undefined },
          fetchImpl: async () => Response.json({ data: [] }),
          maxMatches: 1,
          maxTelemetryFetches: 1,
          telemetryConcurrency: 1,
          teamConcurrency: 2,
        });
        const result = await worker.runOnce();
        if (result.teamsDiscovered !== TEAM_COUNT || result.teamsFailed !== 0) {
          workerFailures.push({ code: 'worker_team_result_mismatch', worker: workerIndex, teamsFailed: result.teamsFailed });
        }
        return result;
      } catch (error) {
        workerFailures.push({ code: safeErrorCode(error), worker: workerIndex, teamsFailed: -1 });
        return null;
      }
    });
    const workerElapsedMs = performance.now() - workerStarted;
    phase = 'idle';
    const workerPhase = summarize(samples, 'worker_reads', workerElapsedMs);
    phase = 'global_pubg_admission';
    const admissionStarted = performance.now();
    const admissionResult = await simulateGlobalPubgAdmission(measuredPool);
    const admissionElapsedMs = performance.now() - admissionStarted;
    phase = 'idle';
    const admissionPhase = summarize(samples, 'global_pubg_admission', admissionElapsedMs);
    const peakConnections = sampler.stop();
    sampler = undefined;
    const processMemoryObservation = processMemorySampler.stop();
    processMemorySampler = undefined;

    const totalExpectedWorkerTeamRuns = TEAM_COUNT;
    const totalAttemptedWorkerTeamRuns = workerResults.reduce((sum, result) => sum + (result?.teamsAttempted ?? 0), 0);
    const totalCompletedWorkerTeamRuns = workerResults.reduce((sum, result) => sum + (result?.teamsCompleted ?? 0), 0);
    const allFailures = queryFailures.length + workerFailures.length + queryPhase.failures + workerPhase.failures + admissionResult.failures.length + admissionPhase.failures;
    const report = {
      benchmark: 'pubg-saas-m2-synthetic-200-team',
      scope: 'local isolated schema; synthetic identifiers and match data; no live PUBG/KOOK/model calls',
      target: { host: databaseUrl.hostname, database: decodeURIComponent(databaseUrl.pathname.replace(/^\//u, '')), schema },
        concurrency: { authorizedQueryTasks: queryConcurrency, independentWorkerRuns: workerConcurrency, poolMax: pool.options.max },
      fixture: { ...fixture.fixtures, matchesPerTeam: MATCHES_PER_TEAM, matchListWindow: MATCH_LIST_WINDOW },
      authorizedQueryPhase: {
        ...queryPhase,
        teams: fixture.contexts.length,
        queriesPerTeam: QUERIES_PER_TEAM,
        tasks: expectedQueryTasks,
        pacing: TASK_INTERVAL_MS === 0
          ? 'burst replay; daily volume is not spread across 24 hours'
          : `task starts staggered every ${TASK_INTERVAL_MS} ms; synthetic replay, not a 24-hour schedule`,
        taskStartIntervalMs: TASK_INTERVAL_MS,
        targetTaskStartRatePerSecond: TASK_INTERVAL_MS === 0 ? null : round(1000 / TASK_INTERVAL_MS),
        targetScheduleDurationMs: TASK_INTERVAL_MS === 0 ? 0 : Math.max(0, expectedQueryTasks - 1) * TASK_INTERVAL_MS,
        taskThroughputPerSecond: round(validQueryTasks / (queryElapsedMs / 1000)),
        failures: queryFailures.length + queryPhase.failures,
        failureCodes: countCodes(queryFailures.map(item => item.code)),
      },
      workerReadPhase: {
        ...workerPhase,
        concurrentRuns: workerConcurrency,
        teamConcurrencyPerRun: 2,
        expectedTeamRuns: totalExpectedWorkerTeamRuns,
        attemptedTeamRuns: totalAttemptedWorkerTeamRuns,
        completedTeamRuns: totalCompletedWorkerTeamRuns,
        teamRunsPerSecond: round(totalCompletedWorkerTeamRuns / (workerElapsedMs / 1000)),
        failures: workerFailures.length + workerPhase.failures,
        failureCodes: countCodes(workerFailures.map(item => item.code)),
      },
      globalPubgAdmissionPhase: {
        ...admissionPhase,
        ...admissionResult,
      },
      poolObservation: peakConnections,
      processMemoryObservation,
      totalFailures: allFailures,
      caveat: 'A bounded local synthetic benchmark; results do not establish production capacity or service-level objectives.',
    };
    console.log(JSON.stringify(report, null, 2));
    if (allFailures !== 0 || validQueryTasks !== expectedQueryTasks
      || totalCompletedWorkerTeamRuns !== totalExpectedWorkerTeamRuns
      || admissionResult.failures.length !== 0) process.exitCode = 1;
  } finally {
    sampler?.stop();
    processMemorySampler?.stop();
    try {
      await pool?.end();
    } finally {
      try {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await admin.end();
      }
    }
  }
}

function safeErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code;
  if (error instanceof Error && /^[a-z0-9_]+$/iu.test(error.message)) return error.message;
  return error instanceof Error ? error.name : 'unknown_error';
}

function countCodes(codes: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const code of codes) result[code] = (result[code] ?? 0) + 1;
  return result;
}

await main();
