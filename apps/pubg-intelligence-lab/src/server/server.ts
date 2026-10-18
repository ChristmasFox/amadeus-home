import {
  createScopedAssistantContext,
  deterministicAssistantFallback,
  requestedPlayerReview,
  requestedRecentMatchCount,
} from './assistant-scope.js';
import {
  bindNetwork,
  isLocalRequest,
  isLoopbackHost,
  isPrivateIPv4Host,
  requestBody,
  safeDateBounds,
  send,
} from './http-utils.js';
import {
  battleLabels,
  computeMatchRelative,
  computeMatchStory,
  loadBattleTelemetry,
} from './match-views.js';
import { researchRecoveryMessage, shortConversationReply } from './messages.js';
import { isPublicRequest, loadPublicAccess, looksProxied } from './public-access.js';
import { CLIENT_DIST, handlePublic, sendPublicJson } from './public-site.js';
import {
  archivedIds,
  createSyntheticTeam,
  DEFAULT_HOST,
  DEFAULT_PORT,
  FEATURE_VERSION,
  inMode,
  inSquad,
  isRanked,
  MAX_MATCHES_PER_PAGE,
  MAX_TACTICAL_MATCHES,
  MAX_TELEMETRY_ANALYTICS_MATCHES,
  openSnapshot,
  PARSER_VERSION,
  readArchiveBackup,
  requestedMode,
  safePlayerName,
  scrubText,
  selectSquad,
  type Snapshot,
  visibleMatch,
  wantsCompleteTelemetry,
} from './snapshot.js';
import { computeTelemetryAnalytics } from './telemetry-analytics.js';
import {
  analyzeMatchReview,
  DEFAULT_TIMEZONE,
  extractMatchReviewFacts,
  localDateLabel,
} from '@agent/pubg-domain';
import {
  analyzeTacticalMatch,
  anonymizeResearchText,
  type BattleReviewLabel,
  buildFrequentPairCandidates,
  buildLineupAnalytics,
  buildMapAnalytics,
  buildMatchSeries,
  buildPerformanceInsights,
  buildPlayerProfiles,
  buildProfileInsights,
  buildResearchReport,
  buildSquadAnalytics,
  buildWeaponEfficiency,
  classifyResearchQuestion,
  type EvaluationReviewLabel,
  mapDisplayName,
  MODE_GROUPS,
  rankInsights,
  reconstructBattleEpisodes,
  redactSensitiveText,
  replayTacticalBenchmark,
  type ResearchAssistantResult,
  type ResearchSquad,
  type ResearchTemplate,
  ResearchTemplateSchema,
  runResearchAssistant,
  type TacticalMatchAnalysis,
  tacticalPlayerRef,
} from '@agent/pubg-intelligence';
import { type LanguageModel } from 'ai';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer as createViteServer } from 'vite';

async function handleApi(request: IncomingMessage, response: ServerResponse, snapshot: Snapshot): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (request.method === 'POST' && url.pathname === '/api/evaluations/replay') {
    const report = replayTacticalBenchmark();
    const runId = snapshot.experimentStore.saveEvaluation(report);
    send(response, 201, { runId, report, reviews: [], runs: snapshot.experimentStore.listEvaluations(20) });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/evaluations/runs') {
    send(response, 200, { runs: snapshot.experimentStore.listEvaluations(20) });
    return;
  }
  const evaluationRoute = /^\/api\/evaluations\/runs\/([a-f0-9-]{36})(?:\/(reviews))?$/u.exec(url.pathname);
  if (evaluationRoute?.[1] && request.method === 'GET' && !evaluationRoute[2]) {
    const report = snapshot.experimentStore.getEvaluation(evaluationRoute[1]);
    if (!report) { send(response, 404, { error: 'evaluation_run_not_found' }); return; }
    send(response, 200, { runId: evaluationRoute[1], report, reviews: snapshot.experimentStore.listEvaluationReviews(evaluationRoute[1]) });
    return;
  }
  if (evaluationRoute?.[1] && evaluationRoute[2] === 'reviews' && request.method === 'POST') {
    let body: Record<string, unknown>;
    try {
      const value = await requestBody(request);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_json');
      body = value as Record<string, unknown>;
    } catch {
      send(response, 400, { error: 'invalid_review' });
      return;
    }
    const labels: EvaluationReviewLabel[] = ['confirm', 'reject', 'unresolved', 'wrong_evidence'];
    if (typeof body.caseId !== 'string' || typeof body.ruleId !== 'string' || !labels.includes(body.label as EvaluationReviewLabel)) {
      send(response, 400, { error: 'invalid_review' });
      return;
    }
    try {
      const review = snapshot.experimentStore.saveEvaluationReview({
        runId: evaluationRoute[1], caseId: body.caseId, ruleId: body.ruleId, label: body.label as EvaluationReviewLabel,
      });
      send(response, 201, { review, reviews: snapshot.experimentStore.listEvaluationReviews(evaluationRoute[1]) });
    } catch (error) {
      send(response, error instanceof Error && error.message === 'evaluation_run_not_found' ? 404 : 400, {
        error: error instanceof Error && error.message === 'evaluation_run_not_found' ? 'evaluation_run_not_found' : 'evaluation_review_outside_run',
      });
    }
    return;
  }
  const battleReviewRoute = request.method === 'POST'
    ? url.pathname.match(/^\/api\/matches\/([^/]+)\/battles\/(battle-[a-f0-9]{12})\/review$/u)
    : null;
  if (battleReviewRoute) {
    let matchId: string;
    try { matchId = decodeURIComponent(battleReviewRoute[1] ?? ''); }
    catch { send(response, 400, { error: 'invalid_battle_review' }); return; }
    const match = snapshot.byId.get(matchId);
    if (!match) { send(response, 404, { error: 'match_not_found' }); return; }
    const scopeBounds = safeDateBounds(url.searchParams.get('from'), url.searchParams.get('to'));
    if (!scopeBounds) { send(response, 400, { error: 'invalid_date_range' }); return; }
    const squad = selectSquad(snapshot, url.searchParams.get('squadId'));
    if (!inSquad(match, squad)
      || (scopeBounds.fromMs !== undefined && match.timestamp < scopeBounds.fromMs)
      || (scopeBounds.toMs !== undefined && match.timestamp >= scopeBounds.toMs)) {
      send(response, 404, { error: 'match_outside_scope' });
      return;
    }
    let body: Record<string, unknown>;
    try {
      const value = await requestBody(request);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_json');
      body = value as Record<string, unknown>;
    } catch {
      send(response, 400, { error: 'invalid_battle_review' });
      return;
    }
    const labels: BattleReviewLabel[] = ['correct', 'insufficient_inference', 'wrong', 'unknown'];
    if (!labels.includes(body.label as BattleReviewLabel)) {
      send(response, 400, { error: 'invalid_battle_review' });
      return;
    }
    try {
      const telemetry = await loadBattleTelemetry(snapshot, match);
      const trackedPlayerIds = match.players.filter((player) => squad.memberIds.includes(player.accountId)).map((player) => player.accountId);
      const result = reconstructBattleEpisodes({ match, telemetry, trackedPlayerIds });
      const battleId = battleReviewRoute[2]!;
      if (!result.battles.some((battle) => battle.id === battleId)) {
        send(response, 404, { error: 'battle_not_found' });
        return;
      }
      const review = snapshot.experimentStore.saveBattleReview({ matchId, battleId, label: body.label as BattleReviewLabel });
      send(response, 201, { review, reviews: snapshot.experimentStore.listBattleReviews(matchId) });
    } catch {
      send(response, 409, { error: 'battle_archive_unavailable' });
    }
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
    const dates = snapshot.matches.map((match) => localDateLabel(match.timestamp, DEFAULT_TIMEZONE)).sort();
    send(response, 200, {
      matchCount: snapshot.matches.length,
      telemetryCachedMatchCount: snapshot.features.size,
      archivedMatchCount: (await archivedIds(snapshot)).size,
      archiveBackup: readArchiveBackup(),
      modeCounts: Object.fromEntries(MODE_GROUPS.map((group) => [group, snapshot.matches.filter((match) => inMode(match, group)).length])),
      rankedMatchCount: snapshot.matches.filter(isRanked).length,
      parserVersion: PARSER_VERSION,
      featureVersion: FEATURE_VERSION,
      dateFrom: dates[0] ?? null,
      dateTo: dates.at(-1) ?? null,
      modelEnabled: snapshot.modelEnabled,
      modelId: snapshot.modelId,
      selectedSquadId: snapshot.defaultSquad.id,
      squads: snapshot.squads.map(({ id, label, members, matchCount }) => ({ id, label, members: members.map((member) => member.name), matchCount })),
    });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/matches') {
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const bounds = safeDateBounds(from, to);
    if (!bounds) { send(response, 400, { error: 'invalid_date_range' }); return; }
    const squad = selectSquad(snapshot, url.searchParams.get('squadId'));
    const mode = requestedMode(url);
    const archived = wantsCompleteTelemetry(url) ? await archivedIds(snapshot) : null;
    const search = (url.searchParams.get('search') ?? '').trim().toLocaleLowerCase('zh-CN').slice(0, 100);
    const offset = Math.max(0, Math.min(10000, Number(url.searchParams.get('offset') ?? 0) || 0));
    const filtered = snapshot.matches.filter((match) => {
      const time = match.timestamp;
      if (bounds.fromMs !== undefined && time < bounds.fromMs) return false;
      if (bounds.toMs !== undefined && time >= bounds.toMs) return false;
      if (!inSquad(match, squad) || !inMode(match, mode) || (archived && !archived.has(match.matchId))) return false;
      return !search || match.mapName.toLocaleLowerCase('zh-CN').includes(search) || mapDisplayName(match.mapName).includes(search) || match.gameMode.toLocaleLowerCase('zh-CN').includes(search);
    }).sort((a, b) => b.timestamp - a.timestamp || b.matchId.localeCompare(a.matchId));
    send(response, 200, {
      total: filtered.length,
      offset,
      limit: MAX_MATCHES_PER_PAGE,
      matches: filtered.slice(offset, offset + MAX_MATCHES_PER_PAGE).map((match) => visibleMatch(match, squad, snapshot)),
    });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/analytics/performance') {
    const scopeBounds = safeDateBounds(url.searchParams.get('from'), url.searchParams.get('to'));
    if (!scopeBounds) { send(response, 400, { error: 'invalid_date_range' }); return; }
    const squad = selectSquad(snapshot, url.searchParams.get('squadId'));
    const mode = requestedMode(url);
    const archived = await archivedIds(snapshot);
    const completeOnly = wantsCompleteTelemetry(url);
    const scoped = snapshot.matches.filter((match) => inSquad(match, squad) && inMode(match, mode)
      && (!completeOnly || archived.has(match.matchId))
      && (scopeBounds.fromMs === undefined || match.timestamp >= scopeBounds.fromMs)
      && (scopeBounds.toMs === undefined || match.timestamp < scopeBounds.toMs));
    const members = new Set(squad.memberIds);
    const weaponSamples = scoped.flatMap((match) => (snapshot.features.get(match.matchId)?.facts.weapons ?? [])
      .filter((weapon) => members.has(weapon.playerId)));
    const telemetryMatches = scoped.filter((match) => snapshot.features.has(match.matchId)).length;
    const squadAnalytics = buildSquadAnalytics({ matches: scoped, memberIds: squad.memberIds });
    const maps = buildMapAnalytics({ matches: scoped, memberIds: squad.memberIds });
    const lineups = buildLineupAnalytics({ matches: scoped, memberIds: squad.memberIds });
    const series = buildMatchSeries({ matches: scoped, memberIds: squad.memberIds });
    const profiles = buildPlayerProfiles({
      matches: scoped,
      memberIds: squad.memberIds,
      facts: new Map(scoped.flatMap((match) => { const feature = snapshot.features.get(match.matchId); return feature ? [[match.matchId, feature.facts] as const] : []; })),
    });
    send(response, 200, {
      scope: { squadLabel: squad.label, selectedMatches: scoped.length, telemetryMatches, archivedMatches: scoped.filter((match) => archived.has(match.matchId)).length, mode, completeOnly },
      squad: squadAnalytics,
      maps,
      lineups,
      series,
      profiles,
      highlights: rankInsights([...buildPerformanceInsights({ squad: squadAnalytics, maps, lineups, series }), ...buildProfileInsights(profiles)]),
      weapons: buildWeaponEfficiency(weaponSamples).slice(0, 12),
    });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/analytics/compare') {
    const scopeBounds = safeDateBounds(url.searchParams.get('from'), url.searchParams.get('to'));
    if (!scopeBounds) { send(response, 400, { error: 'invalid_date_range' }); return; }
    const squad = selectSquad(snapshot, url.searchParams.get('squadId'));
    const mode = requestedMode(url);
    const archived = await archivedIds(snapshot);
    const completeOnly = wantsCompleteTelemetry(url);
    const scoped = snapshot.matches.filter((match) => inSquad(match, squad) && inMode(match, mode)
      && (!completeOnly || archived.has(match.matchId))
      && (scopeBounds.fromMs === undefined || match.timestamp >= scopeBounds.fromMs)
      && (scopeBounds.toMs === undefined || match.timestamp < scopeBounds.toMs))
      .sort((left, right) => left.timestamp - right.timestamp);
    const ids = squad.memberIds.length ? squad.memberIds : [...new Set(scoped.flatMap((match) => match.players.map((player) => player.accountId)))].slice(0, 4);
    const names: Record<string, string> = {};
    ids.forEach((id, index) => {
      const sample = scoped.flatMap((match) => match.players).find((player) => player.accountId === id);
      names[id] = safePlayerName(sample?.displayName || sample?.playerName || '', index);
    });
    send(response, 200, {
      players: ids.map((id) => ({ accountId: id, name: names[id] })),
      matches: scoped.map((match) => {
        const per: Record<string, { damage: number; kills: number; knocks: number; assists: number; survival: number; revives: number }> = {};
        for (const id of ids) {
          const player = match.players.find((item) => item.accountId === id);
          if (player) per[id] = { damage: player.damage, kills: player.kills, knocks: player.dbnos, assists: player.assists, survival: Math.max(0, player.survivalTime) / 60, revives: player.revives };
        }
        const ranks = match.players.filter((player) => ids.includes(player.accountId)).map((player) => player.rank).filter((rank): rank is number => rank !== null && rank > 0);
        return { t: match.timestamp, rank: ranks.length ? Math.min(...ranks) : null, per };
      }).filter((entry) => Object.keys(entry.per).length > 0),
    });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/analytics/telemetry') {
    const scopeBounds = safeDateBounds(url.searchParams.get('from'), url.searchParams.get('to'));
    if (!scopeBounds) { send(response, 400, { error: 'invalid_date_range' }); return; }
    const squad = selectSquad(snapshot, url.searchParams.get('squadId'));
    const requestedLimit = Number(url.searchParams.get('limit') ?? MAX_TELEMETRY_ANALYTICS_MATCHES);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(MAX_TELEMETRY_ANALYTICS_MATCHES, Math.floor(requestedLimit))) : MAX_TELEMETRY_ANALYTICS_MATCHES;
    const mode = requestedMode(url);
    const completeOnly = wantsCompleteTelemetry(url);
    const key = [squad.id, mode, completeOnly ? 'complete' : 'all', url.searchParams.get('from') ?? '', url.searchParams.get('to') ?? '', limit].join('|');
    let pending = snapshot.telemetryAnalytics.get(key);
    if (!pending) {
      pending = computeTelemetryAnalytics(snapshot, { squad, mode, fromMs: scopeBounds.fromMs, toMs: scopeBounds.toMs, limit, archived: completeOnly ? await archivedIds(snapshot) : null });
      snapshot.telemetryAnalytics.set(key, pending);
      pending.catch(() => snapshot.telemetryAnalytics.delete(key));
    }
    try {
      send(response, 200, await pending);
    } catch {
      send(response, 500, { error: 'telemetry_analytics_failed' });
    }
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/tactics/recurrent-pairs') {
    const scopeBounds = safeDateBounds(url.searchParams.get('from'), url.searchParams.get('to'));
    if (!scopeBounds) { send(response, 400, { error: 'invalid_date_range' }); return; }
    const squad = selectSquad(snapshot, url.searchParams.get('squadId'));
    const requestedLimit = Number(url.searchParams.get('limit') ?? MAX_TACTICAL_MATCHES);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(MAX_TACTICAL_MATCHES, Math.floor(requestedLimit))) : MAX_TACTICAL_MATCHES;
    const eligible = snapshot.matches.filter((match) => snapshot.telemetryUrls.has(match.matchId)
      && inSquad(match, squad)
      && (scopeBounds.fromMs === undefined || match.timestamp >= scopeBounds.fromMs)
      && (scopeBounds.toMs === undefined || match.timestamp < scopeBounds.toMs))
      .sort((left, right) => right.timestamp - left.timestamp || right.matchId.localeCompare(left.matchId));
    const selected = eligible.slice(0, limit);
    const analyses: TacticalMatchAnalysis[] = [];
    let unavailableMatches = 0;
    let nextIndex = 0;
    const workerCount = Math.min(3, selected.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < selected.length) {
        const index = nextIndex;
        nextIndex += 1;
        const match = selected[index]!;
        const trackedPlayerIds = match.players.filter((player) => squad.memberIds.includes(player.accountId)).map((player) => player.accountId);
        try {
          const telemetry = await loadBattleTelemetry(snapshot, match);
          const reconstruction = reconstructBattleEpisodes({ match, telemetry, trackedPlayerIds });
          analyses.push(analyzeTacticalMatch({ match, telemetry, reconstruction, trackedPlayerIds }));
        } catch {
          unavailableMatches += 1;
        }
      }
    }));
    const candidates = buildFrequentPairCandidates(analyses);
    const ruleIds = new Set(analyses.flatMap((analysis) => analysis.candidates.map((candidate) => candidate.ruleId)));
    const ruleCoverage = [...ruleIds].sort().map((ruleId) => {
      const rows = analyses.flatMap((analysis) => analysis.candidates.filter((candidate) => candidate.ruleId === ruleId));
      const evaluatedMatchCount = analyses.filter((analysis) => analysis.candidates.some((candidate) => candidate.ruleId === ruleId && candidate.metric.denominator !== null)).length;
      const support = new Set(rows.flatMap((candidate) => candidate.supportEvents.filter((ref) => ref.eventId).map((ref) => `${ref.matchId}\u001f${ref.eventId}`)));
      const counterexamples = new Set(rows.flatMap((candidate) => candidate.counterexamples.filter((ref) => ref.eventId).map((ref) => `${ref.matchId}\u001f${ref.eventId}`)));
      return {
        ruleId,
        matchCount: analyses.length,
        evaluatedMatchCount,
        unknownMatchCount: analyses.length - evaluatedMatchCount,
        sampleSize: rows.reduce((sum, candidate) => sum + candidate.metric.sampleSize, 0),
        supportEventCount: support.size,
        counterexampleEventCount: counterexamples.size,
      };
    });
    const labels: Record<string, string> = {};
    for (const match of selected) {
      for (const [index, player] of match.players.entries()) {
        if (!squad.memberIds.includes(player.accountId)) continue;
        labels[tacticalPlayerRef(player.accountId)] ??= safePlayerName(player.displayName || player.playerName, index);
      }
    }
    send(response, 200, {
      status: analyses.length ? 'available' : 'insufficient_data',
      ruleVersion: 'tactical-social-rules-v2',
      requestedMatches: selected.length,
      analyzedMatches: analyses.length,
      unavailableMatches,
      candidateCount: candidates.length,
      candidates,
      ruleCoverage,
      labels,
    });
    return;
  }
  const matchEpisodes = request.method === 'GET' ? url.pathname.match(/^\/api\/matches\/([^/]+)\/episodes$/u) : null;
  if (matchEpisodes) {
    let matchId: string;
    try { matchId = decodeURIComponent(matchEpisodes[1] ?? ''); }
    catch { send(response, 400, { error: 'invalid_match_id' }); return; }
    const match = snapshot.byId.get(matchId);
    if (!match) { send(response, 404, { error: 'match_not_found' }); return; }
    const scopeBounds = safeDateBounds(url.searchParams.get('from'), url.searchParams.get('to'));
    if (!scopeBounds) { send(response, 400, { error: 'invalid_date_range' }); return; }
    const squad = selectSquad(snapshot, url.searchParams.get('squadId'));
    if (!inSquad(match, squad)
      || (scopeBounds.fromMs !== undefined && match.timestamp < scopeBounds.fromMs)
      || (scopeBounds.toMs !== undefined && match.timestamp >= scopeBounds.toMs)) {
      send(response, 404, { error: 'match_outside_scope' });
      return;
    }
    if (!snapshot.telemetryUrls.has(matchId)) {
      send(response, 200, { matchId, status: 'unavailable', reason: 'no_telemetry_asset_in_snapshot' });
      return;
    }
    try {
      const telemetry = await loadBattleTelemetry(snapshot, match);
      const trackedPlayerIds = match.players
        .filter((player) => squad.memberIds.includes(player.accountId))
        .map((player) => player.accountId);
      const result = reconstructBattleEpisodes({ match, telemetry, trackedPlayerIds });
      const tactical = analyzeTacticalMatch({ match, telemetry, reconstruction: result, trackedPlayerIds });
      const playerRefs = new Set<string>();
      const teamRefs = new Set<string>();
      for (const episode of result.episodes) {
        for (const ref of episode.participantRefs) playerRefs.add(ref);
        for (const team of episode.teams) {
          if (team.teamRef) teamRefs.add(team.teamRef);
          for (const member of team.memberRefs) playerRefs.add(member);
        }
        for (const event of episode.timeline) {
          if (event.actorRef) playerRefs.add(event.actorRef);
          if (event.victimRef) playerRefs.add(event.victimRef);
          if (event.actorTeamRef) teamRefs.add(event.actorTeamRef);
          if (event.victimTeamRef) teamRefs.add(event.victimTeamRef);
        }
        for (const position of episode.positions) {
          playerRefs.add(position.playerRef);
          if (position.teamRef) teamRefs.add(position.teamRef);
        }
        for (const chain of episode.knockChains) {
          if (chain.knockedPlayerRef) playerRefs.add(chain.knockedPlayerRef);
          if (chain.attackerRef) playerRefs.add(chain.attackerRef);
        }
      }
      send(response, 200, {
        matchId,
        status: result.status,
        schemaVersion: result.schemaVersion,
        parserVersion: result.parserVersion,
        episodes: result.episodes,
        battles: result.battles,
        battleReviews: snapshot.experimentStore.listBattleReviews(matchId),
        circleSamples: result.circleSamples,
        circleTransitions: result.circleTransitions,
        labels: {
          ...battleLabels(match, squad, telemetry, playerRefs, teamRefs),
          tacticalPlayers: Object.fromEntries(match.players.flatMap((player, index) => squad.memberIds.includes(player.accountId)
            ? [[tacticalPlayerRef(player.accountId), safePlayerName(player.displayName || player.playerName, index)]]
            : [])),
        },
        tactical,
        diagnostics: result.diagnostics,
      });
    } catch {
      send(response, 200, { matchId, status: 'unavailable', reason: 'telemetry_fetch_or_parse_failed' });
    }
    return;
  }
  const mapImageRoute = request.method === 'GET' ? url.pathname.match(/^\/api\/maps\/([A-Za-z0-9]+_Main)$/u) : null;
  if (mapImageRoute) {
    // Map artwork lives in a runtime directory (see scripts/fetch-pubg-map-images.sh), never in Git.
    const directory = process.env.PUBG_INTELLIGENCE_MAP_DIR?.trim() || join(homedir(), '.local', 'share', 'amadeus', 'pubg-intelligence-lab', 'maps');
    for (const [extension, type] of [['jpg', 'image/jpeg'], ['png', 'image/png']] as const) {
      const file = join(directory, `${mapImageRoute[1]}.${extension}`);
      if (existsSync(file) && statSync(file).isFile()) {
        response.writeHead(200, { 'content-type': type, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' });
        response.end(readFileSync(file));
        return;
      }
    }
    send(response, 404, { error: 'map_image_missing' });
    return;
  }
  const matchStoryRoute = request.method === 'GET' ? url.pathname.match(/^\/api\/matches\/([^/]+)\/story$/u) : null;
  if (matchStoryRoute) {
    let matchId: string;
    try { matchId = decodeURIComponent(matchStoryRoute[1] ?? ''); }
    catch { send(response, 400, { error: 'invalid_match_id' }); return; }
    const match = snapshot.byId.get(matchId);
    if (!match) { send(response, 404, { error: 'match_not_found' }); return; }
    send(response, 200, await computeMatchStory(snapshot, selectSquad(snapshot, url.searchParams.get('squadId')), match));
    return;
  }
  const matchRelative = request.method === 'GET' ? url.pathname.match(/^\/api\/matches\/([^/]+)\/relative$/u) : null;
  if (matchRelative) {
    let matchId: string;
    try { matchId = decodeURIComponent(matchRelative[1] ?? ''); }
    catch { send(response, 400, { error: 'invalid_match_id' }); return; }
    const match = snapshot.byId.get(matchId);
    if (!match) { send(response, 404, { error: 'match_not_found' }); return; }
    send(response, 200, await computeMatchRelative(snapshot, selectSquad(snapshot, url.searchParams.get('squadId')), match));
    return;
  }
  const matchDetail = request.method === 'GET' ? url.pathname.match(/^\/api\/matches\/([^/]+)$/u) : null;
  if (matchDetail) {
    let matchId: string;
    try { matchId = decodeURIComponent(matchDetail[1] ?? ''); }
    catch { send(response, 400, { error: 'invalid_match_id' }); return; }
    const match = snapshot.byId.get(matchId);
    if (!match) { send(response, 404, { error: 'match_not_found' }); return; }
    const feature = snapshot.features.get(match.matchId);
    const facts = structuredClone(feature?.facts ?? extractMatchReviewFacts(match, { events: [] }, createSyntheticTeam(match)));
    const knownPlacements = [...new Set(match.players.map((player) => player.rank).filter((rank): rank is number => rank !== null && rank > 0))];
    if (knownPlacements.length > 1) {
      facts.match.placement = null;
      facts.squad.placement = null;
      facts.players.forEach((player) => { player.rank = null; });
    }
    const analysis = analyzeMatchReview(facts);
    send(response, 200, {
      match: visibleMatch(match, selectSquad(snapshot, url.searchParams.get('squadId')), snapshot),
      telemetry: feature ? { status: 'HIT', parserVersion: PARSER_VERSION, featureVersion: FEATURE_VERSION, createdAt: feature.createdAt } : { status: 'MISSING', parserVersion: PARSER_VERSION, featureVersion: FEATURE_VERSION },
      analysis: {
        summary: scrubText(analysis.summary, match),
        teamStory: analysis.teamStory ? scrubText(analysis.teamStory, match) : null,
        good: analysis.good.slice(0, 5).map((value) => scrubText(value, match)),
        improvements: analysis.improvements.slice(0, 5).map((value) => scrubText(value, match)),
        players: facts.players.map((player, index) => ({
          name: safePlayerName(player.playerName, index), kills: player.kills, knocks: player.dbnos, damage: player.damage,
          revives: player.revives, role: player.matchRole ?? null,
        })),
      },
      evidence: facts.evidence.slice(0, 30).map((item, index) => ({
        id: `E${String(index + 1).padStart(2, '0')}`,
        source: item.source,
        kind: item.kind,
        description: scrubText(item.description, match),
      })),
    });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/research') {
    let body: Record<string, unknown>;
    try {
      const value = await requestBody(request);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_json');
      body = value as Record<string, unknown>;
    } catch (error) {
      send(response, 400, { error: error instanceof Error && error.message === 'request_too_large' ? 'request_too_large' : 'invalid_json' });
      return;
    }
    const question = typeof body.question === 'string' ? redactSensitiveText(body.question.trim()) : '';
    if (!question) { send(response, 400, { error: 'question_required' }); return; }
    const from = typeof body.from === 'string' ? body.from : null;
    const to = typeof body.to === 'string' ? body.to : null;
    const bounds = safeDateBounds(from, to);
    if (!bounds) { send(response, 400, { error: 'invalid_date_range' }); return; }
    const squad = selectSquad(snapshot, body.squadId);
    const templateResult = ResearchTemplateSchema.safeParse(body.template ?? 'tactical_coaching');
    if (!templateResult.success) { send(response, 400, { error: 'invalid_template' }); return; }
    const template: ResearchTemplate = templateResult.data;
    const selectedMatchId = typeof body.matchId === 'string' ? body.matchId : undefined;
    let scopedMatches = snapshot.matches.filter((match) => {
      if (!inSquad(match, squad)) return false;
      if (bounds.fromMs !== undefined && match.timestamp < bounds.fromMs) return false;
      if (bounds.toMs !== undefined && match.timestamp >= bounds.toMs) return false;
      return true;
    });
    if (selectedMatchId) {
      const selected = scopedMatches.find((match) => match.matchId === selectedMatchId);
      if (!selected) { send(response, 404, { error: 'match_outside_scope' }); return; }
      scopedMatches = [selected];
    }
    const playerNames = new Map<string, string>();
    for (const [index, match] of scopedMatches.entries()) {
      for (const player of match.players) {
        const accountId = player.accountId;
        if (squad.memberIds.length && !squad.memberIds.includes(accountId)) continue;
        playerNames.set(accountId, safePlayerName(player.displayName || player.playerName, index));
      }
    }
    const playerAliases = [...playerNames.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([accountId, name], index) => ({ accountId, name, alias: `PLAYER_${String(index + 1).padStart(2, '0')}` }));
    const playerReview = selectedMatchId ? undefined : requestedPlayerReview(question, playerAliases);
    const playerReviewLimit = playerReview ? requestedRecentMatchCount(question) : 0;
    const researchMatches = playerReview
      ? scopedMatches.filter((match) => match.players.some((player) => player.accountId === playerReview.accountId))
        .sort((left, right) => right.timestamp - left.timestamp || right.matchId.localeCompare(left.matchId))
        .slice(0, playerReviewLimit)
      : scopedMatches;
    const researchSquad: ResearchSquad = playerReview
      ? { ...squad, label: playerReview.name, memberIds: [playerReview.accountId] }
      : squad;
    const privateIdentifiers = [
      ...snapshot.matches.map((match) => ({ value: match.matchId, alias: '[比赛编号已隐藏]' })),
      ...snapshot.matches.flatMap((match) => match.players.map((player) => ({ value: player.accountId, alias: '[队员编号已隐藏]' }))),
    ];
    const selectedPlayerNames = new Set(playerAliases.map((item) => item.name.toLocaleLowerCase('zh-CN')));
    const outOfScopePlayerAliases = snapshot.matches.flatMap((match) => match.players)
      .map((player) => player.displayName || player.playerName)
      .filter((name) => name.trim() && !selectedPlayerNames.has(name.toLocaleLowerCase('zh-CN')))
      .map((name) => ({ name, alias: '[范围外队员已隐藏]' }));
    const reviewPlayerAliases = playerReview
      ? [
        { name: playerReview.name, alias: 'PLAYER_01' },
        ...snapshot.matches.flatMap((match) => match.players)
          .map((player) => player.displayName || player.playerName)
          .filter((name) => name.trim() && name.toLocaleLowerCase('zh-CN') !== playerReview.name.toLocaleLowerCase('zh-CN'))
          .map((name) => ({ name, alias: '[范围外队员已隐藏]' })),
      ]
      : [...playerAliases, ...outOfScopePlayerAliases];
    const modelQuestion = anonymizeResearchText(question, reviewPlayerAliases, privateIdentifiers);
    const rawHistory = Array.isArray(body.history) ? body.history : [];
    const priorTurns: Array<{ role: 'user' | 'assistant'; text: string }> = rawHistory.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const row = item as Record<string, unknown>;
      if ((row.role !== 'user' && row.role !== 'assistant') || typeof row.text !== 'string') return [];
      return [{ role: row.role as 'user' | 'assistant', text: anonymizeResearchText(redactSensitiveText(row.text), reviewPlayerAliases, privateIdentifiers) }];
    }).slice(-6);
    const conversationReply = shortConversationReply(question);
    const plan = conversationReply
      ? { intent: { action: 'unsupported', metric: null, groupBy: null } as const, source: 'local-rule' as const }
      : playerReview
        ? { intent: { action: 'player_comparison', metric: classifyResearchQuestion(question).metric ?? 'damage', groupBy: 'player' } as const, source: 'local-rule' as const }
        : await snapshot.planner.plan(modelQuestion);
    const report = buildResearchReport({
      matches: researchMatches,
      squad: researchSquad,
      intent: plan.intent,
      telemetryMatchIds: new Set(snapshot.features.keys()),
    });
    let assistantLabels: Record<string, string> = {};
    let assistant: ResearchAssistantResult;
    if (conversationReply) {
      assistant = {
        version: 'research-assistant-v1',
        status: 'abstained',
        source: 'deterministic-fallback',
        template,
        answer: conversationReply,
        claims: [],
        evidence: [],
        toolNames: [],
        degradedReason: null,
      };
    } else {
      const assistantContext = createScopedAssistantContext({
        snapshot,
        matches: researchMatches,
        squad: researchSquad,
        telemetryMatchIds: new Set(snapshot.features.keys()),
        ...(playerReview ? { requestedMatchLimit: playerReviewLimit } : {}),
      });
      assistantLabels = assistantContext.labels;
      const fallbackMetrics = await assistantContext.tools.getScopedMetrics({
        metric: plan.intent.metric ?? 'damage',
        groupBy: plan.intent.groupBy ?? 'none',
      }) as { evidenceRefs?: string[] };
      const deterministicFallback = deterministicAssistantFallback(question, report.answer, plan.intent.action);
      const targetMetrics = report.players[0];
      const fallbackAnswer = playerReview
        ? report.scope.selectedMatches
          ? `${playerReview.name} 最近请求的 ${playerReviewLimit} 场中，本地找到 ${report.scope.selectedMatches} 场：${targetMetrics?.kills ?? 0} 杀，累计 ${Math.round(targetMetrics?.damage ?? 0).toLocaleString('zh-CN')} 伤害（平均 ${Math.round(targetMetrics?.averageDamage ?? 0)}），${targetMetrics?.knocks ?? 0} 次击倒、${targetMetrics?.revives ?? 0} 次救援，平均生存 ${Math.round(targetMetrics?.averageSurvivalTime ?? 0)} 秒。${report.telemetry.currentCacheMatches}/${report.scope.selectedMatches} 场有本地 Telemetry 特征；没有模型时，我先不对武器选择或团战跟进作定性。`
          : `${playerReview.name} 在当前小队和日期范围内没有可分析比赛；可以确认小队选择或扩大日期范围。`
        : deterministicFallback.answer;
      assistant = await runResearchAssistant({
        ...(snapshot.researchModel ? { model: snapshot.researchModel } : {}),
        message: modelQuestion,
        priorTurns,
        template,
        scopeDescription: playerReview
          ? `PLAYER_01, the latest ${researchMatches.length} of up to ${playerReviewLimit} requested matches within ${from ?? 'start'} through ${to ?? 'latest'}`
          : `${from ?? 'start'} through ${to ?? 'latest'}, selected squad, ${scopedMatches.length} eligible matches`,
        fallbackAnswer,
        fallbackEvidenceRefs: deterministicFallback.citeReportEvidence ? fallbackMetrics.evidenceRefs ?? [] : deterministicFallback.evidenceRefs,
        tools: assistantContext.tools,
        evidenceByAlias: assistantContext.evidenceByAlias,
        signal: AbortSignal.timeout(45_000),
      });
    }
    const runId = snapshot.experimentStore.save({ question, intent: plan.intent, source: plan.source, report, assistant });
    send(response, 200, {
      runId,
      intent: plan.intent,
      plannerSource: plan.source,
      report,
      assistant: { ...assistant, labels: assistantLabels, recoveryMessage: researchRecoveryMessage(assistant.degradedReason) },
    });
    return;
  }
  send(response, 404, { error: 'not_found' });
}

export async function startServer(options: { researchModel?: Exclude<LanguageModel, string> } = {}): Promise<{ close: () => Promise<void>; url: string }> {
  const bootStart = Date.now();
  const bootMark = (label: string) => { if (process.env.PUBG_INTELLIGENCE_BOOT_TIMING === '1') process.stderr.write(`BOOT ${label} +${Date.now() - bootStart}ms\n`); };
  const snapshot = await openSnapshot(options.researchModel);
  bootMark('snapshot opened');
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const host = process.env.HOST?.trim() || DEFAULT_HOST;
  if (!isLoopbackHost(host) && !isPrivateIPv4Host(host)) throw new Error('HOST_MUST_BE_LOOPBACK_OR_PRIVATE_IPV4');
  const allowedNetwork = bindNetwork(host);
  let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
  const publicAccess = loadPublicAccess(process.env, process.env.PUBG_INTELLIGENCE_STATE_DIR?.trim() || join(homedir(), '.local', 'share', 'amadeus', 'pubg-intelligence-lab'));
  if (publicAccess && !existsSync(resolve(CLIENT_DIST, 'index.html'))) throw new Error('public_access_needs_built_client');
  const server = createServer((request, response) => {
    if (isPublicRequest(request, publicAccess)) {
      void handlePublic(request, response, snapshot, publicAccess!, handleApi).catch(() => {
        if (!response.headersSent) sendPublicJson(response, 500, { error: 'research_request_failed' });
      });
      return;
    }
    // Anything relayed by the public proxy must carry the public Host; a proxied request for another host is refused.
    if (looksProxied(request)) { send(response, 403, { error: 'proxied_request_not_allowed' }); return; }
    if ((request.url ?? '').startsWith('/api/')) {
      if (!isLocalRequest(request, allowedNetwork)) { send(response, 403, { error: 'local_network_access_only' }); return; }
      void handleApi(request, response, snapshot).catch(() => {
        if (!response.headersSent) send(response, 500, { error: 'research_request_failed' });
      });
      return;
    }
    vite?.middlewares(request, response, () => {
      if (!response.headersSent) { response.writeHead(404); response.end('Not found'); }
    });
  });
  // The dev server's HMR socket must never be reachable through the public hostname or the proxy.
  server.prependListener('upgrade', (request, socket) => {
    if (isPublicRequest(request, publicAccess) || looksProxied(request)) socket.destroy();
  });
  bootMark('before vite');
  vite = await createViteServer({
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
    optimizeDeps: {
      noDiscovery: true,
      include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    },
  });
  bootMark('vite ready');
  await new Promise<void>((resolveStart, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolveStart());
  });
  bootMark('listening');
  // Warm the per-match telemetry results for the default squad so the first visit to the field tab is quick.
  void computeTelemetryAnalytics(snapshot, { squad: snapshot.defaultSquad, mode: 'squad', fromMs: undefined, toMs: undefined, limit: MAX_TELEMETRY_ANALYTICS_MATCHES })
    .catch(() => undefined);
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return {
    url: `http://${host}:${actualPort}`,
    close: async () => {
      await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
      await vite?.close();
      await snapshot.analysisPool.close();
      snapshot.experimentStore.close();
    },
  };
}