import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { DEFAULT_TEAM } from '../src/config/team.js';
import type { NormalizedMatch, NormalizedPlayer } from '../src/data/model.js';
import { buildDeterministicQuery } from '../src/planner/deterministic-planner.js';
import { analyzeMatchReview } from '../src/review/review-analyzer.js';
import { extractMatchReviewFacts } from '../src/review/review-facts.js';
import { generateFunEvents } from '../src/review/fun-intelligence.js';
import { buildReviewPresentation } from '../src/review/presentation.js';

const fixturePath = process.env.PUBG_REAL_MATCH_FIXTURE ?? '';

function realMatch(): NormalizedMatch {
  const values: Record<string, Partial<NormalizedPlayer>> = {
    [DEFAULT_TEAM.players[0]!.id]: { rank: 2, kills: 0, assists: 0, damage: 0, dbnos: 0, revives: 0 },
    [DEFAULT_TEAM.players[1]!.id]: { rank: null, kills: 0, assists: 0, damage: 0, dbnos: 0, revives: 0 },
    [DEFAULT_TEAM.players[2]!.id]: { rank: 2, kills: 3, assists: 1, damage: 256.24585, dbnos: 3, revives: 0 },
    [DEFAULT_TEAM.players[3]!.id]: { rank: null, kills: 0, assists: 0, damage: 0, dbnos: 0, revives: 0 },
  };
  const players = DEFAULT_TEAM.players.map((configured) => ({
    accountId: configured.id,
    playerName: configured.name,
    displayName: configured.name,
    rank: null,
    kills: 0,
    assists: 0,
    damage: 0,
    dbnos: 0,
    revives: 0,
    headshotKills: 0,
    survivalTime: 0,
    longestKill: 0,
    deaths: 1,
    deathSemantics: 'explicit' as const,
    ...values[configured.id],
  }));
  return {
    schemaVersion: 3,
    matchId: '226bb2d9-a83f-49db-ae85-965fcd9ec302',
    shard: 'steam',
    createdAt: '2026-09-02T13:10:29Z',
    timestamp: Date.parse('2026-09-02T13:10:29Z'),
    matchType: 'competitive',
    gameMode: 'squad',
    isCompetitive: true,
    mapName: 'Baltic_Main',
    duration: 1462,
    patchVersion: '',
    players,
  };
}

test('real V3.2 match fixture stays in tracked-team scope', { skip: !existsSync(fixturePath) }, () => {
  const raw = JSON.parse(gunzipSync(readFileSync(fixturePath)).toString('utf8')) as unknown;
  const facts = extractMatchReviewFacts(realMatch(), raw, DEFAULT_TEAM, 1);
  const analysis = analyzeMatchReview(facts);
  const review = {
    schemaVersion: 1 as const,
    match: facts.match,
    facts,
    analysis,
    telemetry: { status: 'HIT' as const, parserVersion: 'fixture', featureVersion: 'fixture' },
  };
  const presentation = buildReviewPresentation(review, buildDeterministicQuery({ text: '复盘今天最后一把' }), null);

  assert.equal(facts.combat.kills, 3);
  assert.equal(facts.combat.knocks, 3);
  assert.equal(facts.fightIntegrity.pass, true);
  assert.equal(facts.fights.some((fight) => fight.teamKills > 3 || fight.teamKnocks > 3), false);
  assert.equal(facts.fights.some((fight) => fight.end - fight.start > 30), false);
  assert.equal(facts.fights.some((fight) => fight.participants.some((id) => !facts.squad.playerIds.includes(id)
    && !fight.opponentTeamIds.length)), false);
  assert.equal(facts.vehicles.some((vehicle) => vehicle.driverConfirmed), false);
  assert.equal(facts.players.some((player) => player.keyOperations.some((operation) => operation.time === 0)), false);
  assert.equal(presentation.fallbackText.includes('42杀'), false);
  assert.equal(presentation.fallbackText.includes('43倒地'), false);
  assert.equal(presentation.fallbackText.includes('驾驶'), false);
  assert.equal(presentation.fallbackText.includes('乘车'), true);
  assert.equal(analysis.playerCommentary.some((item) => item.text.includes('未检测到有效关键贡献')), true);

  const funEvents = generateFunEvents(facts, 5);
  const evidenceIds = new Set(facts.evidence.map((item) => item.id));
  assert.equal(funEvents.every((event) => event.factIds.length > 0
    && event.evidenceIds.length > 0
    && event.evidenceIds.every((id) => evidenceIds.has(id))), true);
});
