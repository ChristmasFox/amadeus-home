import { randomUUID } from 'node:crypto';
import type { TeamConfig, TeamPlayer } from '../config/team.js';
import type { Coverage, DataStatus, Evidence, SourceInfo } from '../schema/status.js';
import type { CanonicalQuery, GroupBy, Metric, Selector } from '../schema/query.js';
import { CanonicalQuerySchema } from '../schema/query.js';
import type { NormalizedMatch, QueryRow, ResultSetRecord, StructuredResult } from '../data/model.js';
import { DeterministicQueryEngine, resultSetFromResult } from '../engine/query-engine.js';
import { PubgApiClient, PubgApiError } from '../data/pubg-api-client.js';
import { SqlitePubgRepository } from '../storage/sqlite-repository.js';
import { TelemetryWorker, PubgApiTelemetryDownloader } from '../review/telemetry.js';
import { emptyMatchReviewFacts, selectMatchReviewFactCategories } from '../review/review-facts.js';
import { analyzeMatchReview } from '../review/review-analyzer.js';
import type { MatchReviewResult } from '../review/types.js';

export const PUBGMETRIC_VERSION = 'pubg-metrics-v1';
export const PUBG_QUERY_VERSION = 'pubg-query-v1';
export const PUBG_RESULT_SET_TTL_MS = 30 * 60 * 1000;

export type ToolStatus = 'ok' | 'partial' | 'no_matches' | 'error';

export interface ToolError {
  code: string;
  retryable: boolean;
  reason: string;
}

export interface ToolEnvelope<T = unknown> {
  status: ToolStatus;
  data: T;
  coverage: Coverage;
  asOf: string;
  metricVersion: string;
  queryResolved: Record<string, unknown>;
  evidenceRefs: Evidence;
  resultSetId?: string;
  error?: ToolError;
}

export interface SubjectInput {
  playerIds?: string[];
  playerNames?: string[];
  signal?: AbortSignal;
}

export interface TimeRangeInput {
  type: 'time_range';
  from: string;
  to: string;
  timezone?: string;
  businessDayStart?: string;
}

export interface LastMatchesInput {
  type: 'last_n_matches';
  count: number;
  offset?: number;
}

export interface ResultSetInput {
  type: 'result_set';
  resultSetId: string;
}

export type ToolSelectorInput = TimeRangeInput | LastMatchesInput | ResultSetInput;

export interface StatsToolInput extends SubjectInput {
  sessionId: string;
  selector: ToolSelectorInput;
  metrics: Metric[];
  operation?: 'report' | 'detail' | 'rank' | 'strongest' | 'weakest' | 'trend' | 'list';
  groupBy?: GroupBy;
  orderBy?: { metric: Metric; direction: 'asc' | 'desc' };
  limit?: number;
  refresh?: boolean;
}

export interface CompareToolInput extends SubjectInput {
  sessionId: string;
  segments: Array<{ label: string; selector: ToolSelectorInput }>;
  metrics: Metric[];
  groupBy?: GroupBy;
  orderBy?: { metric: Metric; direction: 'asc' | 'desc' };
  limit?: number;
  refresh?: boolean;
}

export interface SearchMatchesInput extends SubjectInput {
  sessionId: string;
  from?: string;
  to?: string;
  timezone?: string;
  gameMode?: string;
  mapName?: string;
  sort?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  recentN?: number;
  refresh?: boolean;
}

export interface ResolvePlayersInput {
  sessionId: string;
  playerNames?: string[];
  playerIds?: string[];
  refresh?: boolean;
  signal?: AbortSignal;
}

export interface GetMatchInput {
  sessionId: string;
  matchId: string;
  refresh?: boolean;
  signal?: AbortSignal;
}

export interface GetReviewFactsInput extends GetMatchInput {
  playerIds?: string[];
  categories?: string[];
}

function asFiniteDate(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceForLocal(records: NormalizedMatch[], now: Date, state: ReturnType<SqlitePubgRepository['getSyncState']>): SourceInfo {
  if (state) return { ...state.source, localMatchCount: records.length };
  return {
    store: 'sqlite',
    syncInvoked: false,
    playerApiCalls: 0,
    matchApiCalls: 0,
    localMatchCount: records.length,
  };
}

function coverageForLocal(records: NormalizedMatch[], now: Date, state: ReturnType<SqlitePubgRepository['getSyncState']>): Coverage {
  if (state) return { ...state.coverage, checkedAt: state.checkedAt, availableMatchCount: records.length };
  const timestamps = records.map((record) => record.timestamp).filter((value) => Number.isFinite(value));
  return {
    status: 'OK',
    complete: true,
    coverageStart: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null,
    coverageEnd: now.toISOString(),
    checkedAt: now.toISOString(),
    failedMatchIds: [],
    sourceUnavailable: false,
    freshness: 'unknown',
    localComplete: true,
    queryCovered: true,
    requiredMatchCount: records.length,
    availableMatchCount: records.length,
  };
}

function coverageWithRecords(coverage: Coverage, records: NormalizedMatch[], now: Date): Coverage {
  const timestamps = records.map((record) => record.timestamp).filter((value) => Number.isFinite(value));
  return {
    ...coverage,
    coverageStart: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : coverage.coverageStart ?? null,
    coverageEnd: now.toISOString(),
    checkedAt: now.toISOString(),
    requiredMatchCount: records.length + coverage.failedMatchIds.length,
    availableMatchCount: records.length,
  };
}

function uniqueStrings(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function playerIdsFromSubject(input: SubjectInput, team: TeamConfig): { ids: string[]; names: string[] } {
  const ids = uniqueStrings(input.playerIds);
  const names = uniqueStrings(input.playerNames);
  if (!ids.length && !names.length) return { ids: team.players.map((player) => player.id), names: [] };
  return { ids, names };
}

function lowerStatus(status: DataStatus): ToolStatus {
  if (status === 'NO_MATCHES') return 'no_matches';
  if (status === 'OK') return 'ok';
  if (status === 'PARTIAL' || status === 'COVERAGE_GAP' || status === 'STALE' || status === 'REVIEW_PARTIAL') return 'partial';
  return 'error';
}

function errorFor(status: DataStatus, diagnostics: Record<string, unknown>, source: SourceInfo): ToolError | undefined {
  if (status === 'OK' || status === 'NO_MATCHES' || status === 'PARTIAL' || status === 'COVERAGE_GAP' || status === 'STALE' || status === 'REVIEW_PARTIAL') return undefined;
  const code = typeof diagnostics.errorCode === 'string'
    ? diagnostics.errorCode
    : status === 'SOURCE_UNAVAILABLE' ? 'source_unavailable'
      : status.toLowerCase();
  return {
    code,
    retryable: status === 'SOURCE_UNAVAILABLE',
    reason: typeof source.error === 'string' ? source.error : String((diagnostics.errors as string[] | undefined)?.[0] ?? status),
  };
}

function evidenceFor(result: StructuredResult): Evidence {
  return {
    ...result.evidence,
    calculation: result.evidence.calculation || PUBG_QUERY_VERSION,
  };
}

function sanitize(value: unknown): unknown {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item)]));
  }
  return value;
}

function selectorToCanonical(selector: ToolSelectorInput, timezone: string, businessDayStart: string): Selector {
  if (selector.type === 'time_range') {
    return {
      type: 'time_range',
      start: selector.from,
      end: selector.to,
      timezone: selector.timezone ?? timezone,
      businessDayStart: selector.businessDayStart ?? businessDayStart,
    };
  }
  if (selector.type === 'last_n_matches') {
    return { type: 'last_n_matches', count: Math.min(Math.max(Math.trunc(selector.count), 1), 100), offset: Math.max(0, Math.trunc(selector.offset ?? 0)) };
  }
  return { type: 'result_set', resultSetId: selector.resultSetId };
}

function queryForStats(input: StatsToolInput, subjectIds: string[], timezone: string, businessDayStart: string): CanonicalQuery {
  const operation = input.operation ?? 'report';
  const groupBy = input.groupBy ?? 'player';
  const metrics = uniqueStrings(input.metrics as string[]) as Metric[];
  const orderBy = input.orderBy ?? { metric: metrics[0] ?? 'kills', direction: 'desc' as const };
  return CanonicalQuerySchema.parse({
    version: 3,
    queryId: 'pubg-' + randomUUID(),
    domain: 'pubg',
    subject: { type: subjectIds.length === 1 ? 'player' : 'players', ids: subjectIds },
    operation,
    selector: selectorToCanonical(input.selector, timezone, businessDayStart),
    matchSelector: null,
    segments: [],
    groupBy,
    metrics: metrics.length ? metrics : ['kills'],
    filters: {},
    orderBy,
    limit: input.limit === undefined ? null : Math.min(Math.max(Math.trunc(input.limit), 1), 100),
    reference: {
      sessionId: input.sessionId,
      selectorExplicit: true,
      subjectExplicit: Boolean(input.playerIds?.length || input.playerNames?.length),
      useResultSet: input.selector.type === 'result_set',
      resultSetId: input.selector.type === 'result_set' ? input.selector.resultSetId : undefined,
      inheritedFromContext: false,
      planner: 'provided',
    },
    presentation: { compact: true },
  });
}

function queryForCompare(input: CompareToolInput, subjectIds: string[], timezone: string, businessDayStart: string): CanonicalQuery {
  const metrics = uniqueStrings(input.metrics as string[]) as Metric[];
  return CanonicalQuerySchema.parse({
    version: 3,
    queryId: 'pubg-' + randomUUID(),
    domain: 'pubg',
    subject: { type: subjectIds.length === 1 ? 'player' : 'players', ids: subjectIds },
    operation: 'compare',
    selector: selectorToCanonical(input.segments[0]?.selector ?? { type: 'last_n_matches', count: 1 }, timezone, businessDayStart),
    matchSelector: null,
    segments: input.segments.slice(0, 2).map((segment) => ({ label: segment.label, selector: selectorToCanonical(segment.selector, timezone, businessDayStart) })),
    groupBy: input.groupBy ?? 'player',
    metrics: metrics.length ? metrics : ['kills'],
    filters: {},
    orderBy: input.orderBy ?? { metric: metrics[0] ?? 'kills', direction: 'desc' as const },
    limit: input.limit === undefined ? null : Math.min(Math.max(Math.trunc(input.limit), 1), 100),
    reference: {
      sessionId: input.sessionId,
      selectorExplicit: true,
      subjectExplicit: Boolean(input.playerIds?.length || input.playerNames?.length),
      inheritedFromContext: false,
      planner: 'provided',
    },
    presentation: { compact: true },
  });
}

function resultEnvelope(result: StructuredResult, query: CanonicalQuery, resultSetId?: string): ToolEnvelope {
  const envelope: ToolEnvelope = {
    status: lowerStatus(result.status),
    data: sanitize(result.data),
    coverage: sanitize(result.coverage) as Coverage,
    asOf: result.coverage.checkedAt ?? new Date().toISOString(),
    metricVersion: PUBGMETRIC_VERSION,
    queryResolved: sanitize(query) as Record<string, unknown>,
    evidenceRefs: sanitize(evidenceFor(result)) as Evidence,
    ...(resultSetId ? { resultSetId } : {}),
  };
  const error = errorFor(result.status, result.diagnostics, result.source);
  if (error) envelope.error = error;
  return envelope;
}

export interface PubgDomainServiceOptions {
  team: TeamConfig;
  repository: SqlitePubgRepository;
  apiClient?: PubgApiClient;
  telemetryWorker?: TelemetryWorker;
  timezone?: string;
  businessDayStart?: string;
  maxMatches?: number;
  now?: () => Date;
  freshnessMs?: number;
}

export class PubgDomainService {
  readonly team: TeamConfig;
  readonly repository: SqlitePubgRepository;
  private readonly apiClient: PubgApiClient | undefined;
  private readonly telemetryWorker: TelemetryWorker;
  private readonly timezone: string;
  private readonly businessDayStart: string;
  private readonly maxMatches: number;
  private readonly now: () => Date;
  private readonly freshnessMs: number;
  private readonly queryEngine: DeterministicQueryEngine;

  constructor(options: PubgDomainServiceOptions) {
    this.team = options.team;
    this.repository = options.repository;
    const apiClient = options.apiClient;
    this.apiClient = apiClient;
    this.timezone = options.timezone ?? 'Asia/Shanghai';
    this.businessDayStart = options.businessDayStart ?? '00:00';
    this.maxMatches = Math.min(Math.max(1, Math.trunc(options.maxMatches ?? 500)), 1000);
    this.now = options.now ?? (() => new Date());
    this.freshnessMs = options.freshnessMs ?? 5 * 60 * 1000;
    this.telemetryWorker = options.telemetryWorker ?? new TelemetryWorker({
      team: this.team,
      store: this.repository,
      ...(apiClient ? { downloader: new PubgApiTelemetryDownloader({ apiKey: apiClient.apiKey, baseUrl: apiClient.baseUrl }) } : {}),
    });
    this.queryEngine = new DeterministicQueryEngine({
      team: this.team,
      timezone: this.timezone,
      businessDayStart: this.businessDayStart,
      now: this.now(),
    });
  }

  private async refresh(refresh = true, maxMatches = 500, signal?: AbortSignal): Promise<{ records: NormalizedMatch[]; coverage: Coverage; source: SourceInfo; diagnostics: Record<string, unknown> }> {
    const now = this.now();
    const existing = this.repository.listMatches();
    const state = this.repository.getSyncState('team:' + this.team.id);
    const stateChecked = state ? Date.parse(state.checkedAt) : Number.NaN;
    if (!refresh && state && Number.isFinite(stateChecked) && now.getTime() - stateChecked < this.freshnessMs) {
      return { records: existing, coverage: coverageForLocal(existing, now, state), source: sourceForLocal(existing, now, state), diagnostics: { refreshed: false, reason: 'fresh_cache' } };
    }
    if (!this.apiClient) return { records: existing, coverage: coverageForLocal(existing, now, state), source: sourceForLocal(existing, now, state), diagnostics: { refreshed: false, reason: 'api_not_configured' } };
    const synced = await this.apiClient.syncTeam(this.team, {
      maxMatches,
      knownMatchIds: existing.map((record) => record.matchId),
      ...(signal ? { signal } : {}),
    });
    if (synced.records.length) {
      this.repository.upsertMatches(synced.records, { source: 'pubg-api', fetchedAt: now.toISOString(), checkedPlayerIds: this.team.players.map((player) => player.id) });
    }
    const merged = this.repository.listMatches();
    const stateValue = {
      key: 'team:' + this.team.id,
      checkedAt: now.toISOString(),
      coverage: coverageWithRecords(synced.coverage, merged, now),
      source: { ...synced.source, localMatchCount: merged.length },
      discoveredMatchIds: synced.discoveredMatchIds,
      failedMatchIds: synced.coverage.failedMatchIds,
      ...(synced.source.error ? { error: synced.source.error } : {}),
    };
    this.repository.setSyncState(stateValue);
    return { records: merged, coverage: stateValue.coverage, source: stateValue.source, diagnostics: synced.diagnostics ?? {} };
  }

  private resolveSubject(input: SubjectInput): { ids: string[]; players: TeamPlayer[]; error?: ToolError } {
    const requested = playerIdsFromSubject(input, this.team);
    const aliasMap = new Map<string, TeamPlayer>();
    for (const player of this.team.players) {
      aliasMap.set(player.id.toLowerCase(), player);
      aliasMap.set(player.name.toLowerCase(), player);
      for (const alias of player.aliases) aliasMap.set(alias.toLowerCase(), player);
    }
    const players = [...requested.ids.map((id) => this.team.players.find((player) => player.id === id)).filter((player): player is TeamPlayer => Boolean(player))];
    for (const name of requested.names) {
      const player = aliasMap.get(name.toLowerCase());
      if (!player) return { ids: [], players: [], error: { code: 'unknown_player', retryable: false, reason: name } };
      if (!players.some((item) => item.id === player.id)) players.push(player);
    }
    const unknownIds = requested.ids.filter((id) => !this.team.players.some((player) => player.id === id));
    if (unknownIds.length) return { ids: [], players: [], error: { code: 'unknown_player', retryable: false, reason: unknownIds.join(',') } };
    return { ids: players.map((player) => player.id), players };
  }

  async resolvePlayers(input: ResolvePlayersInput): Promise<ToolEnvelope> {
    const requested = playerIdsFromSubject(input, this.team);
    const subject = this.resolveSubject(input);
    if (subject.error && input.playerNames?.length && this.apiClient) {
      try {
        const entries = await this.apiClient.discoverPlayers(this.team.platform, [], input.playerNames, input.signal);
        const resolved = entries.map((entry) => ({ accountId: String(entry.id ?? ''), apiName: String((entry.attributes as Record<string, unknown> | undefined)?.name ?? '') })).filter((item) => item.accountId);
        const exact = resolved.filter((item) => input.playerNames?.some((name) => item.apiName.toLowerCase() === name.toLowerCase()));
        return {
          status: exact.length === 1 ? 'ok' : exact.length > 1 ? 'error' : 'no_matches',
          data: { requestedNames: input.playerNames, matches: exact, configured: false },
          coverage: coverageForLocal([], this.now(), null),
          asOf: this.now().toISOString(),
          metricVersion: PUBGMETRIC_VERSION,
          queryResolved: { tool: 'pubg_resolve_players', platform: this.team.platform },
          evidenceRefs: { matchIds: [], playerIds: exact.map((item) => item.accountId), fields: ['accountId', 'apiName'], calculation: 'configured_alias_or_official_player_lookup' },
          ...(exact.length > 1 ? { error: { code: 'ambiguous_player', retryable: false, reason: 'multiple official players matched' } } : {}),
        };
      } catch (error) {
        return this.errorEnvelope('player_lookup_failed', error instanceof PubgApiError ? error.retryable : true, error instanceof Error ? error.message : 'player lookup failed');
      }
    }
    if (subject.error) return this.errorEnvelope(subject.error.code, subject.error.retryable, subject.error.reason);
    return {
      status: 'ok',
      data: { platform: this.team.platform, teamId: this.team.id, teamLabel: this.team.label, players: subject.players.map((player) => ({ accountId: player.id, name: player.name, aliases: player.aliases })) },
      coverage: coverageForLocal([], this.now(), null),
      asOf: this.now().toISOString(),
      metricVersion: PUBGMETRIC_VERSION,
      queryResolved: { tool: 'pubg_resolve_players', requested: requested },
      evidenceRefs: { matchIds: [], playerIds: subject.ids, fields: ['accountId', 'name', 'aliases'], calculation: 'configured_team_aliases' },
    };
  }

  private errorEnvelope(code: string, retryable: boolean, reason: string): ToolEnvelope {
    return {
      status: 'error',
      data: {},
      coverage: coverageForLocal([], this.now(), null),
      asOf: this.now().toISOString(),
      metricVersion: PUBGMETRIC_VERSION,
      queryResolved: {},
      evidenceRefs: { matchIds: [], playerIds: [], fields: [], calculation: PUBG_QUERY_VERSION },
      error: { code, retryable, reason },
    };
  }

  async queryStats(input: StatsToolInput): Promise<ToolEnvelope> {
    const subject = this.resolveSubject(input);
    if (subject.error) return this.errorEnvelope(subject.error.code, subject.error.retryable, subject.error.reason);
    const source = await this.refresh(input.refresh !== false || input.selector.type === 'last_n_matches', this.maxMatches, input.signal);
    let resultSetMatchIds: string[] | undefined;
    if (input.selector.type === 'result_set') {
      const resultSet = this.repository.getResultSet(input.sessionId, input.selector.resultSetId, this.now());
      if (!resultSet) return this.errorEnvelope('result_set_not_found_or_session_mismatch', false, 'result set is missing, expired, or belongs to another session');
      resultSetMatchIds = resultSet.matchIds;
    }
    const query = queryForStats(input, subject.ids, this.timezone, this.businessDayStart);
    const result = this.queryEngine.execute(query, source.records, source.coverage, source.source, {
      team: this.team,
      now: this.now(),
      ...(resultSetMatchIds ? { resultSetMatchIds } : {}),
    });
    const resultSet = resultSetFromResult(result, query, input.sessionId, PUBG_RESULT_SET_TTL_MS);
    this.repository.setResultSet(resultSet);
    return resultEnvelope(result, query, resultSet.id);
  }

  async compareStats(input: CompareToolInput): Promise<ToolEnvelope> {
    const subject = this.resolveSubject(input);
    if (subject.error) return this.errorEnvelope(subject.error.code, subject.error.retryable, subject.error.reason);
    const source = await this.refresh(input.refresh !== false, this.maxMatches, input.signal);
    const query = queryForCompare(input, subject.ids, this.timezone, this.businessDayStart);
    const result = this.queryEngine.execute(query, source.records, source.coverage, source.source, { team: this.team, now: this.now() });
    const resultSet = resultSetFromResult(result, query, input.sessionId, PUBG_RESULT_SET_TTL_MS);
    this.repository.setResultSet(resultSet);
    return resultEnvelope(result, query, resultSet.id);
  }

  async searchMatches(input: SearchMatchesInput): Promise<ToolEnvelope> {
    const subject = this.resolveSubject(input);
    if (subject.error) return this.errorEnvelope(subject.error.code, subject.error.retryable, subject.error.reason);
    const source = await this.refresh(input.refresh !== false || input.recentN !== undefined, this.maxMatches, input.signal);
    const now = this.now();
    const from = input.from ? asFiniteDate(input.from) : 0;
    const to = input.to ? asFiniteDate(input.to) : now.getTime();
    if (from === null || to === null || from >= to) return this.errorEnvelope('invalid_time_range', false, 'from/to must be valid and from < to');
    const selected = source.records.filter((match) => match.timestamp >= from && match.timestamp < to
      && match.isCompetitive !== false
      && match.players.some((player) => subject.ids.includes(player.accountId))
      && (!input.gameMode || match.gameMode.toLowerCase() === input.gameMode.toLowerCase())
      && (!input.mapName || match.mapName.toLowerCase() === input.mapName.toLowerCase()));
    const ordered = [...selected].sort((left, right) => (input.sort ?? 'desc') === 'desc'
      ? right.timestamp - left.timestamp || right.matchId.localeCompare(left.matchId)
      : left.timestamp - right.timestamp || left.matchId.localeCompare(right.matchId));
    const pageSize = Math.min(Math.max(Math.trunc(input.pageSize ?? 20), 1), 50);
    const page = Math.min(Math.max(Math.trunc(input.page ?? 0), 0), 100);
    const recent = input.recentN ? ordered.slice(0, Math.min(Math.max(Math.trunc(input.recentN), 1), 100)) : ordered.slice(page * pageSize, page * pageSize + pageSize);
    const rows = recent.map((match) => {
      const players = match.players.filter((player) => subject.ids.includes(player.accountId));
      const ranks = players.map((player) => player.rank).filter((rank): rank is number => rank !== null);
      return {
        matchId: match.matchId,
        startedAt: match.createdAt,
        timestamp: match.timestamp,
        mapName: match.mapName,
        gameMode: match.gameMode,
        duration: match.duration,
        patchVersion: match.patchVersion,
        placement: ranks.length ? Math.min(...ranks) : null,
        players: players.map((player) => ({ accountId: player.accountId, name: player.playerName, kills: player.kills, assists: player.assists, damage: player.damage, dbnos: player.dbnos, rank: player.rank })),
      };
    });
    const query = {
      tool: 'pubg_search_matches',
      sessionId: input.sessionId,
      selector: { from: new Date(from).toISOString(), to: new Date(to).toISOString(), timezone: input.timezone ?? this.timezone },
      subject: subject.ids,
      filters: { gameMode: input.gameMode ?? null, mapName: input.mapName ?? null },
      order: input.sort ?? 'desc',
      page,
      pageSize,
      refresh: {
        requested: input.refresh !== false,
        forcedForRecent: input.recentN !== undefined,
        syncInvoked: source.source.syncInvoked,
        playerApiCalls: source.source.playerApiCalls,
        matchApiCalls: source.source.matchApiCalls,
        newMatchCount: source.diagnostics.newMatchCount ?? 0,
        cachedMatchCount: source.diagnostics.cachedMatchCount ?? 0,
        cacheReason: source.diagnostics.reason ?? null,
      },
    };
    const resultSetId = 'mrs_' + randomUUID();
    const resultSet: ResultSetRecord = {
      id: resultSetId,
      queryId: 'search-' + randomUUID(),
      sessionId: input.sessionId,
      resolvedQuery: queryForStats({ sessionId: input.sessionId, selector: { type: 'time_range', from: new Date(from).toISOString(), to: new Date(to).toISOString() }, metrics: ['matches'], operation: 'list', groupBy: 'match' }, subject.ids, this.timezone, this.businessDayStart),
      resolvedSelector: { type: 'time_range', start: new Date(from).toISOString(), end: new Date(to).toISOString(), timezone: this.timezone, businessDayStart: this.businessDayStart },
      playerIds: subject.ids,
      matchIds: recent.map((match) => match.matchId),
      rows: [],
      aggregates: { candidateCount: selected.length, returnedCount: rows.length, page, pageSize, order: input.sort ?? 'desc' },
      rankings: [],
      coverage: source.coverage,
      status: rows.length ? (source.coverage.status === 'OK' ? 'OK' : source.coverage.status) : source.coverage.complete ? 'NO_MATCHES' : source.coverage.status,
      source: source.source,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PUBG_RESULT_SET_TTL_MS).toISOString(),
    };
    this.repository.setResultSet(resultSet);
    const status: ToolStatus = rows.length ? (source.coverage.status === 'OK' ? 'ok' : 'partial') : source.coverage.complete ? 'no_matches' : 'error';
    const envelope: ToolEnvelope = {
      status,
      data: { matches: sanitize(rows), total: selected.length, page, pageSize, hasMore: (page + 1) * pageSize < selected.length },
      coverage: source.coverage,
      asOf: source.coverage.checkedAt ?? now.toISOString(),
      metricVersion: PUBGMETRIC_VERSION,
      queryResolved: query,
      evidenceRefs: { matchIds: recent.map((match) => match.matchId), playerIds: subject.ids, fields: ['matchId', 'startedAt', 'mapName', 'gameMode', 'placement', 'players.kills', 'players.damage'], calculation: 'deterministic_match_search' },
      resultSetId,
    };
    if (source.coverage.status === 'SOURCE_UNAVAILABLE') envelope.error = { code: 'source_unavailable', retryable: true, reason: source.source.error ?? 'PUBG API unavailable' };
    return envelope;
  }

  async getMatch(input: GetMatchInput): Promise<ToolEnvelope> {
    let match = this.repository.getMatch(input.matchId);
    let source: SourceInfo = { store: 'sqlite', syncInvoked: false, playerApiCalls: 0, matchApiCalls: 0, localMatchCount: this.repository.countMatches() };
    let coverage = coverageForLocal(this.repository.listMatches(), this.now(), this.repository.getSyncState('team:' + this.team.id));
    if (!match && input.refresh !== false && this.apiClient) {
      try {
        const fetched = await this.apiClient.getMatch(this.team.platform, input.matchId, this.team, input.signal);
        this.repository.upsertMatches([fetched], { source: 'pubg-api', fetchedAt: this.now().toISOString(), checkedPlayerIds: this.team.players.map((player) => player.id) });
        match = fetched;
        source = { store: 'pubg-api', syncInvoked: true, playerApiCalls: 0, matchApiCalls: 1, localMatchCount: this.repository.countMatches() };
        coverage = coverageForLocal(this.repository.listMatches(), this.now(), null);
      } catch (error) {
        const apiError = error instanceof PubgApiError;
        return this.errorEnvelope(apiError ? error.code : 'match_fetch_failed', apiError ? error.retryable : true, error instanceof Error ? error.message : 'match fetch failed');
      }
    }
    if (!match) return this.errorEnvelope('match_not_found', false, input.matchId);
    const row: QueryRow = {
      key: match.matchId,
      label: match.matchId,
      groupBy: 'match',
      matchId: match.matchId,
      timestamp: match.timestamp,
      createdAt: match.createdAt,
      mapName: match.mapName,
      gameMode: match.gameMode,
      duration: match.duration,
      players: match.players,
      metrics: {
        matches: 1,
        kills: match.players.reduce((sum, player) => sum + player.kills, 0),
        assists: match.players.reduce((sum, player) => sum + player.assists, 0),
        damage: match.players.reduce((sum, player) => sum + player.damage, 0),
        rank: match.players.map((player) => player.rank).filter((rank): rank is number => rank !== null).sort((a, b) => a - b)[0] ?? null,
      },
      activityStatus: 'ACTIVE',
    };
    return {
      status: 'ok',
      data: { match: sanitize({ ...match, telemetryUrl: undefined, row }) },
      coverage,
      asOf: this.now().toISOString(),
      metricVersion: PUBGMETRIC_VERSION,
      queryResolved: { tool: 'pubg_get_match', matchId: input.matchId },
      evidenceRefs: { matchIds: [match.matchId], playerIds: match.players.map((player) => player.accountId), fields: ['matchId', 'createdAt', 'mapName', 'gameMode', 'players'], calculation: 'sqlite_match_store' },
    };
  }

  async getReviewFacts(input: GetReviewFactsInput): Promise<ToolEnvelope> {
    const match = this.repository.getMatch(input.matchId);
    if (!match) {
      const result = await this.getMatch({
        sessionId: input.sessionId,
        matchId: input.matchId,
        ...(input.refresh === undefined ? {} : { refresh: input.refresh }),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      if (result.status === 'error') return result;
    }
    const target = this.repository.getMatch(input.matchId);
    if (!target) return this.errorEnvelope('match_not_found', false, input.matchId);
    const telemetry = await this.telemetryWorker.ensure(target, 1, input.signal);
    const facts = selectMatchReviewFactCategories(
      telemetry.facts ?? emptyMatchReviewFacts(target, this.team, 1),
      input.categories,
    );
    const analysis = analyzeMatchReview(facts);
    const review: MatchReviewResult = {
      schemaVersion: 1,
      match: facts.match,
      facts,
      analysis,
      telemetry: {
        status: telemetry.status,
        parserVersion: telemetry.parserVersion,
        featureVersion: telemetry.featureVersion,
        ...(telemetry.error ? { error: telemetry.error } : {}),
      },
    };
    const status: ToolStatus = telemetry.status === 'UNAVAILABLE' ? 'partial' : facts.fightIntegrity.pass ? 'ok' : 'partial';
    const result: ToolEnvelope = {
      status,
      data: { facts: sanitize(facts), telemetry: sanitize(review.telemetry), derivedAnalysis: sanitize(analysis) },
      coverage: coverageForLocal(this.repository.listMatches(), this.now(), this.repository.getSyncState('team:' + this.team.id)),
      asOf: this.now().toISOString(),
      metricVersion: PUBGMETRIC_VERSION,
      queryResolved: { tool: 'pubg_get_review_facts', matchId: input.matchId, categories: input.categories ?? null },
      evidenceRefs: { matchIds: [target.matchId], playerIds: facts.squad.playerIds, fields: ['match', 'players', 'combat', 'fights', 'weapons', 'vehicles', 'evidence'], calculation: 'telemetry_facts_v1' },
    };
    if (telemetry.status === 'UNAVAILABLE') result.error = { code: 'telemetry_unavailable', retryable: true, reason: telemetry.error ?? 'telemetry unavailable' };
    return result;
  }
}
