import { open, lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  QueryPlanSchema,
  type QueryPlan,
  type QueryPlanFailure,
} from '../src/application/nl-query-planner.js';
import { createPublicQueryPlanner } from '../src/infrastructure/ai/public-model.js';

const CaseSchema = z.object({
  caseId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/u),
  message: z.string().trim().min(1).max(1_200),
  expectedPlan: QueryPlanSchema,
  previousPlan: QueryPlanSchema.nullable().optional(),
}).strict();

export const PromptBenchmarkDatasetSchema = z.object({
  version: z.literal(1),
  cases: z.array(CaseSchema).min(100).max(200),
}).strict();

export type PromptBenchmarkDataset = z.infer<typeof PromptBenchmarkDatasetSchema>;

export function parsePromptBenchmarkDataset(value: unknown): PromptBenchmarkDataset {
  const dataset = PromptBenchmarkDatasetSchema.parse(value);
  if (new Set(dataset.cases.map(item => item.caseId)).size !== dataset.cases.length)
    throw new Error('benchmark_case_ids_must_be_unique');
  return dataset;
}

const PLAN_FIELDS: (keyof QueryPlan)[] = [
  'intent', 'subject', 'playerName', 'actorName', 'victimName', 'metric', 'period',
  'comparePeriod', 'matchCount', 'needsClarification',
];

export interface PlanComparison {
  exact: boolean;
  correctFields: number;
  totalFields: number;
  expectedIntent: QueryPlan['intent'];
  predictedIntent: QueryPlan['intent'];
}

interface BenchmarkResultRow extends PlanComparison {
  caseId: string;
  source: 'model' | 'fallback';
  failure: QueryPlanFailure | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export function compareQueryPlans(actual: QueryPlan, expected: QueryPlan): PlanComparison {
  const correctFields = PLAN_FIELDS.reduce((sum, field) => sum + Number(actual[field] === expected[field]), 0);
  return {
    exact: correctFields === PLAN_FIELDS.length,
    correctFields,
    totalFields: PLAN_FIELDS.length,
    expectedIntent: expected.intent,
    predictedIntent: actual.intent,
  };
}

function isInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

async function readPrivateExternalDataset(value: string): Promise<PromptBenchmarkDataset> {
  const path = resolve(value);
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0)
    throw new Error('benchmark_input_must_be_owner_only_regular_file');
  const actualPath = await realpath(path);
  if (isInside(repositoryRoot, actualPath)) throw new Error('benchmark_input_must_be_outside_repository');
  const raw: unknown = JSON.parse(await readFile(actualPath, 'utf8'));
  return parsePromptBenchmarkDataset(raw);
}

async function writePrivateExternalReport(value: string, report: unknown): Promise<void> {
  const requestedPath = resolve(value);
  if (isInside(repositoryRoot, requestedPath)) throw new Error('benchmark_report_must_be_outside_repository');
  const parent = await realpath(dirname(requestedPath));
  if (isInside(repositoryRoot, parent)) throw new Error('benchmark_report_must_be_outside_repository');
  const target = join(parent, requestedPath.slice(dirname(requestedPath).length + 1));
  const handle = await open(target, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } finally {
    await handle.close();
  }
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? null;
}

export async function runPromptBenchmark(
  dataset: PromptBenchmarkDataset,
  planner: NonNullable<ReturnType<typeof createPublicQueryPlanner>>['planner'],
  modelId: string,
  now: () => number = () => performance.now(),
) {
  const rows: BenchmarkResultRow[] = [];
  for (const item of dataset.cases) {
    const started = now();
    const result = await planner.plan({
      authorizationContext: Object.freeze({ scopeValidated: true }),
      message: item.message,
      previousPlan: item.previousPlan ?? null,
      signal: AbortSignal.timeout(45_000),
    });
    const latencyMs = Math.max(0, now() - started);
    const comparison = compareQueryPlans(result.plan, item.expectedPlan);
    rows.push({
      caseId: item.caseId,
      ...comparison,
      source: result.source,
      failure: result.failure,
      latencyMs,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
    });
  }

  const exactMatches = rows.filter(row => row.exact).length;
  const correctFields = rows.reduce((sum, row) => sum + row.correctFields, 0);
  const totalFields = rows.reduce((sum, row) => sum + row.totalFields, 0);
  const latencies = rows.map(row => row.latencyMs);
  const tokenTotal = (field: 'inputTokens' | 'outputTokens' | 'totalTokens') => {
    const known = rows.map(row => row[field]).filter((value): value is number => value !== null);
    return known.length === rows.length ? known.reduce((sum, value) => sum + value, 0) : null;
  };

  return {
    schema: 'pubg-saas-query-planner-benchmark/v1',
    provider: 'saas-combo',
    modelId,
    caseCount: rows.length,
    exactMatches,
    exactAccuracy: exactMatches / rows.length,
    correctFields,
    totalFields,
    fieldAccuracy: correctFields / totalFields,
    fallbackCount: rows.filter(row => row.source === 'fallback').length,
    p50LatencyMs: percentile(latencies, 0.50),
    p95LatencyMs: percentile(latencies, 0.95),
    inputTokens: tokenTotal('inputTokens'),
    outputTokens: tokenTotal('outputTokens'),
    totalTokens: tokenTotal('totalTokens'),
    results: rows,
  };
}

export async function benchmarkMain(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const inputPath = env.PUBG_SAAS_PROMPT_BENCHMARK_FILE;
  const reportPath = env.PUBG_SAAS_PROMPT_BENCHMARK_REPORT;
  if (!inputPath || !reportPath) throw new Error('benchmark_file_config_missing');
  const configured = createPublicQueryPlanner(env);
  if (!configured) throw new Error('pubg_saas_model_config_missing');
  const dataset = await readPrivateExternalDataset(inputPath);
  const report = await runPromptBenchmark(dataset, configured.planner, configured.modelId);
  await writePrivateExternalReport(reportPath, report);
  process.stdout.write(`PUBG_SAAS_QUERY_BENCHMARK=complete cases=${report.caseCount} exact=${report.exactMatches}/${report.caseCount} exact_accuracy=${report.exactAccuracy.toFixed(3)} field_accuracy=${report.fieldAccuracy.toFixed(3)} fallback=${report.fallbackCount} p50_ms=${report.p50LatencyMs?.toFixed(1) ?? 'unknown'} p95_ms=${report.p95LatencyMs?.toFixed(1) ?? 'unknown'} report=external-file\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void benchmarkMain().catch(error => {
    const code = error instanceof z.ZodError ? 'benchmark_dataset_invalid' : error instanceof Error ? error.message : 'benchmark_failed';
    process.stderr.write(`PUBG_SAAS_QUERY_BENCHMARK=failed code=${code}\n`);
    process.exitCode = 1;
  });
}
