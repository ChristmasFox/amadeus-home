import { readFileSync } from 'node:fs';
import type { AnyAgentTool, OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import { jsonResult } from 'openclaw/plugin-sdk/core';
import { defineToolPlugin } from 'openclaw/plugin-sdk/tool-plugin';
import { Static, Type, type TSchema as TypeSchema } from 'typebox';
import { openClawConversationAdapter } from './adapters/openclaw.js';
import { registerPubgEvidenceGuard } from './evidence-guard.js';
import { IdentityStore, type IdentityResolution, type PersonSnapshot } from '@agent/identity';
import {
  adaptWorldlineNotification,
  buildPubgStatusPresentation,
  buildPubgToolPresentation,
  formatDisplayTime,
  renderPubgStatus,
  type PubgSourceRange,
} from '@agent/presentation';
import {
  PubgApiClient,
  PubgApiError,
  PubgDomainService,
  SqlitePubgRepository,
  loadTeamConfig,
  type CompareToolInput,
  type GetMatchInput,
  type GetReviewFactsInput,
  type GetPeriodReviewInput,
  type GroupBy,
  type Metric,
  type ResolvePlayersInput,
  type SearchMatchesInput,
  type StatsToolInput,
  type TeamDamageQueryInput,
  type PrefetchTelemetryInput,
  type TelemetrySyncReportInput,
  type ToolEnvelope,
  type ToolSelectorInput,
} from '@agent/pubg-domain';

const PLUGIN_ID = 'pubg';
const MAX_SUBJECT_ITEMS = 12;
const MAX_CATEGORIES = 16;

const PluginConfigSchema = Type.Object({
  databasePath: Type.Optional(Type.String({ maxLength: 1024 })),
  teamConfigFile: Type.Optional(Type.String({ maxLength: 1024 })),
  apiKeyFile: Type.Optional(Type.String({ maxLength: 1024 })),
  apiBaseUrl: Type.Optional(Type.String({ maxLength: 512 })),
  timezone: Type.Optional(Type.String({ maxLength: 128 })),
  businessDayStart: Type.Optional(Type.String({ pattern: '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' })),
  maxMatches: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
  freshnessMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 86_400_000 })),
  identityDatabasePath: Type.Optional(Type.String({ maxLength: 1024 })),
  identityPresetsFile: Type.Optional(Type.String({ maxLength: 1024 })),
}, { additionalProperties: false });

export type PluginConfig = Static<typeof PluginConfigSchema>;

const SessionId = Type.Optional(Type.String({ maxLength: 256 }));
const PlayerIds = Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: MAX_SUBJECT_ITEMS }));
const PlayerNames = Type.Optional(Type.Array(Type.String({
  minLength: 1,
  maxLength: 128,
  description: 'An explicit PUBG in-game name or configured alias only; never a channel sender/profile name, phone number, or JID.',
}), { maxItems: MAX_SUBJECT_ITEMS }));
const PersonIds = Type.Optional(Type.Array(Type.String({
  minLength: 1,
  maxLength: 128,
  description: 'Canonical Person IDs returned by identity_resolve. For a human nickname in a PUBG request, call identity_resolve first and pass its resolved personId here; never use a channel display name, phone number, or JID.',
}), { maxItems: MAX_SUBJECT_ITEMS }));
const ExplicitTeam = Type.Optional(Type.Boolean({
  description: 'Explicitly request the configured PUBG team. This is never an implicit fallback for an unbound sender.',
}));
const SubjectProperties = {
  sessionId: SessionId,
  playerIds: PlayerIds,
  playerNames: PlayerNames,
  personIds: PersonIds,
  team: ExplicitTeam,
};

const TimeRangeSelector = Type.Object({
  type: Type.Literal('time_range'),
  from: Type.String({ minLength: 1, maxLength: 128 }),
  to: Type.String({ minLength: 1, maxLength: 128 }),
  timezone: Type.Optional(Type.String({ maxLength: 128 })),
  businessDayStart: Type.Optional(Type.String({ pattern: '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' })),
}, { additionalProperties: false });
const RelativePeriodSelector = Type.Object({
  type: Type.Literal('relative_period'),
  value: Type.String({ minLength: 1, maxLength: 128, description: 'Semantic period such as today, yesterday, day_before_yesterday, or a user-specified relative period; do not calculate timestamps here.' }),
  label: Type.Optional(Type.String({ maxLength: 128 })),
}, { additionalProperties: false });
const LastMatchesSelector = Type.Object({
  type: Type.Literal('last_n_matches'),
  count: Type.Integer({ minimum: 1, maximum: 100 }),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000 })),
}, { additionalProperties: false });
const ResultSetSelector = Type.Object({
  type: Type.Literal('result_set'),
  resultSetId: Type.String({ minLength: 1, maxLength: 256 }),
}, { additionalProperties: false });
const Selector = Type.Union([TimeRangeSelector, RelativePeriodSelector, LastMatchesSelector, ResultSetSelector]);
const SearchSelector = Type.Union([TimeRangeSelector, RelativePeriodSelector]);
const TeamDamageSource = Type.Union([
  Type.Literal('MELEE'), Type.Literal('GUN'), Type.Literal('EXPLOSIVE'), Type.Literal('VEHICLE'),
]);
const TeamDamageMeleeKind = Type.Union([
  Type.Literal('KICK'), Type.Literal('PUNCH'), Type.Literal('OTHER'),
]);

const Metrics = Type.Union([
  Type.Literal('matches'), Type.Literal('kills'), Type.Literal('assists'), Type.Literal('damage'),
  Type.Literal('avg_damage'), Type.Literal('kd'), Type.Literal('deaths'), Type.Literal('wins'),
  Type.Literal('top10'), Type.Literal('rank'), Type.Literal('dbnos'), Type.Literal('revives'),
  Type.Literal('headshot_kills'), Type.Literal('survival_time'), Type.Literal('longest_kill'),
  Type.Literal('performance_score'), Type.Literal('chicken_index'),
]);
const GroupBySchema = Type.Union([
  Type.Literal('player'), Type.Literal('match'), Type.Literal('day'), Type.Literal('map'),
  Type.Literal('mode'), Type.Literal('team'),
]);
const OrderBy = Type.Object({
  metric: Metrics,
  direction: Type.Union([Type.Literal('asc'), Type.Literal('desc')]),
}, { additionalProperties: false });

const ToolOutputStatus = Type.Union([
  Type.Literal('ok'), Type.Literal('partial'), Type.Literal('no_matches'), Type.Literal('error'),
]);
const DataSourceRangeSegment = Type.Object({
  label: Type.String({ maxLength: 128 }),
  from: Type.Union([Type.String(), Type.Null()]),
  to: Type.Union([Type.String(), Type.Null()]),
  fromLocal: Type.Union([Type.String(), Type.Null()]),
  toLocal: Type.Union([Type.String(), Type.Null()]),
  timezone: Type.Union([Type.String(), Type.Null()]),
  businessDayStart: Type.Union([Type.String(), Type.Null()]),
}, { additionalProperties: false });
const DataSourceRangeSchema = Type.Object({
  from: Type.Union([Type.String(), Type.Null()]),
  to: Type.Union([Type.String(), Type.Null()]),
  fromLocal: Type.Union([Type.String(), Type.Null()]),
  toLocal: Type.Union([Type.String(), Type.Null()]),
  timezone: Type.Union([Type.String(), Type.Null()]),
  businessDayStart: Type.Union([Type.String(), Type.Null()]),
  segments: Type.Array(DataSourceRangeSegment, { maxItems: 2 }),
}, { additionalProperties: false });
const ToolOutputSchema = Type.Object({
  status: ToolOutputStatus,
  data: Type.Unknown(),
  coverage: Type.Object({
    status: Type.String(),
    complete: Type.Boolean(),
    coverageStart: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    coverageEnd: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    checkedAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    failedMatchIds: Type.Array(Type.String(), { maxItems: 1000 }),
    sourceUnavailable: Type.Boolean(),
    freshness: Type.Union([Type.Literal('fresh'), Type.Literal('stale'), Type.Literal('unknown')]),
  }, { additionalProperties: true }),
  asOf: Type.String(),
  asOfLocal: Type.String(),
  dataUpdatedAt: Type.String(),
  dataUpdatedAtLocal: Type.String(),
  displayTimezone: Type.String(),
  dataSourceRange: DataSourceRangeSchema,
  presentation: Type.Unknown(),
  displayText: Type.String({ minLength: 1 }),
  metricVersion: Type.String(),
  queryResolved: Type.Record(Type.String(), Type.Unknown()),
  evidenceRefs: Type.Object({
    matchIds: Type.Array(Type.String(), { maxItems: 1000 }),
    playerIds: Type.Array(Type.String(), { maxItems: MAX_SUBJECT_ITEMS }),
    fields: Type.Array(Type.String(), { maxItems: 128 }),
    calculation: Type.String(),
  }, { additionalProperties: true }),
  resultSetId: Type.Optional(Type.String({ maxLength: 256 })),
  error: Type.Optional(Type.Object({
    code: Type.String({ maxLength: 128 }),
    retryable: Type.Boolean(),
    reason: Type.String({ maxLength: 512 }),
  }, { additionalProperties: false })),
}, { additionalProperties: false });

const QueryStatsParameters = Type.Object({
  ...SubjectProperties,
  selector: Selector,
  metrics: Type.Array(Metrics, { minItems: 1, maxItems: 16 }),
  operation: Type.Optional(Type.Union([
    Type.Literal('report'), Type.Literal('detail'), Type.Literal('rank'), Type.Literal('strongest'),
    Type.Literal('weakest'), Type.Literal('trend'), Type.Literal('list'),
  ])),
  groupBy: Type.Optional(GroupBySchema),
  orderBy: Type.Optional(OrderBy),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  refresh: Type.Optional(Type.Boolean({ description: 'Default is true: refresh the upstream match list, then read cached Match/Telemetry facts. Set false only for an explicit cache-only request; never answer from conversation context.' })),
}, { additionalProperties: false });

const CompareParameters = Type.Object({
  ...SubjectProperties,
  segments: Type.Array(Type.Object({
    label: Type.String({ minLength: 1, maxLength: 128 }),
    selector: Selector,
  }, { additionalProperties: false }), { minItems: 2, maxItems: 2 }),
  metrics: Type.Array(Metrics, { minItems: 1, maxItems: 16 }),
  groupBy: Type.Optional(Type.Union([Type.Literal('player'), Type.Literal('day'), Type.Literal('map'), Type.Literal('mode'), Type.Literal('team')])),
  orderBy: Type.Optional(OrderBy),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  refresh: Type.Optional(Type.Boolean({ description: 'Default is true: refresh both compared segments before reading persistent cached facts; never use prior conversation text as data.' })),
}, { additionalProperties: false });

const ResolvePlayersParameters = Type.Object({
  ...SubjectProperties,
  refresh: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const SearchMatchesParameters = Type.Object({
  ...SubjectProperties,
  selector: Type.Optional(SearchSelector),
  from: Type.Optional(Type.String({ maxLength: 128 })),
  to: Type.Optional(Type.String({ maxLength: 128 })),
  timezone: Type.Optional(Type.String({ maxLength: 128 })),
  gameMode: Type.Optional(Type.String({ maxLength: 64 })),
  mapName: Type.Optional(Type.String({ maxLength: 128 })),
  sort: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')], { description: 'Period reviews should use asc for chronological play order; recentN/latest-match lookups use desc.' })),
  page: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  recentN: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: 'Use only for latest/recent-match lookups; omit for a full period review so the Domain defaults to chronological order.' })),
  refresh: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const MatchParameters = Type.Object({
  ...SubjectProperties,
  matchId: Type.String({ minLength: 1, maxLength: 256 }),
  refresh: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const ReviewParameters = Type.Object({
  ...SubjectProperties,
  matchId: Type.String({ minLength: 1, maxLength: 256 }),
  searchResultSetId: Type.String({
    minLength: 1,
    maxLength: 256,
    description: 'resultSetId returned by a fresh pubg_search_matches call in the current turn; stale or omitted search context is rejected.',
  }),
  categories: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: MAX_CATEGORIES })),
  refresh: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const PeriodReviewParameters = Type.Object({
  ...SubjectProperties,
  searchResultSetId: Type.String({
    minLength: 1,
    maxLength: 256,
    description: 'resultSetId returned by a fresh pubg_search_matches call in the current turn; stale or unrelated search context is rejected.',
  }),
  categories: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: MAX_CATEGORIES })),
}, { additionalProperties: false });

const TeamDamageParameters = Type.Object({
  sessionId: SessionId,
  selector: SearchSelector,
  actorPlayer: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 128,
    description: 'Configured PUBG player name, alias, or account ID. Provide together with victimPlayer for one direction; omit both for all directions.',
  })),
  victimPlayer: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 128,
    description: 'Configured PUBG player name, alias, or account ID. Provide together with actorPlayer for one direction; omit both for all directions.',
  })),
  source: Type.Optional(TeamDamageSource),
  meleeKind: Type.Optional(TeamDamageMeleeKind),
  refresh: Type.Optional(Type.Boolean({ description: 'Default is true: refresh match discovery and ensure Telemetry for every match in the resolved period.' })),
}, { additionalProperties: false });

const PrefetchTelemetryParameters = Type.Object({
  team: Type.Literal(true, { description: 'Scheduled/team-wide prefetch only; this is not a sender identity fallback.' }),
  maxMatches: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
  maxFetches: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  concurrency: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 })),
}, { additionalProperties: false });

const TelemetrySyncReportParameters = Type.Object({
  team: Type.Literal(true, { description: 'Scheduled/team-wide report only.' }),
  reportDate: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
}, { additionalProperties: false });

type QueryStatsParameters = Static<typeof QueryStatsParameters>;
type CompareParameters = Static<typeof CompareParameters>;
type ResolvePlayersParameters = Static<typeof ResolvePlayersParameters>;
type SearchMatchesParameters = Static<typeof SearchMatchesParameters>;
type MatchParameters = Static<typeof MatchParameters>;
type ReviewParameters = Static<typeof ReviewParameters>;
type PeriodReviewParameters = Static<typeof PeriodReviewParameters>;
type TeamDamageParameters = Static<typeof TeamDamageParameters>;
type PrefetchTelemetryParameters = Static<typeof PrefetchTelemetryParameters>;
type TelemetrySyncReportParameters = Static<typeof TelemetrySyncReportParameters>;

export type IdentitySubjectInput = {
  playerIds?: string[];
  playerNames?: string[];
  personIds?: string[];
  team?: boolean;
};

const serviceCache = new Map<string, PubgDomainService>();
const identityStoreCache = new Map<string, IdentityStore>();

async function telemetrySyncReportWithNotification(service: PubgDomainService, input: TelemetrySyncReportInput): Promise<ToolEnvelope> {
  const envelope = await service.getTelemetrySyncReport(input);
  const data = envelope.data && typeof envelope.data === 'object' ? envelope.data as Record<string, unknown> : undefined;
  const summary = data?.summary && typeof data.summary === 'object' ? data.summary as Record<string, unknown> : undefined;
  if (!summary) return envelope;
  const unavailableCount = Number(summary.unavailableCount ?? 0);
  const pendingCount = Number(summary.pendingCount ?? 0);
  const failedMatchIds = Array.isArray(summary.failedMatchIds) ? summary.failedMatchIds : [];
  const partial = unavailableCount > 0 || pendingCount > 0 || failedMatchIds.length > 0 || envelope.status === 'partial';
  const asOf = envelope.asOf;
  return {
    ...envelope,
    data: {
      ...data,
      notification: adaptWorldlineNotification({
        type: 'worldline_notification_intent',
        eventType: 'pubg_telemetry_sync',
        kind: 'telemetry_sync',
        severity: partial ? 'warning' : 'success',
        significance: partial ? 'major' : 'notable',
        eventKey: `pubg-sync:${String(summary.reportDate ?? 'unknown')}`,
        source: 'pubg-sync',
        headline: 'PUBG Telemetry 同步',
        facts: [
          { label: '日期', value: typeof summary.reportDate === 'string' ? summary.reportDate : null, evidenceRefs: [] },
          { label: '定时检查', value: Number.isFinite(Number(summary.runCount)) ? Number(summary.runCount) : null, evidenceRefs: [] },
          { label: '发现新对局', value: Number.isFinite(Number(summary.newMatchCount)) ? Number(summary.newMatchCount) : null, evidenceRefs: [] },
          { label: 'Telemetry 新拉取并写入缓存', value: Number.isFinite(Number(summary.fetchedCount)) ? Number(summary.fetchedCount) : null, evidenceRefs: [] },
          { label: 'Telemetry 命中缓存', value: Number.isFinite(Number(summary.cacheHitCount)) ? Number(summary.cacheHitCount) : null, evidenceRefs: [] },
          { label: '暂不可用', value: Number.isFinite(unavailableCount) ? unavailableCount : null, evidenceRefs: [] },
          { label: '等待后续重试', value: Number.isFinite(pendingCount) ? pendingCount : null, evidenceRefs: [] },
          { label: '异常对局', value: failedMatchIds.length, evidenceRefs: [] },
        ],
        summary: partial ? 'PUBG Telemetry 同步部分完成，未完成项将继续重试。' : 'PUBG Telemetry 同步完成。',
        dataUpdatedAt: asOf,
        occurredAt: asOf,
        worldLineClosing: true,
      }),
    },
  };
}

function configString(config: PluginConfig, key: keyof PluginConfig, envKey: string): string | undefined {
  const configured = config[key];
  return typeof configured === 'string' && configured.trim() ? configured.trim() : process.env[envKey]?.trim() || undefined;
}

function makeService(config: PluginConfig): PubgDomainService {
  const databasePath = configString(config, 'databasePath', 'PUBG_DATABASE_PATH') ?? '/data/pubg.sqlite';
  const teamConfigFile = configString(config, 'teamConfigFile', 'PUBG_TEAM_CONFIG_FILE');
  const team = loadTeamConfig({ path: teamConfigFile, required: true });
  const apiKeyFile = configString(config, 'apiKeyFile', 'PUBG_API_KEY_FILE');
  const apiKey = apiKeyFile ? readFileSync(apiKeyFile, 'utf8').trim() : process.env.PUBG_API_KEY?.trim();
  const apiBaseUrl = configString(config, 'apiBaseUrl', 'PUBG_API_BASE_URL');
  const apiClient = apiKey
    ? new PubgApiClient({ apiKey, ...(apiBaseUrl ? { baseUrl: apiBaseUrl } : {}) })
    : undefined;
  return new PubgDomainService({
    team,
    repository: new SqlitePubgRepository(databasePath),
    ...(apiClient ? { apiClient } : {}),
    ...(configString(config, 'timezone', 'PUBG_TIMEZONE') ? { timezone: configString(config, 'timezone', 'PUBG_TIMEZONE') } : {}),
    ...(configString(config, 'businessDayStart', 'PUBG_BUSINESS_DAY_START') ? { businessDayStart: configString(config, 'businessDayStart', 'PUBG_BUSINESS_DAY_START') } : {}),
    ...(config.maxMatches ? { maxMatches: config.maxMatches } : {}),
    ...(config.freshnessMs ? { freshnessMs: config.freshnessMs } : {}),
  });
}

function serviceFor(config: PluginConfig): PubgDomainService {
  const databasePath = configString(config, 'databasePath', 'PUBG_DATABASE_PATH') ?? '/data/pubg.sqlite';
  const teamConfigFile = configString(config, 'teamConfigFile', 'PUBG_TEAM_CONFIG_FILE') ?? '';
  const apiBaseUrl = configString(config, 'apiBaseUrl', 'PUBG_API_BASE_URL') ?? '';
  const key = JSON.stringify({ databasePath, teamConfigFile, apiBaseUrl });
  const current = serviceCache.get(key);
  if (current) return current;
  const service = makeService(config);
  serviceCache.set(key, service);
  return service;
}

function identityConfigString(config: PluginConfig, key: 'identityDatabasePath' | 'identityPresetsFile', envKey: string): string | undefined {
  const configured = config[key];
  return typeof configured === 'string' && configured.trim() ? configured.trim() : process.env[envKey]?.trim() || undefined;
}

function identityFor(config: PluginConfig): IdentityStore {
  const databasePath = identityConfigString(config, 'identityDatabasePath', 'IDENTITY_DATABASE_PATH') ?? '/data/identity.sqlite';
  const presetsFile = identityConfigString(config, 'identityPresetsFile', 'IDENTITY_PRESETS_FILE');
  const key = `${databasePath}\u0000${presetsFile ?? ''}`;
  const existing = identityStoreCache.get(key);
  if (existing) {
    if (presetsFile) existing.refreshPresets(presetsFile);
    return existing;
  }
  const store = new IdentityStore(databasePath, presetsFile ? { presetsFile } : {});
  identityStoreCache.set(key, store);
  return store;
}

function stripIdentityFields(input: IdentitySubjectInput): Omit<IdentitySubjectInput, 'personIds' | 'team'> {
  const { personIds: _personIds, team: _team, ...rest } = input;
  return rest;
}

function subjectError(code: string, reason: string): ToolEnvelope {
  return {
    status: 'error',
    data: {},
    coverage: {
      status: 'SOURCE_UNAVAILABLE',
      complete: false,
      coverageStart: null,
      coverageEnd: null,
      checkedAt: new Date().toISOString(),
      failedMatchIds: [],
      sourceUnavailable: false,
      freshness: 'unknown',
    },
    asOf: new Date().toISOString(),
    metricVersion: 'pubg-metrics-v1',
    queryResolved: { tool: PLUGIN_ID, identity: 'required' },
    evidenceRefs: { matchIds: [], playerIds: [], fields: [], calculation: 'identity_resolution' },
    error: { code, retryable: false, reason },
  };
}

function accountIdsForPerson(person: PersonSnapshot, service: PubgDomainService): { playerIds: string[]; playerNames: string[] } {
  const accounts = person.externalAccounts.filter((account) => account.provider.toLowerCase() === 'pubg');
  const playerIds: string[] = [];
  const playerNames: string[] = [];
  for (const account of accounts) {
    const match = service.team.players.find((player) => [player.id, player.name, ...player.aliases].some((value) => value.toLocaleLowerCase() === account.externalId.toLocaleLowerCase()));
    if (match) playerIds.push(match.id);
    else playerNames.push(account.externalId);
  }
  return { playerIds: [...new Set(playerIds)], playerNames: [...new Set(playerNames)] };
}

async function resolvePersonAccounts(
  personIds: string[],
  service: PubgDomainService,
  config: PluginConfig,
  sessionId: string,
  signal?: AbortSignal,
): Promise<{ playerIds: string[]; playerNames: string[] } | ToolEnvelope> {
  const store = identityFor(config);
  const playerIds: string[] = [];
  const unresolvedNames: string[] = [];
  for (const personId of [...new Set(personIds.map((value) => value.trim()).filter(Boolean))]) {
    const person = store.getPerson(personId);
    if (!person) return subjectError('identity_person_not_found', personId);
    const accounts = accountIdsForPerson(person, service);
    if (!accounts.playerIds.length && !accounts.playerNames.length) return subjectError('identity_pubg_account_unbound', person.displayName);
    playerIds.push(...accounts.playerIds);
    unresolvedNames.push(...accounts.playerNames);
  }
  if (unresolvedNames.length) {
    const resolved = await service.resolvePlayers({ sessionId, playerNames: [...new Set(unresolvedNames)], ...(signal ? { signal } : {}) });
    const data = resolved.data && typeof resolved.data === 'object' ? resolved.data as Record<string, unknown> : {};
    const matches = Array.isArray(data.matches) ? data.matches : [];
    const resolvedIds = matches.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const accountId = (value as Record<string, unknown>).accountId;
      return typeof accountId === 'string' && accountId.trim() ? [accountId.trim()] : [];
    });
    if (resolved.status !== 'ok' || resolvedIds.length !== unresolvedNames.length) {
      return subjectError('identity_pubg_account_unresolved', unresolvedNames.join(','));
    }
    playerIds.push(...resolvedIds);
  }
  return { playerIds: [...new Set(playerIds)], playerNames: [] };
}

export async function prepareIdentitySubject(
  service: PubgDomainService,
  config: PluginConfig,
  input: IdentitySubjectInput,
  toolContext: OpenClawPluginToolContext,
  sessionId: string,
  signal?: AbortSignal,
): Promise<IdentitySubjectInput | ToolEnvelope> {
  const explicitPlayerIds = input.playerIds?.length ?? 0;
  const explicitPlayerNames = input.playerNames?.length ?? 0;
  const explicitPersons = input.personIds?.length ?? 0;
  if (input.team === true) {
    if (explicitPlayerIds || explicitPlayerNames || explicitPersons) return subjectError('identity_subject_conflict', 'team cannot be combined with another subject');
    return { ...stripIdentityFields(input), playerIds: service.team.players.map((player) => player.id) };
  }
  if (explicitPlayerIds || explicitPlayerNames) {
    if (explicitPersons) return subjectError('identity_subject_conflict', 'personIds cannot be combined with playerIds or playerNames');
    return stripIdentityFields(input);
  }
  let personIds = input.personIds;
  if (!personIds?.length) {
    const context = openClawConversationAdapter.adapt(toolContext, sessionId).identityContext;
    const resolution: IdentityResolution = identityFor(config).resolve({ type: 'self' }, context);
    if (resolution.status !== 'resolved' || !resolution.person) {
      return subjectError('identity_sender_unbound', resolution.reason ?? 'current sender is not bound to a canonical Person');
    }
    personIds = [resolution.person.personId];
  }
  const accounts = await resolvePersonAccounts(personIds, service, config, sessionId, signal);
  if (!('playerIds' in accounts)) return accounts;
  return { ...stripIdentityFields(input), playerIds: accounts.playerIds, ...(accounts.playerNames.length ? { playerNames: accounts.playerNames } : {}) };
}

function contextSessionId(input: { sessionId?: string }, toolContext: OpenClawPluginToolContext): string {
  return openClawConversationAdapter.adapt(toolContext, input.sessionId).sessionId;
}

function runtimeError(error: unknown): ToolEnvelope {
  const apiError = error instanceof PubgApiError;
  const errorDetails = apiError
    ? { code: error.code, retryable: error.retryable, reason: error.message }
    : { code: 'plugin_runtime_error', retryable: false, reason: 'PUBG plugin configuration or execution failed' };
  return {
    status: 'error',
    data: {},
    coverage: {
      status: 'SOURCE_UNAVAILABLE',
      complete: false,
      coverageStart: null,
      coverageEnd: null,
      checkedAt: new Date().toISOString(),
      failedMatchIds: [],
      sourceUnavailable: true,
      freshness: 'unknown',
    },
    asOf: new Date().toISOString(),
    metricVersion: 'pubg-metrics-v1',
    queryResolved: { tool: PLUGIN_ID },
    evidenceRefs: { matchIds: [], playerIds: [], fields: [], calculation: 'pubg_plugin_runtime' },
    error: errorDetails,
  };
}

type DataSourceRange = {
  from: string | null;
  to: string | null;
  fromLocal: string | null;
  toLocal: string | null;
  timezone: string | null;
  businessDayStart: string | null;
  segments: Array<{
    label: string;
    from: string | null;
    to: string | null;
    fromLocal: string | null;
    toLocal: string | null;
    timezone: string | null;
    businessDayStart: string | null;
  }>;
};

type DataSourceRangeCore = Pick<DataSourceRange, 'from' | 'to' | 'timezone' | 'businessDayStart'>;
type DataSourceRangeSegmentValue = { label: string } & DataSourceRangeCore;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function formatLocalTime(value: unknown, timezone: string, now?: string, forceDate = false): string | null {
  const instant = typeof value === 'number' ? new Date(value) : typeof value === 'string' ? value : null;
  return formatDisplayTime(instant, { timezone, ...(now ? { now } : {}), forceDate });
}

const DISPLAY_TIME_KEYS = new Set([
  'asOf', 'checkedAt', 'coverageStart', 'coverageEnd', 'createdAt', 'startedAt',
  'finishedAt', 'lastRunAt', 'occurredAt', 'updatedAt', 'expiresAt', 'from', 'to',
]);

function decorateDisplayTimes(value: unknown, timezone: string, now: string): unknown {
  if (Array.isArray(value)) return value.map((item) => decorateDisplayTimes(item, timezone, now));
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = decorateDisplayTimes(item, timezone, now);
    if (DISPLAY_TIME_KEYS.has(key) && typeof item === 'string') {
      const local = formatLocalTime(item, timezone, now, key === 'from' || key === 'to');
      if (local) result[`${key}Local`] = local;
    }
  }
  return result;
}

function rangeFromValue(value: unknown): DataSourceRangeCore | null {
  if (!isRecord(value)) return null;
  const from = stringOrNull(value.from) ?? stringOrNull(value.start);
  const to = stringOrNull(value.to) ?? stringOrNull(value.end);
  if (from === null && to === null) return null;
  return {
    from,
    to,
    timezone: stringOrNull(value.timezone),
    businessDayStart: stringOrNull(value.businessDayStart),
  };
}

function earliestRangeValue(ranges: DataSourceRangeCore[], key: 'from' | 'to'): string | null {
  const values = ranges.map((range) => range[key]).filter((value): value is string => value !== null);
  if (!values.length) return null;
  const ordered = values
    .map((value) => ({ value, timestamp: Date.parse(value) }))
    .filter((item) => Number.isFinite(item.timestamp))
    .sort((left, right) => left.timestamp - right.timestamp);
  if (!ordered.length) return values[0] ?? null;
  return (key === 'from' ? ordered[0] : ordered[ordered.length - 1])?.value ?? null;
}

function dataSourceRangeFor(envelope: ToolEnvelope, fallbackTimezone = 'Asia/Shanghai'): DataSourceRange {
  const query = isRecord(envelope.queryResolved) ? envelope.queryResolved : {};
  const direct = rangeFromValue(query.sourceRange);
  const resolvedSelector = rangeFromValue(query.resolvedSelector);
  const selector = resolvedSelector ?? rangeFromValue(query.selector);
  const selectorRanges = [direct, selector].filter((range): range is DataSourceRangeCore => range !== null);
  const rawSegments = Array.isArray(query.resolvedSegments) ? query.resolvedSegments : query.segments;
  const segments: DataSourceRangeSegmentValue[] = Array.isArray(rawSegments)
    ? rawSegments.flatMap((segment): DataSourceRangeSegmentValue[] => {
      if (!isRecord(segment)) return [];
      const range = rangeFromValue(segment.selector);
      if (!range) return [];
      return [{ label: stringOrNull(segment.label) ?? 'segment', ...range }];
    })
    : [];
  const segmentRanges = segments.map(({ label: _label, ...range }) => range);
  const ranges = [...selectorRanges, ...segmentRanges];
  const fallback = {
    from: stringOrNull(envelope.coverage.coverageStart),
    to: stringOrNull(envelope.coverage.coverageEnd),
    timezone: null,
    businessDayStart: null,
  };
  const primary = direct ?? selector ?? (ranges.length ? ranges[0] : fallback);
  const timezone = primary.timezone ?? fallbackTimezone;
  const localize = (range: DataSourceRangeCore) => ({
    ...range,
    fromLocal: formatLocalTime(range.from, range.timezone ?? timezone, undefined, true),
    toLocal: formatLocalTime(range.to, range.timezone ?? timezone, undefined, true),
  });
  const localizedSegments = segments.map((segment) => ({
    ...segment,
    fromLocal: formatLocalTime(segment.from, segment.timezone ?? timezone, undefined, true),
    toLocal: formatLocalTime(segment.to, segment.timezone ?? timezone, undefined, true),
  }));
  const localizedPrimary = localize({
    from: earliestRangeValue(ranges.length ? ranges : [fallback], 'from'),
    to: earliestRangeValue(ranges.length ? ranges : [fallback], 'to'),
    timezone,
    businessDayStart: primary.businessDayStart,
  });
  return {
    ...localizedPrimary,
    segments: localizedSegments,
  };
}

function presentationRangeFor(dataSourceRange: DataSourceRange): PubgSourceRange | undefined {
  const segments = dataSourceRange.segments.map((segment) => ({ label: segment.label, from: segment.from, to: segment.to }));
  if (dataSourceRange.from === null && dataSourceRange.to === null && !segments.length) return undefined;
  return { from: dataSourceRange.from, to: dataSourceRange.to, ...(segments.length ? { segments } : {}) };
}

function jsonToolResult(name: string, envelope: ToolEnvelope, fallbackTimezone = 'Asia/Shanghai'): ReturnType<typeof jsonResult> {
  const dataSourceRange = dataSourceRangeFor(envelope, fallbackTimezone);
  const displayTimezone = dataSourceRange.timezone ?? fallbackTimezone;
  const displayEnvelope = decorateDisplayTimes(envelope, displayTimezone, envelope.asOf) as Record<string, unknown>;
  const range = presentationRangeFor(dataSourceRange);
  let presentation: ReturnType<typeof buildPubgToolPresentation>;
  try {
    presentation = buildPubgToolPresentation(name, {
      status: envelope.status,
      data: envelope.data,
      dataUpdatedAt: envelope.asOf,
      ...(range ? { sourceRange: range } : {}),
      queryResolved: envelope.queryResolved,
      evidenceRefs: envelope.evidenceRefs,
      ...(envelope.error ? { error: envelope.error } : {}),
    }, { timezone: displayTimezone, now: envelope.asOf });
  } catch (error) {
    const status = buildPubgStatusPresentation({
      toolName: name,
      status: 'error',
      data: {},
      dataUpdatedAt: envelope.asOf,
      ...(range ? { sourceRange: range } : {}),
      evidenceRefs: envelope.evidenceRefs,
      error: { code: 'presentation_invalid', reason: error instanceof Error ? error.message : String(error) },
    });
    presentation = { presentation: status, displayText: renderPubgStatus(status, { timezone: displayTimezone, now: envelope.asOf }) };
  }
  return jsonResult({
    ...displayEnvelope,
    asOfLocal: formatLocalTime(envelope.asOf, displayTimezone) ?? envelope.asOf,
    dataUpdatedAt: envelope.asOf,
    dataUpdatedAtLocal: formatLocalTime(envelope.asOf, displayTimezone) ?? envelope.asOf,
    displayTimezone,
    dataSourceRange,
    presentation: presentation.presentation,
    displayText: presentation.displayText,
  });
}

function makeTool<Schema extends TypeSchema>(
  name: string,
  description: string,
  parameters: Schema,
  config: PluginConfig,
  toolContext: OpenClawPluginToolContext,
  requiresIdentitySubject: boolean,
  execute: (service: PubgDomainService, input: Static<Schema>, sessionId: string, signal?: AbortSignal) => Promise<ToolEnvelope>,
): AnyAgentTool {
  return {
    name,
    label: name,
    description,
    parameters,
    outputSchema: ToolOutputSchema,
    async execute(_toolCallId, rawParams, signal) {
      try {
        const input = rawParams as Static<Schema>;
        const displayTimezone = configString(config, 'timezone', 'PUBG_TIMEZONE') ?? 'Asia/Shanghai';
        const service = serviceFor(config);
        const sessionId = contextSessionId(input as { sessionId?: string }, toolContext);
        const prepared = requiresIdentitySubject
          ? await prepareIdentitySubject(service, config, input as Static<Schema> & IdentitySubjectInput, toolContext, sessionId, signal)
          : stripIdentityFields(input as Static<Schema> & IdentitySubjectInput);
        if ('status' in prepared && prepared.status === 'error') return jsonToolResult(name, prepared, displayTimezone);
        return jsonToolResult(name, await execute(service, prepared as Static<Schema>, sessionId, signal), displayTimezone);
      } catch (error) {
        return jsonToolResult(name, runtimeError(error), configString(config, 'timezone', 'PUBG_TIMEZONE') ?? 'Asia/Shanghai');
      }
    },
  };
}

function selectorInput(value: unknown): ToolSelectorInput {
  return value as ToolSelectorInput;
}

const entry = defineToolPlugin({
  id: PLUGIN_ID,
  name: 'PUBG Stats',
  description: 'Deterministic PUBG match statistics and telemetry review tools.',
  configSchema: PluginConfigSchema,
  tools: (tool) => [
    tool({
      name: 'pubg_resolve_players',
      description: 'Resolve configured PUBG players and aliases, or look up one exact official player name.',
      parameters: ResolvePlayersParameters,
      factory: ({ config, toolContext }) => makeTool(
        'pubg_resolve_players',
        'Resolve configured PUBG players and aliases, or look up one exact official player name.',
        ResolvePlayersParameters,
        config,
        toolContext,
        true,
        (service, input, sessionId) => service.resolvePlayers({ ...(input as ResolvePlayersParameters), sessionId } as ResolvePlayersInput),
      ),
    }),
    tool({
      name: 'pubg_search_matches',
      description: 'Search bounded PUBG matches and return a fresh resultSetId for follow-up facts or review.',
      parameters: SearchMatchesParameters,
      factory: ({ config, toolContext }) => makeTool(
        'pubg_search_matches',
        'Search bounded PUBG matches and return a fresh resultSetId for follow-up facts or review.',
        SearchMatchesParameters,
        config,
        toolContext,
        true,
        (service, input, sessionId) => service.searchMatches({ ...(input as SearchMatchesParameters), sessionId } as SearchMatchesInput),
      ),
    }),
    tool({
      name: 'pubg_query_stats',
      description: 'Query deterministic PUBG aggregates for a bounded selector and return validated presentation/displayText.',
      parameters: QueryStatsParameters,
      factory: ({ config, toolContext }) => makeTool(
        'pubg_query_stats',
        'Query deterministic PUBG aggregates for a bounded selector and return validated presentation/displayText.',
        QueryStatsParameters,
        config,
        toolContext,
        true,
        (service, input, sessionId, signal) => service.queryStats({
          ...(input as QueryStatsParameters),
          sessionId,
          selector: selectorInput((input as QueryStatsParameters).selector),
          metrics: (input as QueryStatsParameters).metrics as Metric[],
          ...(signal ? { signal } : {}),
        } as StatsToolInput),
      ),
    }),
    tool({
      name: 'pubg_compare_stats',
      description: 'Compare two bounded PUBG segments and return independent source ranges with validated presentation/displayText.',
      parameters: CompareParameters,
      factory: ({ config, toolContext }) => makeTool(
        'pubg_compare_stats',
        'Compare two bounded PUBG segments and return independent source ranges with validated presentation/displayText.',
        CompareParameters,
        config,
        toolContext,
        true,
        (service, input, sessionId, signal) => service.compareStats({
          ...(input as CompareParameters),
          sessionId,
          segments: (input as CompareParameters).segments.map((segment) => ({ ...segment, selector: selectorInput(segment.selector) })),
          metrics: (input as CompareParameters).metrics as Metric[],
          ...(signal ? { signal } : {}),
        } as CompareToolInput),
      ),
    }),
    tool({
      name: 'pubg_get_match',
      description: 'Get one selected PUBG Match API record and return validated presentation/displayText.',
      parameters: MatchParameters,
      factory: ({ config, toolContext }) => makeTool(
        'pubg_get_match',
        'Get one selected PUBG Match API record and return validated presentation/displayText.',
        MatchParameters,
        config,
        toolContext,
        false,
        (service, input, sessionId, signal) => service.getMatch({ ...(input as MatchParameters), sessionId, ...(signal ? { signal } : {}) } as GetMatchInput),
      ),
    }),
    tool({
      name: 'pubg_get_review_facts',
      description: 'Get deterministic Telemetry facts for one selected match from a fresh search resultSetId; return validated presentation/displayText.',
      parameters: ReviewParameters,
      factory: ({ config, toolContext }) => makeTool(
        'pubg_get_review_facts',
        'Get deterministic Telemetry facts for one selected match from a fresh search resultSetId.',
        ReviewParameters,
        config,
        toolContext,
        true,
        (service, input, sessionId, signal) => service.getReviewFacts({ ...(input as ReviewParameters), sessionId, ...(signal ? { signal } : {}) } as GetReviewFactsInput),
      ),
    }),
    tool({
      name: 'pubg_get_period_review',
      description: 'Build a bounded multi-match review from a fresh search resultSetId; Domain owns order, freshness, and partial coverage.',
      parameters: PeriodReviewParameters,
      factory: ({ config, toolContext }) => makeTool(
        'pubg_get_period_review',
        'Build a bounded multi-match review from a fresh search resultSetId.',
        PeriodReviewParameters,
        config,
        toolContext,
        true,
        (service, input, sessionId, signal) => service.getPeriodReview({ ...(input as PeriodReviewParameters), sessionId, ...(signal ? { signal } : {}) } as GetPeriodReviewInput),
      ),
    }),
    tool({
      name: 'pubg_query_team_damage',
      description: 'Query bounded directional team-damage facts; provide actor/victim together or omit both.',
      parameters: TeamDamageParameters,
      factory: ({ config, toolContext }) => makeTool(
        'pubg_query_team_damage',
        'Query bounded directional team-damage facts; provide actor/victim together or omit both.',
        TeamDamageParameters,
        config,
        toolContext,
        false,
        (service, input, sessionId, signal) => service.queryTeamDamage({ ...(input as TeamDamageParameters), sessionId, ...(signal ? { signal } : {}) } as TeamDamageQueryInput),
      ),
    }),
    tool({
      name: 'pubg_prefetch_telemetry',
      description: 'Run scheduled/team-wide Telemetry prefetch with bounded concurrency; use team=true.',
      parameters: PrefetchTelemetryParameters,
      factory: ({ config, toolContext }) => makeTool(
        'pubg_prefetch_telemetry',
        'Run scheduled/team-wide Telemetry prefetch with bounded concurrency; use team=true.',
        PrefetchTelemetryParameters,
        config,
        toolContext,
        false,
        (service, input) => service.prefetchTelemetry({
          ...(input as PrefetchTelemetryParameters),
          trigger: 'hourly',
        } as PrefetchTelemetryInput),
      ),
    }),
    tool({
      name: 'pubg_telemetry_sync_report',
      description: 'Build the scheduled previous-day Telemetry sync report and structured owner-notification payload; use team=true.',
      parameters: TelemetrySyncReportParameters,
      factory: ({ config, toolContext }) => makeTool(
        'pubg_telemetry_sync_report',
        'Build the scheduled previous-day Telemetry sync report and structured owner-notification payload; use team=true.',
        TelemetrySyncReportParameters,
        config,
        toolContext,
        false,
        (service, input) => telemetrySyncReportWithNotification(service, input as TelemetrySyncReportInput),
      ),
    }),
  ],
});

const registerTools = entry.register;
entry.register = (api) => {
  registerTools(api);
  registerPubgEvidenceGuard(api);
};

export default entry;
