import type { NormalizedMatch } from '@agent/pubg-domain';
import {
  analyzeCombatQuality,
  analyzeDeaths,
  analyzeFieldTelemetry,
  analyzeFights,
  analyzeLobby,
  analyzeStreaks,
  analyzeStyleTelemetry,
  emptyFights,
  extractLandings,
  landingPlayerRef,
  normalizeBattleTelemetry,
  reconstructBattleEpisodes,
  type CombatQualityMatchStats,
  type DeathRecord,
  type FieldMatchStats,
  type FightMatchStats,
  type LandingSample,
  type LobbyMatchStats,
  type PlayerStyleMatch,
  type StreakMatchStats,
} from '@agent/pubg-intelligence';

export interface MatchTelemetryAnalysis {
  quality: CombatQualityMatchStats;
  deaths: DeathRecord[];
  landings: LandingSample[];
  field: FieldMatchStats;
  fights: FightMatchStats;
  style: Record<string, PlayerStyleMatch>;
  lobby: Record<string, LobbyMatchStats>;
  streaks: StreakMatchStats;
}

/** Every per-match derivation for a squad from one raw payload. Pure and CPU-bound, so it runs on a worker thread. */
export function computeMatchAnalysis(payload: Uint8Array, match: NormalizedMatch, memberIds: readonly string[]): MatchTelemetryAnalysis {
  const members = new Set(memberIds);
  const memberRefs = new Set(memberIds.map(landingPlayerRef));
  const telemetry = normalizeBattleTelemetry(payload, match);
  const landings = extractLandings(payload, match, new Set(match.players.map((player) => player.accountId)));
  const trackedPlayerIds = match.players.filter((player) => members.has(player.accountId)).map((player) => player.accountId);
  const reconstruction = reconstructBattleEpisodes({ match, telemetry, trackedPlayerIds });
  const fightStats = analyzeFights(reconstruction, match.matchId, trackedPlayerIds);
  const rawStyle = analyzeStyleTelemetry(payload, new Set(trackedPlayerIds));
  const style: Record<string, PlayerStyleMatch> = {};
  for (const player of match.players) {
    const raw = rawStyle[player.accountId];
    if (!raw || !members.has(player.accountId)) continue;
    style[player.accountId] = { ...raw, minutes: Math.max(0, player.survivalTime) / 60, fights: fightStats.roles[player.accountId] ?? emptyFights() };
  }
  return {
    quality: analyzeCombatQuality(reconstruction),
    deaths: analyzeDeaths(telemetry, trackedPlayerIds),
    landings: landings.filter((landing) => memberRefs.has(landing.playerRef)),
    field: analyzeFieldTelemetry(payload, new Set(trackedPlayerIds)),
    fights: fightStats,
    style,
    lobby: analyzeLobby(payload, new Set(trackedPlayerIds)),
    streaks: analyzeStreaks(payload, new Set(trackedPlayerIds)),
  };
}
