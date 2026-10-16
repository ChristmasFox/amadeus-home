import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { createServer as createViteServer } from 'vite';
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
  buildResearchReport,
  buildResearchSquads,
  ExperimentRunStore,
  NaturalLanguageResearchPlanner,
  redactSensitiveText,
  type ResearchSquad,
} from '@agent/pubg-intelligence';
import { createResearchModel } from './model.js';

const PARSER_VERSION = 'telemetry-parser-6';
const FEATURE_VERSION = 'review-features-6';
const DEFAULT_PORT = 4179;
const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_MATCHES_PER_PAGE = 100;

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
  experimentStore: ExperimentRunStore;
  planner: NaturalLanguageResearchPlanner;
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

async function openSnapshot(): Promise<Snapshot> {
  const configuredDatabase = process.env.PUBG_INTELLIGENCE_DB?.trim();
  if (!configuredDatabase) throw new Error('PUBG_INTELLIGENCE_DB_REQUIRED');
  const sourcePath = realpathSync(configuredDatabase);
  if (!statSync(sourcePath).isFile()) throw new Error('PUBG_INTELLIGENCE_DB_INVALID');
  const experimentPath = localDataPath();
  mkdirSync(dirname(experimentPath), { recursive: true, mode: 0o700 });
  ensureSeparateExperimentPath(sourcePath, experimentPath);

  const repository = new SqlitePubgRepository(sourcePath, { readOnly: true });
  let matches: NormalizedMatch[];
  const features = new Map<string, MatchReviewFeature>();
  try {
    matches = repository.listMatches({ limit: 10000 }).map(sanitizeMatch);
    for (const match of matches) {
      const record = await repository.get({ matchId: match.matchId, parserVersion: PARSER_VERSION, featureVersion: FEATURE_VERSION });
      if (record) features.set(match.matchId, { facts: record.facts, createdAt: record.createdAt });
    }
  } finally {
    repository.close();
  }

  const squads = buildResearchSquads(matches);
  const selectedSquad = defaultSquad(matches, squads);
  const model = createResearchModel();
  return {
    matches,
    byId: new Map(matches.map((match) => [match.matchId, match])),
    squads,
    defaultSquad: selectedSquad,
    features,
    experimentStore: new ExperimentRunStore(experimentPath),
    planner: new NaturalLanguageResearchPlanner(model),
    modelEnabled: Boolean(model),
  };
}

function isLocalRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
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
    const plan = await snapshot.planner.plan(question);
    const report = buildResearchReport({
      matches: snapshot.matches,
      squad,
      intent: plan.intent,
      telemetryMatchIds: new Set(snapshot.features.keys()),
      ...(bounds.fromMs === undefined ? {} : { fromMs: bounds.fromMs }),
      ...(bounds.toMs === undefined ? {} : { toMs: bounds.toMs }),
      ...(typeof body.matchId === 'string' && snapshot.byId.has(body.matchId) ? { selectedMatchId: body.matchId } : {}),
    });
    const runId = snapshot.experimentStore.save({ question, intent: plan.intent, source: plan.source, report });
    send(response, 200, { runId, intent: plan.intent, plannerSource: plan.source, report });
    return;
  }
  send(response, 404, { error: 'not_found' });
}

export async function startServer(): Promise<{ close: () => Promise<void>; url: string }> {
  const snapshot = await openSnapshot();
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const server = createServer((request, response) => {
    if ((request.url ?? '').startsWith('/api/')) {
      if (!isLocalRequest(request)) { send(response, 403, { error: 'local_access_only' }); return; }
      void handleApi(request, response, snapshot).catch(() => {
        if (!response.headersSent) send(response, 500, { error: 'research_request_failed' });
      });
      return;
    }
    vite.middlewares(request, response, () => {
      if (!response.headersSent) { response.writeHead(404); response.end('Not found'); }
    });
  });
  await new Promise<void>((resolveStart, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolveStart());
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return {
    url: `http://127.0.0.1:${actualPort}`,
    close: async () => {
      await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
      await vite.close();
      snapshot.experimentStore.close();
    },
  };
}
