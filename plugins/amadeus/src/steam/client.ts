import { readFile } from 'node:fs/promises';
import { normalizeState, type PresenceObservation } from './domain.js';

/**
 * Steam Web API client (polling only: no Steam login, no CM). The key is read from a protected file and only ever
 * placed in the request query; it never appears in errors, logs or results. Network settings come from the process
 * environment (Node honours NODE_USE_ENV_PROXY / HTTP(S)_PROXY / NO_PROXY with the built-in fetch), and the base URL
 * can be pointed at a relay when direct access is unavailable.
 */
export const STEAM_API_BASE = 'https://api.steampowered.com';
export const SUMMARIES_BATCH = 100;

export class SteamApiError extends Error {
  constructor(readonly code: 'key_missing' | 'rate_limited' | 'forbidden' | 'http_error' | 'network' | 'bad_response', readonly status?: number) {
    super(`steam_${code}${status ? `_${status}` : ''}`);
  }
}

export interface SteamClientOptions {
  baseUrl?: string;
  keyFile?: string;
  /** Injected for tests; the key is otherwise read from keyFile on first use. */
  apiKey?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Minimum spacing between requests. */
  minIntervalMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
  now?: () => number;
}

export interface PlayerSummary {
  steamId: string;
  name: string;
  avatarUrl?: string;
  profilePublic: boolean;
  personaState: number | undefined;
  gameId?: string;
  gameName?: string;
  lastLogoff?: number;
  createdAt?: number;
}

export type Unknown<T> = { known: true; value: T } | { known: false; reason: 'profile_private' | 'not_available' };

export interface GameStat {
  appId: number;
  name?: string;
  totalMinutes: number;
  recentMinutes?: number;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class SteamClient {
  private key: string | undefined;
  private lastRequestAt = 0;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly options: SteamClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? STEAM_API_BASE).replace(/\/$/u, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? realSleep;
    this.now = options.now ?? Date.now;
    this.key = options.apiKey;
  }

  private async apiKey(): Promise<string> {
    if (this.key) return this.key;
    if (!this.options.keyFile) throw new SteamApiError('key_missing');
    try {
      const value = (await readFile(this.options.keyFile, 'utf8')).trim();
      if (!value) throw new Error('empty');
      this.key = value;
      return value;
    } catch {
      throw new SteamApiError('key_missing');
    }
  }

  async hasKey(): Promise<boolean> {
    try { await this.apiKey(); return true; } catch { return false; }
  }

  private async get(path: string, params: Record<string, string>): Promise<unknown> {
    const key = await this.apiKey();
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    url.searchParams.set('key', key);
    const maxRetries = this.options.maxRetries ?? 2;
    for (let attempt = 0; ; attempt += 1) {
      const wait = (this.options.minIntervalMs ?? 250) - (this.now() - this.lastRequestAt);
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = this.now();
      let status: number | undefined;
      try {
        const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000), headers: { accept: 'application/json' } });
        status = response.status;
        if (response.ok) {
          try { return await response.json(); } catch { throw new SteamApiError('bad_response', status); }
        }
        if (status === 401 || status === 403) throw new SteamApiError('forbidden', status);
        if (status !== 429 && status < 500) throw new SteamApiError('http_error', status);
      } catch (error) {
        if (error instanceof SteamApiError && error.code !== 'rate_limited') throw error;
        if (!(error instanceof SteamApiError) && attempt >= maxRetries) throw new SteamApiError('network');
      }
      if (attempt >= maxRetries) throw new SteamApiError(status === 429 ? 'rate_limited' : 'http_error', status);
      await this.sleep(500 * 2 ** attempt);
    }
  }

  async resolveVanity(vanity: string): Promise<string | undefined> {
    const body = await this.get('/ISteamUser/ResolveVanityURL/v1/', { vanityurl: vanity }) as { response?: { success?: number; steamid?: string } };
    return body.response?.success === 1 && typeof body.response.steamid === 'string' ? body.response.steamid : undefined;
  }

  /** Batched in groups of 100; ids Steam does not return are simply absent. */
  async playerSummaries(steamIds: string[]): Promise<Map<string, PlayerSummary>> {
    const result = new Map<string, PlayerSummary>();
    for (let index = 0; index < steamIds.length; index += SUMMARIES_BATCH) {
      const batch = steamIds.slice(index, index + SUMMARIES_BATCH);
      const body = await this.get('/ISteamUser/GetPlayerSummaries/v2/', { steamids: batch.join(',') }) as { response?: { players?: unknown[] } };
      if (!Array.isArray(body.response?.players)) throw new SteamApiError('bad_response');
      for (const raw of body.response!.players!) {
        const player = parseSummary(raw);
        if (player) result.set(player.steamId, player);
      }
    }
    return result;
  }

  async ownedGames(steamId: string): Promise<Unknown<GameStat[]>> {
    const body = await this.get('/IPlayerService/GetOwnedGames/v1/', { steamid: steamId, include_appinfo: '1', include_played_free_games: '1' }) as { response?: { games?: unknown[]; game_count?: number } };
    if (!Array.isArray(body.response?.games)) return { known: false, reason: 'profile_private' };
    return { known: true, value: body.response!.games!.map(parseGame).filter((game): game is GameStat => game !== undefined) };
  }

  async recentGames(steamId: string): Promise<Unknown<GameStat[]>> {
    const body = await this.get('/IPlayerService/GetRecentlyPlayedGames/v1/', { steamid: steamId, count: '10' }) as { response?: { games?: unknown[]; total_count?: number } };
    const response = body.response;
    if (!response) return { known: false, reason: 'profile_private' };
    // Steam omits `games` both for a private profile and for nothing played; a total_count of 0 is the genuine "none".
    if (!Array.isArray(response.games)) return response.total_count === 0 ? { known: true, value: [] } : { known: false, reason: 'profile_private' };
    return { known: true, value: response.games.map(parseGame).filter((game): game is GameStat => game !== undefined) };
  }
}

function parseSummary(raw: unknown): PlayerSummary | undefined {
  const player = raw as Record<string, unknown> | null;
  if (!player || typeof player.steamid !== 'string') return undefined;
  const visibility = typeof player.communityvisibilitystate === 'number' ? player.communityvisibilitystate : undefined;
  const gameId = typeof player.gameid === 'string' ? player.gameid : typeof player.gameid === 'number' ? String(player.gameid) : undefined;
  return {
    steamId: player.steamid,
    name: typeof player.personaname === 'string' ? player.personaname : '',
    ...(typeof player.avatarfull === 'string' ? { avatarUrl: player.avatarfull } : {}),
    profilePublic: visibility === 3,
    personaState: typeof player.personastate === 'number' ? player.personastate : undefined,
    ...(gameId ? { gameId } : {}),
    ...(typeof player.gameextrainfo === 'string' ? { gameName: player.gameextrainfo } : {}),
    ...(typeof player.lastlogoff === 'number' ? { lastLogoff: player.lastlogoff * 1000 } : {}),
    ...(typeof player.timecreated === 'number' ? { createdAt: player.timecreated * 1000 } : {}),
  };
}

function parseGame(raw: unknown): GameStat | undefined {
  const game = raw as Record<string, unknown> | null;
  if (!game || typeof game.appid !== 'number') return undefined;
  return {
    appId: game.appid,
    ...(typeof game.name === 'string' ? { name: game.name } : {}),
    totalMinutes: typeof game.playtime_forever === 'number' ? game.playtime_forever : 0,
    ...(typeof game.playtime_2weeks === 'number' ? { recentMinutes: game.playtime_2weeks } : {}),
  };
}

export function observationFrom(summary: PlayerSummary): PresenceObservation {
  return {
    steamId: summary.steamId,
    state: normalizeState(summary.personaState, summary.gameId),
    personaState: summary.personaState,
    ...(summary.gameId ? { gameId: summary.gameId } : {}),
    ...(summary.gameName ? { gameName: summary.gameName } : {}),
    profilePublic: summary.profilePublic,
  };
}
