import type { FunConfidence, FunEvent, MatchReviewFacts, TeamDamageFact, TeamVehicleEvent } from './types.js';
import { isPunchWeapon } from './telemetry-events.js';
import { generateBaseFunEvents, resolveFunEvidenceIds } from './fun-event-generator.js';

export interface FunCombinationRule {
  id: string;
  conditions: string[];
  priority: number;
  funScore: number;
  confidenceRequirement: FunConfidence;
  dedupGroup: string;
  evaluate(facts: MatchReviewFacts, baseEvents: FunEvent[]): FunEvent | null;
}

function playerName(facts: MatchReviewFacts, playerId: string): string {
  return facts.players.find((player) => player.playerId === playerId)?.playerName ?? playerId;
}

function playerSummaryFact(facts: MatchReviewFacts, playerId: string): string {
  return `player-summary-${facts.match.matchId}-${playerId}`;
}

function punchFacts(facts: MatchReviewFacts, playerId: string): TeamDamageFact[] {
  return (facts.teamDamage ?? []).filter((fact) => fact.actorPlayerId === playerId
    && fact.source === 'MELEE'
    && isPunchWeapon(fact.weapon ?? null, fact.damageTypeCategory ?? null));
}

function confirmedVehicleFacts(facts: MatchReviewFacts, playerId: string): TeamVehicleEvent[] {
  return (facts.teamVehicleEvents ?? []).filter((item) => item.actorPlayerId === playerId && item.driverConfirmed);
}

function baseEventsFor(baseEvents: FunEvent[], types: string[], actorPlayerId?: string): FunEvent[] {
  return baseEvents.filter((event) => types.includes(event.type)
    && (actorPlayerId === undefined || event.actorPlayerId === actorPlayerId));
}

function makeCombo(
  facts: MatchReviewFacts,
  rule: FunCombinationRule,
  input: {
    id: string;
    actorPlayerId?: string;
    targetPlayerIds: string[];
    factIds: string[];
    evidenceIds: string[];
    title: string;
    text: string;
    facts: Record<string, number | string | boolean | null>;
    tags: string[];
    suppresses: string[];
  },
): FunEvent | null {
  const factIds = [...new Set(input.factIds.filter(Boolean))];
  const evidenceIds = resolveFunEvidenceIds(facts, input.evidenceIds);
  if (!factIds.length || !evidenceIds.length) return null;
  return {
    id: input.id,
    type: `COMBO_${rule.id.toUpperCase()}`,
    ...(input.actorPlayerId ? { actorPlayerId: input.actorPlayerId } : {}),
    targetPlayerIds: [...new Set(input.targetPlayerIds)],
    factIds,
    evidenceIds,
    confidence: rule.confidenceRequirement,
    funScore: Math.max(0, Math.min(100, rule.funScore)),
    category: 'combination',
    title: input.title,
    text: input.text,
    facts: input.facts,
    tags: [...new Set(['combo', ...input.tags])],
    dedupGroup: rule.dedupGroup,
    suppresses: [...new Set(input.suppresses)],
  };
}

function firstThenFight(): FunCombinationRule {
  return {
    id: 'first_punch_then_fight',
    conditions: ['same actor has >= 3 confirmed punch hits', 'player damage <= 100'],
    priority: 100,
    funScore: 85,
    confidenceRequirement: 'DERIVED',
    dedupGroup: 'combo-teammate',
    evaluate(facts) {
      const candidates = facts.players
        .map((player) => ({ player, punches: punchFacts(facts, player.playerId) }))
        .filter((item) => item.punches.reduce((sum, fact) => sum + fact.hitCount, 0) >= 3 && item.player.damage <= 100)
        .sort((left, right) => right.punches.reduce((sum, fact) => sum + fact.hitCount, 0) - left.punches.reduce((sum, fact) => sum + fact.hitCount, 0) || left.player.playerId.localeCompare(right.player.playerId));
      const selected = candidates[0];
      if (!selected) return null;
      const punches = selected.punches.reduce((sum, fact) => sum + fact.hitCount, 0);
      const enemyDamage = Math.round(selected.player.damage);
      const preMatchPunches = selected.punches
        .filter((fact) => fact.phase === 'pre_match')
        .reduce((sum, fact) => sum + fact.hitCount, 0);
      const inMatchPunches = selected.punches
        .filter((fact) => fact.phase === 'in_match')
        .reduce((sum, fact) => sum + fact.hitCount, 0);
      const punchText = preMatchPunches > 0 && inMatchPunches > 0
        ? `赛前${preMatchPunches}拳、正赛${inMatchPunches}拳`
        : preMatchPunches > 0
          ? `赛前${preMatchPunches}拳`
          : inMatchPunches > 0
            ? `正赛${inMatchPunches}拳`
            : `${punches}拳`;
      const breakdown = selected.punches
        .slice()
        .sort((left, right) => right.hitCount - left.hitCount || left.victimPlayerId.localeCompare(right.victimPlayerId))
        .map((fact) => `${playerName(facts, fact.victimPlayerId)} ${fact.hitCount}拳`)
        .join(' · ');
      return makeCombo(facts, this, {
        id: `fun-event-combo-first-punch-${selected.player.playerId}`,
        actorPlayerId: selected.player.playerId,
        targetPlayerIds: selected.punches.map((fact) => fact.victimPlayerId),
        factIds: [...selected.punches.map((fact) => fact.id), playerSummaryFact(facts, selected.player.playerId)],
        evidenceIds: [...selected.punches.flatMap((fact) => [`evidence-${fact.id}`, ...fact.evidenceIds]), `player-summary-${facts.match.matchId}-${selected.player.playerId}`],
        title: '🥊 先礼后兵',
        text: `${selected.player.playerName}\n先给队友${punchText}（${breakdown}），正式比赛只给敌人造成${enemyDamage}伤害。`,
        facts: { punchHits: punches, enemyDamage, breakdown },
        tags: ['punching', 'low_enemy_damage'],
        suppresses: ['TEAMMATE_PUNCHING'],
      });
    },
  };
}

function friendlyThreat(): FunCombinationRule {
  return {
    id: 'punch_and_vehicle_damage',
    conditions: ['same actor has confirmed punch hits', 'same confirmed driver has vehicle team damage'],
    priority: 95,
    funScore: 88,
    confidenceRequirement: 'CONFIRMED',
    dedupGroup: 'combo-teammate',
    evaluate(facts) {
      const candidates = facts.players.map((player) => ({
        player,
        punches: punchFacts(facts, player.playerId),
        vehicle: confirmedVehicleFacts(facts, player.playerId),
      })).filter((item) => item.punches.reduce((sum, fact) => sum + fact.hitCount, 0) > 0 && item.vehicle.length > 0)
        .sort((left, right) => left.player.playerId.localeCompare(right.player.playerId));
      const selected = candidates[0];
      if (!selected) return null;
      const punches = selected.punches.reduce((sum, fact) => sum + fact.hitCount, 0);
      const vehicleDamage = selected.vehicle.reduce((sum, item) => sum + item.damage, 0);
      return makeCombo(facts, this, {
        id: `fun-event-combo-friendly-threat-${selected.player.playerId}`,
        actorPlayerId: selected.player.playerId,
        targetPlayerIds: [...selected.punches.map((fact) => fact.victimPlayerId), ...selected.vehicle.map((item) => item.victimPlayerId)],
        factIds: [...selected.punches.map((fact) => fact.id), ...selected.vehicle.map((item) => item.id)],
        evidenceIds: [...selected.punches.flatMap((fact) => [`evidence-${fact.id}`, ...fact.evidenceIds]), ...selected.vehicle.flatMap((item) => [`evidence-${item.id}`, ...item.evidenceIds])],
        title: '🚨 友军威胁',
        text: `${selected.player.playerName}\n拳击队友${punches}次，又造成${Math.round(vehicleDamage)}点车辆队伤。`,
        facts: { punchHits: punches, vehicleDamage: Math.round(vehicleDamage) },
        tags: ['punching', 'vehicle_team_damage'],
        suppresses: ['TEAMMATE_PUNCHING', 'VEHICLE_TEAM_HIT', 'TEAM_VEHICLE_DAMAGE'],
      });
    },
  };
}

function pubgTour(): FunCombinationRule {
  return {
    id: 'tourist_bus',
    conditions: ['rideDistance >= 5000m', 'low combat contribution'],
    priority: 90,
    funScore: 84,
    confidenceRequirement: 'DERIVED',
    dedupGroup: 'combo-vehicle',
    evaluate(facts, baseEvents) {
      const candidates = facts.players.map((player) => ({ player, vehicle: facts.vehicles.find((item) => item.playerId === player.playerId) }))
        .filter((item) => item.vehicle && item.vehicle.rideDistance >= 5_000
          && item.player.kills === 0
          && item.player.assists === 0
          && item.player.dbnos === 0
          && item.player.revives === 0
          && item.player.damage <= 100)
        .sort((left, right) => (right.vehicle?.rideDistance ?? 0) - (left.vehicle?.rideDistance ?? 0) || left.player.playerId.localeCompare(right.player.playerId));
      const selected = candidates[0];
      if (!selected?.vehicle) return null;
      const travel = baseEventsFor(baseEvents, ['TOP_DRIVER', 'TOP_PASSENGER', 'LONGEST_RIDE'], selected.player.playerId)[0];
      return makeCombo(facts, this, {
        id: `fun-event-combo-tour-${selected.player.playerId}`,
        actorPlayerId: selected.player.playerId,
        targetPlayerIds: [],
        factIds: [playerSummaryFact(facts, selected.player.playerId), selected.vehicle.id ?? `vehicle-${selected.player.playerId}`],
        evidenceIds: [
          `player-summary-${facts.match.matchId}-${selected.player.playerId}`,
          ...selected.vehicle.evidenceIds,
          ...(travel?.evidenceIds ?? []),
        ],
        title: '🚌 PUBG旅游团',
        text: `${selected.player.playerName}\n乘车${(selected.vehicle.rideDistance / 1_000).toFixed(1)}km · ${selected.player.kills}杀 · ${Math.round(selected.player.damage)}伤害。`,
        facts: { rideDistance: Math.round(selected.vehicle.rideDistance), kills: selected.player.kills, damage: Math.round(selected.player.damage) },
        tags: ['vehicle', 'low_combat'],
        suppresses: ['TOP_DRIVER', 'TOP_PASSENGER', 'LONGEST_RIDE', 'NO_COMBAT_PRESENCE'],
      });
    },
  };
}

function strategicReserve(): FunCombinationRule {
  return {
    id: 'rocket_reserve',
    conditions: ['rocket pickupEvents >= 2', 'rocket shots = 0'],
    priority: 92,
    funScore: 86,
    confidenceRequirement: 'DERIVED',
    dedupGroup: 'combo-heavy-weapon',
    evaluate(facts, baseEvents) {
      const unused = facts.specialEvents.find((event) => event.type === 'ROCKET_UNUSED' && event.playerId && Number(event.facts.pickupEvents ?? 0) >= 2 && Number(event.facts.shots ?? 0) === 0);
      if (!unused?.playerId) return null;
      const base = baseEventsFor(baseEvents, ['ROCKET_UNUSED'], unused.playerId)[0];
      const pickups = Number(unused.facts.pickupEvents ?? 0);
      return makeCombo(facts, this, {
        id: `fun-event-combo-rocket-reserve-${unused.playerId}`,
        actorPlayerId: unused.playerId,
        targetPlayerIds: [],
        factIds: [unused.id],
        evidenceIds: [`evidence-${unused.id}`, ...unused.evidenceIds, ...(base?.evidenceIds ?? [])],
        title: '🎒 战略储备',
        text: `${playerName(facts, unused.playerId)}\n火箭筒拾取${pickups}次，直到比赛结束一炮未发。`,
        facts: { pickupEvents: pickups, shots: 0 },
        tags: ['heavy_weapon', 'unused'],
        suppresses: ['ROCKET_UNUSED'],
      });
    },
  };
}

function reviveFailure(): FunCombinationRule {
  return {
    id: 'revive_failure',
    conditions: ['revives >= 4', 'placement > 1'],
    priority: 88,
    funScore: 84,
    confidenceRequirement: 'DERIVED',
    dedupGroup: 'combo-support',
    evaluate(facts) {
      if (facts.match.placement === null || facts.match.placement <= 1) return null;
      const selected = [...facts.players].filter((player) => player.revives >= 4)
        .sort((left, right) => right.revives - left.revives || left.playerId.localeCompare(right.playerId))[0];
      if (!selected) return null;
      return makeCombo(facts, this, {
        id: `fun-event-combo-revive-failure-${selected.playerId}`,
        actorPlayerId: selected.playerId,
        targetPlayerIds: [],
        factIds: [playerSummaryFact(facts, selected.playerId)],
        evidenceIds: [`player-summary-${facts.match.matchId}-${selected.playerId}`, `match-summary-${facts.match.matchId}`],
        title: '🩺 人救麻了',
        text: `${selected.playerName}\n完成${selected.revives}次救援，但队伍最终止步#${facts.match.placement}。`,
        facts: { revives: selected.revives, placement: facts.match.placement },
        tags: ['support', 'loss'],
        suppresses: ['MOST_REVIVES', 'REVIVE_CHAIN'],
      });
    },
  };
}

function attackDirection(): FunCombinationRule {
  return {
    id: 'attack_direction',
    conditions: ['friendly-fire damage >= 20', 'friendly-fire damage >= 25% of enemy damage'],
    priority: 80,
    funScore: 78,
    confidenceRequirement: 'DERIVED',
    dedupGroup: 'combo-teammate',
    evaluate(facts) {
      // Lobby/ready-room friendly fire is useful for punching jokes, but it
      // must not be used to claim that the squad attacked itself in the match.
      const teamDamage = (facts.teamDamage ?? []).filter((fact) => fact.phase !== 'pre_match');
      const friendlyDamage = teamDamage.reduce((sum, fact) => sum + fact.damage, 0);
      const enemyDamage = facts.players.reduce((sum, player) => sum + player.damage, 0);
      if (enemyDamage <= 0 || friendlyDamage < 20 || friendlyDamage < enemyDamage * 0.25) return null;
      const actors = [...new Set(teamDamage.map((fact) => fact.actorPlayerId))];
      const targets = [...new Set(teamDamage.map((fact) => fact.victimPlayerId))];
      const hasUnconfirmedVehicle = teamDamage.some((fact) => fact.source === 'VEHICLE'
        && !(facts.teamVehicleEvents ?? []).some((item) => item.actorPlayerId === fact.actorPlayerId && item.driverConfirmed));
      return makeCombo(facts, this, {
        ...(!hasUnconfirmedVehicle && actors.length === 1 ? { actorPlayerId: actors[0] } : {}),
        id: 'fun-event-combo-attack-direction',
        targetPlayerIds: targets,
        factIds: teamDamage.map((fact) => fact.id),
        evidenceIds: teamDamage.flatMap((fact) => [`evidence-${fact.id}`, ...fact.evidenceIds]),
        title: '🎯 攻击方向值得研究',
        text: `队友伤害${Math.round(friendlyDamage)}点，占敌人伤害${Math.round(enemyDamage)}点的显著比例。`,
        facts: { friendlyDamage: Math.round(friendlyDamage), enemyDamage: Math.round(enemyDamage) },
        tags: ['team_damage', 'direction'],
        suppresses: ['TEAM_GUN_DAMAGE', 'TEAM_MELEE_DAMAGE', 'TEAM_VEHICLE_DAMAGE', 'TEAM_EXPLOSIVE_DAMAGE'],
      });
    },
  };
}

export const DEFAULT_FUN_COMBINATION_RULES: FunCombinationRule[] = [
  firstThenFight(),
  friendlyThreat(),
  pubgTour(),
  strategicReserve(),
  reviveFailure(),
  attackDirection(),
];

export class EventCombinationEngine {
  constructor(private readonly rules: FunCombinationRule[] = DEFAULT_FUN_COMBINATION_RULES) {}

  combine(facts: MatchReviewFacts, baseEvents = generateBaseFunEvents(facts)): FunEvent[] {
    return [...this.rules]
      .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
      .map((rule) => rule.evaluate(facts, baseEvents))
      .filter((event): event is FunEvent => event !== null && event.factIds.length > 0 && event.evidenceIds.length > 0);
  }
}

export function combineFunEvents(facts: MatchReviewFacts, baseEvents?: FunEvent[]): FunEvent[] {
  return new EventCombinationEngine().combine(facts, baseEvents);
}
