import { readFile } from 'node:fs/promises';
import { normalizeState, type PresenceObservation } from './domain.js';

/**
 * Steam Web API client (polling only: no Steam login, no CM). The key is read from a protected file and only ever
 * placed in the request query; it never appears in errors, logs or results. Network settings come from the process
 * environment (Node honours NODE_USE_ENV_PROXY / HTTP(S)_PROXY / NO_PROXY with the built-in fetch), and the base URL
 * can be pointed at a relay when direct access is unavailable.
 */
export const STEAM_API_BASE = 'https://api.steampowered.com';
export const STEAM_STORE_BASE = 'https://store.steampowered.com';
export const SUMMARIES_BATCH = 100;

export class SteamApiError extends Error {
  constructor(readonly code: 'key_missing' | 'rate_limited' | 'forbidden' | 'http_error' | 'network' | 'bad_response', readonly status?: number) {
    super(`steam_${code}${status ? `_${status}` : ''}`);
  }
}

export interface SteamClientOptions {
  baseUrl?: string;
  /** The public storefront (name search); the Web API base is used for everything else. */
  storeBaseUrl?: string;
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

const ACHIEVEMENT_LANGUAGE = 'schinese';

export interface AchievementState {
  apiName: string;
  achieved: boolean;
  /** When it was unlocked (ms); absent when not unlocked or Steam gave no time. */
  unlockedAt?: number;
  name?: string;
  description?: string;
}

export interface AchievementDefinition {
  apiName: string;
  name: string;
  description?: string;
  hidden: boolean;
}

export interface PlayerBans {
  steamId: string;
  communityBanned: boolean;
  vacBanned: boolean;
  vacBans: number;
  gameBans: number;
  daysSinceLastBan: number;
  economyBan: string;
}

export interface BadgeSummary {
  level: number;
  xp: number;
  xpToNextLevel: number;
  badgeCount: number;
}

export interface NewsItem {
  gid: string;
  title: string;
  url: string;
  feedLabel?: string;
  date: number;
  contents: string;
}

export interface WishlistEntry {
  appId: number;
  priority: number;
  addedAt?: number;
}

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

  private async get(path: string, params: Record<string, string>, options: { acceptBadRequest?: boolean } = {}): Promise<unknown> {
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
        if (status === 400 && options.acceptBadRequest) {
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

  /** The user's friends (ids only). Steam answers 401 for a private friend list, which is unknown, not "no friends". */
  async friendList(steamId: string): Promise<Unknown<string[]>> {
    try {
      const body = await this.get('/ISteamUser/GetFriendList/v1/', { steamid: steamId, relationship: 'friend' }) as { friendslist?: { friends?: Array<{ steamid?: unknown }> } };
      const friends = body.friendslist?.friends;
      if (!Array.isArray(friends)) return { known: false, reason: 'profile_private' };
      return { known: true, value: friends.map((friend) => friend.steamid).filter((id): id is string => typeof id === 'string') };
    } catch (error) {
      if (error instanceof SteamApiError && error.code === 'forbidden' && error.status === 401) return { known: false, reason: 'profile_private' };
      throw error;
    }
  }

  async ownedGames(steamId: string): Promise<Unknown<GameStat[]>> {
    const body = await this.get('/IPlayerService/GetOwnedGames/v1/', { steamid: steamId, include_appinfo: '1', include_played_free_games: '1' }) as { response?: { games?: unknown[]; game_count?: number } };
    if (!Array.isArray(body.response?.games)) return { known: false, reason: 'profile_private' };
    return { known: true, value: body.response!.games!.map(parseGame).filter((game): game is GameStat => game !== undefined) };
  }

  /** The Steam level; Steam answers an empty response for a private profile. */
  async steamLevel(steamId: string): Promise<Unknown<number>> {
    const body = await this.get('/IPlayerService/GetSteamLevel/v1/', { steamid: steamId }) as { response?: { player_level?: unknown } };
    const level = body.response?.player_level;
    return typeof level === 'number' ? { known: true, value: level } : { known: false, reason: 'profile_private' };
  }

  async badges(steamId: string): Promise<Unknown<BadgeSummary>> {
    const body = await this.get('/IPlayerService/GetBadges/v1/', { steamid: steamId }) as { response?: { badges?: unknown[]; player_xp?: unknown; player_level?: unknown; player_xp_needed_to_level_up?: unknown } };
    const response = body.response;
    if (!response || typeof response.player_level !== 'number') return { known: false, reason: 'profile_private' };
    return {
      known: true,
      value: {
        level: response.player_level,
        xp: typeof response.player_xp === 'number' ? response.player_xp : 0,
        xpToNextLevel: typeof response.player_xp_needed_to_level_up === 'number' ? response.player_xp_needed_to_level_up : 0,
        badgeCount: Array.isArray(response.badges) ? response.badges.length : 0,
      },
    };
  }

  /** Ban status is public on every profile; batched in groups of 100. */
  async playerBans(steamIds: string[]): Promise<Map<string, PlayerBans>> {
    const result = new Map<string, PlayerBans>();
    for (let index = 0; index < steamIds.length; index += SUMMARIES_BATCH) {
      const body = await this.get('/ISteamUser/GetPlayerBans/v1/', { steamids: steamIds.slice(index, index + SUMMARIES_BATCH).join(',') }) as { players?: unknown[] };
      if (!Array.isArray(body.players)) throw new SteamApiError('bad_response');
      for (const raw of body.players) {
        const item = raw as Record<string, unknown> | null;
        if (!item || typeof item.SteamId !== 'string') continue;
        result.set(item.SteamId, {
          steamId: item.SteamId, communityBanned: item.CommunityBanned === true, vacBanned: item.VACBanned === true,
          vacBans: typeof item.NumberOfVACBans === 'number' ? item.NumberOfVACBans : 0,
          gameBans: typeof item.NumberOfGameBans === 'number' ? item.NumberOfGameBans : 0,
          daysSinceLastBan: typeof item.DaysSinceLastBan === 'number' ? item.DaysSinceLastBan : 0,
          economyBan: typeof item.EconomyBan === 'string' ? item.EconomyBan : 'none',
        });
      }
    }
    return result;
  }

  /** How many people are playing a game right now; undefined when Steam does not report it. */
  async currentPlayers(appId: string): Promise<number | undefined> {
    const body = await this.get('/ISteamUserStats/GetNumberOfCurrentPlayers/v1/', { appid: appId }, { acceptBadRequest: true }) as { response?: { player_count?: unknown; result?: unknown } };
    return body.response?.result === 1 && typeof body.response.player_count === 'number' ? body.response.player_count : undefined;
  }

  async news(appId: string, count: number): Promise<NewsItem[]> {
    const body = await this.get('/ISteamNews/GetNewsForApp/v2/', { appid: appId, count: String(count), maxlength: '400' }, { acceptBadRequest: true }) as { appnews?: { newsitems?: unknown[] } };
    return (body.appnews?.newsitems ?? []).flatMap((raw): NewsItem[] => {
      const item = raw as Record<string, unknown> | null;
      if (!item || typeof item.title !== 'string') return [];
      return [{
        gid: String(item.gid ?? ''), title: item.title, url: typeof item.url === 'string' ? item.url : '',
        ...(typeof item.feedlabel === 'string' ? { feedLabel: item.feedlabel } : {}),
        date: typeof item.date === 'number' ? item.date * 1000 : 0,
        contents: typeof item.contents === 'string' ? item.contents : '',
      }];
    });
  }

  /** A person's own numbers in one game (CS2 and similar). Private details and games without stats are unknown, never zero. */
  async userStats(steamId: string, appId: string): Promise<Unknown<{ gameName?: string; stats: Array<{ name: string; value: number }> }>> {
    try {
      const body = await this.get('/ISteamUserStats/GetUserStatsForGame/v2/', { steamid: steamId, appid: appId }) as { playerstats?: { gameName?: unknown; stats?: unknown[] } };
      const stats = body.playerstats?.stats;
      if (!Array.isArray(stats) || !stats.length) return { known: false, reason: 'not_available' };
      return {
        known: true,
        value: {
          ...(typeof body.playerstats?.gameName === 'string' ? { gameName: body.playerstats.gameName } : {}),
          stats: stats.flatMap((raw) => { const item = raw as Record<string, unknown> | null; return item && typeof item.name === 'string' && typeof item.value === 'number' ? [{ name: item.name, value: item.value }] : []; }),
        },
      };
    } catch (error) {
      if (error instanceof SteamApiError && error.code === 'forbidden') return { known: false, reason: 'profile_private' };
      if (error instanceof SteamApiError && error.code === 'http_error' && error.status === 400) return { known: false, reason: 'not_available' };
      throw error;
    }
  }

  /** The official wishlist endpoint. An empty answer is both "private" and "nothing on it", so it is reported as not available. */
  async wishlist(steamId: string): Promise<Unknown<WishlistEntry[]>> {
    const body = await this.get('/IWishlistService/GetWishlist/v1/', { steamid: steamId }) as { response?: { items?: unknown[] } };
    const items = body.response?.items;
    if (!Array.isArray(items) || !items.length) return { known: false, reason: 'not_available' };
    return {
      known: true,
      value: items.flatMap((raw): WishlistEntry[] => {
        const item = raw as Record<string, unknown> | null;
        return item && typeof item.appid === 'number' ? [{ appId: item.appid, priority: typeof item.priority === 'number' ? item.priority : 0, ...(typeof item.date_added === 'number' ? { addedAt: item.date_added * 1000 } : {}) }] : [];
      }),
    };
  }

  /** Store names for app ids, in batches (official IStoreBrowseService). Ids the store does not know are simply absent. */
  async storeNames(appIds: number[]): Promise<Map<number, string>> {
    const result = new Map<number, string>();
    for (let index = 0; index < appIds.length; index += 50) {
      const input = JSON.stringify({ ids: appIds.slice(index, index + 50).map((appid) => ({ appid })), context: { language: 'schinese', country_code: 'CN' }, data_request: {} });
      const body = await this.get('/IStoreBrowseService/GetItems/v1/', { input_json: input }) as { response?: { store_items?: unknown[] } };
      for (const raw of body.response?.store_items ?? []) {
        const item = raw as Record<string, unknown> | null;
        if (item && typeof item.appid === 'number' && typeof item.name === 'string') result.set(item.appid, item.name);
      }
    }
    return result;
  }

  /** Name search on the public storefront JSON endpoint (no scraping, no key); best matches first. */
  async storeSearch(term: string): Promise<Array<{ appId: number; name: string }>> {
    const base = (this.options.storeBaseUrl ?? STEAM_STORE_BASE).replace(/\/$/u, '');
    const url = new URL(`${base}/api/storesearch/`);
    url.searchParams.set('term', term);
    url.searchParams.set('l', 'schinese');
    url.searchParams.set('cc', 'CN');
    const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000), headers: { accept: 'application/json' } }).catch(() => undefined);
    if (!response?.ok) throw new SteamApiError(response && response.status === 429 ? 'rate_limited' : 'network', response?.status);
    const body = await response.json().catch(() => ({})) as { items?: unknown[] };
    return (body.items ?? []).flatMap((raw) => { const item = raw as Record<string, unknown> | null; return item && item.type === 'app' && typeof item.id === 'number' && typeof item.name === 'string' ? [{ appId: item.id, name: item.name }] : []; });
  }

  async recentGames(steamId: string): Promise<Unknown<GameStat[]>> {
    const body = await this.get('/IPlayerService/GetRecentlyPlayedGames/v1/', { steamid: steamId, count: '10' }) as { response?: { games?: unknown[]; total_count?: number } };
    const response = body.response;
    if (!response) return { known: false, reason: 'profile_private' };
    // Steam omits `games` both for a private profile and for nothing played; a total_count of 0 is the genuine "none".
    if (!Array.isArray(response.games)) return response.total_count === 0 ? { known: true, value: [] } : { known: false, reason: 'profile_private' };
    return { known: true, value: response.games.map(parseGame).filter((game): game is GameStat => game !== undefined) };
  }
  /**
   * One person's achievements in one game. Steam answers 400 for a private profile ("not public") and for a game
   * without stats; both are unknown, never "zero achievements".
   */
  async playerAchievements(steamId: string, appId: string): Promise<Unknown<AchievementState[]>> {
    const body = await this.get('/ISteamUserStats/GetPlayerAchievements/v1/', { steamid: steamId, appid: appId, l: ACHIEVEMENT_LANGUAGE }, { acceptBadRequest: true }) as { playerstats?: { success?: boolean; error?: string; achievements?: unknown[] } };
    const stats = body.playerstats;
    if (!stats?.success) return { known: false, reason: /not public/iu.test(stats?.error ?? '') ? 'profile_private' : 'not_available' };
    if (!Array.isArray(stats.achievements)) return { known: false, reason: 'not_available' };
    return {
      known: true,
      value: stats.achievements.flatMap((raw): AchievementState[] => {
        const item = raw as Record<string, unknown> | null;
        if (!item || typeof item.apiname !== 'string') return [];
        const achieved = item.achieved === 1 || item.achieved === true;
        return [{
          apiName: item.apiname, achieved,
          ...(achieved && typeof item.unlocktime === 'number' && item.unlocktime > 0 ? { unlockedAt: item.unlocktime * 1000 } : {}),
          ...(typeof item.name === 'string' && item.name ? { name: item.name } : {}),
          ...(typeof item.description === 'string' && item.description ? { description: item.description } : {}),
        }];
      }),
    };
  }

  /** Display names, descriptions and hidden flags of a game's achievements. Empty when the game has none. */
  async achievementSchema(appId: string): Promise<AchievementDefinition[]> {
    const body = await this.get('/ISteamUserStats/GetSchemaForGame/v2/', { appid: appId, l: ACHIEVEMENT_LANGUAGE }) as { game?: { availableGameStats?: { achievements?: unknown[] } } };
    const list = body.game?.availableGameStats?.achievements;
    if (!Array.isArray(list)) return [];
    return list.flatMap((raw): AchievementDefinition[] => {
      const item = raw as Record<string, unknown> | null;
      if (!item || typeof item.name !== 'string') return [];
      return [{
        apiName: item.name,
        name: typeof item.displayName === 'string' && item.displayName ? item.displayName : item.name,
        ...(typeof item.description === 'string' && item.description ? { description: item.description } : {}),
        hidden: item.hidden === 1,
      }];
    });
  }

  /** Share of all players who unlocked each achievement, in percent, keyed by api name. */
  async achievementPercentages(appId: string): Promise<Map<string, number>> {
    const body = await this.get('/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/', { gameid: appId }, { acceptBadRequest: true }) as { achievementpercentages?: { achievements?: unknown[] } };
    const result = new Map<string, number>();
    for (const raw of body.achievementpercentages?.achievements ?? []) {
      const item = raw as Record<string, unknown> | null;
      const percent = typeof item?.percent === 'number' ? item.percent : typeof item?.percent === 'string' ? Number(item.percent) : NaN;
      if (item && typeof item.name === 'string' && Number.isFinite(percent)) result.set(item.name, Math.round(percent * 10) / 10);
    }
    return result;
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
