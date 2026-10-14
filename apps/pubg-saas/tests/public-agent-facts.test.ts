import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPublicAgentCoverage, buildPublicAgentFacts } from '../src/application/public-agent-facts.js';

test('coverage facts preserve the queried and available match counts without failed match ids', () => {
  const coverage = buildPublicAgentCoverage({
    status: 'PARTIAL',
    complete: false,
    freshness: 'stale',
    checkedAt: '2026-10-14T10:00:00.000Z',
    coverageStart: '2026-10-13T22:00:00.000Z',
    coverageEnd: '2026-10-14T22:00:00.000Z',
    sourceUnavailable: false,
    localComplete: false,
    queryCovered: false,
    requiredMatchCount: 7,
    availableMatchCount: 5,
    failedMatchIds: ['private-match-id'],
  }, new Date('2026-10-14T12:00:00.000Z'));
  assert.deepEqual(coverage, {
    status: 'PARTIAL',
    complete: false,
    freshness: 'stale',
    checkedAtLocal: '2026-10-14 18:00',
    coverageStartLocal: '2026-10-14 06:00',
    coverageEndLocal: '2026-10-15 06:00',
    sourceUnavailable: false,
    localComplete: false,
    queryCovered: false,
    requiredMatchCount: 7,
    availableMatchCount: 5,
  });
  assert.equal(JSON.stringify(coverage).includes('private-match-id'), false);
  assert.equal(JSON.stringify(coverage).includes('failedMatchIds'), false);
});

test('team damage facts expose bounded source/direction totals without evidence or internal ids', () => {
  const roster = [
    { id: 'account-secret-actor', name: 'Alpha', aliases: ['A'] },
    { id: 'account-secret-victim', name: 'Bravo', aliases: ['B'] },
  ];
  const matches = Array.from({ length: 11 }, (_, index) => ({
    matchId: `private-match-${index}`,
    startedAt: `2026-10-${String(1 + index).padStart(2, '0')}T12:00:00.000Z`,
    mapName: 'Erangel',
    gameMode: 'squad-fpp',
    placement: 2,
    hitCount: index === 0 ? 2 : 1,
    damage: index === 0 ? 25.5 : 10,
    teamDamage: [{
      id: `private-fact-${index}`,
      actorPlayerId: 'account-secret-actor',
      victimPlayerId: 'account-secret-victim',
      source: index === 1 ? 'GUN' : 'MELEE',
      hitCount: index === 0 ? 2 : 1,
      damage: index === 0 ? 25.5 : 10,
      phase: 'internal-phase',
      evidenceIds: [`private-evidence-${index}`],
    }],
    telemetry: { status: 'FETCHED', cacheLookup: 'internal-cache-state' },
  }));
  const facts = buildPublicAgentFacts({
    intent: 'team_damage',
    roster,
    now: new Date('2026-10-14T12:00:00.000Z'),
    queryResolved: {
      matchCount: 11,
      sourceRange: {
        from: '2026-10-13T22:00:00.000Z',
        to: '2026-10-14T22:00:00.000Z',
        timezone: 'Asia/Shanghai',
        businessDayStart: '06:00',
      },
      direction: { actorPlayerId: 'account-secret-actor', victimPlayerId: 'account-secret-victim' },
    },
    data: {
      direction: 'internal directional label',
      complete: true,
      totalHitCount: 12,
      totalDamage: 125.5,
      knownHitCount: 12,
      knownDamage: 125.5,
      directions: [{
        actor: { playerId: 'account-secret-actor', name: 'internal actor label' },
        victim: { playerId: 'account-secret-victim', name: 'internal victim label' },
        hitCount: 12,
        damage: 125.5,
        knownHitCount: 12,
        knownDamage: 125.5,
        complete: true,
        matchIds: ['private-match-evidence'],
      }],
      bySource: [
        { source: 'MELEE', hitCount: 11, damage: 115.5, knownHitCount: 11, knownDamage: 115.5 },
        { source: 'GUN', hitCount: 1, damage: 10, knownHitCount: 1, knownDamage: 10 },
      ],
      matches,
      telemetry: { requestedMatchCount: 11, availableMatchCount: 11, unavailableMatchIds: ['private-match-evidence'], statusCounts: { FETCHED: 11 } },
    },
  });

  assert.ok(facts);
  const teamDamage = facts as {
    matchCount: number;
    listedMatchCount: number;
    matchesTruncated: boolean;
    sourceRange: { fromLocal: string; toLocal: string; businessDayStart: string };
    bySource: Array<{ source: string; matchCount: number }>;
    directions: Array<{ actor: string; victim: string; sources: Array<{ source: string; matchCount: number }> }>;
    matches: unknown[];
  };
  assert.equal(teamDamage.matchCount, 11);
  assert.equal(teamDamage.listedMatchCount, 10);
  assert.equal(teamDamage.matches.length, 10);
  assert.equal(teamDamage.matchesTruncated, true);
  assert.deepEqual(teamDamage.sourceRange, {
    fromLocal: '2026-10-14 06:00',
    toLocal: '2026-10-15 06:00',
    timezone: 'Asia/Shanghai',
    businessDayStart: '06:00',
  });
  assert.deepEqual(teamDamage.bySource.map(({ source, matchCount }) => [source, matchCount]), [['MELEE', 10], ['GUN', 1]]);
  assert.equal(teamDamage.directions[0]?.actor, 'Alpha');
  assert.equal(teamDamage.directions[0]?.victim, 'Bravo');
  assert.deepEqual(teamDamage.directions[0]?.sources.map(({ source, matchCount }) => [source, matchCount]), [['MELEE', 10], ['GUN', 1]]);

  const encoded = JSON.stringify(facts);
  for (const forbidden of ['private-match', 'private-fact', 'private-evidence', 'account-secret', 'evidenceIds', 'matchIds', 'playerId', 'telemetry', 'phase', 'cacheLookup', 'internal actor']) {
    assert.equal(encoded.includes(forbidden), false, `public facts leaked ${forbidden}`);
  }
});

test('stats facts cap the roster and expose only the approved player metric allowlist', () => {
  const roster = Array.from({ length: 9 }, (_, index) => ({ id: `account-${index}`, name: `Player ${index}`, aliases: [`Alias ${index}`] }));
  const rows = roster.map((player, index) => ({
    key: player.id,
    label: 'untrusted domain label',
    groupBy: 'player',
    metrics: {
      matches: 3,
      kills: index,
      dbnos: 1,
      assists: 2,
      revives: 1,
      wins: 1,
      top10: 2,
      headshot_kills: 1,
      longest_kill: 125.5,
      survival_time: 3_600,
      damage: 500,
      kd: 2,
      deaths: 1,
      rank: 4,
      performance_score: 88,
      chicken_index: 12,
      denominatorZero: 0,
    },
    activityStatus: 'ACTIVE',
    matchIds: ['private-match-id'],
    evidenceRefs: ['private-evidence-id'],
  }));
  const facts = buildPublicAgentFacts({
    intent: 'team_stats',
    roster,
    now: new Date('2026-10-14T12:00:00.000Z'),
    queryResolved: { sourceRange: { from: '2026-10-13T22:00:00.000Z', to: '2026-10-14T22:00:00.000Z', timezone: 'Asia/Shanghai', businessDayStart: '06:00' } },
    data: { rows, summary: { uniqueMatchCount: 3 }, queryId: 'private-query-id', sessionId: 'private-session-id' },
  });

  assert.ok(facts);
  const stats = facts as { matchCount: number; playersTruncated: boolean; players: Array<{ name: string; aliases: string[]; stats: Record<string, number | null> }> };
  assert.equal(stats.matchCount, 3);
  assert.equal(stats.players.length, 8);
  assert.equal(stats.playersTruncated, true);
  assert.equal(stats.players[0]?.name, 'Player 0');
  assert.equal(stats.players[0]?.aliases[0], 'Alias 0');
  assert.deepEqual(Object.keys(stats.players[0]?.stats ?? {}).sort(), [
    'assists', 'damage', 'dbnos', 'deaths', 'headshot_kills', 'kd', 'kills', 'longest_kill', 'matches', 'rank', 'revives', 'survival_time', 'top10', 'wins',
  ]);
  const encoded = JSON.stringify(facts);
  for (const forbidden of ['account-', 'private-match', 'private-evidence', 'private-query', 'private-session', 'performance_score', 'chicken_index', 'denominatorZero', 'activityStatus', 'matchIds', 'evidenceRefs', 'key']) {
    assert.equal(encoded.includes(forbidden), false, `public facts leaked ${forbidden}`);
  }
});
