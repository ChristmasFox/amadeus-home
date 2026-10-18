import { type MatchTelemetryAnalysis } from './match-analysis.js';
import {
  archivedIds,
  inMode,
  safePlayerName,
  type Snapshot,
} from './snapshot.js';
import { type NormalizedMatch } from '@agent/pubg-domain';
import {
  battlePlayerRef,
  battleTeamRef,
  type BattleTelemetryDocument,
  buildMatchRelative,
  DOWN_CAUSES,
  extractLandings,
  mapDisplayName,
  mapSizeKm,
  modeGroupOf,
  normalizeBattleTelemetry,
  type RelativeValues,
  type ResearchSquad,
} from '@agent/pubg-intelligence';

export async function loadBattleTelemetry(snapshot: Snapshot, match: NormalizedMatch): Promise<BattleTelemetryDocument> {
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
export function analyzeMatchTelemetry(snapshot: Snapshot, squad: ResearchSquad, match: NormalizedMatch): Promise<MatchTelemetryAnalysis | 'missing' | 'failed'> {
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
export const MATCH_RELATIVE_HISTORY_LIMIT = 150;

export function storeValues(match: NormalizedMatch, accountId: string): RelativeValues | null {
  const player = match.players.find((item) => item.accountId === accountId);
  if (!player) return null;
  return { damage: player.damage, kills: player.kills, knocks: player.dbnos, assists: player.assists, survival: Math.max(0, player.survivalTime) / 60 };
}

export function telemetryValues(analysis: MatchTelemetryAnalysis, accountId: string): RelativeValues {
  const style = analysis.style[accountId];
  const streak = analysis.streaks.players[accountId];
  const shots = style ? style.shots : 0;
  const hits = style ? style.hits : 0;
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
export async function computeMatchStory(snapshot: Snapshot, squad: ResearchSquad, match: NormalizedMatch) {
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
    downCauses: DOWN_CAUSES,
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
          const shots = style.shots;
          const hits = style.hits;
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

export async function computeMatchRelative(snapshot: Snapshot, squad: ResearchSquad, match: NormalizedMatch) {
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

export function battleLabels(
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