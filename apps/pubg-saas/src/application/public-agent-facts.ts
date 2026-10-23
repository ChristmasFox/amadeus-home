import { formatDisplayTime } from '@rine-kit/presentation';
import { BUSINESS_DAY_START, DEFAULT_TIMEZONE } from '@rine-kit/pubg-domain/core';

type PublicRosterPlayer = { id: string; name: string; aliases?: readonly string[] };

export interface PublicAgentFactsInput {
  status: string;
  data: unknown;
  coverage: unknown;
  asOf: string;
  metricVersion?: string;
  queryResolved: unknown;
  evidenceRefs: unknown;
  error?: unknown;
  presentation: unknown;
  displayText: string;
  roster: readonly PublicRosterPlayer[];
  now: Date;
}

interface PublicNames {
  byId: Map<string, string>;
  matchReferences: Map<string, string>;
}

const OMIT_KEYS = new Set([
  'id', 'tenantid', 'teamid', 'botaccountid', 'userid', 'channelid', 'sessionid',
  'requestid', 'queryid', 'resultsetid', 'searchresultsetid', 'playerid', 'accountid',
  'evidenceid', 'evidenceids', 'factid', 'participantid', 'cachekey', 'cachelookup', 'cachestatus',
  'retryat', 'retryschedule', 'raw', 'rawpayload', 'debug', 'diagnostic', 'diagnostics',
  'stack', 'apikey', 'token', 'secret', 'password', 'authorization', 'url',
]);

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function keyName(value: string): string {
  return value.replace(/[-_]/gu, '').toLocaleLowerCase('en-US');
}

function safeString(value: string): string {
  return value.normalize('NFC').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function rosterNames(roster: readonly PublicRosterPlayer[]): PublicNames {
  const byId = new Map<string, string>();
  roster.forEach((player, index) => {
    const officialName = safeString(player.name);
    // A missing PUBG display name can fall back to account.<opaque-id> in PG.
    // Give the model a neutral roster label instead of exposing that identifier.
    const name = !officialName || /^account\./iu.test(officialName) ? `未命名队员${index + 1}` : officialName;
    if (!player.id) return;
    byId.set(player.id, name);
  });
  return { byId, matchReferences: new Map() };
}

function matchReference(id: string, names: PublicNames): string {
  let reference = names.matchReferences.get(id);
  if (!reference) {
    reference = `第${names.matchReferences.size + 1}场`;
    names.matchReferences.set(id, reference);
  }
  return reference;
}

function collectMatchReferences(value: unknown, names: PublicNames): void {
  if (Array.isArray(value)) {
    for (const item of value) collectMatchReferences(item, names);
    return;
  }
  const row = object(value);
  if (!row) return;
  for (const [key, item] of Object.entries(row)) {
    const normalized = keyName(key);
    if (normalized === 'matchid' && typeof item === 'string') matchReference(item, names);
    if ((normalized.endsWith('matchids') || normalized === 'order') && Array.isArray(item)) {
      for (const matchId of item) if (typeof matchId === 'string') matchReference(matchId, names);
    }
    collectMatchReferences(item, names);
  }
}

function replaceKnownIdentifiers(value: string, names: PublicNames): string {
  let output = safeString(value);
  const entries = [
    ...[...names.byId.entries()].map(([id, name]) => [id, name] as const),
    ...[...names.matchReferences.entries()].map(([id, name]) => [id, name] as const),
  ].sort(([left], [right]) => right.length - left.length);
  for (const [id, label] of entries) output = output.replaceAll(id, label);
  return output.replace(/account\.[A-Za-z0-9_-]{1,128}/gu, '未命名队员');
}

function evidenceSummary(value: unknown): Record<string, unknown> {
  const refs = object(value) ?? {};
  const matches = Array.isArray(refs.matchIds) ? refs.matchIds.length : 0;
  const players = Array.isArray(refs.playerIds) ? refs.playerIds.length : 0;
  const fields = Array.isArray(refs.fields)
    ? refs.fields.filter((item): item is string => typeof item === 'string')
      .filter(item => !/(?:id|ids)$/iu.test(keyName(item)))
      .map(item => safeString(item))
    : [];
  return { matchCount: matches, playerCount: players, fields };
}

function safeKeyForIdentifier(key: string, id: string, names: PublicNames): [string, unknown] | null {
  const normalized = keyName(key);
  if (normalized === 'matchid') return ['matchReference', matchReference(id, names)];
  if (normalized === 'actorplayerid') return ['actorName', names.byId.get(id) ?? null];
  if (normalized === 'victimplayerid') return ['victimName', names.byId.get(id) ?? null];
  if (normalized === 'playerid' || normalized === 'accountid') return ['playerName', names.byId.get(id) ?? null];
  return null;
}

function sanitizePublicValue(value: unknown, names: PublicNames, parentKey = ''): unknown {
  if (Array.isArray(value)) return value.map(item => sanitizePublicValue(item, names, parentKey));
  if (typeof value === 'string') return replaceKnownIdentifiers(value, names);
  const row = object(value);
  if (!row) return value;

  const result: Record<string, unknown> = {};
  // Stats rows use Domain `key` for a PUBG account identifier. Replace it with
  // the public roster name; all other opaque row keys stay private.
  const rowPlayerName = typeof row.key === 'string' ? names.byId.get(row.key) : undefined;
  if (rowPlayerName) result.playerName = rowPlayerName;

  for (const [key, item] of Object.entries(row)) {
    const normalized = keyName(key);
    if (normalized === 'evidencerefs') {
      result.evidence = evidenceSummary(item);
      continue;
    }
    if (normalized === 'matchid') {
      if (typeof item === 'string') result.matchReference = matchReference(item, names);
      continue;
    }
    if (typeof item === 'string' && /(?:player|account)[_-]?id$/iu.test(key)) {
      const mapped = safeKeyForIdentifier(key, item, names);
      if (mapped && mapped[1] !== null) result[mapped[0]] = mapped[1];
      continue;
    }
    if (OMIT_KEYS.has(normalized) || normalized.startsWith('debug') || normalized.startsWith('diagnostic')) continue;
    if (normalized.endsWith('matchids') || normalized === 'order') {
      const refs = Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === 'string').map(id => matchReference(id, names)) : [];
      const outputKey = normalized === 'order' || normalized === 'orderedmatchids'
        ? 'orderedMatches'
        : key.replace(/matchIds$/iu, 'matchReferences');
      result[outputKey] = refs;
      continue;
    }
    if (normalized.endsWith('playerids') || normalized.endsWith('accountids')) {
      const players = Array.isArray(item)
        ? item.flatMap(id => typeof id === 'string' && names.byId.has(id) ? [names.byId.get(id)!] : [])
        : [];
      result[key.replace(/(?:player|account)ids$/iu, 'players')] = players;
      continue;
    }
    if (normalized === 'key') {
      if (typeof item === 'string' && !names.byId.has(item)) {
        // `key` is an implementation grouping field; only its authorized
        // roster projection above is meaningful to the Agent.
      }
      continue;
    }
    if (normalized === 'label' && rowPlayerName) continue;
    result[key] = sanitizePublicValue(item, names, key);
  }
  if (parentKey === 'error' && 'reason' in result) delete result.reason;
  return result;
}

export function buildPublicAgentSourceRange(queryResolved: unknown, now: Date): Record<string, unknown> | null {
  const resolved = object(queryResolved);
  const range = object(resolved?.sourceRange);
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

/** Keeps the complete Domain result and shared presentation contract while
 * removing transport/session identifiers, opaque PUBG IDs, and diagnostics. */
export function buildPublicAgentFacts(input: PublicAgentFactsInput): Record<string, unknown> {
  const names = rosterNames(input.roster);
  collectMatchReferences(input.data, names);
  collectMatchReferences(input.queryResolved, names);
  collectMatchReferences(input.evidenceRefs, names);
  const facts: Record<string, unknown> = {
    status: input.status,
    data: input.data,
    coverage: input.coverage,
    asOf: input.asOf,
    ...(input.metricVersion ? { metricVersion: input.metricVersion } : {}),
    queryResolved: input.queryResolved,
    evidenceRefs: input.evidenceRefs,
    ...(input.error ? { error: input.error } : {}),
    presentation: input.presentation,
    displayText: input.displayText,
    dataUpdatedAt: input.asOf,
    dataUpdatedAtLocal: formatDisplayTime(input.asOf, { timezone: DEFAULT_TIMEZONE, now: new Date(input.now), forceDate: true }),
    displayTimezone: DEFAULT_TIMEZONE,
    ...(buildPublicAgentSourceRange(input.queryResolved, input.now)
      ? { sourceRangeLocal: buildPublicAgentSourceRange(input.queryResolved, input.now) }
      : {}),
  };
  return sanitizePublicValue(facts, names) as Record<string, unknown>;
}
