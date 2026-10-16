import type { MatchReviewFacts, NormalizedMatch, TelemetryFeatureRecord } from '@agent/pubg-domain';

/** Stable, pure API consumed by Gate. Bump this semver independently of the Lab UI. */
export const GATE_PUBG_INTELLIGENCE_API_VERSION = '1.0.0' as const;
export const GATE_PUBG_INTELLIGENCE_RULE_VERSION = 'gate-compact-facts-v1' as const;
export const GATE_PUBG_INTELLIGENCE_MAX_MATCHES = 30;
export const GATE_PUBG_INTELLIGENCE_MAX_EVIDENCE_REFS = 12;

export interface GateCachedMatchInput {
  match: NormalizedMatch;
  feature: TelemetryFeatureRecord | null;
}

export interface GateIntelligenceEvidenceRef {
  matchRef: string;
  evidenceRef: string;
  kind: 'fight_outcome' | 'directed_friendly_damage';
  fromSeconds: number | null;
  toSeconds: number | null;
}

export interface GateIntelligenceSummary {
  schemaVersion: 1;
  apiVersion: typeof GATE_PUBG_INTELLIGENCE_API_VERSION;
  ruleVersion: typeof GATE_PUBG_INTELLIGENCE_RULE_VERSION;
  source: 'compact-team-telemetry-features';
  rawEventStreamAvailable: false;
  coverage: {
    requestedMatches: number;
    currentFeatureMatches: number;
    missingOrStaleFeatureMatches: number;
    freshness: 'current_version_complete' | 'partial_current_version' | 'no_current_version_features';
    parserVersion: string;
    featureVersion: string;
    asOf: string | null;
  };
  fightOutcomes: {
    status: 'available' | 'no_observed_fights' | 'integrity_unavailable';
    sampleSize: number;
    wins: number;
    losses: number;
    trades: number;
    unknown: number;
    integrityUnavailableMatches: number;
    evidence: GateIntelligenceEvidenceRef[];
  };
  directedFriendlyDamage: {
    status: 'available' | 'not_observed' | 'incomplete';
    hitCount: number;
    damage: number;
    directedPairCount: number;
    unknownPhaseFactCount: number;
    pairs: Array<{
      actorRef: string;
      victimRef: string;
      source: string;
      hitCount: number;
      damage: number;
      evidence: GateIntelligenceEvidenceRef[];
    }>;
  };
}

function stableMatchRef(index: number): string {
  return `M${String(index + 1).padStart(2, '0')}`;
}

function eventRef(index: number): string {
  return `E${String(index + 1).padStart(3, '0')}`;
}

function validNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function checkedFeature(input: GateCachedMatchInput, parserVersion: string, featureVersion: string, roster: Set<string>): MatchReviewFacts | null {
  const feature = input.feature;
  if (!feature) return null;
  if (feature.matchId !== input.match.matchId || feature.parserVersion !== parserVersion || feature.featureVersion !== featureVersion
    || feature.facts.match.matchId !== input.match.matchId) throw new Error('gate_intelligence_feature_scope_mismatch');
  if (!Array.isArray(feature.facts.combat.events) || feature.facts.combat.events.length !== 0) {
    throw new Error('gate_intelligence_raw_event_stream_not_compacted');
  }
  if (!feature.createdAt || !Number.isFinite(Date.parse(feature.createdAt))) throw new Error('gate_intelligence_feature_timestamp_invalid');
  if (feature.facts.players.some((player) => !roster.has(player.playerId))) throw new Error('gate_intelligence_feature_roster_mismatch');
  if ((feature.facts.teamDamage ?? []).some((fact) => !roster.has(fact.actorPlayerId) || !roster.has(fact.victimPlayerId))) {
    throw new Error('gate_intelligence_friendly_damage_scope_mismatch');
  }
  if ((feature.facts.teamDamage ?? []).some((fact) => !validNonNegative(fact.hitCount) || !validNonNegative(fact.damage)
    || !Array.isArray(fact.evidenceIds))) throw new Error('gate_intelligence_friendly_damage_invalid');
  return feature.facts;
}

/**
 * Summarizes only Gate's compact, team-scoped review features. It intentionally
 * does not accept a SQLite handle, raw event stream, tenant selector, or SQL.
 * The caller must pass records from its already-authorized PostgreSQL repo.
 */
export function summarizeGateCachedFeatures(input: {
  matches: readonly GateCachedMatchInput[];
  rosterPlayerIds: readonly string[];
  parserVersion: string;
  featureVersion: string;
}): GateIntelligenceSummary {
  if (!Number.isSafeInteger(input.matches.length) || input.matches.length > GATE_PUBG_INTELLIGENCE_MAX_MATCHES) {
    throw new Error('gate_intelligence_match_limit_exceeded');
  }
  const rosterIds = [...new Set(input.rosterPlayerIds)].sort((left, right) => left.localeCompare(right));
  if (!rosterIds.length || rosterIds.length > 8 || rosterIds.length !== input.rosterPlayerIds.length) {
    throw new Error('gate_intelligence_roster_invalid');
  }
  if (!input.parserVersion.trim() || !input.featureVersion.trim()) throw new Error('gate_intelligence_version_required');
  const matchIds = new Set<string>();
  const roster = new Set(rosterIds);
  const aliases = new Map(rosterIds.map((id, index) => [id, `teammate-${index + 1}`]));
  const ordered = [...input.matches].sort((left, right) => left.match.timestamp - right.match.timestamp || left.match.matchId.localeCompare(right.match.matchId));
  const features = ordered.map((row) => {
    if (!row.match.matchId || matchIds.has(row.match.matchId)) throw new Error('gate_intelligence_match_id_invalid_or_duplicate');
    matchIds.add(row.match.matchId);
    if (row.match.players.some((player) => !roster.has(player.accountId))) throw new Error('gate_intelligence_match_roster_mismatch');
    return checkedFeature(row, input.parserVersion, input.featureVersion, roster);
  });
  const currentFeatureMatches = features.filter((facts) => facts !== null).length;
  const featureRecords = ordered.flatMap((row) => row.feature ? [row.feature] : []);
  const asOf = featureRecords.map((row) => row.createdAt).sort().at(-1) ?? null;
  const evidenceAliases = new Map<string, Map<string, string>>();
  ordered.forEach((row, index) => {
    const facts = features[index];
    const ids = [...new Set([
      ...(facts?.fights.flatMap((fight) => fight.evidenceIds) ?? []),
      ...(facts?.teamDamage ?? []).flatMap((fact) => fact.phase === 'pre_match' ? [] : fact.evidenceIds),
    ])].sort((left, right) => left.localeCompare(right));
    evidenceAliases.set(row.match.matchId, new Map(ids.map((id, refIndex) => [id, eventRef(refIndex)])));
  });
  const refsFor = (matchId: string, ids: readonly string[], kind: GateIntelligenceEvidenceRef['kind'], from: number | null, to: number | null): GateIntelligenceEvidenceRef[] => {
    const lookup = evidenceAliases.get(matchId);
    const matchIndex = ordered.findIndex((row) => row.match.matchId === matchId);
    return [...new Set(ids)].flatMap((id) => {
      const alias = lookup?.get(id);
      return alias && matchIndex >= 0 ? [{ matchRef: stableMatchRef(matchIndex), evidenceRef: alias, kind, fromSeconds: from, toSeconds: to }] : [];
    });
  };

  let wins = 0, losses = 0, trades = 0, unknown = 0, sampleSize = 0, integrityUnavailableMatches = 0;
  const fightEvidence: GateIntelligenceEvidenceRef[] = [];
  features.forEach((facts, index) => {
    if (!facts) return;
    if (!facts.fightIntegrity.pass) { integrityUnavailableMatches += 1; return; }
    for (const fight of facts.fights) {
      if (!fight.eventCount || !fight.evidenceIds.length) continue;
      sampleSize += 1;
      if (fight.result === 'WIN') wins += 1;
      else if (fight.result === 'LOSS') losses += 1;
      else if (fight.result === 'TRADE') trades += 1;
      else unknown += 1;
      fightEvidence.push(...refsFor(ordered[index]!.match.matchId, fight.evidenceIds, 'fight_outcome', fight.start, fight.end));
    }
  });
  const pairs = new Map<string, { actorRef: string; victimRef: string; source: string; hitCount: number; damage: number; evidence: GateIntelligenceEvidenceRef[] }>();
  let unknownPhaseFactCount = 0;
  let friendlyFactsAvailable = false;
  features.forEach((facts, index) => {
    if (!facts) return;
    if (facts.teamDamage === undefined) return;
    friendlyFactsAvailable = true;
    for (const fact of facts.teamDamage) {
      if (fact.phase === 'pre_match') continue;
      if (fact.phase !== 'in_match') { unknownPhaseFactCount += 1; continue; }
      const actorRef = aliases.get(fact.actorPlayerId);
      const victimRef = aliases.get(fact.victimPlayerId);
      if (!actorRef || !victimRef) throw new Error('gate_intelligence_friendly_damage_scope_mismatch');
      const key = `${actorRef}\u001f${victimRef}\u001f${fact.source}`;
      const existing = pairs.get(key) ?? { actorRef, victimRef, source: fact.source, hitCount: 0, damage: 0, evidence: [] };
      existing.hitCount += fact.hitCount;
      existing.damage += fact.damage;
      existing.evidence.push(...refsFor(ordered[index]!.match.matchId, fact.evidenceIds, 'directed_friendly_damage', fact.timestamp, fact.timestamp));
      pairs.set(key, existing);
    }
  });
  const directedPairs = [...pairs.values()].sort((left, right) => right.damage - left.damage
    || left.actorRef.localeCompare(right.actorRef) || left.victimRef.localeCompare(right.victimRef) || left.source.localeCompare(right.source));
  const totalHits = directedPairs.reduce((sum, pair) => sum + pair.hitCount, 0);
  const totalDamage = directedPairs.reduce((sum, pair) => sum + pair.damage, 0);
  const missingOrStaleFeatureMatches = ordered.length - currentFeatureMatches;
  return {
    schemaVersion: 1,
    apiVersion: GATE_PUBG_INTELLIGENCE_API_VERSION,
    ruleVersion: GATE_PUBG_INTELLIGENCE_RULE_VERSION,
    source: 'compact-team-telemetry-features',
    rawEventStreamAvailable: false,
    coverage: {
      requestedMatches: ordered.length,
      currentFeatureMatches,
      missingOrStaleFeatureMatches,
      freshness: currentFeatureMatches === 0 ? 'no_current_version_features'
        : missingOrStaleFeatureMatches ? 'partial_current_version' : 'current_version_complete',
      parserVersion: input.parserVersion,
      featureVersion: input.featureVersion,
      asOf,
    },
    fightOutcomes: {
      status: sampleSize ? 'available' : integrityUnavailableMatches ? 'integrity_unavailable' : 'no_observed_fights',
      sampleSize, wins, losses, trades, unknown, integrityUnavailableMatches,
      evidence: fightEvidence.slice(0, GATE_PUBG_INTELLIGENCE_MAX_EVIDENCE_REFS),
    },
    directedFriendlyDamage: {
      status: !friendlyFactsAvailable || unknownPhaseFactCount ? 'incomplete' : totalHits ? 'available' : 'not_observed',
      hitCount: totalHits,
      damage: Math.round(totalDamage * 100) / 100,
      directedPairCount: directedPairs.length,
      unknownPhaseFactCount,
      pairs: directedPairs.slice(0, 5).map((pair) => ({
        actorRef: pair.actorRef,
        victimRef: pair.victimRef,
        source: pair.source,
        hitCount: pair.hitCount,
        damage: Math.round(pair.damage * 100) / 100,
        evidence: pair.evidence.slice(0, GATE_PUBG_INTELLIGENCE_MAX_EVIDENCE_REFS),
      })),
    },
  };
}
