import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MockLanguageModelV4 } from 'ai/test';
import {
  NaturalLanguageQueryPlanner,
  type QueryPlan,
} from '../src/application/nl-query-planner.js';
import { createSyntheticPromptBenchmarkDataset } from './fixtures/nl-query-synthetic-corpus.js';
import { exportSyntheticPromptBenchmarkDataset } from './export-synthetic-nl-query-benchmark.js';
import {
  compareQueryPlans,
  parsePromptBenchmarkDataset,
  PromptBenchmarkDatasetSchema,
  runPromptBenchmark,
} from './nl-query-provider.benchmark.js';

const plan: QueryPlan = {
  version: 1,
  intent: 'team_stats',
  subject: 'team',
  playerName: null,
  actorName: null,
  victimName: null,
  metric: 'kills',
  period: 'today',
  comparePeriod: null,
  matchCount: null,
  needsClarification: false,
};

function mockResult(output: QueryPlan) {
  return {
    content: [{
      type: 'tool-call' as const,
      toolCallId: 'query-plan-call',
      toolName: 'submit_query_plan',
      input: JSON.stringify(output),
    }],
    finishReason: { unified: 'stop' as const, raw: 'stop' },
    usage: {
      inputTokens: { total: 31, noCache: 31, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 12, text: 12, reasoning: undefined },
    },
    warnings: [],
  };
}

test('synthetic corpus has 100 unique, schema-valid cases across ten intent families', () => {
  const dataset = createSyntheticPromptBenchmarkDataset();
  assert.equal(PromptBenchmarkDatasetSchema.parse(dataset).cases.length, 100);
  assert.equal(new Set(dataset.cases.map(item => item.caseId)).size, 100);
  assert.equal(new Set(dataset.cases.map(item => item.message)).size, 100);
  const familyCounts = new Map<string, number>();
  for (const item of dataset.cases) {
    const family = item.caseId.split('-').slice(0, -1).join('-');
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
  }
  assert.equal(familyCounts.size, 10);
  assert.ok([...familyCounts.values()].every(count => count === 10));

  const short = { ...dataset, cases: dataset.cases.slice(0, 99) };
  const long = { ...dataset, cases: [...dataset.cases, ...dataset.cases, dataset.cases[0]!] };
  assert.throws(() => PromptBenchmarkDatasetSchema.parse(short));
  assert.throws(() => PromptBenchmarkDatasetSchema.parse(long));
  const duplicateIds = structuredClone(dataset);
  duplicateIds.cases[1]!.caseId = duplicateIds.cases[0]!.caseId;
  assert.throws(() => parsePromptBenchmarkDataset(duplicateIds), { message: 'benchmark_case_ids_must_be_unique' });
});

test('synthetic corpus exports only to a new owner-only file outside the repository', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pubg-saas-benchmark-'));
  await chmod(directory, 0o700);
  const output = join(directory, 'prompts.json');
  try {
    await exportSyntheticPromptBenchmarkDataset(output);
    const info = await stat(output);
    assert.equal(info.mode & 0o777, 0o600);
    assert.equal(parsePromptBenchmarkDataset(JSON.parse(await readFile(output, 'utf8'))).cases.length, 100);
    await assert.rejects(exportSyntheticPromptBenchmarkDataset(output), { code: 'EEXIST' });

    const repositoryRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
    await assert.rejects(
      exportSyntheticPromptBenchmarkDataset(join(repositoryRoot, 'apps/pubg-saas/tests/prompts.json')),
      { message: 'synthetic_benchmark_output_directory_must_be_owner_only_external' },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('plan comparison measures exact and field accuracy without returning prompt text', async () => {
  assert.deepEqual(compareQueryPlans(plan, plan), {
    exact: true,
    correctFields: 10,
    totalFields: 10,
    expectedIntent: 'team_stats',
    predictedIntent: 'team_stats',
  });
  assert.equal(compareQueryPlans({ ...plan, period: 'yesterday' }, plan).exact, false);

  const dataset = createSyntheticPromptBenchmarkDataset();
  const model = new MockLanguageModelV4({ doGenerate: dataset.cases.map(item => mockResult(item.expectedPlan)) });
  const planner = new NaturalLanguageQueryPlanner(model);
  let clock = 0;
  const report = await runPromptBenchmark(dataset, planner, 'fixture-model', () => (clock += 4));
  assert.equal(report.exactMatches, 100);
  assert.equal(report.exactAccuracy, 1);
  assert.equal(report.fieldAccuracy, 1);
  assert.equal(report.fallbackCount, 0);
  assert.equal(report.p50LatencyMs, 4);
  assert.equal(report.p95LatencyMs, 4);
  assert.equal(report.totalTokens, 4_300);
  assert.equal(model.doGenerateCalls.length, 100);
  const serializedReport = JSON.stringify(report);
  assert.equal(serializedReport.includes(dataset.cases[0]!.message), false);
  assert.equal(serializedReport.includes(dataset.cases[99]!.message), false);
});
