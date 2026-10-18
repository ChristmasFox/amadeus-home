import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { homedir, networkInterfaces } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createServer as createViteServer } from 'vite';
import type { LanguageModel } from 'ai';
import {
  analyzeMatchReview,
  DEFAULT_TIMEZONE,
  extractMatchReviewFacts,
  localDateLabel,
  SqlitePubgRepository,
  type MatchReviewFacts,
  type NormalizedMatch,
  type TeamConfig,
} from '@agent/pubg-domain';
import {
  battlePlayerRef,
  battleTeamRef,
  buildResearchReport,
  buildResearchSquads,
  buildFrequentPairCandidates,
  classifyResearchQuestion,
  ExperimentRunStore,
  replayTacticalBenchmark,
  analyzeTacticalMatch,
  buildMatchRelative,
  type RelativeValues,
  buildLongRunCombat,
  summarizeLobby,
  summarizeStreaks,
  buildSquadStyle,
  buildFieldInsights,
  FIELD_INSIGHT_MAX,
  summarizeDistance,
  summarizeFights,
  summarizeRoles,
  summarizeZone,
  buildCombatInsights,
  buildLineupAnalytics,
  buildPerformanceInsights,
  buildPlayerProfiles,
  buildProfileInsights,
  rankInsights,
  buildMatchSeries,
  MODE_GROUPS,
  modeGroupOf,
  summarizeDeaths,
  type ModeGroup,
  buildLandingPreference,
  buildMapAnalytics,
  buildSquadAnalytics,
  extractLandings,
  mapDisplayName,
  mapSizeKm,
  summarizeCombatQuality,
  type LandingSample,
  buildWeaponEfficiency,
  anonymizeResearchText,
  NaturalLanguageResearchPlanner,
  ResearchTemplateSchema,
  runResearchAssistant,
  normalizeBattleTelemetry,
  redactSensitiveText,
  reconstructBattleEpisodes,
  tacticalPlayerRef,
  type BattleTelemetryDocument,
  type ResearchSquad,
  type ResearchTemplate,
  type ResearchAssistantEvidence,
  type ResearchAssistantResult,
  type ResearchAssistantToolset,
  type TacticalMatchAnalysis,
  type EvaluationReviewLabel,
  type BattleReviewLabel,
} from '@agent/pubg-intelligence';
import { RawTelemetryArchive } from '@agent/pubg-intelligence/archive';
import { assertArchiveOutsideRepository } from '@agent/pubg-intelligence/backfill';
import { researchRecoveryMessage, shortConversationReply } from './messages.js';
import { AnalysisCache, analysisVersion } from './analysis-cache.js';
import { WorkerPool } from './analysis-pool.js';
import type { MatchTelemetryAnalysis } from './match-analysis.js';
import {
  clearedCookie, clientKey, isPublicRequest, LOGIN_PAGE, loadPublicAccess, login, loginCookie, logout, looksProxied, MAX_LOGIN_BYTES,
  validSession, type PublicAccess,
} from './public-access.js';
import { createResearchModel } from './model.js';

const PARSER_VERSION = 'telemetry-parser-6';
const FEATURE_VERSION = 'review-features-6';
const DEFAULT_PORT = 4179;
const DEFAULT_HOST = '127.0.0.1';
const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_MATCHES_PER_PAGE = 100;
const MAX_TACTICAL_MATCHES = 30;
/** Analytics read only the local archive, one match at a time, and keep just the small per-match result. */
const MAX_TELEMETRY_ANALYTICS_MATCHES = 400;

interface MatchReviewFeature {
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
}

function safePlayerName(value: string, index: number): string {
  const normalized = redactSensitiveText(value.trim()).replace(/\[手机号已隐藏\]/gu, '匿名队员');
  return normalized || `队员 ${index + 1}`;
}

interface ScopedPlayerAlias {
  accountId: string;
  name: string;
  alias: string;
}

function requestedRecentMatchCount(question: string): number {
  const text = question.normalize('NFKC').toLocaleLowerCase('zh-CN');
  const match = /(?:近|最近|last)\s*(\d{1,2}|[零一二两三四五六七八九十]+)\s*(?:场|局|matches?)?/iu.exec(text);
  if (!match?.[1]) return 10;
  const token = match[1];
  const chinese: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const parsed = /^\d+$/u.test(token) ? Number(token) : chinese[token];
  return Math.max(1, Math.min(10, Number.isFinite(parsed) ? parsed! : 10));
}

function requestedPlayerReview(question: string, players: readonly ScopedPlayerAlias[]): ScopedPlayerAlias | undefined {
  const text = question.normalize('NFKC').toLocaleLowerCase('zh-CN');
  if (!/(?:近\s*(?:[\d零一二两三四五六七八九十]+\s*)?(?:场|局)|最近.{0,8}(?:场|局|比赛)?|打法|复盘|分析|表现|状态|playstyle|performance|last\s+\d+)/iu.test(text)) return undefined;
  const candidates = players.filter((player) => player.name.trim() && text.includes(player.name.normalize('NFKC').toLocaleLowerCase('zh-CN')))
    .sort((left, right) => right.name.length - left.name.length);
  const longestNameLength = candidates[0]?.name.length;
  const best = candidates.filter((player) => player.name.length === longestNameLength);
  const accounts = new Set(best.map((player) => player.accountId));
  return accounts.size === 1 ? best[0] : undefined;
}

function sanitizeMatch(match: NormalizedMatch): NormalizedMatch {
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

function defaultSquad(matches: NormalizedMatch[], squads: ResearchSquad[]): ResearchSquad {
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

function localDataPath(): string {
  return process.env.PUBG_INTELLIGENCE_EXPERIMENT_DB?.trim()
    || join(homedir(), '.local', 'share', 'amadeus', 'pubg-intelligence-lab', 'experiments.sqlite');
}

function ensureSeparateExperimentPath(sourcePath: string, experimentPath: string): void {
  const sourceReal = realpathSync(sourcePath);
  const experimentAbsolute = resolve(experimentPath);
  const experimentDirectory = realpathSync(dirname(experimentAbsolute));
  const experimentReal = existsSync(experimentAbsolute)
    ? realpathSync(experimentAbsolute)
    : join(experimentDirectory, basename(experimentAbsolute));
  if (sourceReal === experimentReal) throw new Error('experiment_store_must_be_separate');
}

async function openSnapshot(modelOverride?: Exclude<LanguageModel, string>): Promise<Snapshot> {
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
  try {
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
  const packageDist = (name: string) => join(repositoryRoot, 'packages', name, 'dist', 'src');
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
  };
}

function isAllowedTelemetryUrl(value: string): boolean {
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

async function loadBattleTelemetry(snapshot: Snapshot, match: NormalizedMatch): Promise<BattleTelemetryDocument> {
  const cached = snapshot.battleTelemetry.get(match.matchId);
  if (cached) return cached;
  const request = snapshot.rawTelemetryArchive.read(match.matchId).then((payload) => {
    if (!payload) throw new Error('telemetry_archive_missing');
    snapshot.landings.set(match.matchId, extractLandings(payload, match, new Set(match.players.map((player) => player.accountId))));
    return normalizeBattleTelemetry(payload, match);
  });
  snapshot.battleTelemetry.set(match.matchId, request);
  try {
    return await request;
  } catch (error) {
    snapshot.battleTelemetry.delete(match.matchId);
    throw error;
  }
}

/**
 * Analyse one archived match for a squad. The result is looked up in memory, then on disk, and only computed (on a
 * worker thread, so the server stays responsive) when neither has it. Returns 'missing' when the archive has no entry
 * (the CDN keeps telemetry for about 14 days) and 'failed' when it cannot be parsed.
 */
function analyzeMatchTelemetry(snapshot: Snapshot, squad: ResearchSquad, match: NormalizedMatch): Promise<MatchTelemetryAnalysis | 'missing' | 'failed'> {
  const key = `${squad.id}|${match.matchId}`;
  const cached = snapshot.matchTelemetry.get(key);
  if (cached) return cached;
  const request = (async (): Promise<MatchTelemetryAnalysis | 'missing' | 'failed'> => {
    const stored = snapshot.analysisCache.read<MatchTelemetryAnalysis>(squad.id, match.matchId);
    if (stored) return stored;
    try {
      const result = await snapshot.analysisPool.run<MatchTelemetryAnalysis | 'missing'>({
        kind: 'analysis', archiveDirectory: snapshot.archiveDirectory, match, memberIds: [...squad.memberIds],
      });
      if (result !== 'missing') snapshot.analysisCache.write(squad.id, match.matchId, result);
      return result;
    } catch {
      return 'failed';
    }
  })();
  snapshot.matchTelemetry.set(key, request);
  return request;
}

/** History used to place one match against each member's usual level: the most recent matches of the same mode. */
const MATCH_RELATIVE_HISTORY_LIMIT = 150;

function storeValues(match: NormalizedMatch, accountId: string): RelativeValues | null {
  const player = match.players.find((item) => item.accountId === accountId);
  if (!player) return null;
  return { damage: player.damage, kills: player.kills, knocks: player.dbnos, assists: player.assists, survival: Math.max(0, player.survivalTime) / 60 };
}

function telemetryValues(analysis: MatchTelemetryAnalysis, accountId: string): RelativeValues {
  const style = analysis.style[accountId];
  const streak = analysis.streaks.players[accountId];
  const sg = 5;
  const shots = style ? style.shots - (style.classShots[sg] ?? 0) : 0;
  const hits = style ? style.hits - (style.classHits[sg] ?? 0) : 0;
  return {
    dpm: style && style.minutes >= 1 ? (style.gunDamage + style.explosiveDamage) / style.minutes : null,
    hitRate: shots >= 30 ? hits / shots : null,
    takedowns: streak?.takedowns ?? null,
    longestStreak: streak?.longest ?? null,
    wipeTakedowns: streak?.wipeTakedowns ?? null,
    timesDowned: analysis.fights.roles[accountId]?.timesDowned ?? null,
  };
}

/** Plain-language story of one match: lifelines, fights, route and circle, plus each member's numbers. */
async function computeMatchStory(snapshot: Snapshot, squad: ResearchSquad, match: NormalizedMatch) {
  const members = (squad.memberIds.length ? match.players.filter((player) => squad.memberIds.includes(player.accountId)) : match.players.slice(0, 4));
  const trackedIds = new Set(members.map((player) => player.accountId));
  const names: Record<string, string> = {};
  members.forEach((player, index) => { names[player.accountId] = safePlayerName(player.displayName || player.playerName, index); });
  const base = {
    matchId: match.matchId,
    mapName: match.mapName || null,
    mapLabel: mapDisplayName(match.mapName || '未知地图'),
    mapSizeKm: mapSizeKm(match.mapName || ''),
    gameMode: match.gameMode,
    durationSeconds: match.duration,
    createdAt: match.createdAt ?? null,
    names,
  };
  const archived = await archivedIds(snapshot);
  const rows = members.map((player) => ({
    accountId: player.accountId,
    name: names[player.accountId]!,
    damage: player.damage,
    kills: player.kills,
    knocks: player.dbnos,
    assists: player.assists,
    revives: player.revives,
    survivalSeconds: Math.max(0, player.survivalTime),
    rank: player.rank,
    hitRate: null as number | null,
    damagePerMinute: null as number | null,
    timesDowned: null as number | null,
    heals: null as number | null,
    throwables: null as number | null,
    rides: null as number | null,
    footKm: null as number | null,
    longestStreak: null as number | null,
  }));
  if (!archived.has(match.matchId)) return { ...base, available: false, reason: 'no_archive', players: rows, story: null };
  try {
    const story = await snapshot.analysisPool.run<Parameters<typeof JSON.stringify>[0] | 'missing'>({
      kind: 'story', archiveDirectory: snapshot.archiveDirectory, match, memberIds: [...trackedIds],
    });
    if (story === 'missing') return { ...base, available: false, reason: 'no_archive', players: rows, story: null };
    const analysis = await analyzeMatchTelemetry(snapshot, squad.memberIds.length ? squad : { ...squad, memberIds: [...trackedIds] }, match);
    if (typeof analysis !== 'string') {
      for (const row of rows) {
        const style = analysis.style[row.accountId];
        const streak = analysis.streaks.players[row.accountId];
        if (style) {
          const shots = style.shots - (style.classShots[5] ?? 0);
          const hits = style.hits - (style.classHits[5] ?? 0);
          row.hitRate = shots >= 30 ? hits / shots : null;
          row.damagePerMinute = style.minutes >= 1 ? (style.gunDamage + style.explosiveDamage) / style.minutes : null;
          row.heals = style.healUses + style.boostUses;
          row.throwables = style.throwables.frag + style.throwables.smoke + style.throwables.flash + style.throwables.fire;
          row.rides = style.rides;
          row.footKm = style.footMeters / 1000;
        }
        row.timesDowned = analysis.fights.roles[row.accountId]?.timesDowned ?? null;
        row.longestStreak = streak?.longest ?? null;
      }
    }
    return { ...base, available: true, reason: null, players: rows, story };
  } catch {
    return { ...base, available: false, reason: 'unreadable', players: rows, story: null };
  }
}

async function computeMatchRelative(snapshot: Snapshot, squad: ResearchSquad, match: NormalizedMatch) {
  const members = (squad.memberIds.length ? match.players.filter((player) => squad.memberIds.includes(player.accountId)) : match.players.slice(0, 4))
    .map((player) => ({ accountId: player.accountId, name: player.displayName || player.playerName }));
  const group = modeGroupOf(match.gameMode);
  const history = snapshot.matches
    .filter((other) => other.matchId !== match.matchId && inMode(other, group) && other.players.some((player) => members.some((member) => member.accountId === player.accountId)))
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, MATCH_RELATIVE_HISTORY_LIMIT);
  const archived = await archivedIds(snapshot);
  const telemetrySquad: ResearchSquad = squad.memberIds.length ? squad : { ...squad, memberIds: members.map((member) => member.accountId) };
  const withTelemetry = [match, ...history].filter((item) => archived.has(item.matchId));
  const analyses = new Map<string, MatchTelemetryAnalysis>();
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(3, withTelemetry.length) }, async () => {
    while (nextIndex < withTelemetry.length) {
      const item = withTelemetry[nextIndex++]!;
      const result = await analyzeMatchTelemetry(snapshot, telemetrySquad, item);
      if (typeof result !== 'string') analyses.set(item.matchId, result);
    }
  }));
  const valuesFor = (item: NormalizedMatch, accountId: string): RelativeValues | null => {
    const base = storeValues(item, accountId);
    if (!base) return null;
    const analysis = analyses.get(item.matchId);
    return analysis ? { ...base, ...telemetryValues(analysis, accountId) } : base;
  };
  const squadPlacement = (item: NormalizedMatch) => item.players.find((player) => members.some((member) => member.accountId === player.accountId) && player.rank !== null && player.rank > 0)?.rank ?? null;
  return {
    matchId: match.matchId,
    telemetry: analyses.has(match.matchId),
    historyMatches: history.length,
    ...buildMatchRelative({
      players: members.map((member) => ({
        ...member,
        current: valuesFor(match, member.accountId) ?? {},
        history: history.map((item) => valuesFor(item, member.accountId)).filter((values): values is RelativeValues => values !== null),
      })),
      placement: { current: squadPlacement(match), history: history.map(squadPlacement).filter((rank): rank is number => rank !== null) },
    }),
  };
}

interface TelemetryAnalyticsQuery {
  squad: ResearchSquad;
  mode: ModeGroup | 'all';
  fromMs: number | undefined;
  toMs: number | undefined;
  limit: number;
  archived?: ReadonlySet<string> | null;
}

async function computeTelemetryAnalytics(snapshot: Snapshot, query: TelemetryAnalyticsQuery) {
  const { squad, mode, fromMs, toMs, limit } = query;
  const eligible = snapshot.matches.filter((match) => snapshot.telemetryUrls.has(match.matchId)
    && inSquad(match, squad) && inMode(match, mode)
    && (!query.archived || query.archived.has(match.matchId))
    && (fromMs === undefined || match.timestamp >= fromMs)
    && (toMs === undefined || match.timestamp < toMs))
    .sort((left, right) => right.timestamp - left.timestamp || right.matchId.localeCompare(left.matchId));
  const selected = eligible.slice(0, limit);
  const results: Array<MatchTelemetryAnalysis | 'missing' | 'failed'> = new Array(selected.length).fill('failed');
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(3, selected.length) }, async () => {
    while (nextIndex < selected.length) {
      const index = nextIndex++;
      results[index] = await analyzeMatchTelemetry(snapshot, squad, selected[index]!);
    }
  }));
  const members = new Set(squad.memberIds);
  const analyzed = selected.flatMap((match, index) => {
    const result = results[index]!;
    return typeof result === 'string' ? [] : [{ match, result }];
  });
  const missingArchive = results.filter((result) => result === 'missing').length;
  const combat = summarizeCombatQuality(analyzed.map((item) => item.result.quality));
  const deaths = summarizeDeaths(analyzed.flatMap((item) => item.result.deaths));
  const landing = buildLandingPreference(analyzed.map((item) => ({
    match: item.match,
    landings: item.result.landings,
    memberIds: members as ReadonlySet<string>,
    contestedTeams: item.result.field.landing.contestedTeams,
    region: item.result.field.landing.region,
  })));
  const names = new Map<string, string>();
  for (const item of [...analyzed].sort((left, right) => left.match.timestamp - right.match.timestamp)) {
    for (const player of item.match.players) if (members.has(player.accountId)) names.set(player.accountId, player.displayName || player.playerName);
  }
  const fights = summarizeFights(analyzed.flatMap((item) => item.result.fights.fights));
  const roles = summarizeRoles(analyzed.map((item) => item.result.fights), names);
  const distance = summarizeDistance(analyzed.map((item) => item.result.field));
  const zone = summarizeZone(analyzed.map((item) => item.result.field));
  const style = buildSquadStyle({ matches: analyzed.map((item) => ({ matchId: item.match.matchId, players: item.result.style })), names });
  const lobby = summarizeLobby(analyzed.map((item) => item.result.lobby), names);
  const streaks = summarizeStreaks(analyzed.map((item) => item.result.streaks), names);
  // The Match Store needs no telemetry, so the long-run comparison uses every match in scope, not only archived ones.
  const longRun = buildLongRunCombat({
    matches: snapshot.matches.filter((match) => inSquad(match, squad) && inMode(match, mode)
      && (!query.archived || query.archived.has(match.matchId))
      && (fromMs === undefined || match.timestamp >= fromMs)
      && (toMs === undefined || match.timestamp < toMs)),
    memberIds: squad.memberIds,
  });
  const dates = analyzed.map((item) => item.match.timestamp);
  return {
    scope: {
      squadLabel: squad.label,
      eligibleMatches: eligible.length,
      analyzedMatches: analyzed.length,
      missingArchiveMatches: missingArchive,
      unavailableMatches: selected.length - analyzed.length - missingArchive,
      limit,
      from: dates.length ? new Date(Math.min(...dates)).toISOString() : null,
      to: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
    },
    combat,
    deaths,
    landing,
    fights,
    roles,
    distance,
    zone,
    style,
    lobby,
    streaks,
    longRun,
    highlights: rankInsights([...buildCombatInsights({ combat, deaths, landing }), ...buildFieldInsights({ fights, distance, zone, landing, roles })], FIELD_INSIGHT_MAX),
  };
}

function battleLabels(
  match: NormalizedMatch,
  squad: ResearchSquad,
  telemetry: BattleTelemetryDocument,
  episodePlayerRefs: Set<string>,
  episodeTeamRefs: Set<string>,
): { players: Record<string, string>; teams: Record<string, string> } {
  const trackedIds = new Set(squad.memberIds);
  const participants = match.players
    .map((player, index) => ({
      id: player.accountId,
      ref: battlePlayerRef(match.matchId, player.accountId),
      name: safePlayerName(player.displayName || player.playerName, index),
      tracked: trackedIds.has(player.accountId),
    }))
    .filter((player) => episodePlayerRefs.has(player.ref))
    .sort((left, right) => Number(right.tracked) - Number(left.tracked) || left.ref.localeCompare(right.ref));
  const players: Record<string, string> = {};
  let opponentIndex = 0;
  for (const player of participants) {
    players[player.ref] = player.tracked ? player.name : `对手成员 ${String(++opponentIndex).padStart(2, '0')}`;
  }
  for (const playerRef of episodePlayerRefs) players[playerRef] ??= `未知队员 ${Object.keys(players).length + 1}`;

  const trackedTeamIds = new Set<string>();
  const allTeamIds = new Set<string>();
  for (const event of telemetry.events) {
    if (event.actorTeamId) allTeamIds.add(event.actorTeamId);
    if (event.victimTeamId) allTeamIds.add(event.victimTeamId);
    if (event.actorTeamId && event.actorId && trackedIds.has(event.actorId)) trackedTeamIds.add(event.actorTeamId);
    if (event.victimTeamId && event.victimId && trackedIds.has(event.victimId)) trackedTeamIds.add(event.victimTeamId);
  }
  const sortedTeams = [...allTeamIds]
    .map((id) => ({ id, ref: battleTeamRef(match.matchId, id), tracked: trackedTeamIds.has(id) }))
    .filter((team) => episodeTeamRefs.has(team.ref))
    .sort((left, right) => Number(right.tracked) - Number(left.tracked) || left.ref.localeCompare(right.ref));
  const teams: Record<string, string> = {};
  let opponentTeamIndex = 0;
  for (const team of sortedTeams) teams[team.ref] = team.tracked ? '研究小队' : `对手队伍 ${String(++opponentTeamIndex).padStart(2, '0')}`;
  for (const teamRef of episodeTeamRefs) teams[teamRef] ??= '未知队伍';
  return { players, teams };
}

interface IPv4Network {
  address: string;
  netmask: string;
}

function toIPv4Number(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part) || Number(part) > 255)) return null;
  return parts.reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0);
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1';
}

function isPrivateIPv4Host(host: string): boolean {
  const value = toIPv4Number(host);
  if (value === null) return false;
  return (value >= 0x0a000000 && value <= 0x0affffff)
    || (value >= 0xac100000 && value <= 0xac1fffff)
    || (value >= 0xc0a80000 && value <= 0xc0a8ffff);
}

function bindNetwork(host: string): IPv4Network | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && address.address === host) return { address: address.address, netmask: address.netmask };
    }
  }
  return undefined;
}

function isLocalRequest(request: IncomingMessage, network?: IPv4Network): boolean {
  const address = (request.socket.remoteAddress ?? '').replace(/^::ffff:/u, '');
  if (address === '127.0.0.1' || address === '::1') return true;
  if (!network) return false;
  const peerNumber = toIPv4Number(address);
  const localNumber = toIPv4Number(network.address);
  const maskNumber = toIPv4Number(network.netmask);
  return peerNumber !== null && localNumber !== null && maskNumber !== null
    && (peerNumber & maskNumber) === (localNumber & maskNumber);
}

function send(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

async function requestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_REQUEST_BYTES) throw new Error('request_too_large');
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new Error('invalid_json'); }
}

function safeDateBounds(from: string | null, to: string | null): { fromMs?: number; toMs?: number } | null {
  const bounds: { fromMs?: number; toMs?: number } = {};
  if (from) {
    if (!validCalendarDate(from)) return null;
    bounds.fromMs = startOfLocalDay(from);
  }
  if (to) {
    if (!validCalendarDate(to)) return null;
    bounds.toMs = startOfLocalDay(nextCalendarDate(to));
  }
  if (bounds.fromMs !== undefined && bounds.toMs !== undefined && bounds.fromMs >= bounds.toMs) return null;
  return bounds;
}

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function localParts(timestamp: number): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(timestamp);
  const value = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return { year: value.year!, month: value.month!, day: value.day!, hour: value.hour!, minute: value.minute!, second: value.second! };
}

function startOfLocalDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  const target = Date.UTC(year!, month! - 1, day!);
  let candidate = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = localParts(candidate);
    const representedAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    const correction = target - representedAsUtc;
    if (correction === 0) break;
    candidate += correction;
  }
  return candidate;
}

function nextCalendarDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10);
}

function selectSquad(snapshot: Snapshot, requestedId: unknown): ResearchSquad {
  if (typeof requestedId === 'string') {
    if (requestedId === 'all') return { id: 'all', label: '全部队员', memberIds: [], members: [], matchCount: snapshot.matches.length };
    const selected = snapshot.squads.find((squad) => squad.id === requestedId);
    if (selected) return selected;
  }
  return snapshot.defaultSquad;
}

function inSquad(match: NormalizedMatch, squad: ResearchSquad): boolean {
  return !squad.memberIds.length || match.players.some((player) => squad.memberIds.includes(player.accountId));
}

interface AssistantEvidenceDetail extends ResearchAssistantEvidence {
  matchRef: string;
  occurredAt: string | null;
  detail: string;
  actor: string | null;
  victim: string | null;
  damage: number | null;
}

interface ScopedAssistantContext {
  tools: ResearchAssistantToolset;
  evidenceByAlias: Map<string, ResearchAssistantEvidence>;
  labels: Record<string, string>;
}

function createScopedAssistantContext(input: {
  snapshot: Snapshot;
  matches: readonly NormalizedMatch[];
  squad: ResearchSquad;
  telemetryMatchIds: ReadonlySet<string>;
  requestedMatchLimit?: number;
}): ScopedAssistantContext {
  const { snapshot, matches, squad } = input;
  const memberIds = new Set(squad.memberIds.length
    ? squad.memberIds
    : matches.flatMap((match) => match.players.map((player) => player.accountId)));
  const accountAliases = new Map<string, string>();
  const labels: Record<string, string> = {};
  const nameAliases: Array<{ name: string; alias: string }> = [];
  for (const [index, accountId] of [...memberIds].sort().entries()) {
    const alias = `PLAYER_${String(index + 1).padStart(2, '0')}`;
    accountAliases.set(accountId, alias);
    const player = matches.flatMap((match) => match.players).find((candidate) => candidate.accountId === accountId);
    const name = player ? safePlayerName(player.displayName || player.playerName, index) : `队员 ${index + 1}`;
    labels[alias] = name;
    nameAliases.push({ name, alias });
  }
  const metricAliases = new Map([...memberIds].map((accountId) => [createHash('sha256').update(accountId).digest('hex').slice(0, 12), accountAliases.get(accountId)!]));
  const sortedMatches = [...matches].sort((left, right) => right.timestamp - left.timestamp || right.matchId.localeCompare(left.matchId));
  const matchAliases = new Map(sortedMatches.map((match, index) => [match.matchId, `M${String(index + 1).padStart(4, '0')}`]));
  const matchesByAlias = new Map(sortedMatches.map((match) => [matchAliases.get(match.matchId)!, match]));
  const evidenceByAlias = new Map<string, ResearchAssistantEvidence>();
  const evidenceDetails = new Map<string, AssistantEvidenceDetail>();
  const sourceAliases = new Map<string, string>();
  let nextEvidenceNumber = 1;

  const addEvidence = (inputEvidence: Omit<AssistantEvidenceDetail, 'ref'>): string => {
    const sourceKey = `${inputEvidence.matchId}\u001f${inputEvidence.eventId ?? ''}\u001f${inputEvidence.kind}`;
    const existing = sourceAliases.get(sourceKey);
    if (existing) return existing;
    const ref = `E${String(nextEvidenceNumber++).padStart(4, '0')}`;
    const detail = { ...inputEvidence, ref };
    sourceAliases.set(sourceKey, ref);
    evidenceByAlias.set(ref, { ref, matchId: detail.matchId, eventId: detail.eventId, timeSeconds: detail.timeSeconds, kind: detail.kind });
    evidenceDetails.set(ref, detail);
    return ref;
  };

  const metricReport = (metric: 'damage' | 'kills' | 'knocks' | 'revives' | 'wins' | 'top10' | 'matches' | 'survival_time', groupBy: 'week' | 'map' | 'player' | 'none') => {
    const intent = {
      action: groupBy === 'week' ? 'trend' : groupBy === 'map' ? 'map_breakdown' : groupBy === 'player' ? 'player_comparison' : 'summary',
      metric,
      groupBy: groupBy === 'none' ? null : groupBy,
    } as const;
    const report = buildResearchReport({ matches, squad, intent, telemetryMatchIds: input.telemetryMatchIds });
    const evidenceRefs = report.evidence.map((evidence) => addEvidence({
      matchId: evidence.matchId,
      eventId: null,
      timeSeconds: null,
      kind: `match-store:${evidence.field}`,
      matchRef: matchAliases.get(evidence.matchId) ?? 'M0000',
      occurredAt: evidence.occurredAt,
      detail: `${evidence.mapName} · ${evidence.occurredAt ?? '时间未知'} · ${evidence.value} · ${evidence.description}`,
      actor: null,
      victim: null,
      damage: null,
    }));
    const playerRecentMatches = input.requestedMatchLimit === undefined ? undefined : [...matches]
      .sort((left, right) => right.timestamp - left.timestamp || right.matchId.localeCompare(left.matchId))
      .slice(0, input.requestedMatchLimit)
      .flatMap((match) => {
        const player = match.players.find((candidate) => memberIds.has(candidate.accountId));
        if (!player) return [];
        const playerAlias = accountAliases.get(player.accountId) ?? 'PLAYER_UNKNOWN';
        const ref = addEvidence({
          matchId: match.matchId,
          eventId: null,
          timeSeconds: null,
          kind: 'match-store:player-performance',
          matchRef: matchAliases.get(match.matchId) ?? 'M0000',
          occurredAt: match.createdAt ?? new Date(match.timestamp).toISOString(),
          detail: `${match.mapName} · ${match.createdAt ?? '时间未知'} · ${playerAlias} · ${player.kills} 杀 · ${player.damage} 伤害 · ${player.dbnos} 击倒 · ${player.revives} 救援 · 生存 ${player.survivalTime} 秒 · 排名 ${player.rank ?? '未知'}`,
          actor: playerAlias,
          victim: null,
          damage: player.damage,
        });
        return [{
          matchRef: matchAliases.get(match.matchId) ?? 'M0000',
          date: match.createdAt ?? new Date(match.timestamp).toISOString(),
          map: match.mapName,
          rank: player.rank,
          kills: player.kills,
          damage: player.damage,
          knocks: player.dbnos,
          revives: player.revives,
          survivalSeconds: player.survivalTime,
          evidenceRefs: [ref],
        }];
      });
    const players = report.players.map((player) => ({
      member: metricAliases.get(player.id) ?? 'PLAYER_UNKNOWN',
      matches: player.matches,
      kills: player.kills,
      damage: player.damage,
      knocks: player.knocks,
      revives: player.revives,
      averageDamage: player.averageDamage,
      wins: player.wins,
    }));
    const breakdown = report.breakdown.map((item) => ({
      label: groupBy === 'player' ? nameAliases.find((label) => label.name === item.label)?.alias ?? 'PLAYER_UNKNOWN' : item.label,
      matches: item.matches,
      rankedMatches: item.rankedMatches,
      total: item.total,
      average: item.average,
      wins: item.wins,
      top10: item.top10,
    }));
    return {
      status: report.status,
      metric,
      groupBy,
      selectedMatches: report.scope.selectedMatches,
      requestedMatches: input.requestedMatchLimit ?? report.scope.selectedMatches,
      summary: report.summary,
      telemetry: report.telemetry,
      players,
      breakdown,
      ...(playerRecentMatches ? { playerRecentMatches } : {}),
      evidenceRefs: [...new Set([...(playerRecentMatches?.flatMap((item) => item.evidenceRefs) ?? []), ...evidenceRefs])],
    };
  };

  const playerRef = (accountId: string | null): string | null => accountId ? accountAliases.get(accountId) ?? 'OPPONENT' : null;
  const tools: ResearchAssistantToolset = {
    searchMatches: ({ mapName, limit }) => {
      const filtered = sortedMatches.filter((match) => !mapName || match.mapName.toLocaleLowerCase('zh-CN').includes(mapName.toLocaleLowerCase('zh-CN'))).slice(0, limit);
      const rows = filtered.map((match) => {
        const matchRef = matchAliases.get(match.matchId)!;
        const ref = addEvidence({
          matchId: match.matchId,
          eventId: null,
          timeSeconds: null,
          kind: 'match-store:match-search',
          matchRef,
          occurredAt: match.createdAt ?? new Date(match.timestamp).toISOString(),
          detail: `${match.mapName} · ${match.gameMode} · ${match.players.filter((player) => memberIds.has(player.accountId)).reduce((sum, player) => sum + player.kills, 0)} kills`,
          actor: null,
          victim: null,
          damage: null,
        });
        const squadPlayers = match.players.filter((player) => memberIds.has(player.accountId));
        const placements = [...new Set(squadPlayers.map((player) => player.rank).filter((rank): rank is number => rank !== null && rank > 0))];
        return {
          matchRef,
          date: match.createdAt ?? new Date(match.timestamp).toISOString(),
          mapName: match.mapName || '未知地图',
          mode: match.gameMode,
          placement: placements.length === 1 ? placements[0] : null,
          kills: squadPlayers.reduce((sum, player) => sum + player.kills, 0),
          damage: squadPlayers.reduce((sum, player) => sum + player.damage, 0),
          telemetry: input.telemetryMatchIds.has(match.matchId) ? 'cached' : 'missing',
          evidenceRefs: [ref],
        };
      });
      return { status: rows.length ? 'available' : 'empty', count: rows.length, matches: rows };
    },
    getScopedMetrics: ({ metric, groupBy }) => metricReport(metric, groupBy),
    compareRescues: async ({ limit }) => {
      const telemetryMatches = sortedMatches.filter((match) => snapshot.telemetryUrls.has(match.matchId)).slice(0, 30);
      const revives = new Map<string, { actorId: string; victimId: string; events: Array<{ match: NormalizedMatch; event: BattleTelemetryDocument['events'][number] }> }>();
      let cursor = 0;
      let unavailableMatches = 0;
      await Promise.all(Array.from({ length: Math.min(3, telemetryMatches.length) }, async () => {
        while (cursor < telemetryMatches.length) {
          const match = telemetryMatches[cursor++]!;
          try {
            const telemetry = await loadBattleTelemetry(snapshot, match);
            for (const event of telemetry.events) {
              if (event.type !== 'REVIVE' || event.phase !== 'in_match' || !event.actorId || !event.victimId
                || !memberIds.has(event.actorId) || !memberIds.has(event.victimId)
                || !event.actorTeamId || event.actorTeamId !== event.victimTeamId) continue;
              const key = `${event.actorId}\u001f${event.victimId}`;
              const row = revives.get(key) ?? { actorId: event.actorId, victimId: event.victimId, events: [] };
              row.events.push({ match, event });
              revives.set(key, row);
            }
          } catch {
            unavailableMatches += 1;
          }
        }
      }));
      const pairs = [...revives.values()].sort((left, right) => right.events.length - left.events.length
        || (accountAliases.get(left.actorId) ?? '').localeCompare(accountAliases.get(right.actorId) ?? '')
        || (accountAliases.get(left.victimId) ?? '').localeCompare(accountAliases.get(right.victimId) ?? ''))
        .slice(0, limit).map((row) => {
          const refs = row.events.slice(0, 8).map(({ match, event }) => addEvidence({
            matchId: match.matchId,
            eventId: event.sourceEventId,
            timeSeconds: event.timeSeconds,
            kind: 'directed-revive',
            matchRef: matchAliases.get(match.matchId) ?? 'M0000',
            occurredAt: match.createdAt ?? new Date(match.timestamp).toISOString(),
            detail: `${match.mapName} · ${event.timeSeconds === null ? '时间未知' : `${Math.floor(event.timeSeconds / 60)}:${String(Math.floor(event.timeSeconds % 60)).padStart(2, '0')}`} · ${playerRef(event.actorId)} → ${playerRef(event.victimId)} REVIVE`,
            actor: playerRef(event.actorId),
            victim: playerRef(event.victimId),
            damage: null,
          }));
          return { actor: playerRef(row.actorId), victim: playerRef(row.victimId), count: row.events.length, evidenceRefs: refs };
        });
      return {
        status: pairs.length ? 'available' : 'insufficient_data',
        requestedMatches: telemetryMatches.length,
        analyzedMatches: telemetryMatches.length - unavailableMatches,
        unavailableMatches,
        denominator: 'selected-squad same-team directed REVIVE pairs in available telemetry',
        pairs,
        evidenceRefs: pairs.flatMap((pair) => pair.evidenceRefs),
      };
    },
    getMatchEpisodes: async ({ matchRef }) => {
      const match = matchesByAlias.get(matchRef);
      if (!match) return { status: 'outside_scope', matchRef };
      const telemetry = await loadBattleTelemetry(snapshot, match);
      const trackedPlayerIds = match.players.filter((player) => memberIds.has(player.accountId)).map((player) => player.accountId);
      const reconstruction = reconstructBattleEpisodes({ match, telemetry, trackedPlayerIds });
      const eventsById = new Map(telemetry.events.map((event) => [event.sourceEventId, event]));
      const opponentIds = [...new Set(telemetry.events.flatMap((event) => [event.actorId, event.victimId]).filter((id): id is string => Boolean(id) && !memberIds.has(id!)))].sort();
      const opponentAliases = new Map(opponentIds.map((id, index) => [id, `OPPONENT_${String(index + 1).padStart(2, '0')}`]));
      const safePlayer = (id: string | null) => id ? accountAliases.get(id) ?? opponentAliases.get(id) ?? 'OPPONENT_UNKNOWN' : null;
      const facts = snapshot.features.get(match.matchId)?.facts;
      const featureEvidenceRefs = (evidenceIds: readonly string[], kind: string, actorId: string | null): string[] => {
        const evidenceById = new Map((facts?.evidence ?? []).map((evidence) => [evidence.id, evidence]));
        return [...new Set(evidenceIds.flatMap((id) => {
          const evidence = evidenceById.get(id);
          if (!evidence) return [];
          return [addEvidence({
            matchId: match.matchId,
            eventId: evidence.eventIds[0] ?? null,
            timeSeconds: null,
            kind: `telemetry-feature:${kind}`,
            matchRef,
            occurredAt: match.createdAt ?? new Date(match.timestamp).toISOString(),
            detail: `${match.mapName} · ${evidence.description}`,
            actor: actorId ? safePlayer(actorId) : null,
            victim: null,
            damage: null,
          })];
        }))].slice(0, 8);
      };
      const combatFeatures = facts ? {
        weapons: facts.weapons.filter((item) => memberIds.has(item.playerId)).slice(0, 12).map((item) => ({
          player: safePlayer(item.playerId), weapon: item.weapon, shots: item.shots, hits: item.hits, damage: item.damage,
          knocks: item.knocks, kills: item.kills, evidenceRefs: featureEvidenceRefs(item.evidenceIds, 'weapon', item.playerId),
        })),
        fights: facts.fights.filter((item) => item.participants.some((id) => memberIds.has(id))).slice(0, 12).map((item) => ({
          participants: item.participants.map(safePlayer), result: item.result, damage: item.damage, knocks: item.knocks, kills: item.kills,
          evidenceRefs: featureEvidenceRefs(item.evidenceIds, 'fight', item.participants.find((id) => memberIds.has(id)) ?? null),
        })),
      } : null;
      const trackedBattleRefs = new Set(match.players.filter((player) => memberIds.has(player.accountId)).map((player) => battlePlayerRef(match.matchId, player.accountId)));
      const battleSummaries = reconstruction.battles.filter((battle) => battle.timeline.some((event) => trackedBattleRefs.has(event.actorRef ?? '') || trackedBattleRefs.has(event.victimRef ?? '')))
        .slice(0, 12).map((battle) => {
          const firstKnock = battle.postKnockResponse.firstKnockEventId ? eventsById.get(battle.postKnockResponse.firstKnockEventId) : undefined;
          const response = battle.postKnockResponse.responseEventId ? eventsById.get(battle.postKnockResponse.responseEventId) : undefined;
          const eventRef = (event: typeof firstKnock) => event ? addEvidence({
            matchId: match.matchId,
            eventId: event.sourceEventId,
            timeSeconds: event.timeSeconds,
            kind: `battle:${event.type.toLocaleLowerCase('en-US')}`,
            matchRef,
            occurredAt: match.createdAt ?? new Date(match.timestamp).toISOString(),
            detail: `${match.mapName} · ${event.type} · ${event.timeSeconds === null ? '时间未知' : `${Math.floor(event.timeSeconds / 60)}:${String(Math.floor(event.timeSeconds % 60)).padStart(2, '0')}`} · ${safePlayer(event.actorId) ?? '未知'}${event.victimId ? ` → ${safePlayer(event.victimId)}` : ''}${event.weaponId ? ` · ${event.weaponId}` : ''}${event.type === 'DAMAGE' ? ` · ${event.damage} 伤害` : ''}`,
            actor: safePlayer(event.actorId),
            victim: safePlayer(event.victimId),
            damage: event.type === 'DAMAGE' ? event.damage : null,
          }) : null;
          return {
            startSeconds: battle.startSeconds,
            endSeconds: battle.endSeconds,
            firstKnock: firstKnock ? { actor: safePlayer(firstKnock.actorId), victim: safePlayer(firstKnock.victimId), weapon: firstKnock.weaponId } : null,
            response: { status: battle.postKnockResponse.status, elapsedSeconds: battle.postKnockResponse.elapsedSeconds },
            responseEvent: response ? { type: response.type, actor: safePlayer(response.actorId), victim: safePlayer(response.victimId) } : null,
            evidenceRefs: [...new Set([eventRef(firstKnock), eventRef(response)].filter((ref): ref is string => Boolean(ref)))],
          };
        });
      const episodes = reconstruction.episodes.slice(0, 16).map((episode, episodeIndex) => {
        const sourceEvents = episode.timeline.slice(0, 24).flatMap((timeline) => {
          const event = eventsById.get(timeline.sourceEventId);
          if (!event) return [];
          const ref = addEvidence({
            matchId: match.matchId,
            eventId: event.sourceEventId,
            timeSeconds: event.timeSeconds,
            kind: `battle:${event.type.toLocaleLowerCase('en-US')}`,
            matchRef,
            occurredAt: match.createdAt ?? new Date(match.timestamp).toISOString(),
            detail: `${match.mapName} · ${event.type} · ${event.timeSeconds === null ? '时间未知' : `${Math.floor(event.timeSeconds / 60)}:${String(Math.floor(event.timeSeconds % 60)).padStart(2, '0')}`} · ${safePlayer(event.actorId) ?? '未知'}${event.victimId ? ` → ${safePlayer(event.victimId)}` : ''}`,
            actor: safePlayer(event.actorId),
            victim: safePlayer(event.victimId),
            damage: event.type === 'DAMAGE' ? event.damage : null,
          });
          return [{ ref, type: event.type, timeSeconds: event.timeSeconds, actor: safePlayer(event.actorId), victim: safePlayer(event.victimId), damage: event.type === 'DAMAGE' ? event.damage : null }];
        });
        return {
          episodeRef: `B${String(episodeIndex + 1).padStart(2, '0')}`,
          startSeconds: episode.startSeconds,
          endSeconds: episode.endSeconds,
          durationSeconds: episode.durationSeconds,
          firstKnockRef: episode.firstKnock ? sourceAliases.get(`${match.matchId}\u001f${episode.firstKnock.sourceEventId}\u001fbattle:knock`) ?? null : null,
          participantAliases: episode.participantRefs.map((ref) => {
            const player = match.players.find((candidate) => battlePlayerRef(match.matchId, candidate.accountId) === ref);
            return player ? safePlayer(player.accountId) : 'OPPONENT_UNKNOWN';
          }),
          teams: episode.teams.map((team) => ({ tracked: team.tracked, lastObserved: team.lastObserved })),
          events: sourceEvents,
        };
      });
      const circleTransitions = reconstruction.circleTransitions.slice(0, 24).map((transition, index) => {
        const from = telemetry.events.find((event) => event.sourceEventId === transition.fromSourceEventId);
        const to = telemetry.events.find((event) => event.sourceEventId === transition.toSourceEventId);
        const beforeRef = from ? addEvidence({
          matchId: match.matchId, eventId: from.sourceEventId, timeSeconds: from.timeSeconds, kind: 'circle-transition-before', matchRef,
          occurredAt: match.createdAt ?? new Date(match.timestamp).toISOString(), detail: `${match.mapName} · circle sample before transition`, actor: null, victim: null, damage: null,
        }) : null;
        const afterRef = to ? addEvidence({
          matchId: match.matchId, eventId: to.sourceEventId, timeSeconds: to.timeSeconds, kind: 'circle-transition-after', matchRef,
          occurredAt: match.createdAt ?? new Date(match.timestamp).toISOString(), detail: `${match.mapName} · circle sample after transition`, actor: null, victim: null, damage: null,
        }) : null;
        return { transitionRef: `C${String(index + 1).padStart(2, '0')}`, timeSeconds: transition.timeSeconds, changedZones: transition.changedZones, evidenceRefs: [beforeRef, afterRef].filter((ref): ref is string => Boolean(ref)) };
      });
      return {
        status: reconstruction.status,
        matchRef,
        parserVersion: reconstruction.parserVersion,
        schemaVersion: reconstruction.schemaVersion,
        episodes,
        omittedEpisodeCount: Math.max(0, reconstruction.episodes.length - episodes.length),
        circleTransitions,
        combatFeatures,
        battles: battleSummaries,
        evidenceRefs: [...new Set([
          ...episodes.flatMap((episode) => episode.events.map((event) => event.ref)),
          ...circleTransitions.flatMap((row) => row.evidenceRefs),
          ...(combatFeatures?.weapons.flatMap((item) => item.evidenceRefs) ?? []),
          ...(combatFeatures?.fights.flatMap((item) => item.evidenceRefs) ?? []),
          ...battleSummaries.flatMap((battle) => battle.evidenceRefs),
        ])],
      };
    },
    lookupEvidence: ({ evidenceRefs }) => ({
      items: evidenceRefs.flatMap((ref) => {
        const detail = evidenceDetails.get(ref);
        return detail ? [{ ref, matchRef: detail.matchRef, occurredAt: detail.occurredAt, timeSeconds: detail.timeSeconds, kind: detail.kind, detail: detail.detail, actor: detail.actor, victim: detail.victim, damage: detail.damage }] : [];
      }),
      evidenceRefs: evidenceRefs.filter((ref) => evidenceDetails.has(ref)),
    }),
  };
  return { tools, evidenceByAlias, labels };
}

function deterministicAssistantFallback(question: string, reportAnswer: string, action: string): { answer: string; evidenceRefs: string[]; citeReportEvidence: boolean } {
  const normalized = question.normalize('NFKC').toLocaleLowerCase('zh-CN');
  const thirdCircleWipe = /第三(?:个)?圈|third\s+circle/iu.test(normalized)
    && /团灭|全灭|wipe/iu.test(normalized)
    && /为什么|原因|经常|频繁|why/iu.test(normalized);
  if (thirdCircleWipe) {
    return {
      answer: '当前数据没有可核实的毒圈阶段编号和团灭因果标签，不能确认“第三圈经常团灭”。我先不推断原因。',
      evidenceRefs: [],
      citeReportEvidence: false,
    };
  }
  const directedRevive = /谁救谁|谁.{0,8}(救|扶|拉).{0,8}谁|who.{0,12}revive/iu.test(normalized);
  if (directedRevive) {
    return {
      answer: 'Match Store 只提供队员救援总数，不能确定具体是谁救了谁；当前没有 AI 分析可用的事件级证据，我先不比较救援方向。',
      evidenceRefs: [],
      citeReportEvidence: false,
    };
  }
  if (action === 'unsupported') {
    return {
      answer: '我目前只研究当前选定小队的 PUBG 对局。可以问最近伤害趋势、队员对比、地图表现，或指定一场比赛复盘团战。',
      evidenceRefs: [],
      citeReportEvidence: false,
    };
  }
  if (action === 'unsupported' || action === 'telemetry_coverage') return { answer: reportAnswer, evidenceRefs: [], citeReportEvidence: false };
  return { answer: reportAnswer, evidenceRefs: [], citeReportEvidence: true };
}

function requestedMode(url: URL): ModeGroup | 'all' {
  const value = url.searchParams.get('mode');
  return value === 'all' ? 'all' : MODE_GROUPS.find((group) => group === value) ?? 'squad';
}

/** Only ranked (competitive) matches are analysed; normal, arcade, event and bot-filled casual matches are discarded. */
function isRanked(match: NormalizedMatch): boolean {
  return match.isCompetitive === true;
}

function inMode(match: NormalizedMatch, mode: ModeGroup | 'all'): boolean {
  return isRanked(match) && (mode === 'all' || modeGroupOf(match.gameMode) === mode);
}

/** Match IDs with a verified raw telemetry archive entry; re-read at most every 30 seconds because the hourly prefetch adds entries. */
async function archivedIds(snapshot: Snapshot): Promise<ReadonlySet<string>> {
  const cached = snapshot.archivedIds;
  if (cached && Date.now() - cached.at < 30_000) return cached.ids;
  const ids = new Set(await snapshot.rawTelemetryArchive.listMatchIds());
  snapshot.archivedIds = { at: Date.now(), ids };
  return ids;
}

/** Result of the last archive backup (written by scripts/backup-pubg-telemetry-archive.sh), so a stalled backup shows on the page. */
function readArchiveBackup(): { ok: boolean; result: string; at: string; matches: number } | null {
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

function wantsCompleteTelemetry(url: URL): boolean {
  return url.searchParams.get('complete') === '1';
}

function visibleMatch(match: NormalizedMatch, squad: ResearchSquad, snapshot: Snapshot) {
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

function createSyntheticTeam(match: NormalizedMatch): TeamConfig {
  return {
    id: 'intelligence-local-squad',
    label: 'Local research squad',
    platform: match.shard || 'steam',
    players: match.players.map((player, index) => ({ id: player.accountId, name: safePlayerName(player.displayName || player.playerName, index), aliases: [] })),
  };
}

function scrubText(value: string, match: NormalizedMatch): string {
  let result = redactSensitiveText(value).replace(/\[手机号已隐藏\]/gu, '匿名队员');
  for (const player of match.players) {
    result = result.replaceAll(player.accountId, safePlayerName(player.displayName || player.playerName, 0));
  }
  return result;
}

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

const PUBLIC_CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.map': 'application/json',
};
const CLIENT_DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/client');

function publicHeaders(contentType: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'strict-transport-security': 'max-age=31536000',
    'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    ...extra,
  };
}

function sendPublic(response: ServerResponse, status: number, body: Buffer | string, contentType: string, extra: Record<string, string> = {}): void {
  const payload = typeof body === 'string' ? Buffer.from(body) : body;
  response.writeHead(status, publicHeaders(contentType, { 'content-length': String(payload.length), ...extra }));
  response.end(payload);
}

function sendPublicJson(response: ServerResponse, status: number, value: unknown, extra: Record<string, string> = {}): void {
  sendPublic(response, status, JSON.stringify(value), 'application/json; charset=utf-8', extra);
}

/** Serves the built client for an authenticated public visitor; the Vite dev server is never exposed publicly. */
function servePublicStatic(response: ServerResponse, pathname: string): void {
  const requested = pathname === '/' || pathname === '/index.html' ? '/index.html' : pathname;
  const target = resolve(CLIENT_DIST, `.${requested}`);
  const inside = target === CLIENT_DIST || target.startsWith(`${CLIENT_DIST}/`);
  const isAsset = requested.startsWith('/assets/');
  let file = inside && existsSync(target) && statSync(target).isFile() ? target : null;
  // Unknown paths fall back to the single-page app shell, but a missing asset is a plain 404.
  if (!file && !isAsset && !requested.startsWith('/api/')) file = resolve(CLIENT_DIST, 'index.html');
  if (!file || !existsSync(file)) { sendPublicJson(response, 404, { error: 'not_found' }); return; }
  const extension = file.slice(file.lastIndexOf('.'));
  sendPublic(response, 200, readFileSync(file), PUBLIC_CONTENT_TYPES[extension] ?? 'application/octet-stream');
}

async function readLimitedBody(request: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > limit) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function handlePublic(request: IncomingMessage, response: ServerResponse, snapshot: Snapshot, access: PublicAccess): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const method = request.method ?? 'GET';
  const sameOrigin = request.headers.origin === access.origin;
  if (method === 'POST' && url.pathname === '/api/login') {
    if (!sameOrigin) { sendPublicJson(response, 403, { error: 'same_origin_required' }); return; }
    if (!/^application\/json\b/iu.test(request.headers['content-type'] ?? '')) { sendPublicJson(response, 404, { error: 'not_found' }); return; }
    const body = await readLimitedBody(request, MAX_LOGIN_BYTES);
    if (!body) { sendPublicJson(response, 413, { error: 'login_payload_too_large' }); return; }
    let password: unknown;
    try {
      const payload: unknown = JSON.parse(body.toString('utf8'));
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).join() !== 'password') throw new Error('shape');
      password = (payload as { password: unknown }).password;
    } catch { sendPublicJson(response, 400, { error: 'login_payload_invalid' }); return; }
    const result = await login(access, clientKey(request), password);
    if ('retryAfter' in result) { sendPublicJson(response, 429, { error: 'login_rate_limited' }, { 'retry-after': String(result.retryAfter) }); return; }
    if ('failed' in result) { sendPublicJson(response, 401, { error: 'login_failed' }); return; }
    response.writeHead(204, publicHeaders('application/json', { 'set-cookie': loginCookie(result.token) }));
    response.end();
    return;
  }
  if (!validSession(access, request)) {
    if (method === 'GET' && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/assets/')) { sendPublic(response, 200, LOGIN_PAGE, 'text/html; charset=utf-8'); return; }
    sendPublicJson(response, 401, { error: 'login_required' });
    return;
  }
  if (method !== 'GET' && method !== 'HEAD' && !sameOrigin) { sendPublicJson(response, 403, { error: 'same_origin_required' }); return; }
  if (method === 'POST' && url.pathname === '/api/logout') {
    logout(access, request);
    response.writeHead(204, publicHeaders('application/json', { 'set-cookie': clearedCookie }));
    response.end();
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    await handleApi(request, response, snapshot);
    return;
  }
  if (method !== 'GET' && method !== 'HEAD') { sendPublicJson(response, 405, { error: 'method_not_allowed' }); return; }
  servePublicStatic(response, url.pathname);
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
      void handlePublic(request, response, snapshot, publicAccess!).catch(() => {
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
