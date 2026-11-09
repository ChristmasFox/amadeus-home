import { type NewsItem, type PlayerBans, type Unknown, type WishlistEntry } from './client.js';
import type { SteamLink } from './store.js';
import {
  groupMembersOf, guarded, libraryOf, minutesToHours, ownedFor, targetFor,
  type Person, type SteamCaller, type SteamToolDependencies,
} from './tools.js';

/**
 * The Web API reads that sit beside the main Steam tools: account level / badges / bans, a game's current players and
 * news, a person's per-game statistics, shared games and wishlists. Everything is read on demand, cached briefly,
 * and anything Steam does not share is reported as not visible, never as zero.
 */
const PLAYERS_CACHE_MS = 60_000;
const NEWS_CACHE_MS = 10 * 60_000;
const ACCOUNT_CACHE_MS = 5 * 60_000;
const WISHLIST_CACHE_MS = 5 * 60_000;
const NAMES_CACHE_MS = 24 * 3_600_000;
const PUBG_APP_ID = '578080';

async function cached<T>(deps: SteamToolDependencies, key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const now = (deps.now ?? Date.now)();
  const cache = deps.extraCache ??= new Map();
  const hit = cache.get(key);
  if (hit && now - hit.at <= ttl) return hit.value as T;
  const value = await load();
  cache.set(key, { at: now, value });
  return value;
}

const unavailable = { status: 'unavailable', reason: 'not_supported' } as const;
const dayText = (days: number): string => `${days} 天前`;

// ───────────────────────────── level, badges, bans ─────────────────────────────

export interface AccountInfoParams { person?: Person; all?: boolean; include?: Array<'level' | 'badges' | 'bans'>; limit?: number }

function banView(ban: PlayerBans): Record<string, unknown> {
  const any = ban.vacBanned || ban.gameBans > 0 || ban.communityBanned || ban.economyBan !== 'none';
  return {
    vacBanned: ban.vacBanned, vacBans: ban.vacBans, gameBans: ban.gameBans, communityBanned: ban.communityBanned, economyBan: ban.economyBan,
    ...(any && (ban.vacBans > 0 || ban.gameBans > 0) ? { daysSinceLastBan: ban.daysSinceLastBan, lastBan: dayText(ban.daysSinceLastBan) } : {}),
    summary: any ? '有封禁记录（只陈述事实，不要推测原因或指控）' : '没有封禁记录',
  };
}

/** Steam level (and, on request, badge count / XP and ban status) of one person, or a level ranking of the group. */
export function steamGetAccountInfo(deps: SteamToolDependencies, caller: SteamCaller, params: AccountInfoParams): Promise<unknown> {
  const client = deps.client;
  if (!client.steamLevel || !client.badges || !client.playerBans) return Promise.resolve(unavailable);
  const include = new Set(params.include?.length ? params.include : ['level', 'bans'] as const);
  return guarded(deps, async () => {
    const levelOf = (steamId: string): Promise<Unknown<number>> => cached(deps, `level:${steamId}`, ACCOUNT_CACHE_MS, () => client.steamLevel!(steamId));
    if (params.all) {
      if (!caller.groupId) return { status: 'refused', reason: 'ranking_needs_a_group' };
      const ranked: Array<{ name: string; level: number; accountCount: number }> = [];
      const hidden: string[] = [];
      for (const member of groupMembersOf(deps, caller)) {
        let best: number | undefined;
        for (const link of member.links) { const level = await levelOf(link.steamId); if (level.known) best = Math.max(best ?? 0, level.value); }
        if (best === undefined) hidden.push(member.name); else ranked.push({ name: member.name, level: best, accountCount: member.links.length });
      }
      ranked.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
      return { status: 'ok', rankedBy: 'steam_level', ranking: ranked.slice(0, Math.min(Math.max(params.limit ?? 15, 1), 15)), ...(hidden.length ? { levelNotPublic: hidden, note: '这些成员的等级未公开，没有计入排名。' } : {}) };
    }
    const target = targetFor(deps, caller, params.person ?? { reference: 'self' });
    if (!('links' in target)) return target;
    const bans = include.has('bans') ? await cached(deps, `bans:${target.links.map((link) => link.steamId).sort().join(',')}`, ACCOUNT_CACHE_MS, () => client.playerBans!(target.links.map((link) => link.steamId))) : undefined;
    const accounts = [];
    for (const link of target.links) {
      const entry: Record<string, unknown> = { account: link.personaName };
      if (include.has('level')) { const level = await levelOf(link.steamId); entry.level = level.known ? level.value : { known: false, reason: level.reason, note: '等级未公开' }; }
      if (include.has('badges')) {
        const badges = await cached(deps, `badges:${link.steamId}`, ACCOUNT_CACHE_MS, () => client.badges!(link.steamId));
        entry.badges = badges.known ? { badgeCount: badges.value.badgeCount, xp: badges.value.xp, xpToNextLevel: badges.value.xpToNextLevel } : { known: false, reason: badges.reason, note: '徽章未公开' };
      }
      if (bans) { const ban = bans.get(link.steamId); entry.bans = ban ? banView(ban) : { known: false, reason: 'not_available' }; }
      accounts.push(entry);
    }
    return target.links.length === 1 ? { status: 'ok', ...accounts[0] } : { status: 'ok', accountCount: accounts.length, accounts };
  });
}

// ───────────────────────────── a game: current players, news ─────────────────────────────

export interface GameInfoParams { game: string; info?: 'players' | 'news' | 'both'; count?: number }

/** Resolves a game name or app id: the asker's own library first, then the public store name search. */
async function resolveGame(deps: SteamToolDependencies, caller: SteamCaller, game: string, links: SteamLink[]): Promise<{ appId: string; name?: string } | undefined> {
  const wanted = game.trim();
  if (/^\d{1,10}$/u.test(wanted)) return { appId: wanted };
  const lower = wanted.toLowerCase();
  for (const link of links) {
    const owned = await ownedFor(deps, link.steamId);
    if (!owned.known) continue;
    const match = owned.value.filter((entry) => entry.name?.toLowerCase().includes(lower)).sort((a, b) => Number(b.name?.toLowerCase() === lower) - Number(a.name?.toLowerCase() === lower) || b.totalMinutes - a.totalMinutes)[0];
    if (match) return { appId: String(match.appId), ...(match.name ? { name: match.name } : {}) };
  }
  const search = deps.client.storeSearch;
  if (!search) return undefined;
  const found = (await cached(deps, `search:${lower}`, NAMES_CACHE_MS, () => search.call(deps.client, wanted)))[0];
  return found ? { appId: String(found.appId), name: found.name } : undefined;
}

const stripMarkup = (text: string): string => text.replace(/\[[^\]]*\]/gu, ' ').replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ').trim();

export function steamGameInfo(deps: SteamToolDependencies, caller: SteamCaller, params: GameInfoParams): Promise<unknown> {
  const client = deps.client;
  if (!client.currentPlayers || !client.news) return Promise.resolve(unavailable);
  return guarded(deps, async () => {
    const own = caller.senderKey ? targetFor(deps, caller, { reference: 'self' }) : undefined;
    const resolved = await resolveGame(deps, caller, params.game, own && 'links' in own ? own.links : []);
    if (!resolved) return { status: 'not_found', reason: 'game_not_found' };
    const want = params.info ?? 'both';
    const out: Record<string, unknown> = { status: 'ok', game: { appId: resolved.appId, ...(resolved.name ? { name: resolved.name } : {}) } };
    if (want !== 'news') {
      const count = await cached(deps, `players:${resolved.appId}`, PLAYERS_CACHE_MS, () => client.currentPlayers!(resolved.appId));
      out.currentPlayers = count === undefined ? { known: false, reason: 'not_available' } : { known: true, value: count };
    }
    if (want !== 'players') {
      const limit = Math.min(Math.max(params.count ?? 3, 1), 5);
      const items = await cached<NewsItem[]>(deps, `news:${resolved.appId}:${limit}`, NEWS_CACHE_MS, () => client.news!(resolved.appId, limit));
      out.news = items.length
        ? { known: true, value: items.map((item) => ({ title: item.title, date: item.date ? new Date(item.date).toISOString().slice(0, 10) : null, source: item.feedLabel ?? null, summary: stripMarkup(item.contents).slice(0, 160), url: item.url })) }
        : { known: false, reason: 'not_available', note: '这个游戏没有新闻' };
    }
    return out;
  });
}

// ───────────────────────────── a person's numbers in one game ─────────────────────────────

export interface GameStatsParams { person?: Person; game: string; stat?: string; limit?: number }

export function steamGetGameStats(deps: SteamToolDependencies, caller: SteamCaller, params: GameStatsParams): Promise<unknown> {
  const client = deps.client;
  if (!client.userStats) return Promise.resolve(unavailable);
  return guarded(deps, async () => {
    const target = targetFor(deps, caller, params.person ?? { reference: 'self' });
    if (!('links' in target)) return target;
    const resolved = await resolveGame(deps, caller, params.game, target.links);
    if (!resolved) return { status: 'not_found', reason: 'game_not_found' };
    // PUBG numbers come from the PUBG API through the pubg_* tools, not from Steam.
    if (resolved.appId === PUBG_APP_ID) return { status: 'refused', reason: 'use_pubg_tools', note: 'PUBG 的战绩和数据请用 pubg_* 工具查询。' };
    const limit = Math.min(Math.max(params.limit ?? 12, 1), 40);
    const wanted = params.stat?.trim().toLowerCase();
    const accounts = [];
    for (const link of target.links) {
      const stats = await cached(deps, `ustats:${link.steamId}:${resolved.appId}`, ACCOUNT_CACHE_MS, () => client.userStats!(link.steamId, resolved.appId));
      if (!stats.known) { accounts.push({ account: link.personaName, stats: { known: false, reason: stats.reason, note: stats.reason === 'profile_private' ? '游戏详情未公开' : '这个游戏没有统计数据' } }); continue; }
      const rows = stats.value.stats.filter((item) => !wanted || item.name.toLowerCase().includes(wanted)).sort((a, b) => b.value - a.value);
      accounts.push({ account: link.personaName, stats: { known: true, total: stats.value.stats.length, shown: Math.min(rows.length, limit), items: rows.slice(0, limit) } });
    }
    const game = { appId: resolved.appId, ...(resolved.name ? { name: resolved.name } : {}) };
    return target.links.length === 1 ? { status: 'ok', game, ...accounts[0] } : { status: 'ok', game, accountCount: accounts.length, accounts };
  });
}

// ───────────────────────────── shared games and wishlists ─────────────────────────────

export interface OverlapParams { mode: 'common' | 'wishlist'; people?: Person[]; all?: boolean; limit?: number }

export function steamLibraryOverlap(deps: SteamToolDependencies, caller: SteamCaller, params: OverlapParams): Promise<unknown> {
  const client = deps.client;
  if (params.mode === 'wishlist' && (!client.wishlist || !client.storeNames)) return Promise.resolve(unavailable);
  return guarded(deps, async () => {
    // Who is compared: the whole group, or the listed people (the asker when none are listed).
    const members: Array<{ name: string; links: SteamLink[] }> = [];
    const unresolved: string[] = [];
    if (params.all) {
      if (!caller.groupId) return { status: 'refused', reason: 'needs_a_group' };
      members.push(...groupMembersOf(deps, caller));
    } else {
      for (const person of params.people?.length ? params.people : [{ reference: 'self' } as Person]) {
        const target = targetFor(deps, caller, person);
        if (!('links' in target)) { unresolved.push(person.reference === 'alias' ? person.alias : person.reference); continue; }
        const personId = target.links[0]?.personId;
        const name = (personId ? caller.displayName?.(personId) : undefined) ?? target.links[0]?.personaName ?? '?';
        if (!members.some((member) => member.links[0]?.steamId === target.links[0]?.steamId)) members.push({ name, links: target.links });
      }
    }
    const limit = Math.min(Math.max(params.limit ?? 15, 1), 30);
    const base = unresolved.length ? { notFound: unresolved } : {};
    if (params.mode === 'common') {
      if (members.length < 2) return { status: 'ok', ...base, note: '共同游戏至少需要两个已绑定的成员（all=true 或 people 里列出）。' };
      const libraries = [] as Array<{ name: string; games: Map<number, { name?: string; minutes: number }> }>;
      const hidden: string[] = [];
      for (const member of members) {
        const library = await libraryOf(deps, member.links);
        if (!library.readable) { hidden.push(member.name); continue; }
        libraries.push({ name: member.name, games: new Map(library.games.map((game) => [game.appId, { ...(game.name ? { name: game.name } : {}), minutes: game.totalMinutes }])) });
      }
      if (libraries.length < 2) return { status: 'ok', ...base, gameDetailsNotPublic: hidden, note: '能读到游戏详情的成员不足两位，没法比较。' };
      const shared = [...libraries[0]!.games].filter(([appId]) => libraries.every((library) => library.games.has(appId)))
        .map(([appId, game]) => ({ appId, name: game.name ?? String(appId), combinedHours: minutesToHours(libraries.reduce((sum, library) => sum + (library.games.get(appId)?.minutes ?? 0), 0)) }))
        .sort((a, b) => b.combinedHours - a.combinedHours);
      return { status: 'ok', ...base, compared: libraries.map((library) => library.name), sharedCount: shared.length, shared: shared.slice(0, limit), ...(hidden.length ? { gameDetailsNotPublic: hidden, note: '这些成员的游戏详情未公开，没有参与比较。' } : {}) };
    }
    // wishlist
    const lists = [] as Array<{ name: string; ids: Set<number>; order: number[] }>;
    const none: string[] = [];
    for (const member of members) {
      const ids = new Map<number, number>();
      for (const link of member.links) {
        const wishlist: Unknown<WishlistEntry[]> = await cached(deps, `wish:${link.steamId}`, WISHLIST_CACHE_MS, () => client.wishlist!(link.steamId));
        if (wishlist.known) for (const entry of wishlist.value) ids.set(entry.appId, Math.min(ids.get(entry.appId) ?? 9999, entry.priority || 9999));
      }
      if (!ids.size) { none.push(member.name); continue; }
      lists.push({ name: member.name, ids: new Set(ids.keys()), order: [...ids.entries()].sort((a, b) => a[1] - b[1]).map(([appId]) => appId) });
    }
    if (!lists.length) return { status: 'ok', ...base, wishlist: { known: false, reason: 'not_available', note: '愿望单为空或未公开' } };
    const shared = lists.length > 1 ? [...lists[0]!.ids].filter((appId) => lists.every((list) => list.ids.has(appId))) : [];
    const need = new Set<number>([...shared.slice(0, limit), ...lists.flatMap((list) => list.order.slice(0, Math.min(limit, 10)))]);
    const names = await cached(deps, `names:${[...need].sort().join(',')}`, NAMES_CACHE_MS, () => client.storeNames!([...need]));
    const nameOf = (appId: number): string => names.get(appId) ?? String(appId);
    return {
      status: 'ok', ...base,
      wishlists: lists.map((list) => ({ name: list.name, count: list.ids.size, top: list.order.slice(0, Math.min(limit, 10)).map(nameOf) })),
      ...(lists.length > 1 ? { sharedCount: shared.length, shared: shared.slice(0, limit).map(nameOf) } : {}),
      ...(none.length ? { wishlistEmptyOrNotPublic: none, note: '这些成员的愿望单为空或未公开。' } : {}),
    };
  });
}

