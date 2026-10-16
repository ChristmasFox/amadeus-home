import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { homedir, networkInterfaces } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { createServer as createViteServer } from 'vite';
import type { LanguageModel } from 'ai';
import {
  analyzeMatchReview,
  DEFAULT_TIMEZONE,
  extractMatchReviewFacts,
  localDateLabel,
  PubgApiTelemetryDownloader,
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
  ExperimentRunStore,
  replayTacticalBenchmark,
  analyzeTacticalMatch,
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
  type ResearchAssistantToolset,
  type TacticalMatchAnalysis,
  type EvaluationReviewLabel,
} from '@agent/pubg-intelligence';
import { createResearchModel } from './model.js';

const PARSER_VERSION = 'telemetry-parser-6';
const FEATURE_VERSION = 'review-features-6';
const DEFAULT_PORT = 4179;
const DEFAULT_HOST = '127.0.0.1';
const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_MATCHES_PER_PAGE = 100;
const MAX_TACTICAL_MATCHES = 30;

interface MatchReviewFeature {
  facts: MatchReviewFacts;
  createdAt: string;
}
interface Snapshot {
  matches: NormalizedMatch[];
  byId: Map<string, NormalizedMatch>;
  squads: ResearchSquad[];
  defaultSquad: ResearchSquad;
  features: Map<string, MatchReviewFeature>;
  telemetryUrls: Map<string, string>;
  battleTelemetry: Map<string, Promise<BattleTelemetryDocument>>;
  experimentStore: ExperimentRunStore;
  planner: NaturalLanguageResearchPlanner;
  researchModel?: Exclude<LanguageModel, string>;
  modelEnabled: boolean;
}

function safePlayerName(value: string, index: number): string {
  const normalized = redactSensitiveText(value.trim()).replace(/\[手机号已隐藏\]/gu, '匿名队员');
  return normalized || `队员 ${index + 1}`;
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
  return {
    matches,
    byId: new Map(matches.map((match) => [match.matchId, match])),
    squads,
    defaultSquad: selectedSquad,
    features,
    telemetryUrls,
    battleTelemetry: new Map(),
    experimentStore: new ExperimentRunStore(experimentPath),
    planner: new NaturalLanguageResearchPlanner(model),
    ...(model ? { researchModel: model } : {}),
    modelEnabled: Boolean(model),
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
  const telemetryUrl = snapshot.telemetryUrls.get(match.matchId);
  if (!telemetryUrl) throw new Error('telemetry_asset_missing');
  const request = new PubgApiTelemetryDownloader({
    apiKey: '',
    timeoutMs: 30_000,
    fetchImpl: (input, init) => fetch(input, { ...init, redirect: 'error' }),
  }).download({ ...match, telemetryUrl }).then((payload) => normalizeBattleTelemetry(payload, match));
  snapshot.battleTelemetry.set(match.matchId, request);
  try {
    return await request;
  } catch (error) {
    snapshot.battleTelemetry.delete(match.matchId);
    throw error;
  }
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
      summary: report.summary,
      telemetry: report.telemetry,
      players,
      breakdown,
      evidenceRefs,
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
        evidenceRefs: [...new Set([...episodes.flatMap((episode) => episode.events.map((event) => event.ref)), ...circleTransitions.flatMap((row) => row.evidenceRefs)])],
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
  if (action === 'unsupported' || action === 'telemetry_coverage') return { answer: reportAnswer, evidenceRefs: [], citeReportEvidence: false };
  return { answer: reportAnswer, evidenceRefs: [], citeReportEvidence: true };
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
  if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
    const dates = snapshot.matches.map((match) => localDateLabel(match.timestamp, DEFAULT_TIMEZONE)).sort();
    send(response, 200, {
      matchCount: snapshot.matches.length,
      telemetryCachedMatchCount: snapshot.features.size,
      parserVersion: PARSER_VERSION,
      featureVersion: FEATURE_VERSION,
      dateFrom: dates[0] ?? null,
      dateTo: dates.at(-1) ?? null,
      modelEnabled: snapshot.modelEnabled,
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
    const search = (url.searchParams.get('search') ?? '').trim().toLocaleLowerCase('zh-CN').slice(0, 100);
    const offset = Math.max(0, Math.min(10000, Number(url.searchParams.get('offset') ?? 0) || 0));
    const filtered = snapshot.matches.filter((match) => {
      const time = match.timestamp;
      if (bounds.fromMs !== undefined && time < bounds.fromMs) return false;
      if (bounds.toMs !== undefined && time >= bounds.toMs) return false;
      if (!inSquad(match, squad)) return false;
      return !search || match.mapName.toLocaleLowerCase('zh-CN').includes(search) || match.gameMode.toLocaleLowerCase('zh-CN').includes(search);
    }).sort((a, b) => b.timestamp - a.timestamp || b.matchId.localeCompare(a.matchId));
    send(response, 200, {
      total: filtered.length,
      offset,
      limit: MAX_MATCHES_PER_PAGE,
      matches: filtered.slice(offset, offset + MAX_MATCHES_PER_PAGE).map((match) => visibleMatch(match, squad, snapshot)),
    });
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
      ruleVersion: 'tactical-social-rules-v1',
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
      .map(([accountId, name], index) => ({ name, alias: `PLAYER_${String(index + 1).padStart(2, '0')}` }));
    const privateIdentifiers = [
      ...snapshot.matches.map((match) => ({ value: match.matchId, alias: '[比赛编号已隐藏]' })),
      ...snapshot.matches.flatMap((match) => match.players.map((player) => ({ value: player.accountId, alias: '[队员编号已隐藏]' }))),
    ];
    const selectedPlayerNames = new Set(playerAliases.map((item) => item.name.toLocaleLowerCase('zh-CN')));
    const outOfScopePlayerAliases = snapshot.matches.flatMap((match) => match.players)
      .map((player) => player.displayName || player.playerName)
      .filter((name) => name.trim() && !selectedPlayerNames.has(name.toLocaleLowerCase('zh-CN')))
      .map((name) => ({ name, alias: '[范围外队员已隐藏]' }));
    const promptPlayerAliases = [...playerAliases, ...outOfScopePlayerAliases];
    const modelQuestion = anonymizeResearchText(question, promptPlayerAliases, privateIdentifiers);
    const rawHistory = Array.isArray(body.history) ? body.history : [];
    const priorTurns: Array<{ role: 'user' | 'assistant'; text: string }> = rawHistory.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const row = item as Record<string, unknown>;
      if ((row.role !== 'user' && row.role !== 'assistant') || typeof row.text !== 'string') return [];
      return [{ role: row.role as 'user' | 'assistant', text: anonymizeResearchText(redactSensitiveText(row.text), promptPlayerAliases, privateIdentifiers) }];
    }).slice(-6);
    const plan = await snapshot.planner.plan(modelQuestion);
    const report = buildResearchReport({
      matches: scopedMatches,
      squad,
      intent: plan.intent,
      telemetryMatchIds: new Set(snapshot.features.keys()),
    });
    const assistantContext = createScopedAssistantContext({
      snapshot,
      matches: scopedMatches,
      squad,
      telemetryMatchIds: new Set(snapshot.features.keys()),
    });
    const fallbackMetrics = await assistantContext.tools.getScopedMetrics({
      metric: plan.intent.metric ?? 'damage',
      groupBy: plan.intent.groupBy ?? 'none',
    }) as { evidenceRefs?: string[] };
    const deterministicFallback = deterministicAssistantFallback(question, report.answer, plan.intent.action);
    const assistant = await runResearchAssistant({
      ...(snapshot.researchModel ? { model: snapshot.researchModel } : {}),
      message: modelQuestion,
      priorTurns,
      template,
      scopeDescription: `${from ?? 'start'} through ${to ?? 'latest'}, selected squad, ${scopedMatches.length} eligible matches`,
      fallbackAnswer: deterministicFallback.answer,
      fallbackEvidenceRefs: deterministicFallback.citeReportEvidence ? fallbackMetrics.evidenceRefs ?? [] : deterministicFallback.evidenceRefs,
      tools: assistantContext.tools,
      evidenceByAlias: assistantContext.evidenceByAlias,
      signal: AbortSignal.timeout(45_000),
    });
    const runId = snapshot.experimentStore.save({ question, intent: plan.intent, source: plan.source, report, assistant });
    send(response, 200, {
      runId,
      intent: plan.intent,
      plannerSource: plan.source,
      report,
      assistant: { ...assistant, labels: assistantContext.labels },
    });
    return;
  }
  send(response, 404, { error: 'not_found' });
}

export async function startServer(options: { researchModel?: Exclude<LanguageModel, string> } = {}): Promise<{ close: () => Promise<void>; url: string }> {
  const snapshot = await openSnapshot(options.researchModel);
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const host = process.env.HOST?.trim() || DEFAULT_HOST;
  if (!isLoopbackHost(host) && !isPrivateIPv4Host(host)) throw new Error('HOST_MUST_BE_LOOPBACK_OR_PRIVATE_IPV4');
  const allowedNetwork = bindNetwork(host);
  let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
  const server = createServer((request, response) => {
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
  vite = await createViteServer({
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
    optimizeDeps: {
      noDiscovery: true,
      include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    },
  });
  await new Promise<void>((resolveStart, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolveStart());
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return {
    url: `http://${host}:${actualPort}`,
    close: async () => {
      await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
      await vite?.close();
      snapshot.experimentStore.close();
    },
  };
}
