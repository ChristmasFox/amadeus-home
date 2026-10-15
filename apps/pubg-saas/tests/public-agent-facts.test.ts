import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPublicAgentFacts } from '../src/application/public-agent-facts.js';

const roster = [
  { id: 'account-private-actor', name: 'Alpha', aliases: ['A'] },
  { id: 'account-private-victim', name: 'Bravo', aliases: ['B'] },
];

function findKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(findKeys);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => [key, ...findKeys(item)]);
}

test('the Agent receives the complete Domain envelope, presentation, and display text without internal identifiers', () => {
  const matches = Array.from({ length: 11 }, (_, index) => ({
    id: `internal-record-${index}`,
    matchId: `private-match-${index}`,
    startedAt: `2026-10-${String(1 + index).padStart(2, '0')}T12:00:00.000Z`,
    mapName: 'Erangel',
    gameMode: 'squad-fpp',
    placement: 2,
    hitCount: 2,
    damage: 25.5,
    teamDamage: [{
      id: `private-fact-${index}`,
      actorPlayerId: roster[0]!.id,
      victimPlayerId: roster[1]!.id,
      source: 'MELEE',
      hitCount: 2,
      damage: 25.5,
      evidenceIds: [`private-evidence-${index}`],
    }],
    telemetry: { status: 'FETCHED', combat: { events: [{ category: 'team_damage', damage: 25.5 }] }, cacheLookup: 'HIT' },
  }));
  const result = buildPublicAgentFacts({
    status: 'partial',
    data: {
      complete: false,
      knownHitCount: 22,
      knownDamage: 280.5,
      matches,
      unavailableMatchIds: ['private-unavailable-match'],
      telemetry: { requestedMatchCount: 12, availableMatchCount: 11, unavailableMatchIds: ['private-unavailable-match'] },
    },
    coverage: { status: 'PARTIAL', complete: false, freshness: 'fresh', requiredMatchCount: 12, availableMatchCount: 11 },
    asOf: '2026-10-14T12:00:00.000Z',
    metricVersion: 'pubg-metric-v1',
    queryResolved: {
      tool: 'pubg_query_team_damage',
      sessionId: 'private-session-id',
      sourceRange: { from: '2026-10-13T22:00:00.000Z', to: '2026-10-14T22:00:00.000Z', timezone: 'Asia/Shanghai', businessDayStart: '06:00' },
      order: matches.map(match => match.matchId),
    },
    evidenceRefs: {
      matchIds: matches.map(match => match.matchId),
      playerIds: roster.map(player => player.id),
      fields: ['matches.teamDamage', 'matches.telemetry.combat'],
      calculation: 'pubg_team_damage_v1',
    },
    error: { code: 'partial_review', retryable: true, reason: 'private-match-id detail omitted' },
    presentation: {
      type: 'pubg_team_damage',
      coverage: { complete: false },
      evidenceRefs: { matchIds: matches.map(match => match.matchId), playerIds: roster.map(player => player.id) },
    },
    displayText: '已知 11 场，Alpha 对 Bravo 的 MELEE 伤害为 280.50。',
    roster,
    now: new Date('2026-10-14T12:00:00.000Z'),
  });

  const encoded = JSON.stringify(result);
  const facts = result as {
    status: string;
    data: { matches: Array<{ matchReference: string; teamDamage: Array<{ actorName: string; victimName: string }> }> };
    evidence: { matchCount: number; playerCount: number };
    presentation: { type: string };
    displayText: string;
    error: { code: string; retryable: boolean };
  };
  assert.equal(facts.status, 'partial');
  assert.equal(facts.data.matches.length, 11, 'there is no public-only ten-match facts slice');
  assert.equal(facts.data.matches[0]?.matchReference, '第1场');
  assert.equal(facts.data.matches[10]?.teamDamage[0]?.actorName, 'Alpha');
  assert.equal(facts.data.matches[10]?.teamDamage[0]?.victimName, 'Bravo');
  assert.deepEqual(facts.evidence, { matchCount: 11, playerCount: 2, fields: ['matches.teamDamage', 'matches.telemetry.combat'] });
  assert.equal(facts.presentation.type, 'pubg_team_damage');
  assert.equal(facts.displayText, '已知 11 场，Alpha 对 Bravo 的 MELEE 伤害为 280.50。');
  assert.deepEqual(facts.error, { code: 'partial_review', retryable: true });
  assert.equal(encoded.includes('private-match'), false);
  assert.equal(encoded.includes('private-record'), false);
  assert.equal(encoded.includes('private-fact'), false);
  assert.equal(encoded.includes('private-evidence'), false);
  assert.equal(encoded.includes('account-private'), false);
  assert.equal(encoded.includes('private-session'), false);
  assert.equal(encoded.includes('cacheLookup'), false);
  assert.equal(encoded.includes('sessionId'), false);
  assert.equal(findKeys(result).some(key => /(?:^|_)(?:id|ids)$/iu.test(key)), false);
});

test('complete player statistics retain every Domain metric for the authorized roster', () => {
  const players = Array.from({ length: 8 }, (_, index) => ({ id: `account-${index}`, name: `Player ${index}`, aliases: [`Alias ${index}`] }));
  const rows = players.map((player, index) => ({
    key: player.id,
    groupBy: 'player',
    metrics: {
      matches: 3, kills: index, dbnos: 1, assists: 2, revives: 1, wins: 1, top10: 2,
      headshot_kills: 1, longest_kill: 125.5, survival_time: 3_600, damage: 500, kd: 2,
      deaths: 1, rank: 4, performance_score: 88, chicken_index: 12,
    },
  }));
  const result = buildPublicAgentFacts({
    status: 'ok', data: { rows, summary: { uniqueMatchCount: 3 } }, coverage: { complete: true },
    asOf: '2026-10-14T12:00:00.000Z', queryResolved: {}, evidenceRefs: { playerIds: players.map(player => player.id), matchIds: [] },
    presentation: { type: 'pubg_stats' }, displayText: '小队数据已更新。', roster: players, now: new Date('2026-10-14T12:00:00.000Z'),
  });

  const stats = result as { data: { rows: Array<{ playerName: string; metrics: Record<string, number> }> } };
  assert.equal(stats.data.rows.length, 8);
  assert.equal(stats.data.rows[0]?.playerName, 'Player 0');
  assert.equal(stats.data.rows[0]?.metrics.performance_score, 88);
  assert.equal(stats.data.rows[0]?.metrics.chicken_index, 12);
  assert.equal(JSON.stringify(result).includes('account-0'), false);
});

test('review facts retain per-match Domain details while removing session and match IDs', () => {
  const result = buildPublicAgentFacts({
    status: 'partial',
    data: {
      period: { label: '昨天', orderedMatchIds: ['match-private-1'] },
      reviews: [{
        matchId: 'match-private-1',
        status: 'partial',
        match: { matchId: 'match-private-1', createdAt: '2026-10-14T03:07:00.000Z', mapName: 'Erangel', gameMode: 'duo-fpp' },
        data: { facts: { match: { mapName: 'Erangel' }, players: [{ name: 'Alpha', stats: { kills: 3, assists: 1 } }] } },
      }],
    },
    coverage: { complete: false }, asOf: '2026-10-14T04:00:00.000Z',
    queryResolved: { sessionId: 'private-session', searchResultSetId: 'private-result-set', categories: null },
    evidenceRefs: { matchIds: ['match-private-1'], playerIds: [roster[0]!.id] },
    presentation: { type: 'pubg_period_review', evidenceRefs: { matchIds: ['match-private-1'] } },
    displayText: '昨天这场 Alpha 击杀 3 人。', roster, now: new Date('2026-10-14T12:00:00.000Z'),
  });
  const encoded = JSON.stringify(result);
  assert.match(encoded, /period_review/u);
  assert.match(encoded, /kills/iu);
  assert.match(encoded, /第1场/u);
  assert.equal(encoded.includes('match-private-1'), false);
  assert.equal(encoded.includes('private-session'), false);
  assert.equal(encoded.includes('private-result-set'), false);
  assert.equal(encoded.includes('orderedMatchIds'), false);
});
