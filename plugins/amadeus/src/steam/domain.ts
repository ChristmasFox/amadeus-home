/**
 * Steam presence domain: pure, channel-free logic (no network, storage or host imports) so it can move to a shared
 * package unchanged. Everything that decides whether a notification is sent lives here and is deterministic.
 */

export type PresenceState = 'offline' | 'online' | 'in_game' | 'away';

export interface PresenceObservation {
  steamId: string;
  state: PresenceState;
  /** Raw Steam persona state, kept for diagnostics only. */
  personaState: number | undefined;
  gameId?: string;
  gameName?: string;
  /** True when the profile hides its status, so "offline" may mean "not shared". */
  profilePublic: boolean;
}

const STEAM_ID64 = /^7656119\d{10}$/u;
const VANITY = /^[A-Za-z0-9_-]{2,32}$/u;

export type SteamReference =
  | { kind: 'steamid'; steamId: string }
  | { kind: 'vanity'; vanity: string };

/** A SteamID64, a profile link (/profiles/<id> or /id/<vanity>) or a bare vanity name. Anything else is undefined. */
export function parseSteamReference(input: string): SteamReference | undefined {
  const text = input.trim();
  if (!text) return undefined;
  if (STEAM_ID64.test(text)) return { kind: 'steamid', steamId: text };
  const link = /^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/(profiles|id)\/([^/?#\s]+)\/?(?:[?#].*)?$/iu.exec(text);
  if (link) {
    const [, type, value] = link;
    if (type!.toLowerCase() === 'profiles') return STEAM_ID64.test(value!) ? { kind: 'steamid', steamId: value! } : undefined;
    return VANITY.test(value!) ? { kind: 'vanity', vanity: value! } : undefined;
  }
  return VANITY.test(text) ? { kind: 'vanity', vanity: text } : undefined;
}

export function normalizeState(personaState: number | undefined, gameId: string | undefined): PresenceState {
  if (personaState === undefined || personaState === 0) return 'offline';
  if (personaState === 3 || personaState === 4) return 'away';
  return gameId ? 'in_game' : 'online';
}

export const isOnlineState = (state: PresenceState): boolean => state === 'online' || state === 'in_game';

export interface PresenceRecord {
  state: PresenceState;
  /** When the state last changed (ms). */
  since: number;
  gameId?: string;
  gameName?: string;
  lastNotifiedAt?: number;
}

export interface PresenceChange {
  steamId: string;
  gameId?: string;
  gameName?: string;
  /** When the online state was first observed (ms). */
  at: number;
}

export interface TransitionResult {
  record: PresenceRecord;
  /** Set only for a confirmed offline/away to online transition. */
  event?: PresenceChange;
}

/**
 * One observation applied to the stored record. A change must be seen on two consecutive observations to count
 * (`pending`), which absorbs reconnect flaps. The very first observation of an id only sets the baseline.
 */
export interface StoredPresence extends PresenceRecord {
  pending?: { state: PresenceState; gameId?: string; gameName?: string; since: number };
}

export function applyObservation(previous: StoredPresence | undefined, observation: PresenceObservation, now: number): { next: StoredPresence; event?: PresenceChange } {
  const observed = { state: observation.state, ...(observation.gameId ? { gameId: observation.gameId } : {}), ...(observation.gameName ? { gameName: observation.gameName } : {}) };
  if (!previous) return { next: { ...observed, since: now } };
  // Same state: only the game details move; no event.
  if (observation.state === previous.state) {
    const { pending: _pending, gameId: _gameId, gameName: _gameName, ...rest } = previous;
    return { next: { ...rest, ...(observed.gameId ? { gameId: observed.gameId } : {}), ...(observed.gameName ? { gameName: observed.gameName } : {}) } };
  }
  if (!previous.pending || previous.pending.state !== observation.state) {
    return { next: { ...previous, pending: { ...observed, since: now } } };
  }
  // Confirmed on the second consecutive observation.
  const wasOnline = isOnlineState(previous.state);
  const nowOnline = isOnlineState(observation.state);
  const confirmedAt = previous.pending.since;
  const next: StoredPresence = { ...observed, since: confirmedAt, ...(previous.lastNotifiedAt !== undefined ? { lastNotifiedAt: previous.lastNotifiedAt } : {}) };
  if (!wasOnline && nowOnline && previous.state === 'offline') {
    return { next, event: { steamId: observation.steamId, ...(observed.gameId ? { gameId: observed.gameId } : {}), ...(observed.gameName ? { gameName: observed.gameName } : {}), at: confirmedAt } };
  }
  return { next };
}

export interface QuietHours {
  /** Hour of day, local, 0-23. Start is inclusive, end exclusive; start > end wraps midnight. */
  startHour: number;
  endHour: number;
  timeZone: string;
}

export const DEFAULT_QUIET: QuietHours = { startHour: 0, endHour: 9, timeZone: 'Asia/Shanghai' };

export function localHour(at: number, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(at));
  return Number(hour);
}

export function inQuietHours(at: number, quiet: QuietHours = DEFAULT_QUIET): boolean {
  const hour = localHour(at, quiet.timeZone);
  return quiet.startHour <= quiet.endHour ? hour >= quiet.startHour && hour < quiet.endHour : hour >= quiet.startHour || hour < quiet.endHour;
}

/** Daytime 60 s, overnight 5 min (the quiet window). */
export function pollIntervalMs(at: number, quiet: QuietHours = DEFAULT_QUIET, daytimeMs = 60_000, nightMs = 300_000): number {
  return inQuietHours(at, quiet) ? nightMs : daytimeMs;
}

export interface BroadcastPolicy {
  quiet: QuietHours;
  /** Same person: minimum gap between two announcements. */
  cooldownMs: number;
  /** Events landing within this window of the first one are merged into one message. */
  mergeWindowMs: number;
  maxPerGroupPerHour: number;
}

export const DEFAULT_POLICY: BroadcastPolicy = { quiet: DEFAULT_QUIET, cooldownMs: 60 * 60_000, mergeWindowMs: 3 * 60_000, maxPerGroupPerHour: 6 };

export type SkipReason = 'quiet_hours' | 'cooldown' | 'rate_limited' | 'stale';

export interface Candidate extends PresenceChange {
  lastNotifiedAt?: number;
}

export interface BroadcastPlan {
  /** One merged batch of people to announce, or undefined. */
  send?: PresenceChange[];
  /** Candidates dropped for good (never retried or made up later). */
  skipped: Array<{ steamId: string; reason: SkipReason }>;
  /** Candidates not yet due: they stay queued until the merge window closes. */
  waiting: string[];
}

/**
 * Decide what one group announces now. Quiet-hour and cooldown drops are final; a rate-limited batch is dropped
 * too (nothing is replayed later). People inside the merge window wait so that simultaneous arrivals share one message.
 */
export function planBroadcast(candidates: Candidate[], now: number, sentInLastHour: number, policy: BroadcastPolicy = DEFAULT_POLICY): BroadcastPlan {
  const plan: BroadcastPlan = { skipped: [], waiting: [] };
  const eligible: Candidate[] = [];
  for (const candidate of candidates) {
    if (inQuietHours(candidate.at, policy.quiet) || inQuietHours(now, policy.quiet)) plan.skipped.push({ steamId: candidate.steamId, reason: 'quiet_hours' });
    else if (candidate.lastNotifiedAt !== undefined && candidate.at - candidate.lastNotifiedAt < policy.cooldownMs) plan.skipped.push({ steamId: candidate.steamId, reason: 'cooldown' });
    else eligible.push(candidate);
  }
  if (!eligible.length) return plan;
  const first = Math.min(...eligible.map((entry) => entry.at));
  if (now - first < policy.mergeWindowMs) {
    plan.waiting.push(...eligible.map((entry) => entry.steamId));
    return plan;
  }
  if (sentInLastHour >= policy.maxPerGroupPerHour) {
    plan.skipped.push(...eligible.map((entry) => ({ steamId: entry.steamId, reason: 'rate_limited' as const })));
    return plan;
  }
  plan.send = eligible.map(({ lastNotifiedAt: _ignored, ...change }) => change);
  return plan;
}

/** Idempotency key of one announcement: the group, and every included id with the moment it came online. */
export function announcementKey(groupId: string, changes: PresenceChange[]): string {
  return `steam:${groupId}:${[...changes].sort((a, b) => a.steamId.localeCompare(b.steamId)).map((entry) => `${entry.steamId}@${entry.at}`).join(',')}`;
}
