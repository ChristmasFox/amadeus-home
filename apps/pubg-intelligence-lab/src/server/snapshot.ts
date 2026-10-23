import { AnalysisCache, analysisVersion } from './analysis-cache.js';
import { WorkerPool } from './analysis-pool.js';
import { type MatchTelemetryAnalysis } from './match-analysis.js';
import { createResearchModel } from './model.js';
import {
  type MatchReviewFacts,
  type NormalizedMatch,
  type ReviewShareRecord,
  SqlitePubgRepository,
  type TeamConfig,
} from '@rine-kit/pubg-domain';
import {
  type BattleTelemetryDocument,
  buildResearchSquads,
  ExperimentRunStore,
  type LandingSample,
  mapDisplayName,
  MODE_GROUPS,
  type ModeGroup,
  modeGroupOf,
  NaturalLanguageResearchPlanner,
  redactSensitiveText,
  type ResearchSquad,
} from '@rine-kit/pubg-intelligence';
import { RawTelemetryArchive } from '@rine-kit/pubg-intelligence/archive';
import { assertArchiveOutsideRepository } from '@rine-kit/pubg-intelligence/backfill';
import { type LanguageModel } from 'ai';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import {
  basename,
  dirname,
  join,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

export const PARSER_VERSION = 'telemetry-parser-6';
export const FEATURE_VERSION = 'review-features-6';
export const DEFAULT_PORT = 4179;
export const DEFAULT_HOST = '127.0.0.1';
export const MAX_REQUEST_BYTES = 16 * 1024;
export const MAX_MATCHES_PER_PAGE = 100;
export const MAX_TACTICAL_MATCHES = 30;
/** Analytics read only the local archive, one match at a time, and keep just the small per-match result. */
export const MAX_TELEMETRY_ANALYTICS_MATCHES = 400;

export interface MatchReviewFeature {
  facts: MatchReviewFacts;
  createdAt: string;
}
export interface Snapshot {
  matches: NormalizedMatch[];
  byId: Map<string, NormalizedMatch>;
  squads: ResearchSquad[];
  defaultSquad: ResearchSquad;
  features: Map<string, MatchReviewFeature>;
  landings: Map<string, LandingSample[]>;
  telemetryAnalytics: Map<string, Promise<unknown>>;
  matchTelemetry: Map<string, Promise<MatchTelemetryAnalysis | 'missing' | 'failed'>>;
  archivedIds: { at: number; ids: ReadonlySet<string> } | null;
  telemetryUrls: Map<string, string>;
  rawTelemetryArchive: RawTelemetryArchive;
  archiveDirectory: string;
  analysisPool: WorkerPool;
  analysisCache: AnalysisCache;
  battleTelemetry: Map<string, Promise<BattleTelemetryDocument>>;
  experimentStore: ExperimentRunStore;
  planner: NaturalLanguageResearchPlanner;
  researchModel?: Exclude<LanguageModel, string>;
  modelEnabled: boolean;
  modelId: string | null;
  /** Review share links by token hash, read from the snapshot copy of the Lab ledger. */
  shares: Map<string, ReviewShareRecord>;
}

export function safePlayerName(value: string, index: number): string {
  const normalized = redactSensitiveText(value.trim()).replace(/\[手机号已隐藏\]/gu, '匿名队员');
  return normalized || `队员 ${index + 1}`;
}

export function sanitizeMatch(match: NormalizedMatch): NormalizedMatch {
  const { telemetryUrl: _telemetryUrl, ...safe } = match;
  return {
    ...safe,
    players: safe.players.map((player, index) => ({
      ...player,
      playerName: safePlayerName(player.playerName, index),
      displayName: safePlayerName(player.displayName, index),
    })),
  };
}

export function defaultSquad(matches: NormalizedMatch[], squads: ResearchSquad[]): ResearchSquad {
  if (squads[0]) return squads[0];
  const players = new Map<string, string>();
  for (const match of matches) {
    for (const [index, player] of match.players.entries()) players.set(player.accountId, safePlayerName(player.displayName || player.playerName, index));
  }
  const memberIds = [...players.keys()];
  return {
    id: 'solo-roster',
    label: memberIds.length ? '历史小队' : '全部比赛',
    memberIds,
    members: memberIds.map((id, index) => ({ id, name: players.get(id) ?? `队员 ${index + 1}` })),
    matchCount: matches.length,
  };
}

export function localDataPath(): string {
  return process.env.PUBG_INTELLIGENCE_EXPERIMENT_DB?.trim()
    || join(homedir(), '.local', 'share', 'amadeus', 'pubg-intelligence-lab', 'experiments.sqlite');
}

export function ensureSeparateExperimentPath(sourcePath: string, experimentPath: string): void {
  const sourceReal = realpathSync(sourcePath);
  const experimentAbsolute = resolve(experimentPath);
  const experimentDirectory = realpathSync(dirname(experimentAbsolute));
  const experimentReal = existsSync(experimentAbsolute)
    ? realpathSync(experimentAbsolute)
    : join(experimentDirectory, basename(experimentAbsolute));
  if (sourceReal === experimentReal) throw new Error('experiment_store_must_be_separate');
}

export async function openSnapshot(modelOverride?: Exclude<LanguageModel, string>): Promise<Snapshot> {
  const configuredDatabase = process.env.PUBG_INTELLIGENCE_DB?.trim();
  if (!configuredDatabase) throw new Error('PUBG_INTELLIGENCE_DB_REQUIRED');
  const sourcePath = realpathSync(configuredDatabase);
  if (!statSync(sourcePath).isFile()) throw new Error('PUBG_INTELLIGENCE_DB_INVALID');
  const experimentPath = localDataPath();
  const configuredArchiveDirectory = process.env.PUBG_TELEMETRY_ARCHIVE_DIR?.trim()
    || join(homedir(), '.local', 'share', 'amadeus', 'pubg-telemetry-archive');
  const repositoryRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'));
  const telemetryArchiveDirectory = await assertArchiveOutsideRepository(configuredArchiveDirectory, repositoryRoot);
  mkdirSync(dirname(experimentPath), { recursive: true, mode: 0o700 });
  ensureSeparateExperimentPath(sourcePath, experimentPath);

  const repository = new SqlitePubgRepository(sourcePath, { readOnly: true });
  let matches: NormalizedMatch[];
  const telemetryUrls = new Map<string, string>();
  const features = new Map<string, MatchReviewFeature>();
  let shares = new Map<string, ReviewShareRecord>();
  try {
    shares = new Map(repository.listReviewShares().map((record) => [record.tokenHash, record]));
    const sourceMatches = repository.listMatches({ limit: 10000 });
    for (const match of sourceMatches) {
      const telemetryUrl = match.telemetryUrl;
      if (telemetryUrl && isAllowedTelemetryUrl(telemetryUrl)) telemetryUrls.set(match.matchId, telemetryUrl);
    }
    matches = sourceMatches.map(sanitizeMatch);
    for (const match of matches) {
      const record = await repository.get({ matchId: match.matchId, parserVersion: PARSER_VERSION, featureVersion: FEATURE_VERSION });
      if (record) features.set(match.matchId, { facts: record.facts, createdAt: record.createdAt });
    }
  } finally {
    repository.close();
  }

  const squads = buildResearchSquads(matches);
  const selectedSquad = defaultSquad(matches, squads);
  const model = modelOverride ?? createResearchModel();
  // Per-match analysis is CPU-heavy: workers keep the server responsive, and the disk cache survives restarts.
  const packageDist = (name: string) => {
    // Shared algorithms live in @rine-kit/* on npm (pnpm layout under node_modules/.pnpm).
    const candidates = [
      join(repositoryRoot, 'node_modules', '@rine-kit', name, 'dist', 'src'),
      join(repositoryRoot, 'apps', 'pubg-intelligence-lab', 'node_modules', '@rine-kit', name, 'dist', 'src'),
    ];
    try {
      const pnpm = join(repositoryRoot, 'node_modules', '.pnpm');
      for (const entry of readdirSync(pnpm)) {
        if (entry.startsWith(`@rine-kit+${name}@`)) {
          candidates.push(join(pnpm, entry, 'node_modules', '@rine-kit', name, 'dist', 'src'));
        }
      }
    } catch { /* ignore */ }
    return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
  };
  let analysisSource = '';
  try { analysisSource = readFileSync(fileURLToPath(new URL('./match-analysis.ts', import.meta.url)), 'utf8'); } catch { /* compiled layout: the packages' hash still covers the analysis code */ }
  const analysisCache = new AnalysisCache(join(dirname(experimentPath), 'analysis-cache'), analysisVersion([packageDist('pubg-intelligence'), packageDist('pubg-domain')], [analysisSource]));
  const workerCount = Math.max(1, Math.min(3, Number(process.env.PUBG_INTELLIGENCE_ANALYSIS_WORKERS) || 3));
  const analysisPool = new WorkerPool(new URL('./analysis-worker.ts', import.meta.url), workerCount);
  return {
    matches,
    byId: new Map(matches.map((match) => [match.matchId, match])),
    squads,
    defaultSquad: selectedSquad,
    features,
    landings: new Map(),
    telemetryAnalytics: new Map(),
    matchTelemetry: new Map(),
    archivedIds: null,
    telemetryUrls,
    rawTelemetryArchive: new RawTelemetryArchive(telemetryArchiveDirectory),
    archiveDirectory: telemetryArchiveDirectory,
    analysisPool,
    analysisCache,
    battleTelemetry: new Map(),
    experimentStore: new ExperimentRunStore(experimentPath),
    planner: new NaturalLanguageResearchPlanner(model),
    ...(model ? { researchModel: model } : {}),
    modelEnabled: Boolean(model),
    modelId: model?.modelId ?? null,
    shares,
  };
}

export function isAllowedTelemetryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'telemetry-cdn.pubg.com'
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export function selectSquad(snapshot: Snapshot, requestedId: unknown): ResearchSquad {
  if (typeof requestedId === 'string') {
    if (requestedId === 'all') return { id: 'all', label: '全部队员', memberIds: [], members: [], matchCount: snapshot.matches.length };
    const selected = snapshot.squads.find((squad) => squad.id === requestedId);
    if (selected) return selected;
  }
  return snapshot.defaultSquad;
}

export function inSquad(match: NormalizedMatch, squad: ResearchSquad): boolean {
  return !squad.memberIds.length || match.players.some((player) => squad.memberIds.includes(player.accountId));
}

export function requestedMode(url: URL): ModeGroup | 'all' {
  const value = url.searchParams.get('mode');
  return value === 'all' ? 'all' : MODE_GROUPS.find((group) => group === value) ?? 'squad';
}

/** Only ranked (competitive) matches are analysed; normal, arcade, event and bot-filled casual matches are discarded. */
export function isRanked(match: NormalizedMatch): boolean {
  return match.isCompetitive === true;
}

export function inMode(match: NormalizedMatch, mode: ModeGroup | 'all'): boolean {
  return isRanked(match) && (mode === 'all' || modeGroupOf(match.gameMode) === mode);
}

/** Match IDs with a verified raw telemetry archive entry; re-read at most every 30 seconds because the hourly prefetch adds entries. */
export async function archivedIds(snapshot: Snapshot): Promise<ReadonlySet<string>> {
  const cached = snapshot.archivedIds;
  if (cached && Date.now() - cached.at < 30_000) return cached.ids;
  const ids = new Set(await snapshot.rawTelemetryArchive.listMatchIds());
  snapshot.archivedIds = { at: Date.now(), ids };
  return ids;
}

/** Result of the last archive backup (written by scripts/backup-pubg-telemetry-archive.sh), so a stalled backup shows on the page. */
export function readArchiveBackup(): { ok: boolean; result: string; at: string; matches: number } | null {
  const file = join(process.env.PUBG_INTELLIGENCE_STATE_DIR?.trim() || join(homedir(), '.local', 'share', 'amadeus', 'pubg-intelligence-lab'), 'archive-backup.json');
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    return typeof value.at === 'string' && typeof value.result === 'string'
      ? { ok: value.ok === true, result: value.result, at: value.at, matches: typeof value.matches === 'number' ? value.matches : 0 }
      : null;
  } catch {
    return null;
  }
}

export function wantsCompleteTelemetry(url: URL): boolean {
  return url.searchParams.get('complete') === '1';
}

export function visibleMatch(match: NormalizedMatch, squad: ResearchSquad, snapshot: Snapshot) {
  const players = squad.memberIds.length
    ? match.players.filter((player) => squad.memberIds.includes(player.accountId))
    : match.players;
  const placements = [...new Set(players.map((player) => player.rank).filter((value): value is number => value !== null && value > 0))];
  const placement = placements.length === 1 ? placements[0]! : null;
  return {
    matchId: match.matchId,
    createdAt: match.createdAt ?? (Number.isFinite(match.timestamp) ? new Date(match.timestamp).toISOString() : null),
    mapName: match.mapName || '未知地图',
    mapLabel: mapDisplayName(match.mapName || '未知地图'),
    gameMode: match.gameMode,
    duration: match.duration,
    placement,
    kills: players.reduce((sum, player) => sum + player.kills, 0),
    damage: players.reduce((sum, player) => sum + player.damage, 0),
    players: players.map((player, index) => ({ name: safePlayerName(player.displayName || player.playerName, index), kills: player.kills, damage: player.damage, rank: player.rank })),
    telemetry: snapshot.features.has(match.matchId) ? 'HIT' : 'MISSING',
  };
}

export function createSyntheticTeam(match: NormalizedMatch): TeamConfig {
  return {
    id: 'intelligence-local-squad',
    label: 'Local research squad',
    platform: match.shard || 'steam',
    players: match.players.map((player, index) => ({ id: player.accountId, name: safePlayerName(player.displayName || player.playerName, index), aliases: [] })),
  };
}

export function scrubText(value: string, match: NormalizedMatch): string {
  let result = redactSensitiveText(value).replace(/\[手机号已隐藏\]/gu, '匿名队员');
  for (const player of match.players) {
    result = result.replaceAll(player.accountId, safePlayerName(player.displayName || player.playerName, 0));
  }
  return result;
}