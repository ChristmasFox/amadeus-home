import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

interface WorkflowNode {
  name: string;
  parameters?: { jsCode?: string };
}

interface Workflow {
  nodes: WorkflowNode[];
}

const workflowPath = fileURLToPath(new URL('../../../integrations/n8n/workflows/pubg-daily-stats.workflow.json', import.meta.url));

test('legacy n8n PUBG workflow renders finite KD with exactly one decimal', async () => {
  const workflow = JSON.parse(await readFile(workflowPath, 'utf8')) as Workflow;
  const code = workflow.nodes.find((node) => node.name === "Aggregate Today's Stats")?.parameters?.jsCode;
  assert.ok(code, "missing Aggregate Today's Stats code node");

  const match = code.match(/function formatKdRatio\(value\) \{\n\s*(return .*?)\n\}/u);
  assert.ok(match, 'formatKdRatio function is missing');
  const formatKdRatio = new Function('value', match[1]!) as (value: unknown) => string;

  assert.equal(formatKdRatio(1), '1.0');
  assert.equal(formatKdRatio(1.47), '1.5');
  assert.equal(formatKdRatio(null), '—');
  assert.doesNotMatch(match[1]!, /toFixed\(2\)/u);
});
