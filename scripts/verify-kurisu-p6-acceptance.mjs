import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

process.env.KURISU_ACCEPTANCE_REGISTER_TEST = '0';
const { runKurisuAcceptance } = await import('../apps/agent-runtime/tests/kurisu-acceptance.test.ts');

const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const records = await runKurisuAcceptance({ revision, executedAt: new Date().toISOString() });
const failureDerived = records.filter((record) => record.failureDerived).length;
const categories = [...new Set(records.map((record) => record.category))].sort();
const statuses = [...new Set(records.map((record) => record.result.status))].sort();
const durations = records.map((record) => record.durationMs).sort((left, right) => left - right);
const percentile = (fraction) => durations[Math.min(durations.length - 1, Math.ceil(durations.length * fraction) - 1)] ?? 0;
const report = {
  phase: 'P6',
  status: 'LOCAL_ACCEPTANCE_PASS',
  revision,
  layer: 'L2-structured-server-boundary',
  modelRoute: 'none',
  executedAt: records[0]?.executedAt ?? null,
  scenarioCount: records.length,
  failureDerivedCount: failureDerived,
  categories,
  statuses,
  performance: {
    medianDurationMs: percentile(0.5),
    p95DurationMs: percentile(0.95),
    modelCalls: 0,
    toolCalls: records.reduce((total, record) => total + record.actualToolCalls.length, 0),
  },
  variantProvenance: 'Test-only routine variants plus independently rewritten failure regressions; these expressions are never inserted into a model prompt or router keyword table.',
  l2BoundaryEvidence: [
    'apps/agent-runtime/src/kurisu/service.ts executeHostTool boundary',
    'apps/agent-runtime/tests/kurisu-acceptance.test.ts receiveInbound gateway integration',
    'scripts/smoke-kurisu-http.sh server.ts front-door smoke',
  ],
  l3: {
    status: 'BLOCKED',
    reason: 'No legal LangBot user/support-admin session token was available in this development Goal; the P2 9Router provider trace is not native-agent platform evidence.',
  },
  knownLimitations: [
    'The existing full agent-runtime suite has a known review-v3-2.test.ts child-process hang; P6 uses passing bounded batches and does not claim the full suite passed.',
    'Real producer handoff for the briefing remains BLOCKED_UNSUPPORTED as recorded in the P5 producer inventory.',
  ],
  records,
};

const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0) {
  const outputPath = process.argv[outputIndex + 1];
  if (!outputPath) throw new Error('--output requires a path');
  writeFileSync(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
  console.log(`REPORT_WRITTEN=${resolve(outputPath)}`);
}
console.log(JSON.stringify({
  phase: report.phase,
  status: report.status,
  revision: report.revision,
  scenarioCount: report.scenarioCount,
  failureDerivedCount: report.failureDerivedCount,
  categories: report.categories,
  statuses: report.statuses,
  layer: report.layer,
  modelRoute: report.modelRoute,
  executedAt: report.executedAt,
  performance: report.performance,
  l3: report.l3,
  note: 'This is local structured/fake-backend evidence, not the blocked real LangBot native-agent L3 path.',
}, null, 2));
