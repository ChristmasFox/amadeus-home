import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

interface WorkflowNode {
  name: string;
  type: string;
  parameters?: { jsCode?: string };
}

interface Workflow {
  nodes: WorkflowNode[];
}

const workflowPath = fileURLToPath(new URL('../../../integrations/n8n/workflows/pubg-data-gateway-v3.workflow.json', import.meta.url));

async function loadWorkflow(): Promise<Workflow> {
  return JSON.parse(await readFile(workflowPath, 'utf8')) as Workflow;
}

function executeNode(code: string, json: Record<string, unknown>, input: Array<{ json: Record<string, unknown> }>, references: Record<string, Array<{ json: Record<string, unknown> }>>): Record<string, unknown> {
  const nodes = Object.fromEntries(Object.entries(references).map(([name, values]) => [name, {
    first: () => values[0],
    all: () => values,
  }]));
  const execute = new Function('$json', '$input', '$', code) as (
    json: Record<string, unknown>,
    input: { all: () => Array<{ json: Record<string, unknown> }> },
    lookup: (name: string) => { first: () => { json: Record<string, unknown> } | undefined; all: () => Array<{ json: Record<string, unknown> }> },
  ) => Array<{ json: Record<string, unknown> }>;
  return execute(json, { all: () => input }, (name) => nodes[name as keyof typeof nodes] ?? {
    first: () => undefined,
    all: () => [],
  }).at(0)?.json ?? {};
}

function nodeCode(workflow: Workflow, name: string): string {
  const code = workflow.nodes.find((node) => node.name === name)?.parameters?.jsCode;
  assert.ok(code, `missing code node: ${name}`);
  return code;
}

const now = '2026-09-01T04:00:00.000Z';
const query = {
  version: 3,
  queryId: 'n8n-test-query',
  domain: 'pubg',
  subject: { type: 'team', ids: ['default_team'] },
  operation: 'report',
  selector: { type: 'time_range', start: '2026-08-30T22:00:00.000Z', end: '2026-08-31T22:00:00.000Z', label: '昨天' },
  segments: [],
  groupBy: 'player',
  metrics: ['kd'],
  filters: {},
  orderBy: { metric: 'kd', direction: 'desc' },
  limit: null,
  reference: {},
  presentation: {},
};

const stateRow = {
  cacheKey: 'v2:sync-state:steam:default-team',
  payload: JSON.stringify({
    coverageComplete: true,
    coverageStart: '2026-08-01T00:00:00.000Z',
    coverageEnd: '2026-09-01T03:00:00.000Z',
    expiresAt: Date.parse('2026-08-31T00:00:00.000Z'),
    status: 'OK',
  }),
};

const matchRow = {
  cacheKey: 'v2:match:steam:fixture-match',
  payload: JSON.stringify({
    matchId: 'fixture-match',
    timestamp: Date.parse('2026-08-31T08:00:00.000Z'),
    createdAt: '2026-08-31T08:00:00.000Z',
    isCompetitive: true,
    players: [{ accountId: 'account.29044012052444c0848d617ba100fe1e' }],
  }),
};

test('generated V3 n8n workflow exposes explicit freshness and canonical source fields', async () => {
  const workflow = await loadWorkflow();
  assert.equal(workflow.nodes.length, 9);
  const prepare = nodeCode(workflow, 'Prepare Query Data');
  const collect = nodeCode(workflow, 'Collect Query Data');
  assert.match(prepare, /localComplete/);
  assert.match(prepare, /queryCovered/);
  assert.match(prepare, /requiresFreshness/);
  assert.match(collect, /syncInvoked/);
  assert.match(collect, /syncTriggered/);
  assert.match(collect, /STALE/);
  assert.match(collect, /SOURCE_UNAVAILABLE/);
});

test('generated n8n data gateway skips expired-state sync for complete historical selectors', async () => {
  const workflow = await loadWorkflow();
  const normalized = executeNode(nodeCode(workflow, 'Normalize Query Input'), { query, now, sessionId: 'n8n-session', queryId: 'n8n-query' }, [], {});
  const prepared = executeNode(
    nodeCode(workflow, 'Prepare Query Data'),
    {},
    [{ json: stateRow }, { json: matchRow }],
    {
      'Normalize Query Input': [{ json: normalized }],
      'Read V2 Match Store': [{ json: matchRow }],
    },
  );
  assert.equal(prepared.syncNeeded, false);
  assert.equal((prepared.coverage as Record<string, unknown>).queryCovered, true);
  assert.equal((prepared.diagnostics as Record<string, unknown>).stateFresh, false);
});

test('generated n8n data gateway treats current selector as freshness-sensitive', async () => {
  const workflow = await loadWorkflow();
  const currentQuery = { ...query, selector: { type: 'time_range', start: '2026-08-31T22:00:00.000Z', end: now, label: '今天' } };
  const normalized = executeNode(nodeCode(workflow, 'Normalize Query Input'), { query: currentQuery, now, sessionId: 'n8n-session', queryId: 'n8n-query' }, [], {});
  const prepared = executeNode(
    nodeCode(workflow, 'Prepare Query Data'),
    {},
    [{ json: stateRow }, { json: matchRow }],
    {
      'Normalize Query Input': [{ json: normalized }],
      'Read V2 Match Store': [{ json: matchRow }],
    },
  );
  assert.equal(prepared.syncNeeded, true);
  assert.equal((prepared.coverage as Record<string, unknown>).queryCovered, false);
  assert.equal((prepared.diagnostics as Record<string, unknown>).needsFreshness, true);
});

test('generated n8n data gateway never trusts future coverage for current selectors', async () => {
  const workflow = await loadWorkflow();
  const currentQuery = { ...query, selector: { type: 'time_range', start: '2026-08-31T22:00:00.000Z', end: now, label: '今天' } };
  const normalized = executeNode(nodeCode(workflow, 'Normalize Query Input'), { query: currentQuery, now, sessionId: 'n8n-session', queryId: 'n8n-query' }, [], {});
  const futureState = {
    ...JSON.parse(stateRow.payload),
    expiresAt: Date.parse('2026-09-02T06:00:00.000Z'),
    coverageEnd: '2026-09-02T06:00:00.000Z',
  };
  const prepared = executeNode(
    nodeCode(workflow, 'Prepare Query Data'),
    {},
    [{ json: { ...stateRow, payload: JSON.stringify(futureState) } }, { json: matchRow }],
    {
      'Normalize Query Input': [{ json: normalized }],
      'Read V2 Match Store': [{ json: matchRow }],
    },
  );
  assert.equal((prepared.diagnostics as Record<string, unknown>).stateFresh, true);
  assert.equal(prepared.syncNeeded, true);
  assert.equal((prepared.coverage as Record<string, unknown>).queryCovered, false);
});

test('generated n8n data gateway resolves default team before invoking V2 sync', async () => {
  const workflow = await loadWorkflow();
  const normalized = executeNode(nodeCode(workflow, 'Normalize Query Input'), { query, now, sessionId: 'n8n-session', queryId: 'n8n-query' }, [], {});
  const prepared = executeNode(
    nodeCode(workflow, 'Prepare Query Data'),
    {},
    [{ json: stateRow }, { json: matchRow }],
    {
      'Normalize Query Input': [{ json: normalized }],
      'Read V2 Match Store': [{ json: matchRow }],
    },
  );
  const syncRequest = prepared.syncRequest as { query: { subject: { ids: string[] } } };
  assert.deepEqual(syncRequest.query.subject.ids, [
    'account.29044012052444c0848d617ba100fe1e',
    'account.a22ea4bce333448e9cce807cebd7f4bf',
    'account.45ad53f453db4c4bbff2b4cf00b131d6',
    'account.84c0d223534f42b1922c070a52c3c6ce',
  ]);
  assert.notEqual(syncRequest.query.subject.ids[0], 'default_team');
});

test('generated n8n data gateway marks coverage complete after a successful sync', async () => {
  const workflow = await loadWorkflow();
  const normalized = executeNode(nodeCode(workflow, 'Normalize Query Input'), { query, now, sessionId: 'n8n-session', queryId: 'n8n-query' }, [], {});
  const prepared = executeNode(
    nodeCode(workflow, 'Prepare Query Data'),
    {},
    [{ json: stateRow }, { json: matchRow }],
    {
      'Normalize Query Input': [{ json: normalized }],
      'Read V2 Match Store': [{ json: matchRow }],
    },
  );
  prepared.syncNeeded = true;
  const collected = executeNode(
    nodeCode(workflow, 'Collect Query Data'),
    {
      body: {
        status: 'OK',
        records: [],
        coverage: {
          status: 'OK',
          complete: true,
          coverageStart: '2026-08-01T00:00:00.000Z',
          coverageEnd: now,
          failedMatchIds: [],
          sourceUnavailable: false,
        },
        source: { playersApi: true, playerApiCalls: 1, matchApiCalls: 0 },
      },
    },
    [],
    { 'Prepare Query Data': [{ json: prepared }] },
  );
  const coverage = collected.coverage as Record<string, unknown>;
  assert.equal(collected.status, 'OK');
  assert.equal(coverage.complete, true);
  assert.equal(coverage.localComplete, true);
  assert.equal(coverage.queryCovered, true);
  assert.equal((collected.source as Record<string, unknown>).syncInvoked, true);
});

test('generated n8n data gateway keeps local historical evidence as STALE on sync failure', async () => {
  const workflow = await loadWorkflow();
  const normalized = executeNode(nodeCode(workflow, 'Normalize Query Input'), { query, now, sessionId: 'n8n-session', queryId: 'n8n-query' }, [], {});
  const prepared = executeNode(
    nodeCode(workflow, 'Prepare Query Data'),
    {},
    [{ json: stateRow }, { json: matchRow }],
    {
      'Normalize Query Input': [{ json: normalized }],
      'Read V2 Match Store': [{ json: matchRow }],
    },
  );
  prepared.syncNeeded = true;
  const collected = executeNode(
    nodeCode(workflow, 'Collect Query Data'),
    { error: { message: 'upstream unavailable' } },
    [],
    { 'Prepare Query Data': [{ json: prepared }] },
  );
  assert.equal(collected.status, 'STALE');
  assert.equal((collected.coverage as Record<string, unknown>).sourceUnavailable, true);
  assert.equal((collected.source as Record<string, unknown>).syncInvoked, true);
});
