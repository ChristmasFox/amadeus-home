import { formatDisplayTime } from '@agent/presentation';
import { BUSINESS_DAY_START, DEFAULT_TIMEZONE } from '@agent/pubg-domain/core';

const TEAM_DAMAGE_SOURCES = ['MELEE', 'GUN', 'VEHICLE', 'EXPLOSIVE'] as const;
const PLAYER_STATS = [
  'matches', 'kills', 'dbnos', 'assists', 'revives', 'wins', 'top10',
  'headshot_kills', 'longest_kill', 'survival_time', 'damage', 'kd', 'deaths', 'rank',
] as const;

type PublicRosterPlayer = { id: string; name: string; aliases?: readonly string[] };

export interface PublicAgentFactsInput {
  intent: string;
  data: unknown;
  queryResolved: unknown;
  roster: readonly PublicRosterPlayer[];
  now: Date;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function safeCount(value: unknown): number | null {
  const number = safeNumber(value);
  return number === null ? null : Math.max(0, Math.trunc(number));
}

function safeText(value: unknown, maxLength = 80): string | null {
  if (typeof value !== 'string') return null;
  const text = value.normalize('NFC').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/@/gu, '＠')
    .replace(/[\[\]`*_~>|]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maxLength);
  return text || null;
}

function source(value: unknown): typeof TEAM_DAMAGE_SOURCES[number] | null {
  return TEAM_DAMAGE_SOURCES.includes(value as typeof TEAM_DAMAGE_SOURCES[number])
    ? value as typeof TEAM_DAMAGE_SOURCES[number]
    : null;
}

function rosterMaps(roster: readonly PublicRosterPlayer[]) {
  const byId = new Map<string, { name: string; aliases: string[] }>();
  for (const player of roster.slice(0, 8)) {
    const name = safeText(player.name, 64);
    if (!name || !player.id) continue;
    byId.set(player.id, {
      name,
      aliases: [...new Set((player.aliases ?? []).flatMap(alias => {
        const value = safeText(alias, 48);
        return value && value !== name ? [value] : [];
      }))].slice(0, 8),
    });
  }
  return byId;
}

export function buildPublicAgentSourceRange(queryResolved: unknown, now: Date): Record<string, unknown> | null {
  const resolved = record(queryResolved);
  const range = record(resolved?.sourceRange);
  if (!range) return null;
  const timezone = typeof range.timezone === 'string' && range.timezone.length <= 64 ? range.timezone : DEFAULT_TIMEZONE;
  const boundary = typeof range.businessDayStart === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/u.test(range.businessDayStart)
    ? range.businessDayStart : BUSINESS_DAY_START;
  const from = typeof range.from === 'string' ? range.from : typeof range.start === 'string' ? range.start : null;
  const to = typeof range.to === 'string' ? range.to : typeof range.end === 'string' ? range.end : null;
  if (!from && !to) return null;
  return {
    fromLocal: formatDisplayTime(from, { timezone, now, forceDate: true }),
    toLocal: formatDisplayTime(to, { timezone, now, forceDate: true }),
    timezone,
    businessDayStart: boundary,
  };
}

export function buildPublicAgentCoverage(value: unknown, now: Date): Record<string, unknown> | null {
  const coverage = record(value);
  if (!coverage) return null;
  const status = typeof coverage.status === 'string' && /^[A-Z_]{2,48}$/u.test(coverage.status) ? coverage.status : 'UNKNOWN';
  const freshness = ['fresh', 'stale', 'unknown'].includes(String(coverage.freshness)) ? coverage.freshness : 'unknown';
  const localTime = (timestamp: unknown) => formatDisplayTime(typeof timestamp === 'string' ? timestamp : null, {
    timezone: DEFAULT_TIMEZONE, now, forceDate: true,
  });
  return {
    status,
    complete: coverage.complete === true,
    freshness,
    checkedAtLocal: localTime(coverage.checkedAt),
    coverageStartLocal: localTime(coverage.coverageStart),
    coverageEndLocal: localTime(coverage.coverageEnd),
    sourceUnavailable: coverage.sourceUnavailable === true,
    ...(typeof coverage.localComplete === 'boolean' ? { localComplete: coverage.localComplete } : {}),
    ...(typeof coverage.queryCovered === 'boolean' ? { queryCovered: coverage.queryCovered } : {}),
    ...(safeCount(coverage.requiredMatchCount) !== null ? { requiredMatchCount: safeCount(coverage.requiredMatchCount) } : {}),
    ...(safeCount(coverage.availableMatchCount) !== null ? { availableMatchCount: safeCount(coverage.availableMatchCount) } : {}),
  };
}

function statsFacts(data: Record<string, unknown>, roster: Map<string, { name: string; aliases: string[] }>, queryResolved: unknown, now: Date): Record<string, unknown> {
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const players = rows.slice(0, 8).flatMap(value => {
    const row = record(value);
    const id = typeof row?.key === 'string' ? row.key : '';
    const publicPlayer = roster.get(id);
    const metrics = record(row?.metrics);
    if (!publicPlayer || !metrics) return [];
    const selected: Record<string, number | null> = {};
    for (const key of PLAYER_STATS) {
      if (key in metrics) selected[key] = safeNumber(metrics[key]);
    }
    return [{ name: publicPlayer.name, aliases: publicPlayer.aliases, stats: selected }];
  });
  const summary = record(data.summary);
  return {
    type: 'player_stats',
    matchCount: safeCount(summary?.uniqueMatchCount),
    sourceRange: buildPublicAgentSourceRange(queryResolved, now),
    players,
    playersTruncated: rows.length > 8,
  };
}

interface SourceAggregate {
  knownHitCount: number;
  knownDamage: number;
  matchKeys: Set<string>;
}

interface DirectionAggregate {
  actor: string;
  victim: string;
  sources: Map<string, SourceAggregate>;
}

function sumSourceRows(rows: unknown, matches: unknown[], complete: boolean): Array<Record<string, unknown>> {
  const matchKeysBySource = new Map<string, Set<string>>();
  for (let index = 0; index < matches.length; index += 1) {
    const match = record(matches[index]);
    const facts = Array.isArray(match?.teamDamage) ? match.teamDamage : [];
    const matchKey = typeof match?.matchId === 'string' ? match.matchId : `row:${index}`;
    for (const value of facts) {
      const fact = record(value);
      const kind = source(fact?.source);
      if (!kind) continue;
      const keys = matchKeysBySource.get(kind) ?? new Set<string>();
      keys.add(matchKey);
      matchKeysBySource.set(kind, keys);
    }
  }
  const dataRows = Array.isArray(rows) ? rows : [];
  return dataRows.flatMap(value => {
    const row = record(value);
    const kind = source(row?.source);
    if (!kind) return [];
    const knownHitCount = safeCount(row?.knownHitCount) ?? safeCount(row?.hitCount) ?? 0;
    const knownDamage = safeNumber(row?.knownDamage) ?? safeNumber(row?.damage) ?? 0;
    const knownMatchCount = matchKeysBySource.get(kind)?.size ?? 0;
    return [{
      source: kind,
      hitCount: complete ? safeCount(row?.hitCount) ?? knownHitCount : null,
      damage: complete ? safeNumber(row?.damage) ?? knownDamage : null,
      knownHitCount,
      knownDamage,
      matchCount: complete ? knownMatchCount : null,
      knownMatchCount,
      complete,
    }];
  });
}

function teamDamageFacts(data: Record<string, unknown>, roster: Map<string, { name: string; aliases: string[] }>, queryResolved: unknown, now: Date): Record<string, unknown> {
  const matches = Array.isArray(data.matches) ? data.matches : [];
  const complete = data.complete === true;
  const aggregateByDirection = new Map<string, DirectionAggregate>();
  const addDirection = (actorId: unknown, victimId: unknown): DirectionAggregate | null => {
    if (typeof actorId !== 'string' || typeof victimId !== 'string') return null;
    const actor = roster.get(actorId)?.name;
    const victim = roster.get(victimId)?.name;
    if (!actor || !victim) return null;
    const key = `${actorId}\u0000${victimId}`;
    const current = aggregateByDirection.get(key) ?? { actor, victim, sources: new Map<string, SourceAggregate>() };
    aggregateByDirection.set(key, current);
    return current;
  };

  const rawDirections = Array.isArray(data.directions) ? data.directions : [];
  for (const value of rawDirections) {
    const direction = record(value);
    const actor = record(direction?.actor), victim = record(direction?.victim);
    addDirection(actor?.playerId, victim?.playerId);
  }

  for (let index = 0; index < matches.length; index += 1) {
    const match = record(matches[index]);
    const facts = Array.isArray(match?.teamDamage) ? match.teamDamage : [];
    const matchKey = typeof match?.matchId === 'string' ? match.matchId : `row:${index}`;
    for (const value of facts) {
      const fact = record(value);
      const kind = source(fact?.source);
      const direction = addDirection(fact?.actorPlayerId, fact?.victimPlayerId);
      if (!kind || !direction) continue;
      const aggregate = direction.sources.get(kind) ?? { knownHitCount: 0, knownDamage: 0, matchKeys: new Set<string>() };
      aggregate.knownHitCount += safeCount(fact?.hitCount) ?? 0;
      aggregate.knownDamage += safeNumber(fact?.damage) ?? 0;
      aggregate.matchKeys.add(matchKey);
      direction.sources.set(kind, aggregate);
    }
  }

  const directions = rawDirections.flatMap(value => {
    const row = record(value);
    const actor = record(row?.actor), victim = record(row?.victim);
    const actorId = typeof actor?.playerId === 'string' ? actor.playerId : '';
    const victimId = typeof victim?.playerId === 'string' ? victim.playerId : '';
    const actorName = roster.get(actorId)?.name, victimName = roster.get(victimId)?.name;
    if (!actorName || !victimName) return [];
    const aggregate = aggregateByDirection.get(`${actorId}\u0000${victimId}`);
    const sources = [...(aggregate?.sources.entries() ?? [])].map(([kind, facts]) => ({
      source: kind,
      hitCount: complete ? facts.knownHitCount : null,
      damage: complete ? Math.round(facts.knownDamage * 100) / 100 : null,
      knownHitCount: facts.knownHitCount,
      knownDamage: Math.round(facts.knownDamage * 100) / 100,
      matchCount: complete ? facts.matchKeys.size : null,
      knownMatchCount: facts.matchKeys.size,
      complete,
    }));
    const knownHitCount = safeCount(row?.knownHitCount) ?? safeCount(row?.hitCount) ?? 0;
    const knownDamage = safeNumber(row?.knownDamage) ?? safeNumber(row?.damage) ?? 0;
    const directionComplete = complete && row?.complete === true;
    return [{
      actor: actorName,
      victim: victimName,
      hitCount: directionComplete ? safeCount(row?.hitCount) ?? knownHitCount : null,
      damage: directionComplete ? safeNumber(row?.damage) ?? knownDamage : null,
      knownHitCount,
      knownDamage,
      complete: directionComplete,
      sources,
    }];
  });

  const telemetry = record(data.telemetry);
  const resolved = record(queryResolved);
  const matchCount = safeCount(resolved?.matchCount) ?? safeCount(telemetry?.requestedMatchCount) ?? matches.length;
  const listedMatches = matches.slice(0, 10).flatMap((value, index) => {
    const row = record(value);
    if (!row) return [];
    const facts = Array.isArray(row.teamDamage) ? row.teamDamage : null;
    const grouped = new Map<string, { hitCount: number; damage: number }>();
    for (const item of facts ?? []) {
      const fact = record(item), kind = source(record(item)?.source);
      if (!kind) continue;
      const current = grouped.get(kind) ?? { hitCount: 0, damage: 0 };
      current.hitCount += safeCount(fact?.hitCount) ?? 0;
      current.damage += safeNumber(fact?.damage) ?? 0;
      grouped.set(kind, current);
    }
    return [{
      startedAt: formatDisplayTime(typeof row.startedAt === 'string' ? row.startedAt : null, { timezone: DEFAULT_TIMEZONE, now, forceDate: true }),
      map: safeText(row.mapName, 48),
      mode: safeText(row.gameMode, 48),
      placement: safeCount(row.placement),
      hitCount: safeCount(row.hitCount),
      damage: safeNumber(row.damage),
      knownHitCount: facts === null ? null : [...grouped.values()].reduce((sum, item) => sum + item.hitCount, 0),
      knownDamage: facts === null ? null : Math.round([...grouped.values()].reduce((sum, item) => sum + item.damage, 0) * 100) / 100,
      dataAvailable: facts !== null,
      sources: [...grouped.entries()].map(([kind, item]) => ({
        source: kind,
        hitCount: item.hitCount,
        damage: Math.round(item.damage * 100) / 100,
      })),
    }];
  });
  const knownHitCount = safeCount(data.knownHitCount) ?? 0;
  const knownDamage = safeNumber(data.knownDamage) ?? 0;
  const totalHitCount = complete ? safeCount(data.totalHitCount) ?? knownHitCount : null;
  const totalDamage = complete ? safeNumber(data.totalDamage) ?? knownDamage : null;
  return {
    type: 'team_damage',
    sourceRange: buildPublicAgentSourceRange(queryResolved, now),
    complete,
    matchCount,
    availableMatchCount: safeCount(telemetry?.availableMatchCount),
    hitCount: totalHitCount,
    damage: totalDamage,
    knownHitCount,
    knownDamage,
    bySource: sumSourceRows(data.bySource, matches, complete),
    directions,
    matches: listedMatches,
    listedMatchCount: listedMatches.length,
    matchesTruncated: matchCount > listedMatches.length,
  };
}

/** Maps Domain output to a deliberately small public Agent allowlist. */
export function buildPublicAgentFacts(input: PublicAgentFactsInput): Record<string, unknown> | null {
  const data = record(input.data);
  if (!data) return null;
  const roster = rosterMaps(input.roster);
  if (input.intent === 'team_damage') return teamDamageFacts(data, roster, input.queryResolved, input.now);
  if (['team_stats', 'my_stats', 'player_stats', 'leaderboard'].includes(input.intent)) return statsFacts(data, roster, input.queryResolved, input.now);
  return null;
}
