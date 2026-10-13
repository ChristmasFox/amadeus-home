import assert from 'node:assert/strict';
import test from 'node:test';
import { MockLanguageModelV4 } from 'ai/test';
import {
  NaturalLanguageQueryPlanner,
  type QueryPlan,
} from '../src/application/nl-query-planner.js';
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

function fixtureDataset(count: number) {
  return {
    version: 1 as const,
    cases: Array.from({ length: count }, (_, index) => ({
      caseId: `synthetic-${String(index).padStart(3, '0')}`,
      message: `查今天队伍击杀，第 ${index} 个合成用例`,
      expectedPlan: plan,
      ...(index > 0 ? { previousPlan: plan } : {}),
    })),
  };
}

test('benchmark schema requires 100–200 synthetic/de-identified cases', () => {
  assert.equal(PromptBenchmarkDatasetSchema.parse(fixtureDataset(100)).cases.length, 100);
  assert.equal(PromptBenchmarkDatasetSchema.parse(fixtureDataset(200)).cases.length, 200);
  assert.throws(() => PromptBenchmarkDatasetSchema.parse(fixtureDataset(99)));
  assert.throws(() => PromptBenchmarkDatasetSchema.parse(fixtureDataset(201)));
  const duplicateIds = fixtureDataset(100);
  duplicateIds.cases[1]!.caseId = duplicateIds.cases[0]!.caseId;
  assert.throws(() => parsePromptBenchmarkDataset(duplicateIds), { message: 'benchmark_case_ids_must_be_unique' });
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

  const model = new MockLanguageModelV4({ doGenerate: {
    content: [{ type: 'text', text: JSON.stringify(plan) }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 31, noCache: 31, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 12, text: 12, reasoning: undefined },
    },
    warnings: [],
  } });
  const dataset = fixtureDataset(100);
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
  assert.equal(JSON.stringify(report).includes('合成用例'), false);
});
