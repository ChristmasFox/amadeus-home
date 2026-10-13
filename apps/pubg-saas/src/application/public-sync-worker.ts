import {
  createTeamContext,
  PubgApiClient,
  PubgApiTelemetryDownloader,
  PubgDomainService,
  TelemetryWorker,
  type TeamConfig,
  type TeamContext,
  type TelemetryDownloader,
} from '@agent/pubg-domain/core';
import type { Pool, QueryResultRow } from 'pg';
import type { PublicPubgAdmission } from '../infrastructure/pubg/request-limiter.js';
import { PostgresPubgRepository } from '../infrastructure/postgres/pubg-repository.js';
import { validatePublicPubgShard } from '../infrastructure/pubg/player-resolver.js';

const API_ORIGIN = 'https://api.pubg.com';
const TELEMETRY_HOSTS = new Set(['telemetry-cdn.pubg.com', 'telemetry-cdn.playbattlegrounds.com']);
const MAX_API_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_TELEMETRY_RESPONSE_BYTES = 96 * 1024 * 1024;
const DEFAULT_MAX_MATCHES = 500;
const DEFAULT_MAX_TELEMETRY_FETCHES = 20;
const DEFAULT_TELEMETRY_CONCURRENCY = 2;
const ACCOUNT_ID = /^account\.[A-Za-z0-9_-]{1,128}$/u;
const MATCH_ID = /^[A-Za-z0-9_.-]{1,128}$/u;

export interface PublicSyncCycleResult {
  teamsDiscovered: number;
  teamsAttempted: number;
  teamsCompleted: number;
  teamsFailed: number;
  matchesDiscovered: number;
  telemetryFetched: number;
  telemetryUnavailable: number;
}

export interface PublicSyncWorkerOptions {
  apiKey: string;
  admission: PublicPubgAdmission;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  maxMatches?: number;
  maxTelemetryFetches?: number;
  telemetryConcurrency?: number;
  onTeamError?: (code: 'public_sync_team_invalid' | 'public_sync_team_failed') => void;
}

interface TeamRow extends QueryResultRow {
  tenant_id: string;
  team_id: string;
  label: string;
  pubg_shard: string;
  pubg_account_id: string | null;
  official_name: string | null;
  display_alias: string | null;
}

interface TeamBuilder {
  tenantId: string;
  id: string;
  label: string;
  shard: string;
  players: Map<string, { id: string; name: string; aliases: string[] }>;
}

function boundedInteger(value: number, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error('public_sync_config_invalid');
  return value || fallback;
}

function boundedResponse(response: Response, maxBytes: number): Response {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error('public_sync_response_too_large');
  }
  if (!response.body || response.status === 204 || response.status === 304) return response;
  let size = 0;
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > maxBytes) {
        controller.error(new Error('public_sync_response_too_large'));
        return;
      }
      controller.enqueue(chunk);
    },
  }));
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.delete('transfer-encoding');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

function endpoint(url: URL): { kind: 'api' | 'telemetry'; rateLimited: boolean; maxBytes: number } {
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) throw new Error('public_sync_endpoint_invalid');
  if (url.origin === API_ORIGIN) {
    const isPlayers = /^\/shards\/(steam|kakao|psn|xbox)\/players$/u.test(url.pathname);
    const isMatch = /^\/shards\/(steam|kakao|psn|xbox)\/matches\/[A-Za-z0-9_.-]{1,128}$/u.test(url.pathname);
    if (isPlayers) {
      const ids = url.searchParams.getAll('filter[playerIds]');
      if (url.searchParams.size !== 1 || ids.length !== 1 || ids[0]!.split(',').length > 4
        || ids[0]!.split(',').some((id) => !ACCOUNT_ID.test(id))) throw new Error('public_sync_endpoint_invalid');
    } else if (!isMatch || url.search !== '') {
      throw new Error('public_sync_endpoint_invalid');
    }
    return { kind: 'api', rateLimited: isPlayers, maxBytes: MAX_API_RESPONSE_BYTES };
  }
  if (TELEMETRY_HOSTS.has(url.hostname) && url.search === ''
    && /^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]*-telemetry\.json$/u.test(url.pathname)) {
    return { kind: 'telemetry', rateLimited: false, maxBytes: MAX_TELEMETRY_RESPONSE_BYTES };
  }
  throw new Error('public_sync_endpoint_invalid');
}

/** Restricts the worker to official public PUBG API and telemetry endpoints.
 * Only API calls consume the shared API admission; telemetry assets are public
 * CDN objects and never receive the API key. Redirects are rejected. */
export function createPublicSyncFetch(
  admission: PublicPubgAdmission,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    const target = endpoint(url);
    if ((init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase() !== 'GET') throw new Error('public_sync_method_invalid');
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (target.kind === 'telemetry' && headers.has('authorization')) throw new Error('public_sync_telemetry_auth_forbidden');
    if (target.kind === 'api' && !/^Bearer\s+\S+$/iu.test(headers.get('authorization') ?? '')) throw new Error('public_sync_api_auth_missing');
    if (target.rateLimited) await admission.acquire(init?.signal ?? (input instanceof Request ? input.signal : undefined));
    const response = await fetchImpl(url, { ...init, headers, redirect: 'error' });
    if (target.rateLimited) await admission.observe(response.headers, response.status);
    return boundedResponse(response, target.maxBytes);
  };
}

async function registeredTeams(pool: Pool): Promise<{ teams: TeamContext[]; invalid: number }> {
  const result = await pool.query<TeamRow>(
    `SELECT team.tenant_id,team.team_id,team.label,team.pubg_shard,member.pubg_account_id,
       COALESCE(account.display_name,member.pubg_account_id) AS official_name,alias.display_alias
     FROM teams team
     LEFT JOIN team_members member ON member.tenant_id=team.tenant_id AND member.team_id=team.team_id
     LEFT JOIN pubg_accounts account ON account.shard=team.pubg_shard AND account.account_id=member.pubg_account_id
     LEFT JOIN team_aliases alias ON alias.tenant_id=member.tenant_id AND alias.team_id=member.team_id
       AND alias.pubg_account_id=member.pubg_account_id
     ORDER BY team.tenant_id,team.team_id,member.pubg_account_id,alias.alias_key`,
  );
  const builders = new Map<string, TeamBuilder>();
  for (const row of result.rows) {
    const key = JSON.stringify([row.tenant_id, row.team_id]);
    let builder = builders.get(key);
    if (!builder) {
      builder = {
        tenantId: row.tenant_id,
        id: row.team_id,
        label: row.label,
        shard: row.pubg_shard,
        players: new Map(),
      };
      builders.set(key, builder);
    }
    if (!row.pubg_account_id) continue;
    let player = builder.players.get(row.pubg_account_id);
    if (!player) {
      player = { id: row.pubg_account_id, name: row.official_name?.trim() || row.pubg_account_id, aliases: [] };
      builder.players.set(row.pubg_account_id, player);
    }
    if (row.display_alias?.trim() && !player.aliases.includes(row.display_alias.trim())) player.aliases.push(row.display_alias.trim());
  }
  const teams: TeamContext[] = [];
  let invalid = 0;
  for (const builder of builders.values()) {
    try {
      validatePublicPubgShard(builder.shard);
      const team: TeamConfig = {
        id: builder.id,
        label: builder.label,
        platform: builder.shard,
        players: [...builder.players.values()],
      };
      if (team.players.length < 1 || team.players.length > 4
        || team.players.some((player) => !ACCOUNT_ID.test(player.id) || player.name.length > 100
          || player.aliases.some((alias) => alias.length > 100 || /[\u0000-\u001f]/u.test(alias)))) {
        throw new Error('public_sync_roster_invalid');
      }
      teams.push(createTeamContext(builder.tenantId, team));
    } catch {
      invalid += 1;
    }
  }
  return { teams, invalid };
}

function numberFrom(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? Math.trunc(result) : 0;
}

function telemetryRun(value: unknown): { discovered: number; fetched: number; unavailable: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { discovered: 0, fetched: 0, unavailable: 0 };
  const data = value as Record<string, unknown>;
  const run = data.run && typeof data.run === 'object' && !Array.isArray(data.run)
    ? data.run as Record<string, unknown>
    : {};
  return {
    discovered: numberFrom(run.discoveredMatchCount),
    fetched: numberFrom(run.fetchedCount),
    unavailable: numberFrom(run.unavailableCount),
  };
}

/** Independent public-SaaS ingestion process. It loads only registered SaaS
 * rosters, syncs them through the shared PUBG Domain and writes to PG through
 * the tenant/team scoped repository. */
export class PublicSyncWorker {
  private readonly client: PubgApiClient;
  private readonly telemetryDownloader: TelemetryDownloader;
  private readonly now: () => Date;
  private readonly maxMatches: number;
  private readonly maxTelemetryFetches: number;
  private readonly telemetryConcurrency: number;

  constructor(private readonly pool: Pool, options: PublicSyncWorkerOptions) {
    if (!options.apiKey.trim()) throw new Error('public_pubg_api_key_missing');
    this.maxMatches = boundedInteger(options.maxMatches ?? DEFAULT_MAX_MATCHES, DEFAULT_MAX_MATCHES, 1, 1000);
    this.maxTelemetryFetches = boundedInteger(options.maxTelemetryFetches ?? DEFAULT_MAX_TELEMETRY_FETCHES, DEFAULT_MAX_TELEMETRY_FETCHES, 1, 50);
    this.telemetryConcurrency = boundedInteger(options.telemetryConcurrency ?? DEFAULT_TELEMETRY_CONCURRENCY, DEFAULT_TELEMETRY_CONCURRENCY, 1, 4);
    this.now = options.now ?? (() => new Date());
    const fetchImpl = createPublicSyncFetch(options.admission, options.fetchImpl);
    this.client = new PubgApiClient({ apiKey: options.apiKey, baseUrl: API_ORIGIN, maxRetries: 0, concurrency: 2, timeoutMs: 15_000, fetchImpl });
    this.telemetryDownloader = new PubgApiTelemetryDownloader({
      apiKey: options.apiKey,
      baseUrl: API_ORIGIN,
      timeoutMs: 60_000,
      fetchImpl,
    });
    this.onTeamError = options.onTeamError ?? (() => undefined);
  }

  private readonly onTeamError: (code: 'public_sync_team_invalid' | 'public_sync_team_failed') => void;

  async runOnce(signal?: AbortSignal): Promise<PublicSyncCycleResult> {
    const { teams, invalid } = await registeredTeams(this.pool);
    const summary: PublicSyncCycleResult = {
      teamsDiscovered: teams.length + invalid,
      teamsAttempted: 0,
      teamsCompleted: 0,
      teamsFailed: invalid,
      matchesDiscovered: 0,
      telemetryFetched: 0,
      telemetryUnavailable: 0,
    };
    for (let index = 0; index < invalid; index += 1) this.onTeamError('public_sync_team_invalid');
    for (const teamContext of teams) {
      if (signal?.aborted) break;
      summary.teamsAttempted += 1;
      try {
        const repository = new PostgresPubgRepository(this.pool, teamContext);
        const telemetryWorker = new TelemetryWorker({
          team: teamContext.team,
          store: repository,
          downloader: this.telemetryDownloader,
        });
        const service = new PubgDomainService({
          teamContext,
          repository,
          apiClient: this.client,
          telemetryWorker,
          maxMatches: this.maxMatches,
          now: this.now,
        });
        const result = await service.prefetchTelemetry({
          maxMatches: this.maxMatches,
          maxFetches: this.maxTelemetryFetches,
          concurrency: this.telemetryConcurrency,
          trigger: 'hourly',
          ...(signal ? { signal } : {}),
        });
        const telemetry = telemetryRun(result.data);
        summary.teamsCompleted += 1;
        summary.matchesDiscovered += telemetry.discovered;
        summary.telemetryFetched += telemetry.fetched;
        summary.telemetryUnavailable += telemetry.unavailable;
      } catch {
        summary.teamsFailed += 1;
        this.onTeamError('public_sync_team_failed');
      }
    }
    return summary;
  }
}
