import { CanonicalQuerySchema, type CanonicalQuery } from '../schema/query.js';
import type { RuntimeResponse } from '../runtime/types.js';
import type { PubgMastraRuntime } from '../runtime/workflow.js';
import type { HomeHubRuntime } from '../runtime/homehub-runtime.js';
import type { MediaOperations } from '../homehub/operations/media-operations.js';
import {
  entityResolveInputSchema,
  homehubServicesInputSchema,
  pubgListInputSchema,
  pubgQueryInputSchema,
  pubgReviewInputSchema,
  radarWatchInputSchema,
  type DomainBackends,
} from './domain-tools.js';
import type { ToolResponse, TrustedExecutionContext } from './contracts.js';
import { KurisuStore } from './storage.js';
import { evidence, failure, ok, unknownResult } from './tools.js';

type PubgQueryInput = ReturnType<typeof pubgQueryInputSchema.parse>;
type PubgListInput = ReturnType<typeof pubgListInputSchema.parse>;
type PubgReviewInput = ReturnType<typeof pubgReviewInputSchema.parse>;
type RadarWatchInput = ReturnType<typeof radarWatchInputSchema.parse>;
type EntityResolveInput = ReturnType<typeof entityResolveInputSchema.parse>;

export interface RadarReadOnlyClientOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ReadOnlyBackendOptions {
  pubgRuntime?: PubgMastraRuntime;
  homehubRuntime?: HomeHubRuntime;
  radar?: RadarReadOnlyClientOptions;
  mediaOperations?: MediaOperations;
}

/** Expose persisted notification facts without turning diagnosis into sending. */
export function createNotificationBackend(store: KurisuStore): NonNullable<DomainBackends['notifications']> {
  return {
    diagnosis: async (input, context) => ok({
      eventType: input.eventType ?? null,
      channel: input.channel,
      events: store.listNotificationEvents(input.eventType, input.channel, context.principalKey, input.limit),
    }, [evidence('kurisu.notifications', 'principal-scoped event and delivery records observed')]),
  };
}

/** Build server-owned read adapters. No adapter accepts natural-language text. */
export function createReadOnlyBackends(options: ReadOnlyBackendOptions = {}): DomainBackends {
  return {
    ...(options.pubgRuntime ? { pubg: pubgBackends(options.pubgRuntime) } : {}),
    ...(options.homehubRuntime ? { homehub: homehubBackends(options.homehubRuntime) } : {}),
    ...(options.radar?.baseUrl ? { radar: radarBackends(options.radar) } : {}),
    ...(options.mediaOperations ? { media: mediaBackends(options.mediaOperations) } : {}),
    entities: {
      resolve: async (input) => resolveEntity(input),
    },
  };
}

function mediaBackends(operations: MediaOperations): NonNullable<DomainBackends['media']> {
  return {
    scan: async (input) => {
      try {
        const items = await operations.scanDownloads(input.targetPattern);
        return ok({ items, count: items.length }, [evidence('media.organizer', 'allowlisted download scan returned structured items')]);
      } catch (error) {
        return unknownResult('MEDIA_SCAN_UNAVAILABLE', error instanceof Error ? error.message : 'media scan failed', true);
      }
    },
    preview: async (input) => {
      try {
        const items = await operations.scanDownloads(input.sourcePath);
        if (items.length !== 1) return failure('MEDIA_SOURCE_AMBIGUOUS', 'sourcePath must identify exactly one supported media folder', false);
        const item = items[0]!;
        const plan = await operations.createOperationPlan(item);
        const preview = await operations.previewPlan(plan);
        if (!preview.success) return failure('MEDIA_PREVIEW_BLOCKED', preview.message, false);
        return ok({ item, plan, preview }, [evidence('media.organizer', 'allowlist and no-overwrite preview completed')]);
      } catch (error) {
        return failure('MEDIA_PREVIEW_INVALID', error instanceof Error ? error.message : 'media preview failed', false);
      }
    },
  };
}

function pubgBackends(runtime: PubgMastraRuntime): NonNullable<DomainBackends['pubg']> {
  return {
    query: async (input, context) => runPubg(runtime, canonicalQueryFor(input, context), context),
    list: async (input, context) => runPubg(runtime, canonicalQueryForList(input, context), context),
    review: async (input, context) => runPubg(runtime, canonicalQueryForReview(input, context), context),
  };
}

function homehubBackends(runtime: HomeHubRuntime): NonNullable<DomainBackends['homehub']> {
  return {
    list: async (input) => ok({ services: runtime.listServices(), requested: input.serviceIds }, [evidence('homehub.registry', 'server-side service registry returned structured definitions')]),
    status: async (input) => {
      const health = await runtime.status();
      return ok({
        ...health,
        services: filterByServiceIds(health.services, input.serviceIds),
      }, [evidence('homehub.diagnostic', 'deterministic health result observed')]);
    },
    diagnose: async (input) => ok({ diagnoses: await runtime.diagnoseServices(input.serviceIds) }, [evidence('homehub.diagnostic', 'deterministic diagnostics observed')]),
    errors: async (_input, context) => {
      // Audit records are scoped to the server-resolved principal. They are
      // evidence, not a health claim; a missing record is not an empty error
      // response from an unavailable source.
      const records = await runtime.getAuditLogs(context.principalKey, 20);
      return ok({ principalKey: context.principalKey, records }, [evidence('homehub.audit', 'principal-scoped audit records observed')]);
    },
  };
}

function radarBackends(options: RadarReadOnlyClientOptions): NonNullable<DomainBackends['radar']> {
  const read = (path: string) => radarGet(options, path);
  return {
    list: async () => read('/api/watches'),
    status: async (input) => readWatch(options, input, 'status'),
    stats: async (input) => readWatch(options, input, 'stats'),
  };
}

async function readWatch(options: RadarReadOnlyClientOptions, input: RadarWatchInput, action: 'status' | 'stats'): Promise<ToolResponse> {
  if (!input.watchId) return failure('WATCH_ID_REQUIRED', `${action} requires an explicit watchId`, false);
  return radarGet(options, `/api/watches/${encodeURIComponent(input.watchId)}/${action}`);
}

async function radarGet(options: RadarReadOnlyClientOptions, path: string): Promise<ToolResponse> {
  const baseUrl = options.baseUrl.trim().replace(/\/$/u, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(Math.max(options.timeoutMs ?? 15_000, 1_000), 60_000));
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.apiKey) headers['x-product-radar-key'] = options.apiKey;
    const response = await fetchImpl(`${baseUrl}${path}`, { method: 'GET', headers, signal: controller.signal });
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > 512 * 1024) return unknownResult('RADAR_RESPONSE_TOO_LARGE', 'Product Radar response exceeded the bounded read limit', false);
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      return unknownResult('RADAR_INVALID_JSON', 'Product Radar returned invalid JSON', true);
    }
    if (!response.ok) {
      return unknownResult(`RADAR_HTTP_${response.status}`, `Product Radar returned HTTP ${response.status}`, response.status >= 500 || response.status === 429);
    }
    return ok(body, [evidence('product-radar.api', `GET ${path} returned structured data`)]);
  } catch (error) {
    const errorName = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name) : '';
    const code = errorName === 'AbortError' ? 'RADAR_TIMEOUT' : 'RADAR_UNAVAILABLE';
    return unknownResult(code, error instanceof Error ? error.message : 'Product Radar request failed', true);
  } finally {
    clearTimeout(timer);
  }
}

async function runPubg(runtime: PubgMastraRuntime, query: CanonicalQuery, context: TrustedExecutionContext): Promise<ToolResponse> {
  let result: RuntimeResponse;
  try {
    result = await runtime.handle({
      text: '',
      structuredOnly: true,
      platform: runtimePlatform(context.identity.platform),
      launcherType: context.conversation.kind,
      launcherId: context.conversation.chatId,
      senderId: context.identity.platformUserId,
      botId: context.botId,
      messageId: context.requestId,
      queryId: context.requestId,
      now: context.now,
      providedQuery: query,
    });
  } catch (error) {
    return unknownResult('PUBG_RUNTIME_UNAVAILABLE', error instanceof Error ? error.message : 'PUBG runtime failed', true);
  }
  if (result.coverage?.sourceUnavailable || result.status === 'SOURCE_UNAVAILABLE') {
    return unknownResult('PUBG_SOURCE_UNAVAILABLE', 'PUBG source data is unavailable; no empty result was inferred', true);
  }
  if (result.status === 'INVALID_QUERY' || result.status === 'UNSUPPORTED_CAPABILITY') {
    return failure(`PUBG_${result.status}`, result.response.slice(0, 500), false);
  }
  return ok({
    response: result.response,
    query: result.query,
    resolvedQuery: result.resolvedQuery,
    status: result.status,
    data: result.data,
    coverage: result.coverage,
    source: result.source,
    resultSetId: result.resultSetId,
  }, [evidence('pubg.mastra-runtime', 'existing deterministic PUBG runtime returned a structured result')]);
}

function canonicalQueryFor(input: PubgQueryInput, context: TrustedExecutionContext): CanonicalQuery {
  const operation = input.operation === 'per_player' ? 'detail' : input.operation;
  const subject = subjectFor(input.subject);
  const metrics = metricsFor(input.metrics);
  const matchId = input.matchId ?? (input.subject.type === 'match' ? input.subject.ids[0] : undefined);
  return CanonicalQuerySchema.parse({
    version: 3,
    queryId: context.requestId,
    domain: 'pubg',
    subject,
    operation,
    selector: selectorFor(input.timeRange),
    matchSelector: matchId ? { type: 'match_id', matchId } : null,
    segments: [],
    groupBy: operation === 'trend' ? 'day' : 'player',
    metrics,
    filters: {},
    orderBy: { metric: orderMetric(metrics), direction: 'desc' },
    limit: null,
    reference: { selectorExplicit: input.timeRange !== undefined, subjectExplicit: input.subject.ids.length > 0, useResultSet: false, inheritedFromContext: false, planner: 'provided' },
    presentation: { compact: false },
  });
}

function canonicalQueryForList(input: PubgListInput, context: TrustedExecutionContext): CanonicalQuery {
  const subject = input.subject ? subjectFor(input.subject) : { type: 'team' as const, ids: ['default_team'] };
  const matchId = input.subject?.type === 'match' ? input.subject.ids[0] : undefined;
  return CanonicalQuerySchema.parse({
    version: 3,
    queryId: context.requestId,
    domain: 'pubg',
    subject,
    operation: 'list',
    selector: selectorFor(input.timeRange),
    matchSelector: matchId ? { type: 'match_id', matchId } : null,
    segments: [],
    groupBy: 'match',
    metrics: ['matches', 'rank', 'kills', 'damage'],
    filters: {},
    orderBy: { metric: 'rank', direction: 'asc' },
    limit: input.limit,
    reference: { selectorExplicit: input.timeRange !== undefined, subjectExplicit: Boolean(input.subject?.ids.length), useResultSet: false, inheritedFromContext: false, planner: 'provided' },
    presentation: { compact: true },
  });
}

function canonicalQueryForReview(input: PubgReviewInput, context: TrustedExecutionContext): CanonicalQuery {
  return CanonicalQuerySchema.parse({
    version: 3,
    queryId: context.requestId,
    domain: 'pubg',
    subject: { type: 'team', ids: ['default_team'] },
    operation: 'review_match',
    selector: { type: 'relative_period', value: 'today', label: '指定对局' },
    matchSelector: { type: 'match_id', matchId: input.matchId },
    segments: [],
    groupBy: 'match',
    metrics: ['matches', 'kills', 'assists', 'damage', 'rank', 'dbnos', 'revives', 'survival_time'],
    filters: {},
    orderBy: { metric: 'damage', direction: 'desc' },
    limit: 1,
    reference: { selectorExplicit: true, subjectExplicit: false, useResultSet: false, inheritedFromContext: false, planner: 'provided' },
    presentation: { compact: input.detail === 'summary', profile: 'default' },
  });
}

function subjectFor(subject: { type: 'team' | 'player' | 'match'; ids: string[] }): CanonicalQuery['subject'] {
  return {
    type: subject.type === 'player' ? 'player' : 'team',
    ids: subject.type === 'match' || !subject.ids.length ? ['default_team'] : subject.ids,
  };
}

function metricsFor(metrics: PubgQueryInput['metrics']): CanonicalQuery['metrics'] {
  const all: CanonicalQuery['metrics'] = ['matches', 'kills', 'assists', 'damage', 'avg_damage', 'kd', 'deaths', 'wins', 'top10', 'rank', 'dbnos', 'revives', 'headshot_kills', 'survival_time', 'longest_kill', 'performance_score', 'chicken_index'];
  const mapped = metrics.map((metric) => metric === 'survival_time' ? 'survival_time' : metric) as CanonicalQuery['metrics'];
  return mapped.length ? mapped : all;
}

function orderMetric(metrics: CanonicalQuery['metrics']): CanonicalQuery['metrics'][number] {
  return metrics.includes('kd') ? 'kd' : metrics[0] ?? 'matches';
}

function selectorFor(timeRange: PubgQueryInput['timeRange'] | PubgListInput['timeRange']): CanonicalQuery['selector'] {
  if (!timeRange || timeRange.kind === 'today' || timeRange.kind === 'yesterday') {
    return { type: 'relative_period', value: timeRange?.kind ?? 'today', label: timeRange?.kind ?? '今天' };
  }
  if (timeRange.kind === 'recent') {
    const count = Number(timeRange.start ?? '');
    if (!Number.isInteger(count) || count < 1 || count > 366) throw new Error('recent timeRange requires a count in start');
    return { type: 'recent_days', count, label: `最近${count}天` };
  }
  if (!timeRange.start) throw new Error('date/range timeRange requires start');
  return {
    type: 'time_range',
    start: timeRange.start,
    end: timeRange.end ?? timeRange.start,
    timezone: timeRange.timezone,
    businessDayStart: '06:00',
    label: timeRange.kind === 'date' ? timeRange.start : `${timeRange.start} 至 ${timeRange.end ?? timeRange.start}`,
  };
}

function runtimePlatform(platform: TrustedExecutionContext['identity']['platform']): 'kook' | 'telegram' | 'whatsapp' {
  return platform === 'telegram' || platform === 'whatsapp' ? platform : 'kook';
}

function filterByServiceIds<T extends { serviceId: string }>(services: T[], ids: readonly string[]): T[] {
  return ids.length ? services.filter((service) => ids.includes(service.serviceId)) : services;
}

async function resolveEntity(input: EntityResolveInput): Promise<ToolResponse> {
  if (input.candidateRefs.length === 1) {
    return ok({ domain: input.domain, reference: input.reference, resolved: input.candidateRefs[0], candidates: input.candidateRefs }, [evidence('kurisu.entity', 'one explicit candidate was supplied')], [input.candidateRefs[0]!]);
  }
  if (input.candidateRefs.length === 0) {
    return {
      contractVersion: 'kurisu.v1',
      status: 'needs_input',
      data: { domain: input.domain, reference: input.reference, candidates: [] },
      evidence: [evidence('kurisu.entity', 'no candidate was supplied; clarification is required')],
      entityRefs: [],
    };
  }
  return {
    contractVersion: 'kurisu.v1',
    status: 'needs_input',
    data: { domain: input.domain, reference: input.reference, candidates: input.candidateRefs },
    evidence: [evidence('kurisu.entity', 'multiple candidates remain; no first-match selection was made')],
    entityRefs: [],
  };
}
