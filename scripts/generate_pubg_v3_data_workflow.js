const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.join(__dirname, '..', 'integrations', 'n8n', 'workflows', 'legacy', 'pubg-query-gateway-v2.workflow.json');
const outputPath = path.join(__dirname, '..', 'integrations', 'n8n', 'workflows', 'pubg-data-gateway-v3.workflow.json');
const teamPath = path.join(__dirname, '..', 'apps', 'agent-runtime', 'teams', 'default-team.json');
const raw = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const source = Array.isArray(raw) ? raw[0] : raw;
const team = JSON.parse(fs.readFileSync(teamPath, 'utf8'));
const defaultPlayerIds = team.players.map((player) => player.id);
const defaultPlayers = team.players.map((player) => ({ accountId: player.id, playerName: player.name, displayName: player.name }));

function normalizeQueryInputCode() {
  return `
const body = $json.body && typeof $json.body === 'object' ? $json.body : $json;
const rawQuery = body.query && typeof body.query === 'object' ? body.query : body.queryPlan && typeof body.queryPlan === 'object' ? body.queryPlan : {};
const subject = rawQuery.subject && typeof rawQuery.subject === 'object' ? rawQuery.subject : { type: 'team', ids: ['default_team'], label: ${JSON.stringify(team.label)} };
const requestedIds = Array.isArray(subject.ids) ? subject.ids.map(String) : [];
const resolvedSubjectIds = subject.type === 'team' && (!requestedIds.length || requestedIds.includes('default_team')) ? ${JSON.stringify(defaultPlayerIds)} : requestedIds;
const playerIds = resolvedSubjectIds.length ? resolvedSubjectIds : ${JSON.stringify(defaultPlayerIds)};
const resultSetMatchIds = Array.isArray(body.resultSetMatchIds) ? body.resultSetMatchIds.map(String) : [];
const query = resultSetMatchIds.length
  ? { ...rawQuery, reference: { ...(rawQuery.reference || {}), matchIds: resultSetMatchIds } }
  : rawQuery;
const requestedNow = body.now ? Date.parse(String(body.now)) : NaN;
const nowMs = Number.isFinite(requestedNow) ? requestedNow : Date.now();
const players = ${JSON.stringify(defaultPlayers)}.filter((player) => playerIds.includes(player.accountId));
const sessionId = String(query.sessionId || body.sessionId || 'unknown-session');
const queryId = String(query.queryId || body.queryId || 'unknown-query');
return [{ json: {
  query,
  queryId,
  sessionId,
  subject: { type: subject.type || 'team', ids: playerIds, label: subject.label || ${JSON.stringify(team.label)} },
  playerIds,
  players,
  shard: 'steam',
  syncKey: 'v2:sync-state:steam:default-team',
  nowMs,
  allowedCompetitiveModes: ['solo', 'solo-fpp', 'duo', 'duo-fpp', 'squad', 'squad-fpp'],
} }];
`;
}

function prepareQueryDataCode() {
  return `
function parsePayload(value) {
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return null; } }
  return value && typeof value === 'object' ? value : null;
}
function timestamp(value) {
  if (typeof value === 'number') return value > 10000000000 ? value : value * 1000;
  const text = String(value || '').trim();
  const numeric = Number(text);
  if (/^\\d+(?:\\.\\d+)?$/.test(text) && Number.isFinite(numeric)) return numeric > 10000000000 ? numeric : numeric * 1000;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}
function normalizeRecord(row) {
  const payload = parsePayload(row?.payload ?? row);
  return payload && payload.matchId ? payload : null;
}
function stateFromRows(rows) {
  const request = $('Normalize Query Input').first().json;
  const row = rows.find((item) => String(item.json?.cacheKey || '') === String(request.syncKey));
  return parsePayload(row?.json?.payload);
}
const request = $('Normalize Query Input').first().json;
const state = stateFromRows($input.all());
const storeRows = $('Read V2 Match Store').all().map((item) => normalizeRecord(item.json)).filter(Boolean);
const uniqueRecords = [...new Map(storeRows.map((record) => [String(record.matchId), record])).values()];
const query = request.query || {};
const queryNowMs = Number(request.nowMs) || Date.now();
const expiresAt = timestamp(state?.expiresAt);
const stateFresh = Boolean(state && (!expiresAt || expiresAt > queryNowMs));
const ids = new Set((request.playerIds || []).map(String));
const relevantRecords = uniqueRecords.filter((record) => record.isCompetitive !== false && Array.isArray(record.players) && record.players.some((player) => ids.has(String(player.accountId))));
const recordIds = new Set(uniqueRecords.map((record) => String(record.matchId)));
const selectors = Array.isArray(query.segments) && query.segments.length
  ? query.segments.map((segment) => segment.selector || {})
  : [query.selector || {}];
function selectorRecords(candidate) {
  if (candidate?.type === 'time_range') {
    const start = timestamp(candidate.start);
    const end = timestamp(candidate.end);
    return relevantRecords.filter((record) => record.timestamp >= start && record.timestamp < end);
  }
  if (candidate?.type === 'last_n_matches') {
    const ordered = [...relevantRecords].sort((left, right) => right.timestamp - left.timestamp || String(right.matchId).localeCompare(String(left.matchId)));
    return ordered.slice(Number(candidate.offset || 0), Number(candidate.offset || 0) + Number(candidate.count || 0));
  }
  if (candidate?.type === 'result_set') {
    const resultIds = new Set((query.reference?.matchIds || []).map(String));
    return uniqueRecords.filter((record) => resultIds.has(String(record.matchId)));
  }
  return [];
}
function selectorCovered(candidate) {
  if (candidate?.type === 'time_range') {
    const start = timestamp(candidate.start);
    const end = timestamp(candidate.end);
    const coverageStart = timestamp(state?.coverageStart);
    const coverageEnd = timestamp(state?.coverageEnd);
    return Boolean(state?.coverageComplete && coverageStart && coverageEnd && start >= coverageStart && end <= coverageEnd && end <= queryNowMs);
  }
  if (candidate?.type === 'last_n_matches') {
    const required = Number(candidate.count || 0) + Number(candidate.offset || 0);
    return relevantRecords.length >= required;
  }
  if (candidate?.type === 'result_set') {
    const resultIds = new Set((query.reference?.matchIds || []).map(String));
    return resultIds.size > 0 && [...resultIds].every((id) => recordIds.has(id));
  }
  return false;
}
function requiresFreshness(candidate) {
  if (candidate?.type === 'result_set') return false;
  if (candidate?.type === 'last_n_matches') return true;
  if (candidate?.type === 'time_range') return timestamp(candidate.end) >= queryNowMs;
  return true;
}
const localComplete = selectors.every(selectorCovered);
// Current and rolling selectors must re-check the source on every request.
// A future coverageEnd or a non-expired sync state cannot prove that a new
// Match did not arrive after the previous query.
const needsFreshness = selectors.some(requiresFreshness);
const queryCovered = localComplete && !needsFreshness;
const localSelectedRecords = [...new Map(selectors.flatMap(selectorRecords).map((record) => [String(record.matchId), record])).values()];
const requiredMatchCount = Math.max(...selectors.map((candidate) => candidate?.type === 'last_n_matches' ? Number(candidate.count || 0) + Number(candidate.offset || 0) : 0), 0);
const coverageStatus = queryCovered ? 'OK' : state?.status === 'SOURCE_UNAVAILABLE' && !localComplete ? 'SOURCE_UNAVAILABLE' : 'COVERAGE_GAP';
return [{ json: {
  ...request,
  records: uniqueRecords,
  state,
  coverage: {
    status: coverageStatus,
    complete: queryCovered,
    coverageStart: state?.coverageStart || null,
    coverageEnd: state?.coverageEnd || null,
    checkedAt: new Date(queryNowMs).toISOString(),
    knownPlayerIds: request.playerIds,
    failedMatchIds: state?.failedMatchIds || [],
    sourceUnavailable: false,
    freshness: queryCovered ? 'fresh' : 'unknown',
    localComplete,
    queryCovered,
    requiredMatchCount,
    availableMatchCount: relevantRecords.length,
  },
  source: { store: 'n8n-data-table', cacheType: 'v2-match-or-legacy-match', syncInvoked: false, syncTriggered: false, playerApiCalls: 0, matchApiCalls: 0, localMatchCount: uniqueRecords.length },
  syncNeeded: !queryCovered,
  localComplete,
  queryCovered,
  syncRequest: {
    query: { ...query, subject: { ...(query.subject || {}), type: query.subject?.type || 'team', ids: request.playerIds, label: query.subject?.label || ${JSON.stringify(team.label)} } },
    queryId: request.queryId,
    sessionId: request.sessionId,
    forceDiscovery: true,
    now: new Date(queryNowMs).toISOString(),
  },
  diagnostics: { localRecordCount: uniqueRecords.length, relevantRecordCount: relevantRecords.length, localSelectedCount: localSelectedRecords.length, stateFresh, localComplete, queryCovered, needsFreshness, requiredMatchCount, queryNowMs, stateExpiresAt: state?.expiresAt || null },
} }];
`;
}

function collectQueryDataCode() {
  return `
function parsePayload(value) {
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return {}; } }
  return value && typeof value === 'object' ? value : {};
}
function timestamp(value) {
  if (typeof value === 'number') return value > 10000000000 ? value : value * 1000;
  const text = String(value || '').trim();
  const numeric = Number(text);
  if (/^\\d+(?:\\.\\d+)?$/.test(text) && Number.isFinite(numeric)) return numeric > 10000000000 ? numeric : numeric * 1000;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}
const decision = $('Prepare Query Data').first().json;
const syncInvoked = Boolean(decision.syncNeeded);
const response = syncInvoked ? parsePayload($json.body ?? $json) : {};
const responseSource = response.source && typeof response.source === 'object' ? response.source : {};
const responseStatus = typeof response.status === 'string' ? response.status : '';
const syncFailed = syncInvoked && (Boolean($json.error) || responseStatus === 'SOURCE_UNAVAILABLE');
const incoming = syncInvoked && Array.isArray(response.records) ? response.records : [];
const merged = [...(decision.records || []), ...incoming].filter((record) => record && record.matchId);
const records = [...new Map(merged.map((record) => [String(record.matchId), record])).values()];
const ids = new Set((decision.playerIds || []).map(String));
const relevantRecords = records.filter((record) => record.isCompetitive !== false && Array.isArray(record.players) && record.players.some((player) => ids.has(String(player.accountId))));
const query = decision.query || {};
const queryNowMs = Number(decision.nowMs || decision.diagnostics?.queryNowMs) || Date.now();
const selectors = Array.isArray(query.segments) && query.segments.length
  ? query.segments.map((segment) => segment.selector || {})
  : [query.selector || {}];
function selectorRecords(candidate) {
  if (candidate?.type === 'time_range') {
    const start = timestamp(candidate.start);
    const end = timestamp(candidate.end);
    return relevantRecords.filter((record) => record.timestamp >= start && record.timestamp < end);
  }
  if (candidate?.type === 'last_n_matches') {
    const ordered = [...relevantRecords].sort((left, right) => right.timestamp - left.timestamp || String(right.matchId).localeCompare(String(left.matchId)));
    return ordered.slice(Number(candidate.offset || 0), Number(candidate.offset || 0) + Number(candidate.count || 0));
  }
  if (candidate?.type === 'result_set') {
    const resultIds = new Set((query.reference?.matchIds || []).map(String));
    return records.filter((record) => resultIds.has(String(record.matchId)));
  }
  return [];
}
function selectorCovered(candidate, coverage) {
  if (!coverage?.complete) return false;
  if (candidate?.type === 'time_range') {
    const start = timestamp(candidate.start);
    const end = timestamp(candidate.end);
    const coverageStart = timestamp(coverage.coverageStart);
    const coverageEnd = timestamp(coverage.coverageEnd);
    return Boolean(coverageStart && coverageEnd && start >= coverageStart && end <= coverageEnd && end <= queryNowMs);
  }
  if (candidate?.type === 'last_n_matches') return relevantRecords.length >= Number(candidate.count || 0) + Number(candidate.offset || 0);
  if (candidate?.type === 'result_set') {
    const resultIds = new Set((query.reference?.matchIds || []).map(String));
    const recordIds = new Set(records.map((record) => String(record.matchId)));
    return resultIds.size > 0 && [...resultIds].every((id) => recordIds.has(id));
  }
  return false;
}
const localSelectedRecords = [...new Map(selectors.flatMap(selectorRecords).map((record) => [String(record.matchId), record])).values()];
let coverage = response.coverage && typeof response.coverage === 'object' ? { ...response.coverage } : { ...(decision.coverage || {}) };
let source = { ...(decision.source || {}), ...responseSource };
source.syncInvoked = syncInvoked || Boolean(responseSource.syncInvoked);
source.syncTriggered = syncInvoked || Boolean(responseSource.syncTriggered);
source.playerApiCalls = Number(responseSource.playerApiCalls ?? (responseSource.playersApi ? 1 : decision.source?.playerApiCalls || 0));
source.matchApiCalls = Number(responseSource.matchApiCalls ?? responseSource.matchApiCount ?? (decision.source?.matchApiCalls || 0));
source.localMatchCount = Number(decision.diagnostics?.localRecordCount || decision.source?.localMatchCount || 0);
source.returnedMatchCount = records.length;
source.syncStatus = syncInvoked ? (syncFailed ? 'SOURCE_UNAVAILABLE' : responseStatus || 'OK') : 'NOT_NEEDED';
if (syncFailed) {
  const localQueryCovered = Boolean(decision.queryCovered || decision.coverage?.queryCovered);
  const localSelectedCount = Number(decision.diagnostics?.localSelectedCount || 0);
  const fallbackStatus = localQueryCovered ? 'STALE' : localSelectedCount > 0 || incoming.length > 0 ? 'PARTIAL' : 'SOURCE_UNAVAILABLE';
  coverage = {
    ...(decision.coverage || {}),
    status: fallbackStatus,
    complete: localQueryCovered,
    queryCovered: localQueryCovered,
    localComplete: Boolean(decision.localComplete),
    sourceUnavailable: true,
    freshness: localQueryCovered ? 'stale' : 'unknown',
    checkedAt: new Date(queryNowMs).toISOString(),
  };
  source.error = response.error || $json.error?.message || 'sync workflow unavailable';
}
if (!syncFailed && syncInvoked) {
  if (responseStatus === 'PARTIAL') {
    coverage = { ...coverage, status: 'PARTIAL', complete: false, queryCovered: false, sourceUnavailable: false, freshness: 'unknown' };
  } else if (responseStatus === 'SOURCE_UNAVAILABLE') {
    coverage = { ...coverage, status: records.length ? 'PARTIAL' : 'SOURCE_UNAVAILABLE', complete: false, queryCovered: false, sourceUnavailable: true, freshness: 'unknown' };
  } else {
    const postSyncCovered = Boolean(coverage.complete) && selectors.every((selector) => selectorCovered(selector, coverage));
    coverage = {
      ...coverage,
      status: postSyncCovered ? 'OK' : 'COVERAGE_GAP',
      complete: postSyncCovered,
      queryCovered: postSyncCovered,
      sourceUnavailable: false,
      freshness: postSyncCovered ? 'fresh' : 'unknown',
    };
  }
}
coverage.failedMatchIds = Array.isArray(coverage.failedMatchIds) ? coverage.failedMatchIds.map(String) : [];
coverage.checkedAt = coverage.checkedAt || new Date(queryNowMs).toISOString();
coverage.localComplete = coverage.localComplete ?? Boolean(decision.localComplete);
coverage.queryCovered = coverage.queryCovered ?? Boolean(decision.queryCovered);
coverage.sourceUnavailable = Boolean(coverage.sourceUnavailable);
const status = coverage.status || (syncFailed ? 'SOURCE_UNAVAILABLE' : 'OK');
return [{ json: { status, query, queryId: decision.queryId, sessionId: decision.sessionId, records, coverage, source, diagnostics: { ...(decision.diagnostics || {}), syncFailed, syncRecordCount: incoming.length, localSelectedCount: localSelectedRecords.length } } }];
`;
}

const names = new Map([
  ['PUBG Query Webhook v2', 'PUBG Data Webhook v3'],
  ['Respond Query Data v2', 'Respond Data Result v3'],
  ['Ensure Data via Sync v2', 'Ensure Data via Sync v3'],
]);
const nodeName = (name) => names.get(name) || name;
const nodes = source.nodes.map((node, index) => {
  const copy = { ...node, id: `pubg-data-v3-node-${String(index + 1).padStart(3, '0')}`, name: nodeName(node.name) };
  if (copy.type === 'n8n-nodes-base.webhook') {
    copy.parameters = { ...copy.parameters, path: 'pubg-data-gateway-v3' };
    copy.webhookId = 'pubg-data-gateway-v3-webhook';
  }
  if (copy.name === 'Normalize Query Input') {
    copy.parameters = {
      ...copy.parameters,
      jsCode: normalizeQueryInputCode(),
    };
  }
  if (copy.name === 'Prepare Query Data') {
    copy.parameters = {
      ...copy.parameters,
      jsCode: prepareQueryDataCode(),
    };
  }
  if (copy.name === 'Collect Query Data') {
    copy.parameters = { ...copy.parameters, jsCode: collectQueryDataCode() };
  }
  if (copy.name === 'Ensure Data via Sync v3') {
    copy.parameters = { ...copy.parameters, url: 'http://n8n:5678/webhook/pubg-sync-matches-v3' };
  }
  return copy;
});

const connectionNames = (value) => {
  const result = {};
  for (const [key, branches] of Object.entries(value || {})) {
    result[nodeName(key)] = Object.fromEntries(Object.entries(branches).map(([type, outputs]) => [
      type,
      outputs.map((branch) => branch.map((edge) => ({ ...edge, node: nodeName(edge.node) }))),
    ]));
  }
  return result;
};

const workflow = {
  name: 'PUBG Data Gateway v3',
  id: 'pubg-data-gateway-v3-20260902',
  active: true,
  settings: { ...(source.settings || {}), timezone: 'Asia/Shanghai' },
  nodes,
  connections: connectionNames(source.connections),
  pinData: {},
  tags: [],
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(outputPath);
