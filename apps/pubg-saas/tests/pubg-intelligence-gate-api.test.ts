import assert from 'node:assert/strict';
import test from 'node:test';
import type { MatchReviewFacts, NormalizedMatch, TelemetryFeatureRecord } from '@rine-kit/pubg-domain';
import { summarizeGateCachedFeatures } from '../src/application/pubg-intelligence-gate-api.js';

const parserVersion = 'telemetry-parser-6';
const featureVersion = 'review-features-6';
const rosterPlayerIds = ['fixture-player-b', 'fixture-player-a'];

function match(matchId: string, timestamp: number): NormalizedMatch {
  return {
    schemaVersion: 3, matchId, shard: 'steam', createdAt: new Date(timestamp).toISOString(), timestamp,
    matchType: 'competitive', gameMode: 'squad-fpp', isCompetitive: true, mapName: 'Erangel', duration: 900,
    patchVersion: 'fixture', players: rosterPlayerIds.map((accountId) => ({
      accountId, playerName: 'Fixture Player', displayName: 'Fixture Player', rank: null,
      kills: 0, assists: 0, damage: 0, dbnos: 0, revives: 0, headshotKills: 0, survivalTime: 0,
      longestKill: 0, deaths: null, deathSemantics: 'unknown' as const,
    })),
  };
}

function facts(matchId: string, overrides: Partial<MatchReviewFacts> = {}): MatchReviewFacts {
  return {
    schemaVersion: 1,
    match: { matchId, ordinal: 1, startedAt: null, mapName: 'Erangel', gameMode: 'squad-fpp', duration: 900, placement: null, patchVersion: 'fixture' },
    squad: { playerIds: rosterPlayerIds, kills: 0, assists: 0, damage: 0, knocks: 0, revives: 0, placement: null },
    players: [],
    combat: { eventCount: 4, damage: 0, knocks: 0, kills: 0, revives: 0, opponentDamage: 0, opponentKnocks: 0, opponentKills: 0, opponentRevives: 0, events: [] },
    fights: [
      { id: 'fight-one', start: 20, end: 40, participants: [], damage: 0, knocks: 1, kills: 1, revives: 0, teamDamage: 0, teamKnocks: 1, teamKills: 1, teamRevives: 0, receivedDamage: 0, receivedKnocks: 0, receivedKills: 0, receivedRevives: 0, opponentTeamIds: [], eventCount: 2, result: 'WIN', importanceScore: 1, keyPlayers: [], evidenceIds: ['private-event-1', 'private-event-2'] },
      { id: 'fight-two', start: 80, end: 100, participants: [], damage: 0, knocks: 0, kills: 0, revives: 0, teamDamage: 0, teamKnocks: 0, teamKills: 0, teamRevives: 0, receivedDamage: 0, receivedKnocks: 0, receivedKills: 0, receivedRevives: 0, opponentTeamIds: [], eventCount: 2, result: 'UNKNOWN', importanceScore: 1, keyPlayers: [], evidenceIds: ['private-event-3'] },
    ],
    fightIntegrity: { pass: true, status: 'FIGHT_ANALYTICS_VALID', diagnostics: { matchTeamKills: 1, matchTeamDamage: 0, matchTeamDBNOs: 1, candidateCombatEvents: 4, trackedRelevantEvents: 4, ignoredGlobalEvents: 0, fightCount: 2, damageTolerance: 0, fights: [] }, errors: [] },
    weapons: [], vehicles: [], heavyWeapons: [], specialEvents: [], evidence: [],
    teamDamage: [
      { id: 'friendly-1', actorPlayerId: 'fixture-player-a', victimPlayerId: 'fixture-player-b', hitCount: 2, damage: 15, source: 'GUN', timestamp: 30, timestamps: [30], phase: 'in_match', evidenceIds: ['private-event-2'] },
      { id: 'friendly-2', actorPlayerId: 'fixture-player-a', victimPlayerId: 'fixture-player-b', hitCount: 1, damage: 4, source: 'MELEE', timestamp: 31, timestamps: [31], phase: 'pre_match', evidenceIds: ['private-event-pre-match'] },
      { id: 'friendly-3', actorPlayerId: 'fixture-player-b', victimPlayerId: 'fixture-player-a', hitCount: 1, damage: 2, source: 'GUN', timestamp: null, timestamps: [], evidenceIds: ['private-event-unknown-phase'] },
    ],
    ...overrides,
  };
}

function feature(matchId: string, factsInput = facts(matchId), versions = { parserVersion, featureVersion }): TelemetryFeatureRecord {
  return { matchId, ...versions, facts: factsInput, createdAt: '2026-10-01T00:00:00.000Z' };
}

test('Gate API v1 only emits bounded compact PostgreSQL facts with deterministic aliases and evidence references', () => {
  const report = summarizeGateCachedFeatures({
    matches: [
      { match: match('fixture-match-b', 2), feature: null },
      { match: match('fixture-match-a', 1), feature: feature('fixture-match-a') },
    ],
    rosterPlayerIds, parserVersion, featureVersion,
  });
  assert.equal(report.apiVersion, '1.0.0');
  assert.equal(report.source, 'compact-team-telemetry-features');
  assert.equal(report.rawEventStreamAvailable, false);
  assert.equal(report.coverage.requestedMatches, 2);
  assert.equal(report.coverage.currentFeatureMatches, 1);
  assert.equal(report.coverage.missingOrStaleFeatureMatches, 1);
  assert.equal(report.coverage.freshness, 'partial_current_version');
  assert.equal(report.fightOutcomes.sampleSize, 2);
  assert.equal(report.fightOutcomes.wins, 1);
  assert.equal(report.fightOutcomes.unknown, 1);
  assert.equal(report.directedFriendlyDamage.hitCount, 2);
  assert.equal(report.directedFriendlyDamage.damage, 15);
  assert.equal(report.directedFriendlyDamage.unknownPhaseFactCount, 1);
  assert.equal(report.directedFriendlyDamage.status, 'incomplete');
  assert.deepEqual(report.directedFriendlyDamage.pairs[0], {
    actorRef: 'teammate-1', victimRef: 'teammate-2', source: 'GUN', hitCount: 2, damage: 15,
    evidence: [{ matchRef: 'M01', evidenceRef: 'E002', kind: 'directed_friendly_damage', fromSeconds: 30, toSeconds: 30 }],
  });
  const safe = JSON.stringify(report);
  for (const raw of ['fixture-player-a', 'fixture-match-a', 'private-event-', 'fixture-player-b']) assert.doesNotMatch(safe, new RegExp(raw, 'u'));
  assert.deepEqual(report, summarizeGateCachedFeatures({
    matches: [
      { match: match('fixture-match-a', 1), feature: feature('fixture-match-a') },
      { match: match('fixture-match-b', 2), feature: null },
    ], rosterPlayerIds, parserVersion, featureVersion,
  }));
});

test('Gate API v1 fails closed on out-of-roster, wrong-version, mismatched, and oversized data', () => {
  const base = { matches: [{ match: match('fixture-match-a', 1), feature: feature('fixture-match-a') }], rosterPlayerIds, parserVersion, featureVersion };
  assert.throws(() => summarizeGateCachedFeatures({
    ...base, matches: [{ match: match('fixture-match-a', 1), feature: feature('fixture-match-a', facts('fixture-match-a', {
      players: [{ playerId: 'foreign-player' } as never],
    })) }],
  }), /roster_mismatch/u);
  assert.throws(() => summarizeGateCachedFeatures({
    ...base, matches: [{ match: match('fixture-match-a', 1), feature: feature('fixture-match-a', facts('fixture-match-a'), { parserVersion: 'old-parser', featureVersion }) }],
  }), /feature_scope_mismatch/u);
  const rawFacts = facts('fixture-match-a');
  rawFacts.combat.events = [{ id: 'raw-event' } as never];
  assert.throws(() => summarizeGateCachedFeatures({
    ...base, matches: [{ match: match('fixture-match-a', 1), feature: feature('fixture-match-a', rawFacts) }],
  }), /raw_event_stream_not_compacted/u);
  assert.throws(() => summarizeGateCachedFeatures({ ...base, matches: Array.from({ length: 31 }, (_, i) => ({ match: match(`match-${i}`, i), feature: null })) }), /match_limit_exceeded/u);
});

test('missing directed damage is unknown, and failed fight integrity is not counted as a loss', () => {
  const noDamageFacts = facts('fixture-match-a', {
    fights: [{ id: 'bad-fight', start: 1, end: 2, participants: [], damage: 0, knocks: 1, kills: 0, revives: 0, teamDamage: 0, teamKnocks: 0, teamKills: 0, teamRevives: 0, receivedDamage: 0, receivedKnocks: 1, receivedKills: 1, receivedRevives: 0, opponentTeamIds: [], eventCount: 2, result: 'LOSS', importanceScore: 0, keyPlayers: [], evidenceIds: ['private-event'] }],
    fightIntegrity: { pass: false, status: 'FIGHT_ANALYTICS_INVALID', diagnostics: { matchTeamKills: 0, matchTeamDamage: 0, matchTeamDBNOs: 0, candidateCombatEvents: 2, trackedRelevantEvents: 2, ignoredGlobalEvents: 0, fightCount: 1, damageTolerance: 0, fights: [] }, errors: ['fixture'] },
  });
  delete noDamageFacts.teamDamage;
  const report = summarizeGateCachedFeatures({
    matches: [{ match: match('fixture-match-a', 1), feature: feature('fixture-match-a', noDamageFacts) }],
    rosterPlayerIds, parserVersion, featureVersion,
  });
  assert.equal(report.fightOutcomes.status, 'integrity_unavailable');
  assert.equal(report.fightOutcomes.sampleSize, 0);
  assert.equal(report.fightOutcomes.losses, 0);
  assert.equal(report.directedFriendlyDamage.status, 'incomplete');
});
