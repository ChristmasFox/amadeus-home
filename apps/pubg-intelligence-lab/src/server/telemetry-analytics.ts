import { type MatchTelemetryAnalysis } from './match-analysis.js';
import { analyzeMatchTelemetry } from './match-views.js';
import { inMode, inSquad, type Snapshot } from './snapshot.js';
import {
  buildCombatInsights,
  buildFieldInsights,
  buildLandingPreference,
  buildLongRunCombat,
  buildSquadStyle,
  FIELD_INSIGHT_MAX,
  type ModeGroup,
  rankInsights,
  type ResearchSquad,
  summarizeCombatQuality,
  summarizeDeaths,
  summarizeDistance,
  summarizeDowns,
  summarizeFights,
  summarizeLobby,
  summarizeRoles,
  summarizeRotation,
  summarizeStreaks,
  summarizeZone,
} from '@agent/pubg-intelligence';

export interface TelemetryAnalyticsQuery {
  squad: ResearchSquad;
  mode: ModeGroup | 'all';
  fromMs: number | undefined;
  toMs: number | undefined;
  limit: number;
  archived?: ReadonlySet<string> | null;
}

export async function computeTelemetryAnalytics(snapshot: Snapshot, query: TelemetryAnalyticsQuery) {
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
  const downs = summarizeDowns(analyzed.map((item) => ({ downs: item.result.downs })), names);
  const rotation = summarizeRotation(analyzed.map((item) => ({ rotation: item.result.rotation })));
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
    downs,
    rotation,
    longRun,
    highlights: rankInsights([...buildCombatInsights({ combat, deaths, landing }), ...buildFieldInsights({ fights, distance, zone, landing, roles })], FIELD_INSIGHT_MAX),
  };
}