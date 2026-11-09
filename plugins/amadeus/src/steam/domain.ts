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

export type EventKind = 'came_online' | 'started_playing' | 'switched_game' | 'back_from_away' | 'achievement_unlocked';

export interface UnlockedAchievement {
  apiName: string;
  name: string;
  /** Share of all players who unlocked it, in percent, when known. */
  globalPercent?: number;
}

export interface PresenceRecord {
  state: PresenceState;
  /** When the state last changed (ms). */
  since: number;
  gameId?: string;
  gameName?: string;
}

export interface PresenceChange {
  steamId: string;
  kind: EventKind;
  gameId?: string;
  gameName?: string;
  /** When the new state was first observed (ms). */
  at: number;
  /** For achievement_unlocked: what was just unlocked. */
  achievements?: UnlockedAchievement[];
}

/** What the poller remembers per SteamID: the last seen state. There is no debounce: one observation is enough. */
export type StoredPresence = PresenceRecord;

function eventFor(previous: StoredPresence, observed: { state: PresenceState; gameId?: string }): EventKind | undefined {
  if (!isOnlineState(observed.state)) return undefined;
  if (previous.state === 'offline') return 'came_online';
  if (previous.state === 'away') return 'back_from_away';
  if (observed.state === 'in_game') return previous.state === 'online' ? 'started_playing' : previous.gameId !== observed.gameId ? 'switched_game' : undefined;
  return undefined;
}

/**
 * One observation applied to the stored record: any change of state or game is an event at once. The very first
 * observation of an id only sets the baseline, so a restart never replays history.
 */
export function applyObservation(previous: StoredPresence | undefined, observation: PresenceObservation, now: number): { next: StoredPresence; event?: PresenceChange } {
  const observed = { state: observation.state, ...(observation.gameId ? { gameId: observation.gameId } : {}), ...(observation.gameName ? { gameName: observation.gameName } : {}) };
  if (!previous) return { next: { ...observed, since: now } };
  if (observation.state === previous.state && observation.gameId === previous.gameId) {
    return { next: { ...observed, since: previous.since } };
  }
  const next: StoredPresence = { ...observed, since: now };
  const kind = eventFor(previous, observed);
  if (!kind) return { next };
  return {
    next,
    event: { steamId: observation.steamId, kind, at: now, ...(observed.gameId ? { gameId: observed.gameId } : {}), ...(observed.gameName ? { gameName: observed.gameName } : {}) },
  };
}

/** One poll a minute, day and night. */
export const POLL_INTERVAL_MS = 60_000;

export interface BroadcastPolicy {
  /** Events landing within this window of the first one are merged into one message. */
  mergeWindowMs: number;
}

/** By decision there is no cooldown, no debounce, no quiet hours and no per-group cap: only the merge window remains. */
export const DEFAULT_POLICY: BroadcastPolicy = { mergeWindowMs: 3 * 60_000 };

export type Candidate = PresenceChange;

export interface BroadcastPlan {
  /** One merged batch to announce, or undefined. */
  send?: PresenceChange[];
  /** Candidates not yet due: they stay queued until the merge window closes. */
  waiting: string[];
}

/** People inside the merge window wait so that simultaneous events share one message; then everything queued goes out. */
export function planBroadcast(candidates: Candidate[], now: number, policy: BroadcastPolicy = DEFAULT_POLICY): BroadcastPlan {
  if (!candidates.length) return { waiting: [] };
  const first = Math.min(...candidates.map((entry) => entry.at));
  if (now - first < policy.mergeWindowMs) return { waiting: candidates.map((entry) => entry.steamId) };
  return { send: candidates, waiting: [] };
}

/** Idempotency key of one announcement: the group, and every included id with its event type and the moment it happened. */
export function announcementKey(groupId: string, changes: PresenceChange[]): string {
  return `steam:${groupId}:${[...changes].sort((a, b) => a.steamId.localeCompare(b.steamId)).map((entry) => `${entry.steamId}:${entry.kind}@${entry.at}${entry.achievements ? `[${entry.achievements.map((item) => item.apiName).sort().join('+')}]` : ''}`).join(',')}`;
}
