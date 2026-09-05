const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.join(__dirname, '..', 'integrations', 'n8n', 'workflows', 'legacy', 'pubg-sync-matches-v2.workflow.json');
const outputPath = path.join(__dirname, '..', 'integrations', 'n8n', 'workflows', 'pubg-sync-matches-v3.workflow.json');
const teamPath = path.join(__dirname, '..', 'apps', 'agent-runtime', 'teams', 'default-team.json');

const raw = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const source = Array.isArray(raw) ? raw[0] : raw;
const team = JSON.parse(fs.readFileSync(teamPath, 'utf8'));
const playerIds = team.players.map((player) => player.id);
const players = team.players.map((player) => ({ accountId: player.id, playerName: player.name, displayName: player.name }));

function normalizeSyncRequestCode() {
  return `
const body = $json.body && typeof $json.body === 'object' ? $json.body : $json;
const query = body.query && typeof body.query === 'object' ? body.query : {};
const rawSubject = query.subject && typeof query.subject === 'object' ? query.subject : null;
const requestedIds = Array.isArray(rawSubject?.ids) ? rawSubject.ids.map(String) : Array.isArray(body.playerIds) ? body.playerIds.map(String) : [];
const playerIds = rawSubject?.type === 'team' && (!requestedIds.length || requestedIds.includes('default_team'))
  ? ${JSON.stringify(playerIds)}
  : requestedIds.length ? requestedIds : ${JSON.stringify(playerIds)};
const subject = {
  type: rawSubject?.type || 'team',
  ids: playerIds,
  label: rawSubject?.label || ${JSON.stringify(team.label)},
};
const requestedNow = body.now ? Date.parse(String(body.now)) : NaN;
const nowMs = Number.isFinite(requestedNow) ? requestedNow : Date.now();
return [{ json: {
  query: { ...query, subject },
  queryId: String(body.queryId || query.queryId || 'sync-query'),
  sessionId: String(body.sessionId || query.sessionId || 'sync-session'),
  shard: 'steam',
  playerIds,
  players: ${JSON.stringify(players)}.filter((player) => playerIds.includes(player.accountId)),
  syncKey: 'v2:sync-state:steam:default-team',
  forceDiscovery: body.forceDiscovery !== false,
  nowMs,
  allowedCompetitiveModes: ['solo', 'solo-fpp', 'duo', 'duo-fpp', 'squad', 'squad-fpp'],
} }];
`;
}

const names = new Map([
  ['PUBG Sync Matches v2', 'PUBG Sync Matches v3'],
  ['PUBG Sync Webhook v2', 'PUBG Sync Webhook v3'],
  ['Lookup PUBG Players v2', 'Lookup PUBG Players v3'],
  ['Get PUBG Match v2', 'Get PUBG Match v3'],
  ['Respond Sync Result', 'Respond Sync Result v3'],
]);

const nodes = source.nodes.map((node, index) => {
  const copy = {
    ...node,
    id: `pubg-sync-v3-node-${String(index + 1).padStart(3, '0')}`,
    name: names.get(node.name) || node.name,
  };
  if (copy.type === 'n8n-nodes-base.webhook') {
    copy.parameters = { ...copy.parameters, path: 'pubg-sync-matches-v3' };
    copy.webhookId = 'pubg-sync-matches-v3-webhook';
  }
  if (copy.name === 'Normalize Sync Request') {
    copy.parameters = { ...copy.parameters, jsCode: normalizeSyncRequestCode() };
  }
  if (copy.name === 'Lookup PUBG Players v3' || copy.name === 'Get PUBG Match v3') {
    copy.retryOnFail = true;
    copy.maxTries = 3;
    copy.waitBetweenTries = 2500;
    copy.parameters = {
      ...copy.parameters,
      options: {
        ...(copy.parameters.options || {}),
        response: {
          ...(copy.parameters.options?.response || {}),
          response: {
            ...(copy.parameters.options?.response?.response || {}),
            fullResponse: true,
            neverError: true,
            responseFormat: 'json',
          },
        },
        timeout: copy.name === 'Lookup PUBG Players v3' ? 30000 : 30000,
      },
    };
  }
  return copy;
});

function renameConnectionTarget(target) {
  return names.get(target) || target;
}

const connections = {};
for (const [sourceName, branches] of Object.entries(source.connections || {})) {
  const renamedSource = renameConnectionTarget(sourceName);
  connections[renamedSource] = {};
  for (const [type, outputs] of Object.entries(branches)) {
    connections[renamedSource][type] = outputs.map((branch) => branch.map((edge) => ({ ...edge, node: renameConnectionTarget(edge.node) })));
  }
}

const workflow = {
  name: 'PUBG Sync Matches v3',
  id: 'pubg-sync-matches-v3-20260902',
  active: true,
  settings: { ...(source.settings || {}), timezone: 'Asia/Shanghai' },
  nodes,
  connections,
  pinData: {},
  tags: [],
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(outputPath);
