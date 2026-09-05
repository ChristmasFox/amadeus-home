import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { TeamConfig } from '../config/team.js';
import type { NormalizedMatch } from '../data/model.js';
import { extractMatchReviewFacts } from './review-facts.js';
import type { MatchReviewFacts, ReviewEvidence } from './types.js';

export const DEFAULT_TELEMETRY_PARSER_VERSION = 'telemetry-parser-4';
export const DEFAULT_REVIEW_FEATURE_VERSION = 'review-features-4';

export interface TelemetryFeatureKey {
  matchId: string;
  parserVersion: string;
  featureVersion: string;
}

export interface TelemetryFeatureRecord extends TelemetryFeatureKey {
  facts: MatchReviewFacts;
  createdAt: string;
}

function compactEvidence(facts: MatchReviewFacts): ReviewEvidence[] {
  const original = new Map(facts.evidence.map((item) => [item.id, item]));
  const retained: ReviewEvidence[] = [];
  const retainedIds = new Set<string>();
  const add = (id: string, kind: ReviewEvidence['kind'], source: ReviewEvidence['source'], eventIds: string[], description: string): void => {
    if (retainedIds.has(id)) return;
    retainedIds.add(id);
    retained.push(original.get(id) ?? {
      id,
      kind,
      source,
      eventIds: [...new Set(eventIds)],
      description,
    });
  };

  add(`match-summary-${facts.match.matchId}`, 'FACT', 'match_store', [], 'Match Store 基础战绩');
  facts.weapons.forEach((weapon, index) => add(
    `evidence-weapon-${index + 1}`,
    'DERIVED',
    'telemetry',
    weapon.evidenceIds,
    `${weapon.playerId} 使用 ${weapon.weapon} 的武器统计`,
  ));
  facts.vehicles.forEach((vehicle, index) => add(
    `evidence-vehicle-${index + 1}`,
    'DERIVED',
    'telemetry',
    vehicle.evidenceIds,
    `${vehicle.playerId} 的载具统计`,
  ));
  facts.heavyWeapons.forEach((weapon, index) => add(
    `evidence-heavy-weapon-${index + 1}`,
    'DERIVED',
    'telemetry',
    weapon.evidenceIds,
    `${weapon.playerId} 的 ${weapon.weapon} 统计`,
  ));
  facts.fights.forEach((fight) => add(
    `evidence-${fight.id}`,
    'DERIVED',
    'telemetry',
    fight.evidenceIds,
    '聚合团战',
  ));
  facts.players.forEach((player) => add(
    `player-summary-${facts.match.matchId}-${player.playerId}`,
    'FACT',
    'match_store',
    [],
    `${player.playerName} 的 Match Store 基础战绩`,
  ));
  facts.players.flatMap((player) => player.keyOperations).forEach((operation) => add(
    `evidence-${operation.id}`,
    'DERIVED',
    'telemetry',
    operation.evidenceIds,
    operation.impact,
  ));
  facts.specialEvents.forEach((event) => add(
    `evidence-${event.id}`,
    'DERIVED',
    'telemetry',
    event.evidenceIds,
    event.impact,
  ));
  facts.teamDamage?.forEach((fact) => add(
    `evidence-${fact.id}`,
    'DERIVED',
    'telemetry',
    fact.evidenceIds,
    `${fact.actorPlayerId} 对 ${fact.victimPlayerId} 的队友伤害事实`,
  ));
  facts.teamVehicleEvents?.forEach((fact) => add(
    `evidence-${fact.id}`,
    'DERIVED',
    'telemetry',
    fact.evidenceIds,
    `${fact.actorPlayerId} 对 ${fact.victimPlayerId} 的车辆队伤事实`,
  ));
  facts.flash?.forEach((fact) => add(
    `evidence-flash-${fact.playerId}`,
    'DERIVED',
    'telemetry',
    fact.evidenceIds,
    `${fact.playerId} 的闪光弹使用事实`,
  ));
  return retained;
}

/**
 * Keep durable review facts and evidence references, but not the event stream.
 * The normalized stream is needed during extraction only and can dominate the
 * feature file without adding anything to the rendered review.
 */
export function compactReviewFactsForFeatureStore(facts: MatchReviewFacts): MatchReviewFacts {
  const compacted = structuredClone(facts);
  compacted.combat.events = [];
  compacted.evidence = compactEvidence(compacted);
  return compacted;
}

function compactFeatureRecord(record: TelemetryFeatureRecord): TelemetryFeatureRecord {
  return { ...record, facts: compactReviewFactsForFeatureStore(record.facts) };
}

export interface TelemetryFeatureStore {
  get(key: TelemetryFeatureKey): Promise<TelemetryFeatureRecord | null>;
  set(record: TelemetryFeatureRecord): Promise<void>;
}

function cacheKey(key: TelemetryFeatureKey): string {
  return `${key.matchId}:${key.parserVersion}:${key.featureVersion}`;
}

export class InMemoryTelemetryFeatureStore implements TelemetryFeatureStore {
  private readonly values = new Map<string, TelemetryFeatureRecord>();

  async get(key: TelemetryFeatureKey): Promise<TelemetryFeatureRecord | null> {
    const value = this.values.get(cacheKey(key));
    return value ? structuredClone(value) : null;
  }

  async set(record: TelemetryFeatureRecord): Promise<void> {
    this.values.set(cacheKey(record), structuredClone(record));
  }
}

interface PersistedFeatures {
  features: Record<string, TelemetryFeatureRecord>;
}

export class JsonTelemetryFeatureStore implements TelemetryFeatureStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private async read(): Promise<PersistedFeatures> {
    try {
      const value = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<PersistedFeatures>;
      return { features: value.features ?? {} };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { features: {} };
    }
  }

  private async write(mutator: (state: PersistedFeatures) => void): Promise<void> {
    this.queue = this.queue.catch(() => undefined).then(async () => {
      const state = await this.read();
      mutator(state);
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      await fs.writeFile(temporaryPath, JSON.stringify(state), { mode: 0o600 });
      await fs.rename(temporaryPath, this.filePath);
    });
    return this.queue;
  }

  async get(key: TelemetryFeatureKey): Promise<TelemetryFeatureRecord | null> {
    const state = await this.read();
    const value = state.features[cacheKey(key)];
    if (!value) return null;
    const compacted = compactFeatureRecord(value);
    const needsMigration = value.facts.combat.events.length > 0
      || value.facts.evidence.some((item) => item.id.startsWith('evidence-telemetry-'));
    if (needsMigration) await this.set(compacted);
    return compacted;
  }

  async set(record: TelemetryFeatureRecord): Promise<void> {
    const compacted = compactFeatureRecord(record);
    await this.write((state) => { state.features[cacheKey(compacted)] = compacted; });
  }
}

export interface TelemetryDownloader {
  download(match: NormalizedMatch): Promise<unknown>;
}

export interface HttpTelemetryDownloaderOptions {
  url: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class N8nTelemetryDownloader implements TelemetryDownloader {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: HttpTelemetryDownloaderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async download(match: NormalizedMatch): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.options.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ matchId: match.matchId, shard: match.shard, telemetryUrl: match.telemetryUrl ?? null, source: 'pubg-review-worker-v3.3' }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`telemetry_http_${response.status}`);
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('json')) return await response.json();
      return Buffer.from(await response.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface PubgApiTelemetryDownloaderOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function authorizationValue(apiKey: string): string {
  const value = apiKey.trim();
  return /^Bearer\s+/iu.test(value) ? value : `Bearer ${value}`;
}

export class PubgApiTelemetryDownloader implements TelemetryDownloader {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: PubgApiTelemetryDownloaderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = (options.baseUrl ?? 'https://api.pubg.com').replace(/\/$/u, '');
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  private async get(url: string, authorize = true): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = new Headers({ accept: 'application/json' });
      if (authorize) headers.set('authorization', authorizationValue(this.options.apiKey));
      const response = await this.fetchImpl(url, {
        headers,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`pubg_telemetry_http_${response.status}`);
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  async download(match: NormalizedMatch): Promise<unknown> {
    const detailResponse = match.telemetryUrl ? null : await this.get(`${this.baseUrl}/shards/${encodeURIComponent(match.shard)}/matches/${encodeURIComponent(match.matchId)}`);
    let telemetryUrl = match.telemetryUrl ?? null;
    if (!telemetryUrl && detailResponse) {
      const body = objectValue(await detailResponse.json());
      const included = Array.isArray(body.included) ? body.included : [];
      const relationships = objectValue(objectValue(body.data).relationships);
      const assets = Array.isArray(objectValue(relationships.assets).data) ? objectValue(relationships.assets).data as unknown[] : [];
      const assetIds = new Set(assets.map((asset) => String(objectValue(asset).id ?? '')));
      const asset = included.find((item) => objectValue(item).type === 'asset' && (assetIds.size === 0 || assetIds.has(String(objectValue(item).id ?? ''))));
      telemetryUrl = String(objectValue(objectValue(asset).attributes).URL ?? objectValue(objectValue(asset).attributes).url ?? '') || null;
    }
    if (!telemetryUrl) throw new Error('telemetry_asset_not_found');
    // PUBG returns a signed asset URL; never forward the API credential to it.
    const response = await this.get(telemetryUrl, false);
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('json')) return await response.json();
    return Buffer.from(await response.arrayBuffer());
  }
}

export interface TelemetryWorkerOptions {
  team: TeamConfig;
  store?: TelemetryFeatureStore;
  downloader?: TelemetryDownloader;
  parserVersion?: string;
  featureVersion?: string;
}

export interface TelemetryEnsureResult {
  status: 'HIT' | 'MISS' | 'UNAVAILABLE';
  facts?: MatchReviewFacts;
  parserVersion: string;
  featureVersion: string;
  error?: string;
}

function factsForOrdinal(facts: MatchReviewFacts, ordinal: number): MatchReviewFacts {
  if (facts.match.ordinal === ordinal) return facts;
  const rebound = structuredClone(facts);
  rebound.match.ordinal = ordinal;
  return rebound;
}

export class TelemetryWorker {
  private readonly team: TeamConfig;
  private readonly store: TelemetryFeatureStore;
  private readonly downloader: TelemetryDownloader | undefined;
  readonly parserVersion: string;
  readonly featureVersion: string;

  constructor(options: TelemetryWorkerOptions) {
    this.team = options.team;
    this.store = options.store ?? new InMemoryTelemetryFeatureStore();
    this.downloader = options.downloader;
    this.parserVersion = options.parserVersion ?? DEFAULT_TELEMETRY_PARSER_VERSION;
    this.featureVersion = options.featureVersion ?? DEFAULT_REVIEW_FEATURE_VERSION;
  }

  async ensure(match: NormalizedMatch, ordinal = 1): Promise<TelemetryEnsureResult> {
    const key = { matchId: match.matchId, parserVersion: this.parserVersion, featureVersion: this.featureVersion };
    const cached = await this.store.get(key);
    if (cached) return { status: 'HIT', facts: factsForOrdinal(cached.facts, ordinal), parserVersion: this.parserVersion, featureVersion: this.featureVersion };
    if (!this.downloader) return { status: 'UNAVAILABLE', parserVersion: this.parserVersion, featureVersion: this.featureVersion, error: 'telemetry_downloader_not_configured' };
    try {
      const raw = await this.downloader.download(match);
      const facts = extractMatchReviewFacts(match, raw, this.team, ordinal);
      const persistedFacts = compactReviewFactsForFeatureStore(facts);
      await this.store.set({ ...key, facts: persistedFacts, createdAt: new Date().toISOString() });
      // Keep the normalized event stream inside the Worker boundary. Review
      // analysis and presentation consume derived facts/evidence only.
      return { status: 'MISS', facts: persistedFacts, parserVersion: this.parserVersion, featureVersion: this.featureVersion };
    } catch (error) {
      return {
        status: 'UNAVAILABLE',
        parserVersion: this.parserVersion,
        featureVersion: this.featureVersion,
        error: error instanceof Error ? error.message : 'telemetry_unavailable',
      };
    }
  }
}
