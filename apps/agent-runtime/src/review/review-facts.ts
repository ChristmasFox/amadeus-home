import type { TeamConfig } from '../config/team.js';
import type { NormalizedMatch } from '../data/model.js';
import { detectFights } from './fight-detector.js';
import { dedupeRelevantCombatEvents, isOpponentOffensiveEvent, isOpponentReviveEvent, isTrackedOffensiveEvent, isTrackedReviveEvent } from './combat-scope.js';
import { validateFightIntegrity } from './fight-integrity-validator.js';
import { extractHeavyWeaponStats, extractWeaponStats } from './heavy-weapon-intelligence.js';
import { detectKeyOperations } from './key-operation-detector.js';
import { detectSpecialEvents } from './special-events.js';
import { extractVehicleStats } from './vehicle-intelligence.js';
import { extractFlashStats, extractTeamDamageFacts, extractTeamVehicleEvents } from './team-damage.js';
import type { MatchReviewFacts, ReviewEvidence, ReviewPlayerFacts, ReviewSquadSummary } from './types.js';
import { normalizeTelemetryEvents, type NormalizedTelemetryEvent } from './telemetry-events.js';

function canonicalId(value: string | null, team: TeamConfig): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  const player = team.players.find((item) => item.id.toLowerCase() === normalized
    || item.name.toLowerCase() === normalized
    || item.aliases.some((alias) => alias.toLowerCase() === normalized));
  return player?.id ?? value;
}

function canonicalEvents(events: NormalizedTelemetryEvent[], team: TeamConfig): NormalizedTelemetryEvent[] {
  return events.map((event) => ({
    ...event,
    actorId: canonicalId(event.actorId, team),
    victimId: canonicalId(event.victimId, team),
  }));
}

function matchSummary(match: NormalizedMatch, ordinal: number) {
  return {
    matchId: match.matchId,
    ordinal,
    startedAt: match.createdAt,
    mapName: match.mapName,
    gameMode: match.gameMode,
    duration: match.duration,
    placement: match.players.map((player) => player.rank).filter((rank): rank is number => rank !== null).sort((left, right) => left - right)[0] ?? null,
    patchVersion: match.patchVersion,
  };
}

function squadSummary(match: NormalizedMatch, team: TeamConfig): ReviewSquadSummary {
  const ids = new Set(team.players.map((player) => player.id));
  const players = match.players.filter((player) => ids.has(player.accountId));
  return {
    playerIds: team.players.map((player) => player.id),
    kills: players.reduce((sum, player) => sum + player.kills, 0),
    assists: players.reduce((sum, player) => sum + player.assists, 0),
    damage: players.reduce((sum, player) => sum + player.damage, 0),
    knocks: players.reduce((sum, player) => sum + player.dbnos, 0),
    revives: players.reduce((sum, player) => sum + player.revives, 0),
    placement: players.map((player) => player.rank).filter((rank): rank is number => rank !== null).sort((left, right) => left - right)[0] ?? null,
  };
}

function eventDescription(event: NormalizedTelemetryEvent): string {
  if (event.type === 'DAMAGE') return `造成${Math.round(event.damage)}伤害`;
  if (event.type === 'KNOCK') return '造成一次倒地';
  if (event.type === 'KILL') return '完成一次击杀';
  if (event.type === 'REVIVE') return '完成一次救援';
  if (event.type === 'VEHICLE_DESTROY') return '摧毁载具';
  return event.rawType || event.type;
}

function factsForPlayer(match: NormalizedMatch, team: TeamConfig): ReviewPlayerFacts[] {
  const byId = new Map(match.players.map((player) => [player.accountId, player]));
  return team.players.map((configured) => {
    const player = byId.get(configured.id);
    return {
      playerId: configured.id,
      playerName: configured.name,
      rank: player?.rank ?? null,
      kills: player?.kills ?? 0,
      assists: player?.assists ?? 0,
      damage: player?.damage ?? 0,
      dbnos: player?.dbnos ?? 0,
      revives: player?.revives ?? 0,
      roleConfidence: 'none',
      keyOperations: [],
      heavyWeapons: [],
    };
  });
}

function playerSummaryEvidence(match: NormalizedMatch, player: ReviewPlayerFacts): ReviewEvidence {
  return {
    id: `player-summary-${match.matchId}-${player.playerId}`,
    kind: 'FACT',
    source: 'match_store',
    eventIds: [],
    description: `${player.playerName} 的 Match Store 基础战绩：${player.kills}杀、${player.assists}助、${Math.round(player.damage)}伤害、${player.dbnos}倒地、${player.revives}救援`,
  };
}

function evidenceForEvents(events: NormalizedTelemetryEvent[]): ReviewEvidence[] {
  return events.map((event) => ({
    id: `evidence-${event.id}`,
    kind: 'FACT',
    source: 'telemetry',
    eventIds: [event.id],
    description: eventDescription(event),
  }));
}

export function extractMatchReviewFacts(
  match: NormalizedMatch,
  rawTelemetry: unknown,
  team: TeamConfig,
  ordinal = 1,
): MatchReviewFacts {
  const events = canonicalEvents(normalizeTelemetryEvents(rawTelemetry, match), team);
  const teamIds = new Set(team.players.map((player) => player.id));
  const fights = detectFights(events, teamIds);
  const vehicles = extractVehicleStats(events, teamIds);
  const heavyWeapons = extractHeavyWeaponStats(events, teamIds);
  const weapons = extractWeaponStats(events, teamIds);
  const teamDamage = extractTeamDamageFacts(events, teamIds);
  const teamVehicleEvents = extractTeamVehicleEvents(events, teamIds);
  const flash = extractFlashStats(events, teamIds);
  const players = factsForPlayer(match, team);
  const squad = squadSummary(match, team);
  const combatEvents = dedupeRelevantCombatEvents(events, teamIds);
  const teamCombatEvents = combatEvents.filter((event) => isTrackedOffensiveEvent(event, teamIds) || isTrackedReviveEvent(event, teamIds));
  const opponentCombatEvents = combatEvents.filter((event) => isOpponentOffensiveEvent(event, teamIds) || isOpponentReviveEvent(event, teamIds));
  const combat = {
    eventCount: combatEvents.length,
    damage: teamCombatEvents.filter((event) => event.type === 'DAMAGE').reduce((sum, event) => sum + event.damage, 0),
    knocks: teamCombatEvents.filter((event) => event.type === 'KNOCK').length,
    kills: teamCombatEvents.filter((event) => event.type === 'KILL').length,
    revives: teamCombatEvents.filter((event) => event.type === 'REVIVE').length,
    opponentDamage: opponentCombatEvents.filter((event) => event.type === 'DAMAGE').reduce((sum, event) => sum + event.damage, 0),
    opponentKnocks: opponentCombatEvents.filter((event) => event.type === 'KNOCK').length,
    opponentKills: opponentCombatEvents.filter((event) => event.type === 'KILL').length,
    opponentRevives: opponentCombatEvents.filter((event) => event.type === 'REVIVE').length,
    events,
  };
  const facts: MatchReviewFacts = {
    schemaVersion: 1,
    match: matchSummary(match, ordinal),
    squad,
    players,
    combat,
    fights,
    fightIntegrity: validateFightIntegrity({
      fights,
      events,
      teamIds,
      players,
      matchTeamKills: squad.kills,
      matchTeamDamage: squad.damage,
      matchTeamDBNOs: squad.knocks,
    }),
    weapons,
    vehicles,
    heavyWeapons,
    specialEvents: [],
    teamDamage,
    teamVehicleEvents,
    flash,
    evidence: [
      {
        id: `match-summary-${match.matchId}`,
        kind: 'FACT',
        source: 'match_store',
        eventIds: [],
        description: 'Match Store 基础战绩',
      },
      ...players.map((player) => playerSummaryEvidence(match, player)),
      ...evidenceForEvents(events),
    ],
  };
  const operations = detectKeyOperations(facts);
  for (const player of facts.players) {
    player.keyOperations = operations.filter((operation) => operation.playerId === player.playerId);
    const playerVehicle = vehicles.find((vehicle) => vehicle.playerId === player.playerId);
    if (playerVehicle) player.vehicle = playerVehicle;
    player.heavyWeapons = heavyWeapons.filter((weapon) => weapon.playerId === player.playerId);
    const roleOperation = player.keyOperations.find((operation) => ['ENTRY', 'MULTI_KNOCK', 'CLUTCH'].includes(operation.type))
      ?? player.keyOperations.find((operation) => ['DAMAGE', 'TRADE', 'SUPPORT', 'REVIVE'].includes(operation.type))
      ?? player.keyOperations.find((operation) => ['HEAVY_WEAPON', 'VEHICLE'].includes(operation.type));
    if (roleOperation) {
      player.matchRole = ['ENTRY', 'MULTI_KNOCK', 'CLUTCH'].includes(roleOperation.type)
        ? '主攻/终结'
        : ['REVIVE', 'SUPPORT'].includes(roleOperation.type)
          ? '支援/救援'
          : roleOperation.type === 'HEAVY_WEAPON'
            ? '重火力'
            : roleOperation.type === 'VEHICLE'
              ? '载具作战'
              : '火力输出';
      player.roleConfidence = ['ENTRY', 'MULTI_KNOCK', 'CLUTCH'].includes(roleOperation.type) ? 'high' : 'medium';
    }
  }
  facts.specialEvents = detectSpecialEvents(events, fights, heavyWeapons, vehicles, teamIds, facts.fightIntegrity.pass);
  facts.evidence.push(
    ...fights.map((fight) => ({ id: `evidence-${fight.id}`, kind: 'DERIVED' as const, source: 'telemetry' as const, eventIds: fight.evidenceIds, description: '聚合团战' })),
    ...operations.map((operation) => ({ id: `evidence-${operation.id}`, kind: 'DERIVED' as const, source: 'telemetry' as const, eventIds: operation.evidenceIds, description: operation.impact })),
    ...facts.specialEvents.map((event) => ({ id: `evidence-${event.id}`, kind: 'DERIVED' as const, source: 'telemetry' as const, eventIds: event.evidenceIds, description: event.impact })),
    ...teamDamage.map((fact) => ({
      id: `evidence-${fact.id}`,
      kind: 'DERIVED' as const,
      source: 'telemetry' as const,
      eventIds: fact.evidenceIds,
      description: `${fact.actorPlayerId} 对 ${fact.victimPlayerId} 造成${Math.round(fact.damage)}点队友伤害（${fact.source}）`,
    })),
    ...teamVehicleEvents.map((fact) => ({
      id: `evidence-${fact.id}`,
      kind: 'DERIVED' as const,
      source: 'telemetry' as const,
      eventIds: fact.evidenceIds,
      description: `${fact.actorPlayerId} 对 ${fact.victimPlayerId} 造成车辆${fact.type}事实`,
    })),
    ...flash.map((fact) => ({
      id: `evidence-flash-${fact.playerId}`,
      kind: 'DERIVED' as const,
      source: 'telemetry' as const,
      eventIds: fact.evidenceIds,
      description: `${fact.playerId} 使用闪光弹${fact.uses}次`,
    })),
  );
  return facts;
}

export function emptyMatchReviewFacts(match: NormalizedMatch, team: TeamConfig, ordinal = 1): MatchReviewFacts {
  return extractMatchReviewFacts(match, [], team, ordinal);
}
