const fs = require('fs');
const path = require('path');

const dataTableId = '5ZFCBuokb-pn1ey9';
const credential = { httpHeaderAuth: { id: 'pubg-api-header-20260830', name: 'PUBG API' } };
const teamIds = [
  'account.29044012052444c0848d617ba100fe1e',
  'account.a22ea4bce333448e9cce807cebd7f4bf',
  'account.45ad53f453db4c4bbff2b4cf00b131d6',
  'account.84c0d223534f42b1922c070a52c3c6ce',
];
const teamPlayers = [
  { accountId: teamIds[0], playerName: 'SG_LabmemNo007', displayName: 'SG_LabmemNo007' },
  { accountId: teamIds[1], playerName: 'SG_LabmemNo008', displayName: 'SG_LabmemNo008' },
  { accountId: teamIds[2], playerName: 'SG_LabmemNo004', displayName: 'SG_LabmemNo004' },
  { accountId: teamIds[3], playerName: 'kim_kkl', displayName: 'kim_kkl' },
];

function codeNode(id, name, jsCode, position) {
  return {
    parameters: { jsCode },
    id,
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
  };
}

function dataTableGet(id, name, conditions, position) {
  return {
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'id', value: dataTableId },
      matchType: 'anyCondition',
      filters: { conditions },
      returnAll: true,
      orderBy: false,
    },
    id,
    name,
    type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1,
    position,
    alwaysOutputData: true,
    continueOnFail: true,
  };
}

function dataTableUpsert(id, name, position) {
  return {
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'id', value: dataTableId },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'cacheKey', condition: 'eq', keyValue: '={{ $json.cacheKey }}' }] },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          cacheKey: '={{ $json.cacheKey }}',
          cacheType: '={{ $json.cacheType }}',
          payload: '={{ $json.payload }}',
          refreshedAt: '={{ $json.refreshedAt }}',
          expiresAt: '={{ $json.expiresAt }}',
        },
        schema: [
          { id: 'cacheKey', displayName: 'cacheKey', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'cacheType', displayName: 'cacheType', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'payload', displayName: 'payload', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'refreshedAt', displayName: 'refreshedAt', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'expiresAt', displayName: 'expiresAt', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: false },
        ],
      },
      options: {},
    },
    id,
    name,
    type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1,
    position,
    continueOnFail: true,
  };
}

function httpNode(id, name, url, position, options = {}) {
  return {
    parameters: {
      method: 'GET',
      url,
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.api+json' }] },
      options: { response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } }, timeout: options.timeout || 20000 },
    },
    id,
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.5,
    position,
    credentials: credential,
    continueOnFail: true,
    retryOnFail: Boolean(options.retry),
    ...(options.retry ? { maxTries: 2, waitBetweenTries: 1500 } : {}),
  };
}

const normalizeQueryCode = String.raw`
const body = $json.body && typeof $json.body === 'object' ? $json.body : $json;
const query = body.query && typeof body.query === 'object' ? body.query : body.queryPlan && typeof body.queryPlan === 'object' ? body.queryPlan : {};
const subject = query.subject && typeof query.subject === 'object' ? query.subject : { type: 'team', ids: ${JSON.stringify(teamIds)} };
const playerIds = Array.isArray(subject.ids) ? subject.ids.map(String) : ${JSON.stringify(teamIds)};
const players = ${JSON.stringify(teamPlayers)}.filter((player) => playerIds.includes(player.accountId));
const sessionId = String(query.sessionId || body.sessionId || 'unknown-session');
const queryId = String(query.queryId || body.queryId || 'unknown-query');
return [{ json: {
  query,
  queryId,
  sessionId,
  subject: { type: subject.type || 'team', ids: playerIds },
  playerIds,
  players,
  shard: 'steam',
  syncKey: 'v2:sync-state:steam:default-team',
  nowMs: Date.now(),
  allowedCompetitiveModes: ['solo', 'solo-fpp', 'duo', 'duo-fpp', 'squad', 'squad-fpp'],
} }];
`;

const prepareQueryDataCode = String.raw`
function parsePayload(value) {
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return null; } }
  return value && typeof value === 'object' ? value : null;
}
function timestamp(value) {
  if (typeof value === 'number') return value > 10000000000 ? value : value * 1000;
  const text = String(value || '').trim();
  const numeric = Number(text);
  if (/^\d+(?:\.\d+)?$/.test(text) && Number.isFinite(numeric)) {
    return numeric > 10000000000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}
function normalizeRecord(row) {
  const payload = parsePayload(row?.payload ?? row);
  if (!payload || !payload.matchId) return null;
  return payload;
}
function stateFromRows(rows) {
  const row = rows.find((item) => String(item.json?.cacheKey || '') === String($('Normalize Query Input').first().json.syncKey));
  return parsePayload(row?.json?.payload);
}
const request = $('Normalize Query Input').first().json;
const state = stateFromRows($input.all());
const storeRows = $('Read V2 Match Store').all().map((item) => normalizeRecord(item.json)).filter(Boolean);
const uniqueRecords = [...new Map(storeRows.map((record) => [String(record.matchId), record])).values()];
const query = request.query || {};
const selector = query.selector || {};
const nowMs = Date.now();
const expiresAt = timestamp(state?.expiresAt);
const stateFresh = Boolean(state && (!expiresAt || expiresAt > nowMs));
const knownIds = new Set((state?.matchIds || []).map(String));
const recordIds = new Set(uniqueRecords.map((record) => String(record.matchId)));
const relevant = (record) => {
  if (record.isCompetitive === false) return false;
  const ids = new Set((request.playerIds || []).map(String));
  return Array.isArray(record.players) && record.players.some((player) => ids.has(String(player.accountId)));
};
const relevantRecords = uniqueRecords.filter(relevant);
const selectedIdCount = relevantRecords.length;
function selectorCovered(candidate) {
  if (!state?.coverageComplete) return false;
  if (candidate?.type === 'time_range') {
    const start = timestamp(candidate.start);
    const end = timestamp(candidate.end);
    const coverageStart = timestamp(state?.coverageStart);
    const coverageEnd = timestamp(state?.coverageEnd);
    const openEnded = end > nowMs;
    const effectiveEnd = openEnded ? coverageEnd : end;
    return Boolean(
      coverageStart &&
      coverageEnd &&
      start <= nowMs &&
      start >= coverageStart &&
      (!openEnded ? effectiveEnd <= coverageEnd : start <= coverageEnd),
    );
  }
  if (candidate?.type === 'last_n_matches') {
    const required = Number(candidate.count || 0) + Number(candidate.offset || 0);
    return selectedIdCount >= required;
  }
  if (candidate?.type === 'result_set') {
    const resultIds = new Set((query.reference?.matchIds || []).map(String));
    return resultIds.size > 0 && [...resultIds].every((id) => recordIds.has(id));
  }
  return true;
}
const selectors = Array.isArray(query.segments) && query.segments.length
  ? query.segments.map((segment) => segment.selector || {})
  : [selector];
const withinCoverage = selectors.every(selectorCovered);
const syncNeeded = !stateFresh || !withinCoverage;
let coverageStatus = 'COVERAGE_GAP';
if (stateFresh && state?.coverageComplete && withinCoverage) coverageStatus = 'OK';
if (state?.status === 'SOURCE_UNAVAILABLE' && !withinCoverage) coverageStatus = 'SOURCE_UNAVAILABLE';
return [{ json: {
  ...request,
  records: uniqueRecords,
  state,
  coverage: {
    status: coverageStatus,
    complete: Boolean(state?.coverageComplete && withinCoverage),
    coverageStart: state?.coverageStart || null,
    coverageEnd: state?.coverageEnd || null,
    knownPlayerIds: request.playerIds,
    failedMatchIds: state?.failedMatchIds || [],
  },
  source: { store: 'n8n-data-table', cacheType: 'v2-match-or-legacy-match', syncTriggered: false },
  syncNeeded,
  syncRequest: { query, queryId: request.queryId, sessionId: request.sessionId, forceDiscovery: true },
  diagnostics: { localRecordCount: uniqueRecords.length, relevantRecordCount: selectedIdCount, stateFresh, withinCoverage, stateExpiresAt: state?.expiresAt || null, nowMs },
} }];
`;

const collectQueryDataCode = String.raw`
function parsePayload(value) {
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return {}; } }
  return value && typeof value === 'object' ? value : {};
}
const decision = $('Prepare Query Data').first().json;
const syncInvoked = Boolean(decision.syncNeeded);
const response = syncInvoked ? parsePayload($json.body ?? $json) : {};
const syncFailed = syncInvoked && (Boolean($json.error) || response.status === 'SOURCE_UNAVAILABLE' && !Array.isArray(response.records));
const incoming = syncInvoked && Array.isArray(response.records) ? response.records : [];
const merged = [...(decision.records || []), ...incoming].filter((record) => record && record.matchId);
const records = [...new Map(merged.map((record) => [String(record.matchId), record])).values()];
let coverage = response.coverage && typeof response.coverage === 'object' ? response.coverage : decision.coverage;
let source = { ...(decision.source || {}), syncTriggered: Boolean(decision.syncNeeded), syncStatus: response.status || (syncFailed ? 'SOURCE_UNAVAILABLE' : 'NOT_NEEDED') };
if (syncFailed) {
  coverage = { ...(decision.coverage || {}), status: records.length ? 'PARTIAL' : 'SOURCE_UNAVAILABLE', complete: false, sourceUnavailable: true };
  source.syncError = response.error || $json.error?.message || 'sync workflow unavailable';
}
function timestamp(value) {
  if (typeof value === 'number') return value > 10000000000 ? value : value * 1000;
  const text = String(value || '').trim();
  const numeric = Number(text);
  if (/^\d+(?:\.\d+)?$/.test(text) && Number.isFinite(numeric)) return numeric > 10000000000 ? numeric : numeric * 1000;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}
const nowMs = Date.now();
function selectorCovered(candidate) {
  if (!coverage?.complete) return false;
  if (candidate?.type === 'time_range') {
    const start = timestamp(candidate.start);
    const end = timestamp(candidate.end);
    const coverageStart = timestamp(coverage.coverageStart);
    const coverageEnd = timestamp(coverage.coverageEnd);
    const openEnded = end > nowMs;
    const effectiveEnd = openEnded ? coverageEnd : end;
    return Boolean(
      coverageStart &&
      coverageEnd &&
      start <= nowMs &&
      start >= coverageStart &&
      (!openEnded ? effectiveEnd <= coverageEnd : start <= coverageEnd),
    );
  }
  if (candidate?.type === 'last_n_matches') {
    const ids = new Set((decision.playerIds || []).map(String));
    const count = records.filter((record) => record.isCompetitive !== false && Array.isArray(record.players) && record.players.some((player) => ids.has(String(player.accountId)))).length;
    return count >= Number(candidate.count || 0) + Number(candidate.offset || 0);
  }
  if (candidate?.type === 'result_set') {
    const resultIds = new Set((decision.query?.reference?.matchIds || []).map(String));
    const recordIds = new Set(records.map((record) => String(record.matchId)));
    return resultIds.size > 0 && [...resultIds].every((id) => recordIds.has(id));
  }
  return true;
}
const selectors = Array.isArray(decision.query?.segments) && decision.query.segments.length
  ? decision.query.segments.map((segment) => segment.selector || {})
  : [decision.query?.selector || {}];
if (!syncFailed && syncInvoked && coverage?.complete && !selectors.every(selectorCovered)) {
  coverage = { ...coverage, status: 'COVERAGE_GAP', complete: false };
}
return [{ json: { query: decision.query, queryId: decision.queryId, sessionId: decision.sessionId, records, coverage, source, diagnostics: { ...(decision.diagnostics || {}), syncFailed, syncRecordCount: incoming.length } } }];
`;

const normalizeSyncCode = String.raw`
const body = $json.body && typeof $json.body === 'object' ? $json.body : $json;
const query = body.query && typeof body.query === 'object' ? body.query : {};
const subject = query.subject && typeof query.subject === 'object' ? query.subject : { type: 'team', ids: ${JSON.stringify(teamIds)} };
const playerIds = Array.isArray(subject.ids) && subject.ids.length ? subject.ids.map(String) : ${JSON.stringify(teamIds)};
const players = ${JSON.stringify(teamPlayers)}.filter((player) => playerIds.includes(player.accountId));
return [{ json: {
  query,
  queryId: String(body.queryId || query.queryId || 'sync-query'),
  sessionId: String(body.sessionId || query.sessionId || 'sync-session'),
  shard: 'steam',
  playerIds,
  players,
  syncKey: 'v2:sync-state:steam:default-team',
  forceDiscovery: body.forceDiscovery !== false,
  nowMs: Date.now(),
  allowedCompetitiveModes: ['solo', 'solo-fpp', 'duo', 'duo-fpp', 'squad', 'squad-fpp'],
} }];
`;

const prepareSyncCode = String.raw`
function parsePayload(value) { if (typeof value === 'string') { try { return JSON.parse(value); } catch { return null; } } return value && typeof value === 'object' ? value : null; }
function numericTime(value) { if (typeof value === 'number') return value > 10000000000 ? value : value * 1000; const text = String(value || '').trim(); const numeric = Number(text); if (/^\d+(?:\.\d+)?$/.test(text) && Number.isFinite(numeric)) return numeric > 10000000000 ? numeric : numeric * 1000; const parsed = Date.parse(text); return Number.isFinite(parsed) ? parsed : 0; }
const request = $('Normalize Sync Request').first().json;
const stateRow = $input.all().find((item) => String(item.json?.cacheKey || '') === request.syncKey);
const state = parsePayload(stateRow?.json?.payload);
const storeRows = $('Read V2 Match Store').all().map((item) => parsePayload(item.json?.payload ?? item.json)).filter((record) => record && record.matchId);
const existingMatchIds = [...new Set(storeRows.map((record) => String(record.matchId)))];
const stateExpires = numericTime(state?.expiresAt);
const stateFresh = Boolean(state && (!stateExpires || stateExpires > Date.now()));
const needsDiscovery = Boolean(request.forceDiscovery || !stateFresh);
const matchIds = Array.isArray(state?.matchIds) ? state.matchIds.map(String) : [];
const playerMap = state?.playerMap && typeof state.playerMap === 'object' ? state.playerMap : Object.fromEntries(request.players.map((player) => [player.accountId, player]));
return [{ json: { ...request, state, storeRows, existingMatchIds, matchIds, playerMap, needsDiscovery, discoveryOk: !needsDiscovery, discoveryError: state?.lastError || '', rateLimit: state?.rateLimit || null } }];
`;

const parseDiscoveryCode = String.raw`
function parsePayload(value) { if (typeof value === 'string') { try { return JSON.parse(value); } catch { return {}; } } return value && typeof value === 'object' ? value : {}; }
function headerValue(headers, name) { const wanted = String(name).toLowerCase(); const entry = Object.entries(headers || {}).find(([key]) => String(key).toLowerCase() === wanted); return entry ? String(entry[1]) : null; }
const request = $('Prepare Sync State').first().json;
const body = parsePayload($json.body ?? $json);
const statusCode = Number($json.statusCode || 0);
const data = Array.isArray(body.data) ? body.data : [];
const failed = Boolean($json.error) || statusCode >= 400 || data.length === 0;
const detail = $json.error?.message || body.errors?.[0]?.title || body.errors?.[0]?.detail || 'Players API returned no data';
if (failed) {
  return [{ json: { ...request, matchIds: request.matchIds || [], playerMap: request.playerMap || {}, playerSnapshots: request.state?.playerSnapshots || [], discoveryOk: false, discoveryError: detail, sourceUnavailable: true, rateLimit: { remaining: Number(headerValue($json.headers, 'x-ratelimit-remaining') || 0) || null, reset: Number(headerValue($json.headers, 'x-ratelimit-reset') || 0) || null } } }];
}
const snapshots = request.players.map((requested) => {
  const player = data.find((entry) => String(entry.id || '') === String(requested.accountId));
  const matches = player?.relationships?.matches?.data || [];
  return { ...requested, found: Boolean(player), apiName: player?.attributes?.name || requested.playerName, matchIds: [...new Set(matches.filter((match) => match?.id).map((match) => String(match.id)))] };
});
const matchIds = [...new Set(snapshots.flatMap((player) => player.matchIds))];
const playerMap = Object.fromEntries(snapshots.map((player) => [player.accountId, player]));
return [{ json: { ...request, matchIds, playerMap, playerSnapshots: snapshots, discoveryOk: true, discoveryError: '', sourceUnavailable: false, rateLimit: { remaining: Number(headerValue($json.headers, 'x-ratelimit-remaining') || 0) || null, reset: Number(headerValue($json.headers, 'x-ratelimit-reset') || 0) || null } } }];
`;

const buildFetchPlanCode = String.raw`
const input = $input.first()?.json || {};
const existing = new Set((input.existingMatchIds || []).map(String));
const existingById = new Map((input.storeRows || []).filter((record) => record?.matchId).map((record) => [String(record.matchId), record]));
const requestedPlayerIds = new Set((input.playerIds || []).map(String));
const previousPlayerIds = new Set(Object.keys(input.state?.playerMap || {}).map(String));
const refreshPlayerIds = previousPlayerIds.size ? [...requestedPlayerIds].filter((playerId) => !previousPlayerIds.has(playerId)) : [];
const discovered = [...new Set((input.matchIds || []).map(String))];
const needsPlayerRefresh = (record) => {
  if (!refreshPlayerIds.length || !record) return false;
  const checkedPlayerIds = Array.isArray(record.checkedPlayerIds) ? new Set(record.checkedPlayerIds.map(String)) : null;
  if (checkedPlayerIds && refreshPlayerIds.every((playerId) => checkedPlayerIds.has(playerId))) return false;
  const presentPlayerIds = new Set((record.players || []).map((player) => String(player.accountId)));
  return refreshPlayerIds.some((playerId) => !presentPlayerIds.has(playerId));
};
const missing = input.discoveryError && !input.discoveryOk ? [] : discovered.filter((matchId) => !existing.has(matchId) || needsPlayerRefresh(existingById.get(matchId)));
const common = { ...input, matchIds: discovered, missingMatchIds: missing, hasMissingMatches: missing.length > 0, refreshedMatchIds: missing.filter((matchId) => existing.has(matchId)) };
if (!missing.length) return [{ json: { ...common, matchId: null } }];
return missing.map((matchId) => ({ json: { ...common, matchId } }));
`;

const extractMatchCode = String.raw`
function parsePayload(value) { if (typeof value === 'string') { try { return JSON.parse(value); } catch { return {}; } } return value && typeof value === 'object' ? value : {}; }
const plans = $('Build Match Fetch Plan').all();
const inputs = $input.all();
function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
return inputs.map((item, index) => {
  const plan = plans[index]?.json || {};
  if (!plan.matchId) return { json: { ...plan, record: null, fetchError: '', failedMatchId: null } };
  const response = item.json || {};
  const body = parsePayload(response.body ?? response);
  const match = body.data;
  const statusCode = Number(response.statusCode || 0);
  if (response.error || statusCode >= 400 || !match) {
    const detail = response.error?.message || body.errors?.[0]?.title || body.errors?.[0]?.detail || 'Match API failed';
    return { json: { ...plan, record: null, fetchError: detail, failedMatchId: String(plan.matchId) } };
  }
  const attributes = match.attributes || {};
  const createdAt = String(attributes.createdAt || '');
  const timestamp = Date.parse(createdAt);
  const matchType = String(attributes.matchType || '').toLowerCase();
  const gameMode = String(attributes.gameMode || '').toLowerCase();
  const allowed = new Set(plan.allowedCompetitiveModes || ['solo', 'solo-fpp', 'duo', 'duo-fpp', 'squad', 'squad-fpp']);
  const isCompetitive = matchType === 'competitive' && allowed.has(gameMode);
  const included = Array.isArray(body.included) ? body.included : [];
  const participants = included.filter((entry) => entry.type === 'participant');
  const rosters = new Map(included.filter((entry) => entry.type === 'roster').map((entry) => [String(entry.id), entry]));
  const players = [];
  for (const participant of participants) {
    const stats = participant.attributes?.stats || {};
    const accountId = String(stats.playerId || participant.relationships?.player?.data?.id || '');
    const known = plan.playerMap?.[accountId];
    if (!known) continue;
    const rosterId = participant.relationships?.roster?.data?.id;
    const rosterStats = rosters.get(String(rosterId))?.attributes?.stats || {};
    const rank = number(stats.winPlace || rosterStats.rank || 0, 0);
    players.push({ accountId, playerName: known.playerName, displayName: known.displayName, rank: rank > 0 ? rank : null, kills: number(stats.kills), assists: number(stats.assists), damage: number(stats.damageDealt), dbnos: number(stats.DBNOs), revives: number(stats.revives), headshotKills: number(stats.headshotKills), survivalTime: number(stats.timeSurvived), longestKill: number(stats.longestKill) });
  }
  const record = { schemaVersion: 2, matchId: String(match.id || plan.matchId), shard: plan.shard || 'steam', createdAt, timestamp, matchType, gameMode, isCompetitive, mapName: String(attributes.mapName || '未知地图'), duration: number(attributes.duration), patchVersion: String(attributes.patchVersion || ''), checkedPlayerIds: [...new Set((plan.playerIds || []).map(String))], players };
  return { json: { ...plan, record, fetchError: '', failedMatchId: null } };
});
`;

const buildSyncResponseCode = String.raw`
function parsePayload(value) { if (typeof value === 'string') { try { return JSON.parse(value); } catch { return {}; } } return value && typeof value === 'object' ? value : {}; }
function iso(value) { return value ? new Date(value).toISOString() : null; }
const inputs = $input.all().map((item) => item.json || {});
const first = inputs[0] || $('Build Match Fetch Plan').first()?.json || $('Prepare Sync State').first()?.json || {};
const oldRecords = ($('Prepare Sync State').first()?.json?.storeRows || []).filter((record) => record && record.matchId);
const records = inputs.map((item) => item.record).filter((record) => record && record.matchId);
const failedMatchIds = [...new Set(inputs.map((item) => item.failedMatchId).filter(Boolean).map(String))];
const allRecords = [...oldRecords, ...records];
const timestamps = allRecords.map((record) => Number(record.timestamp || 0)).filter((value) => Number.isFinite(value) && value > 0);
const discoveryOk = Boolean(first.discoveryOk);
const status = !discoveryOk ? 'SOURCE_UNAVAILABLE' : failedMatchIds.length ? 'PARTIAL' : 'OK';
const now = Date.now();
const coverageStart = timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null;
const coverageEnd = new Date(now).toISOString();
return [{ json: {
  queryId: first.queryId,
  sessionId: first.sessionId,
  records,
  coverage: { status, complete: discoveryOk && failedMatchIds.length === 0, coverageStart, coverageEnd, knownPlayerIds: first.playerIds || [], failedMatchIds },
  source: { store: 'n8n-data-table', syncTriggered: true, playersApi: discoveryOk, matchApiCount: inputs.filter((item) => item.matchId).length },
  status,
  discoveredMatchIds: first.matchIds || [],
  playerSnapshots: first.playerSnapshots || [],
  playerMap: first.playerMap || {},
  rateLimit: first.rateLimit || null,
  syncKey: first.syncKey,
  stateExpiresAt: now + 5 * 60 * 1000,
  coverageStart,
  coverageEnd,
  coverageComplete: discoveryOk && failedMatchIds.length === 0,
  failedMatchIds,
  updatedAt: new Date(now).toISOString(),
} }];
`;

const prepareMatchRowCode = String.raw`
return $input.all().filter((item) => item.json?.record?.matchId).map((item) => {
  const record = item.json.record;
  return { json: { cacheKey: 'v2:match:' + String(record.shard || 'steam') + ':' + String(record.matchId), cacheType: 'v2-match', payload: JSON.stringify(record), refreshedAt: new Date().toISOString(), expiresAt: 0 } };
});
`;

const prepareSyncStateRowCode = String.raw`
const result = $input.first()?.json || {};
const payload = { schemaVersion: 2, shard: 'steam', matchIds: result.discoveredMatchIds || [], playerSnapshots: result.playerSnapshots || [], playerMap: result.playerMap || {}, coverageStart: result.coverageStart || null, coverageEnd: result.coverageEnd || null, coverageComplete: Boolean(result.coverageComplete), failedMatchIds: result.failedMatchIds || [], status: result.status || 'SOURCE_UNAVAILABLE', lastError: result.status === 'SOURCE_UNAVAILABLE' ? 'Players API discovery failed' : '', lastDiscoveryAt: result.updatedAt || new Date().toISOString(), rateLimit: result.rateLimit || null, expiresAt: result.stateExpiresAt || Date.now() + 5 * 60 * 1000 };
return [{ json: { cacheKey: result.syncKey || 'v2:sync-state:steam:default-team', cacheType: 'v2-sync-state', payload: JSON.stringify(payload), refreshedAt: result.updatedAt || new Date().toISOString(), expiresAt: payload.expiresAt } }];
`;

const syncWorkflow = {
  name: 'PUBG Sync Matches v2',
  id: 'pubg-sync-matches-v2-20260901',
  active: true,
  settings: { executionOrder: 'v1', timezone: 'Asia/Shanghai', saveManualExecutions: true },
  nodes: [
    { parameters: { httpMethod: 'POST', path: 'pubg-sync-matches-v2', responseMode: 'responseNode', options: {} }, id: 'pubg-sync-v2-node-001', name: 'PUBG Sync Webhook v2', type: 'n8n-nodes-base.webhook', typeVersion: 2.1, position: [-1200, 0], webhookId: 'pubg-sync-matches-v2-webhook' },
    codeNode('pubg-sync-v2-node-002', 'Normalize Sync Request', normalizeSyncCode, [-1000, 0]),
    dataTableGet('pubg-sync-v2-node-003', 'Read V2 Sync State', [{ keyName: 'cacheKey', condition: 'eq', keyValue: '={{ $json.syncKey }}' }], [-800, -160]),
    dataTableGet('pubg-sync-v2-node-004', 'Read V2 Match Store', [{ keyName: 'cacheType', condition: 'eq', keyValue: 'v2-match' }, { keyName: 'cacheType', condition: 'eq', keyValue: 'match' }], [-800, 160]),
    codeNode('pubg-sync-v2-node-005', 'Prepare Sync State', prepareSyncCode, [-560, 0]),
    { parameters: { conditions: { boolean: [{ value1: '={{ !!$json.needsDiscovery }}', operation: 'equal', value2: true }] } }, id: 'pubg-sync-v2-node-006', name: 'Needs Player Discovery', type: 'n8n-nodes-base.if', typeVersion: 1, position: [-320, 0] },
    httpNode('pubg-sync-v2-node-007', 'Lookup PUBG Players v2', "={{ 'https://api.pubg.com/shards/' + $json.shard + '/players?filter%5BplayerIds%5D=' + $json.playerIds.join(',') }}", [-80, -160], { timeout: 15000 }),
    codeNode('pubg-sync-v2-node-008', 'Parse Player Discovery', parseDiscoveryCode, [160, -160]),
    codeNode('pubg-sync-v2-node-009', 'Use Existing Discovery State', "return [{ json: { ...($input.first()?.json || {}), discoveryOk: Boolean($input.first()?.json?.discoveryOk), sourceUnavailable: false } }];", [-80, 160]),
    codeNode('pubg-sync-v2-node-010', 'Build Match Fetch Plan', buildFetchPlanCode, [400, 0]),
    { parameters: { conditions: { boolean: [{ value1: '={{ !!$json.matchId }}', operation: 'equal', value2: true }] } }, id: 'pubg-sync-v2-node-011', name: 'Has Missing Match IDs', type: 'n8n-nodes-base.if', typeVersion: 1, position: [640, 0] },
    httpNode('pubg-sync-v2-node-012', 'Get PUBG Match v2', "={{ 'https://api.pubg.com/shards/' + $json.shard + '/matches/' + $json.matchId }}", [880, -160], { timeout: 20000, retry: true }),
    codeNode('pubg-sync-v2-node-013', 'Emit Noop Sync Result', "const value = $input.first()?.json || {}; return [{ json: { ...value, record: null, fetchError: '', failedMatchId: null } }];", [880, 160]),
    codeNode('pubg-sync-v2-node-014', 'Normalize Match Record', extractMatchCode, [1120, 0]),
    codeNode('pubg-sync-v2-node-015', 'Build Sync Response', buildSyncResponseCode, [1360, 0]),
    codeNode('pubg-sync-v2-node-016', 'Prepare V2 Match Row', prepareMatchRowCode, [1360, -300]),
    dataTableUpsert('pubg-sync-v2-node-017', 'Upsert V2 Match Store', [1600, -300]),
    codeNode('pubg-sync-v2-node-018', 'Prepare V2 Sync State Row', prepareSyncStateRowCode, [1600, 200]),
    dataTableUpsert('pubg-sync-v2-node-019', 'Upsert V2 Sync State', [1840, 200]),
    { parameters: { respondWith: 'json', responseBody: '={{ $json }}', options: {} }, id: 'pubg-sync-v2-node-020', name: 'Respond Sync Result', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.5, position: [1840, 0] },
  ],
  connections: {
    'PUBG Sync Webhook v2': { main: [[{ node: 'Normalize Sync Request', type: 'main', index: 0 }]] },
    'Normalize Sync Request': { main: [[{ node: 'Read V2 Sync State', type: 'main', index: 0 }, { node: 'Read V2 Match Store', type: 'main', index: 0 }]] },
    'Read V2 Sync State': { main: [[{ node: 'Prepare Sync State', type: 'main', index: 0 }]] },
    'Read V2 Match Store': { main: [[{ node: 'Prepare Sync State', type: 'main', index: 1 }]] },
    'Prepare Sync State': { main: [[{ node: 'Needs Player Discovery', type: 'main', index: 0 }]] },
    'Needs Player Discovery': { main: [[{ node: 'Lookup PUBG Players v2', type: 'main', index: 0 }], [{ node: 'Use Existing Discovery State', type: 'main', index: 0 }]] },
    'Lookup PUBG Players v2': { main: [[{ node: 'Parse Player Discovery', type: 'main', index: 0 }]] },
    'Parse Player Discovery': { main: [[{ node: 'Build Match Fetch Plan', type: 'main', index: 0 }]] },
    'Use Existing Discovery State': { main: [[{ node: 'Build Match Fetch Plan', type: 'main', index: 0 }]] },
    'Build Match Fetch Plan': { main: [[{ node: 'Has Missing Match IDs', type: 'main', index: 0 }]] },
    'Has Missing Match IDs': { main: [[{ node: 'Get PUBG Match v2', type: 'main', index: 0 }], [{ node: 'Emit Noop Sync Result', type: 'main', index: 0 }]] },
    'Get PUBG Match v2': { main: [[{ node: 'Normalize Match Record', type: 'main', index: 0 }]] },
    'Emit Noop Sync Result': { main: [[{ node: 'Normalize Match Record', type: 'main', index: 0 }]] },
    'Normalize Match Record': { main: [[{ node: 'Build Sync Response', type: 'main', index: 0 }, { node: 'Prepare V2 Match Row', type: 'main', index: 0 }]] },
    'Build Sync Response': { main: [[{ node: 'Respond Sync Result', type: 'main', index: 0 }, { node: 'Prepare V2 Sync State Row', type: 'main', index: 0 }]] },
    'Prepare V2 Match Row': { main: [[{ node: 'Upsert V2 Match Store', type: 'main', index: 0 }]] },
    'Prepare V2 Sync State Row': { main: [[{ node: 'Upsert V2 Sync State', type: 'main', index: 0 }]] },
  },
  pinData: {},
  tags: [],
};

const queryWorkflow = {
  name: 'PUBG Query Gateway v2',
  id: 'pubg-query-gateway-v2-20260901',
  active: true,
  settings: { executionOrder: 'v1', timezone: 'Asia/Shanghai', saveManualExecutions: true },
  nodes: [
    { parameters: { httpMethod: 'POST', path: 'pubg-query-gateway-v2', responseMode: 'responseNode', options: {} }, id: 'pubg-query-v2-node-001', name: 'PUBG Query Webhook v2', type: 'n8n-nodes-base.webhook', typeVersion: 2.1, position: [-1000, 0], webhookId: 'pubg-query-gateway-v2-webhook' },
    codeNode('pubg-query-v2-node-002', 'Normalize Query Input', normalizeQueryCode, [-800, 0]),
    dataTableGet('pubg-query-v2-node-003', 'Read V2 Sync State', [{ keyName: 'cacheKey', condition: 'eq', keyValue: '={{ $json.syncKey }}' }], [-560, -160]),
    dataTableGet('pubg-query-v2-node-004', 'Read V2 Match Store', [{ keyName: 'cacheType', condition: 'eq', keyValue: 'v2-match' }, { keyName: 'cacheType', condition: 'eq', keyValue: 'match' }], [-560, 160]),
    codeNode('pubg-query-v2-node-005', 'Prepare Query Data', prepareQueryDataCode, [-300, 0]),
    { parameters: { conditions: { boolean: [{ value1: '={{ !!$json.syncNeeded }}', operation: 'equal', value2: true }] } }, id: 'pubg-query-v2-node-006', name: 'Needs Read Through Sync', type: 'n8n-nodes-base.if', typeVersion: 1, position: [-60, 0] },
    { parameters: { method: 'POST', url: 'http://n8n:5678/webhook/pubg-sync-matches-v2', sendBody: true, specifyBody: 'json', jsonBody: '={{ $json.syncRequest }}', options: { response: { response: { fullResponse: false, neverError: true, responseFormat: 'json' } }, timeout: 180000 } }, id: 'pubg-query-v2-node-007', name: 'Ensure Data via Sync v2', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.5, position: [180, -160], continueOnFail: true },
    codeNode('pubg-query-v2-node-008', 'Collect Query Data', collectQueryDataCode, [420, 0]),
    { parameters: { respondWith: 'json', responseBody: '={{ $json }}', options: {} }, id: 'pubg-query-v2-node-009', name: 'Respond Query Data v2', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.5, position: [680, 0] },
  ],
  connections: {
    'PUBG Query Webhook v2': { main: [[{ node: 'Normalize Query Input', type: 'main', index: 0 }]] },
    'Normalize Query Input': { main: [[{ node: 'Read V2 Sync State', type: 'main', index: 0 }, { node: 'Read V2 Match Store', type: 'main', index: 0 }]] },
    'Read V2 Sync State': { main: [[{ node: 'Prepare Query Data', type: 'main', index: 0 }]] },
    'Read V2 Match Store': { main: [[{ node: 'Prepare Query Data', type: 'main', index: 1 }]] },
    'Prepare Query Data': { main: [[{ node: 'Needs Read Through Sync', type: 'main', index: 0 }]] },
    'Needs Read Through Sync': { main: [[{ node: 'Ensure Data via Sync v2', type: 'main', index: 0 }], [{ node: 'Collect Query Data', type: 'main', index: 0 }]] },
    'Ensure Data via Sync v2': { main: [[{ node: 'Collect Query Data', type: 'main', index: 0 }]] },
    'Collect Query Data': { main: [[{ node: 'Respond Query Data v2', type: 'main', index: 0 }]] },
  },
  pinData: {},
  tags: [],
};

const bootstrapWorkflow = {
  name: 'PUBG Bootstrap Store v2',
  id: 'pubg-bootstrap-store-v2-20260901',
  active: false,
  settings: { executionOrder: 'v1', timezone: 'Asia/Shanghai', saveManualExecutions: true },
  nodes: [
    { parameters: {}, id: 'pubg-bootstrap-v2-node-001', name: 'Manual Bootstrap Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [-800, 0] },
    dataTableGet('pubg-bootstrap-v2-node-002', 'Read Legacy Match Rows', [{ keyName: 'cacheType', condition: 'eq', keyValue: 'match' }], [-560, 0]),
    codeNode('pubg-bootstrap-v2-node-003', 'Normalize Legacy Match Rows', String.raw`
function parsePayload(value) { if (typeof value === 'string') { try { return JSON.parse(value); } catch { return null; } } return value && typeof value === 'object' ? value : null; }
function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
return $input.all().map((item) => {
  const payload = parsePayload(item.json?.payload);
  if (!payload || !payload.matchId) return null;
  const players = Array.isArray(payload.players) ? payload.players.map((player) => ({ accountId: String(player.accountId || ''), playerName: String(player.playerName || player.displayName || ''), displayName: String(player.displayName || player.playerName || ''), rank: player.rank == null ? null : number(player.rank), kills: number(player.kills), assists: number(player.assists), damage: number(player.damage ?? player.damageDealt), dbnos: number(player.dbnos), revives: number(player.revives), headshotKills: number(player.headshotKills), survivalTime: number(player.survivalTime ?? player.timeSurvived), longestKill: number(player.longestKill), deaths: player.deaths == null ? (number(player.rank) > 1 ? 1 : 0) : number(player.deaths) })) : [];
  const record = { schemaVersion: 2, matchId: String(payload.matchId), shard: String(payload.shard || 'steam'), createdAt: payload.createdAt || null, timestamp: number(payload.timestamp), matchType: String(payload.matchType || 'competitive'), gameMode: String(payload.gameMode || ''), isCompetitive: payload.isCompetitive !== false, mapName: String(payload.mapName || '未知地图'), duration: number(payload.duration), patchVersion: String(payload.patchVersion || ''), players };
  return { json: { cacheKey: 'v2:match:' + record.shard + ':' + record.matchId, cacheType: 'v2-match', payload: JSON.stringify(record), refreshedAt: new Date().toISOString(), expiresAt: 0 } };
}).filter(Boolean);
`, [-320, 0]),
    dataTableUpsert('pubg-bootstrap-v2-node-004', 'Upsert V2 Match Rows', [-40, 0]),
    codeNode('pubg-bootstrap-v2-node-005', 'Bootstrap Report', "return [{ json: { status: 'OK', migratedRows: $items('Normalize Legacy Match Rows').length, source: 'pubg_cache.match', destination: 'pubg_cache.v2-match', destructive: false } }];", [200, 0]),
  ],
  connections: {
    'Manual Bootstrap Trigger': { main: [[{ node: 'Read Legacy Match Rows', type: 'main', index: 0 }]] },
    'Read Legacy Match Rows': { main: [[{ node: 'Normalize Legacy Match Rows', type: 'main', index: 0 }]] },
    'Normalize Legacy Match Rows': { main: [[{ node: 'Upsert V2 Match Rows', type: 'main', index: 0 }, { node: 'Bootstrap Report', type: 'main', index: 0 }]] },
  },
  pinData: {},
  tags: [],
};

const bootstrapWebhookWorkflow = {
  ...bootstrapWorkflow,
  name: 'PUBG Bootstrap Store v2 Run',
  id: 'pubg-bootstrap-store-v2-run-20260901',
  nodes: bootstrapWorkflow.nodes.map((node) => {
    if (node.name === 'Manual Bootstrap Trigger') {
      return { ...node, id: 'pubg-bootstrap-run-v2-node-001', name: 'Bootstrap Store Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2.1, parameters: { httpMethod: 'POST', path: 'pubg-bootstrap-store-v2', responseMode: 'responseNode', options: {} }, webhookId: 'pubg-bootstrap-store-v2-webhook' };
    }
    if (node.name === 'Read Legacy Match Rows') return { ...node, id: 'pubg-bootstrap-run-v2-node-002' };
    if (node.name === 'Normalize Legacy Match Rows') return { ...node, id: 'pubg-bootstrap-run-v2-node-003' };
    if (node.name === 'Upsert V2 Match Rows') return { ...node, id: 'pubg-bootstrap-run-v2-node-004' };
    if (node.name === 'Bootstrap Report') return { ...node, id: 'pubg-bootstrap-run-v2-node-005', name: 'Bootstrap Report' };
    return node;
  }).concat([
    { parameters: { respondWith: 'json', responseBody: '={{ $json }}', options: {} }, id: 'pubg-bootstrap-run-v2-node-006', name: 'Respond Bootstrap Result', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.5, position: [440, 0] },
  ]),
  connections: {
    'Bootstrap Store Webhook': { main: [[{ node: 'Read Legacy Match Rows', type: 'main', index: 0 }]] },
    'Read Legacy Match Rows': { main: [[{ node: 'Normalize Legacy Match Rows', type: 'main', index: 0 }]] },
    'Normalize Legacy Match Rows': { main: [[{ node: 'Upsert V2 Match Rows', type: 'main', index: 0 }, { node: 'Bootstrap Report', type: 'main', index: 0 }]] },
    'Bootstrap Report': { main: [[{ node: 'Respond Bootstrap Result', type: 'main', index: 0 }]] },
  },
};

const outputDirectory = path.join(__dirname, '..', 'integrations', 'n8n', 'workflows', 'legacy');
fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(path.join(outputDirectory, 'pubg-sync-matches-v2.workflow.json'), JSON.stringify(syncWorkflow, null, 2) + '\n');
fs.writeFileSync(path.join(outputDirectory, 'pubg-query-gateway-v2.workflow.json'), JSON.stringify(queryWorkflow, null, 2) + '\n');
fs.writeFileSync(path.join(outputDirectory, 'pubg-bootstrap-store-v2.workflow.json'), JSON.stringify(bootstrapWorkflow, null, 2) + '\n');
fs.writeFileSync(path.join(outputDirectory, 'pubg-bootstrap-store-v2-run.workflow.json'), JSON.stringify(bootstrapWebhookWorkflow, null, 2) + '\n');
