import type { NormalizedMatch, QueryRow, StructuredResult } from '../data/model.js';
import type { MatchRankMetric } from '../schema/query.js';
import type { NormalizedTelemetryEvent, TelemetryEventPhase } from './telemetry-events.js';

export type ReviewFactKind = 'FACT' | 'DERIVED' | 'ANALYSIS' | 'FUN';

export interface ReviewEvidence {
  id: string;
  kind: ReviewFactKind;
  source: 'match_store' | 'telemetry';
  eventIds: string[];
  description: string;
}

export interface ReviewMatchSummary {
  matchId: string;
  ordinal: number;
  startedAt: string | null;
  mapName: string;
  gameMode: string;
  duration: number;
  placement: number | null;
  patchVersion: string;
}

export interface ReviewSquadSummary {
  playerIds: string[];
  kills: number;
  assists: number;
  damage: number;
  knocks: number;
  revives: number;
  placement: number | null;
}

export interface VehicleStats {
  /** Stable fact ID; optional for compatibility with pre-V3.3 cached facts. */
  id?: string;
  playerId: string;
  rideDistance: number;
  driveDistance: number;
  maxSpeed: number;
  vehicleDamage: number;
  vehiclesDestroyed: number;
  driver: boolean;
  passenger: boolean;
  driverConfirmed: boolean;
  passengerConfirmed: boolean;
  evidenceIds: string[];
}

export interface HeavyWeaponStats {
  playerId: string;
  weapon: string;
  pickupEvents: number;
  dropEvents: number;
  shots: number;
  hits: number;
  playerDamage: number;
  vehicleDamage: number;
  knocks: number;
  kills: number;
  vehiclesDestroyed: number;
  evidenceIds: string[];
}

export type TeamDamageSource = 'MELEE' | 'GUN' | 'VEHICLE' | 'EXPLOSIVE';

export interface TeamDamageFact {
  id: string;
  actorPlayerId: string;
  victimPlayerId: string;
  hitCount: number;
  damage: number;
  source: TeamDamageSource;
  timestamp: number | null;
  timestamps: number[];
  weapon?: string;
  damageTypeCategory?: string;
  vehicleId?: string;
  /** Reliable phase is kept separate so pre-match friendly fire is not mixed with in-match facts. */
  phase?: TelemetryEventPhase;
  evidenceIds: string[];
}

export type TeamVehicleEventType = 'HIT' | 'KNOCK' | 'KILL';

export interface TeamVehicleEvent {
  id: string;
  type: TeamVehicleEventType;
  actorPlayerId: string;
  victimPlayerId: string;
  damage: number;
  timestamp: number | null;
  vehicleId: string | null;
  driverConfirmed: boolean;
  phase?: TelemetryEventPhase;
  evidenceIds: string[];
}

export interface FlashStats {
  /** Stable fact ID; optional for compatibility with pre-V3.3 cached facts. */
  id?: string;
  playerId: string;
  uses: number;
  evidenceIds: string[];
}

export interface WeaponStats {
  playerId: string;
  weapon: string;
  shots: number;
  hits: number;
  damage: number;
  knocks: number;
  kills: number;
  evidenceIds: string[];
}

export type FightResult = 'WIN' | 'LOSS' | 'TRADE' | 'UNKNOWN';

export interface Fight {
  id: string;
  start: number;
  end: number;
  participants: string[];
  damage: number;
  knocks: number;
  kills: number;
  revives: number;
  teamDamage: number;
  teamKnocks: number;
  teamKills: number;
  teamRevives: number;
  receivedDamage: number;
  receivedKnocks: number;
  receivedKills: number;
  receivedRevives: number;
  opponentTeamIds: string[];
  eventCount: number;
  result: FightResult;
  importanceScore: number;
  keyPlayers: string[];
  location?: string;
  evidenceIds: string[];
}

export type KeyOperationType =
  | 'ENTRY'
  | 'MULTI_KNOCK'
  | 'CLUTCH'
  | 'FLANK'
  | 'TRADE'
  | 'SUPPORT'
  | 'REVIVE'
  | 'DAMAGE'
  | 'POSITIONING_RISK'
  | 'MISTAKE'
  | 'VEHICLE'
  | 'HEAVY_WEAPON';

export interface KeyOperation {
  id: string;
  playerId: string;
  time: number | null;
  type: KeyOperationType;
  impact: string;
  impactScore: number;
  facts: Record<string, number | string | boolean | null>;
  evidenceIds: string[];
}

export interface ReviewPlayerFacts {
  playerId: string;
  playerName: string;
  rank: number | null;
  kills: number;
  assists: number;
  damage: number;
  dbnos: number;
  revives: number;
  matchRole?: string;
  roleConfidence: 'high' | 'medium' | 'low' | 'none';
  keyOperations: KeyOperation[];
  vehicle?: VehicleStats;
  heavyWeapons: HeavyWeaponStats[];
}

export interface MatchReviewFacts {
  schemaVersion: 1;
  match: ReviewMatchSummary;
  squad: ReviewSquadSummary;
  players: ReviewPlayerFacts[];
  combat: {
    eventCount: number;
    damage: number;
    knocks: number;
    kills: number;
    revives: number;
    opponentDamage: number;
    opponentKnocks: number;
    opponentKills: number;
    opponentRevives: number;
    events: NormalizedTelemetryEvent[];
  };
  fights: Fight[];
  fightIntegrity: FightIntegrityResult;
  weapons: WeaponStats[];
  vehicles: VehicleStats[];
  heavyWeapons: HeavyWeaponStats[];
  specialEvents: SpecialEvent[];
  evidence: ReviewEvidence[];
  /** Derived friendly-fire facts; absent only in pre-V3.3 cached records. */
  teamDamage?: TeamDamageFact[];
  /** Vehicle collision facts retain driver certainty separately. */
  teamVehicleEvents?: TeamVehicleEvent[];
  /** Flash use is countable; flash victims are intentionally not inferred. */
  flash?: FlashStats[];
}

export type SpecialEventType =
  | 'MULTI_KNOCK'
  | 'CLUTCH'
  | 'REVIVE_CHAIN'
  | 'ROCKET_UNUSED'
  | 'ROCKET_MISS'
  | 'ROCKET_HIT'
  | 'ROCKET_VEHICLE_DESTROY'
  | 'ROCKET_MULTI_KILL'
  | 'ROCKET_VEHICLE_MULTI_KILL'
  | 'ROCKET_ALL_MISS'
  | 'VEHICLE_LONG_DRIVE'
  | 'VEHICLE_DESTROY'
  | 'VEHICLE_KILL';

export interface SpecialEvent {
  id: string;
  type: SpecialEventType;
  playerId?: string;
  time: number | null;
  impact: string;
  impactScore: number;
  facts: Record<string, number | string | boolean | null>;
  evidenceIds: string[];
}

export interface PlayerCommentary {
  playerId: string;
  role?: string;
  roleConfidence: 'high' | 'medium' | 'low' | 'none';
  text: string;
  strengths: string[];
  improvements: string[];
  operationIds: string[];
}

export interface ReviewAnalysis {
  summary: string;
  playerCommentary: PlayerCommentary[];
  keyFights: Fight[];
  good: string[];
  improvements: string[];
  keyPlayers: string[];
  fun: string[];
  funCandidates?: FunCandidate[];
  funEvents?: FunEvent[];
}

export type FunCandidateType =
  | 'ROCKET_UNUSED'
  | 'ROCKET_MISS'
  | 'ROCKET_MULTI_KILL'
  | 'ROCKET_VEHICLE_MULTI_KILL'
  | 'TOP_DRIVER'
  | 'TOP_PASSENGER'
  | 'LONGEST_RIDE'
  | 'MOST_REVIVES'
  | 'MOST_ASSISTS'
  | 'HIGH_KNOCK_LOW_CONVERSION'
  | 'NO_COMBAT_PRESENCE'
  | 'HIGH_DAMAGE'
  | 'LOW_DAMAGE'
  | 'SPECIAL_EVENT';

export interface FunCandidate {
  id: string;
  type: FunCandidateType;
  playerId?: string;
  title: string;
  text: string;
  impactScore: number;
  facts: Record<string, number | string | boolean | null>;
  evidenceIds: string[];
}

export type FunConfidence = 'CONFIRMED' | 'DERIVED' | 'HEURISTIC';

/** Structured, evidence-backed fun output. Rendering must not derive facts from text. */
export interface FunEvent {
  id: string;
  type: string;
  actorPlayerId?: string;
  targetPlayerIds: string[];
  factIds: string[];
  evidenceIds: string[];
  confidence: FunConfidence;
  funScore: number;
  category: string;
  title: string;
  text: string;
  facts: Record<string, number | string | boolean | null>;
  tags: string[];
  dedupGroup?: string;
  suppresses?: string[];
}

export interface MatchReviewResult {
  schemaVersion: 1;
  match: ReviewMatchSummary;
  facts: MatchReviewFacts;
  analysis: ReviewAnalysis;
  telemetry: {
    status: 'HIT' | 'MISS' | 'UNAVAILABLE';
    parserVersion: string;
    featureVersion: string;
    error?: string;
  };
  sourceMatchResultSetId?: string | null;
  activeReviewResultSetId?: string | null;
}

export interface FightIntegrityFightDiagnostic {
  id: string;
  duration: number;
  opponentTeamIds: string[];
  eventCount: number;
  teamKills: number;
  teamKnocks: number;
  teamDamage: number;
  receivedDamage: number;
  integrityPass: boolean;
}

export interface FightIntegrityDiagnostics {
  matchTeamKills: number;
  matchTeamDamage: number;
  matchTeamDBNOs: number;
  candidateCombatEvents: number;
  trackedRelevantEvents: number;
  ignoredGlobalEvents: number;
  fightCount: number;
  damageTolerance: number;
  fights: FightIntegrityFightDiagnostic[];
}

export interface FightIntegrityResult {
  pass: boolean;
  /** Explicit status lets renderers and traces distinguish invalid analytics from missing telemetry. */
  status: 'FIGHT_ANALYTICS_VALID' | 'FIGHT_ANALYTICS_INVALID';
  diagnostics: FightIntegrityDiagnostics;
  errors: string[];
}

export interface MatchPickerCandidate {
  ordinal: number;
  match: NormalizedMatch;
  row: QueryRow;
}

export interface MatchPickerButton {
  text: string;
  callbackData: string;
  ordinal: number;
}

export interface MatchPickerModel {
  selectorLabel: string;
  candidateCount: number;
  candidates: MatchPickerCandidate[];
  buttons: MatchPickerButton[];
}

export interface MatchSelectionRecord {
  token: string;
  platform: string;
  chatId: string;
  sessionId: string;
  matchId: string;
  resultSetId: string;
  ordinal: number;
  createdAt: string;
  expiresAt: string;
  query: import('../schema/query.js').CanonicalQuery;
}

export interface MatchSelectionRequest {
  platform: string;
  chatId: string;
  now?: Date;
}

export interface ReviewExecution {
  result: StructuredResult;
  candidates: MatchPickerCandidate[];
  selected: MatchPickerCandidate | null;
  matchSelector: import('../schema/query.js').MatchSelector | null;
  sourceMatchResultSetId: string | null;
  rankedMetric?: MatchRankMetric;
}
