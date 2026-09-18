import { readFileSync } from 'node:fs';
import type { AnyAgentTool, OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import { jsonResult } from 'openclaw/plugin-sdk/core';
import { defineToolPlugin } from 'openclaw/plugin-sdk/tool-plugin';
import { Static, Type, type TSchema as TypeSchema } from 'typebox';
import { openClawConversationAdapter } from './adapters/openclaw.js';
import { IdentityStore, type IdentityResolution, type PersonSnapshot } from '@agent/identity';
import {
  PubgApiClient,
  PubgApiError,
  PubgDomainService,
  SqlitePubgRepository,
  loadTeamConfig,
  type CompareToolInput,
  type GetMatchInput,
  type GetReviewFactsInput,
  type GroupBy,
  type Metric,
  type ResolvePlayersInput,
  type SearchMatchesInput,
  type StatsToolInput,
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
const LastMatchesSelector = Type.Object({
  type: Type.Literal('last_n_matches'),
  count: Type.Integer({ minimum: 1, maximum: 100 }),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000 })),
}, { additionalProperties: false });
const ResultSetSelector = Type.Object({
  type: Type.Literal('result_set'),
  resultSetId: Type.String({ minLength: 1, maxLength: 256 }),
}, { additionalProperties: false });
const Selector = Type.Union([TimeRangeSelector, LastMatchesSelector, ResultSetSelector]);

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
  refresh: Type.Optional(Type.Boolean()),
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
  refresh: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const ResolvePlayersParameters = Type.Object({
  ...SubjectProperties,
  refresh: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const SearchMatchesParameters = Type.Object({
  ...SubjectProperties,
  from: Type.Optional(Type.String({ maxLength: 128 })),
  to: Type.Optional(Type.String({ maxLength: 128 })),
  timezone: Type.Optional(Type.String({ maxLength: 128 })),
  gameMode: Type.Optional(Type.String({ maxLength: 64 })),
  mapName: Type.Optional(Type.String({ maxLength: 128 })),
  sort: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')])),
  page: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  recentN: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
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
  categories: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: MAX_CATEGORIES })),
  refresh: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

type QueryStatsParameters = Static<typeof QueryStatsParameters>;
type CompareParameters = Static<typeof CompareParameters>;
type ResolvePlayersParameters = Static<typeof ResolvePlayersParameters>;
type SearchMatchesParameters = Static<typeof SearchMatchesParameters>;
type MatchParameters = Static<typeof MatchParameters>;
type ReviewParameters = Static<typeof ReviewParameters>;

export type IdentitySubjectInput = {
  playerIds?: string[];
  playerNames?: string[];
  personIds?: string[];
  team?: boolean;
};

const serviceCache = new Map<string, PubgDomainService>();
const identityStoreCache = new Map<string, IdentityStore>();

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
    return { playerIds: service.team.players.map((player) => player.id) };
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
        const service = serviceFor(config);
        const sessionId = contextSessionId(input as { sessionId?: string }, toolContext);
        const prepared = requiresIdentitySubject
          ? await prepareIdentitySubject(service, config, input as Static<Schema> & IdentitySubjectInput, toolContext, sessionId, signal)
          : stripIdentityFields(input as Static<Schema> & IdentitySubjectInput);
        if ('status' in prepared && prepared.status === 'error') return jsonResult(prepared);
        return jsonResult(await execute(service, prepared as Static<Schema>, sessionId, signal));
      } catch (error) {
        return jsonResult(runtimeError(error));
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
      description: 'Resolve configured PUBG players and aliases, or look up one exact official player name. This is not the chat-identity resolver: for a human nickname, call identity_resolve first and do not put the nickname in playerNames.',
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
      description: 'Search bounded PUBG matches and return concrete match IDs for follow-up details or Telemetry review. For a human nickname, call identity_resolve first and pass the resolved personId in personIds.',
      parameters: SearchMatchesParameters,
      factory: ({ config, toolContext }) => makeTool(
        'pubg_search_matches',
        'Search bounded PUBG matches and return concrete match IDs for follow-up details or Telemetry review.',
        SearchMatchesParameters,
        config,
        toolContext,
        true,
        (service, input, sessionId) => service.searchMatches({ ...(input as SearchMatchesParameters), sessionId } as SearchMatchesInput),
      ),
    }),
    tool({
      name: 'pubg_query_stats',
      description: 'Query deterministic PUBG aggregates over an explicit bounded selector. For requests such as “胶昨天战绩” or “猴昨天战绩”, call identity_resolve first, then pass the resolved personId in personIds; do not ask for a PUBG ID before that lookup.',
      parameters: QueryStatsParameters,
      factory: ({ config, toolContext }) => makeTool(
        'pubg_query_stats',
        'Query deterministic PUBG aggregates over an explicit bounded selector.',
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
      description: 'Compare two explicit PUBG time or match segments with deterministic deltas and null-safe ratios. For a human nickname, call identity_resolve first and pass the resolved personId in personIds.',
      parameters: CompareParameters,
      factory: ({ config, toolContext }) => makeTool(
        'pubg_compare_stats',
        'Compare two explicit PUBG time or match segments with deterministic deltas and null-safe ratios.',
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
      description: 'Get one concrete PUBG Match API record after a match ID has been selected. For a human nickname, call identity_resolve first and pass the resolved personId in personIds.',
      parameters: MatchParameters,
      factory: ({ config, toolContext }) => makeTool(
        'pubg_get_match',
        'Get one concrete PUBG Match API record after a match ID has been selected.',
        MatchParameters,
        config,
        toolContext,
        false,
        (service, input, sessionId, signal) => service.getMatch({ ...(input as MatchParameters), sessionId, ...(signal ? { signal } : {}) } as GetMatchInput),
      ),
    }),
    tool({
      name: 'pubg_get_review_facts',
      description: 'Get evidence-traceable deterministic Telemetry review facts for one concrete PUBG match. For a human nickname, call identity_resolve first and pass the resolved personId in personIds.',
      parameters: ReviewParameters,
      factory: ({ config, toolContext }) => makeTool(
        'pubg_get_review_facts',
        'Get evidence-traceable deterministic Telemetry review facts for one concrete PUBG match.',
        ReviewParameters,
        config,
        toolContext,
        true,
        (service, input, sessionId, signal) => service.getReviewFacts({ ...(input as ReviewParameters), sessionId, ...(signal ? { signal } : {}) } as GetReviewFactsInput),
      ),
    }),
  ],
});

export default entry;
