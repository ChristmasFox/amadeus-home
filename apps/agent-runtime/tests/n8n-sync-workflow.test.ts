import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

interface WorkflowNode {
  name: string;
  type: string;
  retryOnFail?: boolean;
  maxTries?: number;
  waitBetweenTries?: number;
  parameters?: { jsCode?: string; options?: Record<string, unknown>; path?: string };
}

interface Workflow {
  name: string;
  id: string;
  active: boolean;
  nodes: WorkflowNode[];
}

type Item = { json: Record<string, any> };

const workflowPath = fileURLToPath(new URL('../../../integrations/n8n/workflows/pubg-sync-matches-v3.workflow.json', import.meta.url));
const playerIds = [
  'account.29044012052444c0848d617ba100fe1e',
  'account.a22ea4bce333448e9cce807cebd7f4bf',
  'account.45ad53f453db4c4bbff2b4cf00b131d6',
  'account.84c0d223534f42b1922c070a52c3c6ce',
];

async function loadWorkflow(): Promise<Workflow> {
  return JSON.parse(await readFile(workflowPath, 'utf8')) as Workflow;
}

function runNode(
  code: string,
  json: Record<string, any>,
  input: Item[],
  references: Record<string, Item[]>,
): Record<string, any>[] {
  const nodes = Object.fromEntries(Object.entries(references).map(([name, values]) => [name, {
    first: () => values[0],
    all: () => values,
  }]));
  const execute = new Function('$json', '$input', '$', code) as (
    value: Record<string, any>,
    inputApi: { all: () => Item[]; first: () => Item | undefined },
    lookup: (name: string) => { first: () => Item | undefined; all: () => Item[] },
  ) => Item[];
  const output = execute(json, { all: () => input, first: () => input[0] }, (name) => nodes[name] ?? { first: () => undefined, all: () => [] });
  return output.map((item) => item.json);
}

function code(workflow: Workflow, name: string): string {
  const value = workflow.nodes.find((node) => node.name === name)?.parameters?.jsCode;
  assert.ok(value, `missing code node: ${name}`);
  return value;
}

function preparedRequest(workflow: Workflow): Record<string, any> {
  const output = runNode(code(workflow, 'Normalize Sync Request'), {
    body: {
      query: { subject: { type: 'team', ids: ['default_team'] } },
      queryId: 'sync-test-query',
      sessionId: 'sync-test-session',
      now: '2026-09-01T04:00:00.000Z',
    },
  }, [], {});
  assert.equal(output.length, 1);
  return output[0]!;
}

test('V3 sync workflow is active, independently triggered, and retries external API calls', async () => {
  const workflow = await loadWorkflow();
  assert.equal(workflow.name, 'PUBG Sync Matches v3');
  assert.equal(workflow.id, 'pubg-sync-matches-v3-20260902');
  assert.equal(workflow.active, true);
  assert.equal(workflow.nodes.find((node) => node.type === 'n8n-nodes-base.webhook')?.parameters?.path, 'pubg-sync-matches-v3');
  for (const name of ['Lookup PUBG Players v3', 'Get PUBG Match v3']) {
    const node = workflow.nodes.find((candidate) => candidate.name === name);
    assert.equal(node?.retryOnFail, true);
    assert.equal(node?.maxTries, 3);
    assert.equal(node?.waitBetweenTries, 2500);
    assert.equal((node?.parameters?.options?.timeout as number | undefined), 30000);
  }
});

test('V3 sync expands default_team before Players API discovery', async () => {
  const workflow = await loadWorkflow();
  const request = preparedRequest(workflow);
  assert.deepEqual(request.playerIds, playerIds);
  assert.deepEqual(request.query.subject.ids, playerIds);
  assert.equal(request.syncKey, 'v2:sync-state:steam:default-team');
});

test('V3 sync parses discovery success and preserves failed-source semantics', async () => {
  const workflow = await loadWorkflow();
  const request = preparedRequest(workflow);
  const prepared = { ...request, state: null, storeRows: [], existingMatchIds: [], matchIds: [], playerMap: {}, needsDiscovery: true, discoveryOk: false };
  const success = runNode(code(workflow, 'Parse Player Discovery'), {
    statusCode: 200,
    body: {
      data: request.players.map((player: Record<string, string>, index: number) => ({
        id: player.accountId,
        attributes: { name: player.playerName },
        relationships: { matches: { data: [{ id: `match-${index}` }] } },
      })),
    },
  }, [], { 'Prepare Sync State': [{ json: prepared }] });
  assert.equal(success[0]?.discoveryOk, true);
  assert.deepEqual(success[0]?.matchIds, ['match-0', 'match-1', 'match-2', 'match-3']);
  assert.equal(success[0]?.sourceUnavailable, false);

  const failure = runNode(code(workflow, 'Parse Player Discovery'), {
    statusCode: 429,
    error: { message: 'rate limited' },
    headers: { 'x-ratelimit-remaining': '0' },
    body: { errors: [{ title: 'rate limited' }] },
  }, [], { 'Prepare Sync State': [{ json: prepared }] });
  assert.equal(failure[0]?.discoveryOk, false);
  assert.equal(failure[0]?.sourceUnavailable, true);
  assert.equal(failure[0]?.discoveryError, 'rate limited');
});

test('V3 sync fetch plan distinguishes stored and missing Match IDs', async () => {
  const workflow = await loadWorkflow();
  const request = preparedRequest(workflow);
  const prepared = {
    ...request,
    state: { playerMap: {} },
    storeRows: [{ matchId: 'stored-match', players: [] }],
    existingMatchIds: ['stored-match'],
    matchIds: ['stored-match', 'missing-match'],
    playerMap: {},
    discoveryOk: true,
    discoveryError: '',
  };
  const plans = runNode(code(workflow, 'Build Match Fetch Plan'), {}, [{ json: prepared }], {});
  assert.deepEqual(plans.map((plan) => plan.matchId), ['missing-match']);
  assert.equal(plans[0]?.hasMissingMatches, true);
});

test('V3 sync normalizes Match API fields and marks partial fetches', async () => {
  const workflow = await loadWorkflow();
  const request = preparedRequest(workflow);
  const plan = {
    ...request,
    matchId: 'normalized-match',
    playerMap: Object.fromEntries(request.players.map((player: Record<string, string>) => [player.accountId, player])),
    discoveryOk: true,
    allowedCompetitiveModes: ['squad-fpp'],
  };
  const body = {
    data: {
      id: 'normalized-match',
      attributes: {
        createdAt: '2026-09-01T02:00:00.000Z',
        matchType: 'competitive',
        gameMode: 'squad-fpp',
        mapName: 'Erangel_Main',
        duration: 1234,
        patchVersion: 'test-patch',
      },
    },
    included: [{
      type: 'participant',
      attributes: { stats: { playerId: playerIds[0], winPlace: 2, kills: 5, assists: 1, damageDealt: 500, DBNOs: 2, revives: 1, headshotKills: 1, timeSurvived: 1000, longestKill: 120 } },
      relationships: { roster: { data: { id: 'roster-1' } } },
    }, {
      type: 'roster',
      id: 'roster-1',
      attributes: { stats: { rank: 2 } },
    }],
  };
  const normalized = runNode(code(workflow, 'Normalize Match Record'), {}, [{ json: { statusCode: 200, body } }], { 'Build Match Fetch Plan': [{ json: plan }] });
  assert.equal(normalized[0]?.record.matchId, 'normalized-match');
  assert.equal(normalized[0]?.record.isCompetitive, true);
  assert.equal(normalized[0]?.record.players[0].damage, 500);
  assert.equal(normalized[0]?.record.players[0].rank, 2);

  const partial = runNode(code(workflow, 'Build Sync Response'), {}, [{ json: { ...plan, record: null, failedMatchId: 'failed-match' } }], {
    'Build Match Fetch Plan': [{ json: plan }],
    'Prepare Sync State': [{ json: { ...plan, storeRows: [] } }],
  });
  assert.equal(partial[0]?.status, 'PARTIAL');
  assert.equal(partial[0]?.coverage.complete, false);
  assert.deepEqual(partial[0]?.failedMatchIds, ['failed-match']);
});
