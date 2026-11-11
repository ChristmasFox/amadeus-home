import { SteamApiError, type GameStat, type PlayerSummary, type SteamClient, type Unknown } from './client.js';
import { businessCalendar, type BusinessCalendar } from './business-day.js';
import { AchievementCatalog, summariseAchievements, type AchievementClient, type AchievementMode } from './achievements.js';
import { parseSteamReference } from './domain.js';
import { CARD_REPLY_GUIDE, renderPlayingCard, renderPlaytimeCard, renderPlaytimeGroupCard } from './cards.js';
import type { SteamLink, SteamStore } from './store.js';

/** Everything a tool needs to know about who is asking, taken from the host's trusted metadata (never message text). */
export interface SteamCaller {
  /** `whatsapp:<digits>` of the current sender, absent when the host gave no trusted sender. */
  senderKey?: string;
  /** The WhatsApp group of this session, absent in a direct chat. */
  groupId?: string;
  isOwner: boolean;
  /** Trusted sender keys of @mentions and of the replied-to message, in host order. */
  mentions: string[];
  replySender?: string;
  /** Resolves a reviewed group alias to a person id. */
  personForAlias?: (alias: string) => string | undefined;
  /** Resolve a trusted sender reference to a known person, so one person's link is shared across their phone and group (LID) identities. */
  selfPerson?: () => string | undefined;
  mentionPerson?: (index: number) => string | undefined;
  replyPerson?: () => string | undefined;
  /** Mirrors a new link into the identity store; returns the person id when the sender is a known person. */
  mirrorLink?: (steamId: string, label: string) => string | undefined;
  /** Same for another person the owner named by a trusted mention or reply. */
  mirrorLinkFor?: (reference: { type: 'mention'; index: number } | { type: 'reply_sender' }, steamId: string, label: string) => string | undefined;
  /** A person's display name (for rankings); falls back to the Steam nickname. */
  displayName?: (personId: string) => string | undefined;
}

export interface SteamToolDependencies {
  store: SteamStore;
  client: Pick<SteamClient, 'resolveVanity' | 'playerSummaries' | 'ownedGames' | 'recentGames' | 'friendList' | 'hasKey'> & Partial<AchievementClient> & Partial<Pick<SteamClient, 'steamLevel' | 'badges' | 'playerBans' | 'currentPlayers' | 'news' | 'userStats' | 'wishlist' | 'storeNames' | 'storeSearch'>>;
  /** Short-lived answers of the extra Web API reads (level, bans, players online, news, wishlists, names). */
  extraCache?: Map<string, { at: number; value: unknown }>;
  /** The business day used for play time: the same calendar the PUBG daily review uses (defaults to PUBG's own defaults). */
  calendar?: BusinessCalendar;
  /** Cached achievement names and rarity; created on first use. */
  achievementCatalog?: AchievementCatalog;
  /** Short-lived friend snapshots, shared by calls so a follow-up question does not refetch. */
  /** Owned-game lists per account, kept briefly: a library changes slowly and the endpoint is rate limited. */
  ownedCache?: Map<string, { at: number; value: Unknown<GameStat[]> }>;
  friendsCache?: Map<string, { at: number; friends: PlayerSummary[]; truncated: boolean; accountCount: number; accountsHidden: number }>;
  now?: () => number;
}

export type Person =
  | { reference: 'self' }
  | { reference: 'mention'; mentionIndex?: number }
  | { reference: 'reply_sender' }
  | { reference: 'alias'; alias: string };

const keyUnavailable = { status: 'unavailable', reason: 'steam_api_key_missing' } as const;

export async function guarded<T>(deps: SteamToolDependencies, work: () => Promise<T>): Promise<T | typeof keyUnavailable | { status: 'unavailable'; reason: string }> {
  if (!await deps.client.hasKey()) return keyUnavailable;
  try {
    return await work();
  } catch (error) {
    if (error instanceof SteamApiError) return { status: 'unavailable', reason: error.code };
    throw error;
  }
}

const unknownValue = <T>(value: Unknown<T>): { known: true; value: T } | { known: false; reason: string } => value;

function requireSender(caller: SteamCaller): string {
  if (!caller.senderKey) throw new Error('trusted_sender_metadata_unavailable');
  return caller.senderKey;
}

/** Every account of the sender: under their own key, plus those of the same known person under another key (phone vs group id). */
function ownLinks(deps: SteamToolDependencies, caller: SteamCaller): SteamLink[] {
  const links = new Map<string, SteamLink>();
  for (const link of deps.store.linksBySender(requireSender(caller))) links.set(link.steamId, link);
  const personId = caller.selfPerson?.();
  if (personId) for (const link of deps.store.linksByPerson(personId)) links.set(link.steamId, link);
  return [...links.values()].sort((a, b) => a.linkedAt - b.linkedAt);
}

/** Who a link is for: the sender by default; the owner may name another member of the group by a trusted mention, reply or alias. */
type Mirror = (steamId: string, label: string) => string | undefined;
type Subject = { senderKey: string; personId?: string; links: SteamLink[]; mirror: Mirror } | { status: string; reason: string };

function linkSubject(deps: SteamToolDependencies, caller: SteamCaller, person: Person | undefined): Subject {
  const senderKey = requireSender(caller);
  if (!person || person.reference === 'self') return { senderKey, links: ownLinks(deps, caller), mirror: (steamId, label) => caller.mirrorLink?.(steamId, label) };
  // Only the owner binds for someone else, and only inside a group where that someone is named by trusted metadata.
  if (!caller.isOwner) return { status: 'refused', reason: 'owner_only_for_other_members' };
  if (!caller.groupId) return { status: 'refused', reason: 'only_available_in_a_group' };
  let key: string | undefined;
  let personId: string | undefined;
  let mirror: Mirror;
  if (person.reference === 'mention') {
    const index = person.mentionIndex ?? 0;
    key = caller.mentions[index] || undefined;
    personId = caller.mentionPerson?.(index);
    mirror = (steamId, label) => caller.mirrorLinkFor?.({ type: 'mention', index }, steamId, label);
  } else if (person.reference === 'reply_sender') {
    key = caller.replySender;
    personId = caller.replyPerson?.();
    mirror = (steamId, label) => caller.mirrorLinkFor?.({ type: 'reply_sender' }, steamId, label);
  } else {
    personId = caller.personForAlias?.(person.alias);
    key = personId ? deps.store.linksByPerson(personId)[0]?.senderKey : undefined;
    mirror = () => personId;
  }
  if (!key) return { status: 'not_found', reason: 'trusted_member_metadata_unavailable' };
  const links = merge(deps.store.linksBySender(key), personId ? deps.store.linksByPerson(personId) : []);
  return { senderKey: key, ...(personId ? { personId } : {}), links, mirror };
}

export async function steamLinkAccount(deps: SteamToolDependencies, caller: SteamCaller, params: { reference: string; confirm?: boolean; person?: Person }): Promise<unknown> {
  const subject = linkSubject(deps, caller, params.person);
  if ('status' in subject) return subject;
  const parsed = parseSteamReference(params.reference);
  if (!parsed) return { status: 'invalid_reference', reason: 'not_a_steam_id_link_or_name' };
  return guarded(deps, async () => {
    const steamId = parsed.kind === 'steamid' ? parsed.steamId : await deps.client.resolveVanity(parsed.vanity);
    if (!steamId) return { status: 'not_found', reason: 'vanity_not_found' };
    const summary = (await deps.client.playerSummaries([steamId])).get(steamId);
    if (!summary) return { status: 'not_found', reason: 'profile_not_found' };
    const candidate = { steamId, name: summary.name, ...(summary.avatarUrl ? { avatarUrl: summary.avatarUrl } : {}), profilePublic: summary.profilePublic };
    if (params.confirm !== true) {
      return { status: 'needs_confirmation', candidate, instruction: '请把昵称告诉用户并问是不是这个账号；用户明确确认后，再用 confirm=true 重新调用。' };
    }
    const personId = subject.mirror(steamId, summary.name) ?? subject.personId;
    const own = subject.links;
    const holder = deps.store.linkBySteamId(steamId);
    if (holder && !own.some((link) => link.steamId === steamId) && !(personId && holder.personId === personId)) {
      return { status: 'conflict', reason: 'steam_account_already_linked_by_someone_else' };
    }
    // Accounts are added, never replaced; new ones go under the key the person's accounts already use.
    const key = holder?.senderKey ?? own[0]?.senderKey ?? subject.senderKey;
    const result = deps.store.link({ senderKey: key, steamId, personaName: summary.name || steamId, ...(personId ? { personId } : {}), now: (deps.now ?? Date.now)() });
    if (result.status === 'conflict') return { status: 'conflict', reason: 'steam_account_already_linked_by_someone_else' };
    if (caller.groupId) deps.store.enroll(caller.groupId, key);
    return {
      status: 'linked', name: summary.name, broadcast: true, alreadyLinked: own.some((link) => link.steamId === steamId),
      accountCount: (() => { const after = linkSubject(deps, caller, params.person); return 'links' in after ? after.links.length : own.length; })(),
      ...(params.person && params.person.reference !== 'self' ? { forOtherMember: true } : {}),
      groupEnrolled: Boolean(caller.groupId), groupAnnouncementsEnabled: caller.groupId ? deps.store.groupEnabled(caller.groupId) : undefined,
    };
  });
}

/** Removes one of the sender's accounts (named by SteamID, link or nickname), or all of them when asked, or the only one. */
export function steamUnlink(deps: SteamToolDependencies, caller: SteamCaller, params: { account?: string; all?: boolean } = {}): unknown {
  const own = ownLinks(deps, caller);
  if (!own.length) return { status: 'not_linked' };
  let chosen: SteamLink[];
  if (params.all) chosen = own;
  else if (params.account) {
    const parsed = parseSteamReference(params.account);
    const wanted = params.account.trim().toLowerCase();
    chosen = own.filter((link) => (parsed?.kind === 'steamid' && link.steamId === parsed.steamId) || link.personaName.toLowerCase() === wanted);
    if (!chosen.length) chosen = own.filter((link) => link.personaName.toLowerCase().includes(wanted));
    if (chosen.length !== 1) return { status: chosen.length ? 'needs_choice' : 'account_not_found', accounts: own.map((link) => link.personaName) };
  } else if (own.length === 1) chosen = own;
  else return { status: 'needs_choice', accounts: own.map((link) => link.personaName) };
  for (const link of chosen) deps.store.unlink(link.senderKey, link.steamId);
  return { status: 'unlinked', removed: chosen.map((link) => link.personaName), remaining: own.length - chosen.length };
}

/** The personal "announce me" switch. Turning it on inside a group also enrols the person in that group. */
export function steamSetBroadcast(deps: SteamToolDependencies, caller: SteamCaller, params: { enabled: boolean }): unknown {
  const own = ownLinks(deps, caller);
  if (!own.length) return { status: 'not_linked' };
  for (const link of own) deps.store.setBroadcast(link.steamId, params.enabled);
  if (caller.groupId) {
    for (const key of new Set(own.map((link) => link.senderKey))) {
      if (params.enabled) deps.store.enroll(caller.groupId, key);
      else deps.store.leaveGroup(caller.groupId, key);
    }
  }
  return { status: 'ok', broadcast: params.enabled, accountCount: own.length, group: caller.groupId ? 'this_group' : undefined };
}

export function steamGroupSettings(deps: SteamToolDependencies, caller: SteamCaller, params: { enabled?: boolean }): unknown {
  if (!caller.groupId) return { status: 'refused', reason: 'only_available_in_a_group' };
  if (params.enabled !== undefined) {
    if (!caller.isOwner) return { status: 'refused', reason: 'owner_only' };
    deps.store.setGroup(caller.groupId, params.enabled);
  }
  return { status: 'ok', announcementsEnabled: deps.store.groupEnabled(caller.groupId), announced: deps.store.broadcastMembers(caller.groupId).length };
}

type Target = { links: SteamLink[]; self: boolean } | { status: string; reason: string };

const merge = (...lists: SteamLink[][]): SteamLink[] => [...new Map(lists.flat().map((link) => [link.steamId, link])).values()].sort((a, b) => a.linkedAt - b.linkedAt);

export function targetFor(deps: SteamToolDependencies, caller: SteamCaller, person: Person): Target {
  let links: SteamLink[] = [];
  const byPerson = (personId: string | undefined): SteamLink[] => (personId ? deps.store.linksByPerson(personId) : []);
  if (person.reference === 'self') {
    links = ownLinks(deps, caller);
  } else if (person.reference === 'mention') {
    const index = person.mentionIndex ?? 0;
    const key = caller.mentions[index];
    if (!key) return { status: 'not_found', reason: 'trusted_mention_metadata_unavailable' };
    links = merge(deps.store.linksBySender(key), byPerson(caller.mentionPerson?.(index)));
  } else if (person.reference === 'reply_sender') {
    if (!caller.replySender) return { status: 'not_found', reason: 'trusted_reply_sender_metadata_unavailable' };
    links = merge(deps.store.linksBySender(caller.replySender), byPerson(caller.replyPerson?.()));
  } else {
    links = byPerson(caller.personForAlias?.(person.alias));
  }
  if (!links.length) return { status: 'not_linked', reason: 'no_steam_account_linked' };
  const mine = caller.senderKey ? new Set(ownLinks(deps, caller).map((link) => link.steamId)) : new Set<string>();
  const self = links.every((link) => mine.has(link.steamId));
  // Switching announcements off also stops other people reading that account's Steam data.
  if (!self) links = links.filter((link) => mine.has(link.steamId) || link.broadcast);
  if (!links.length) return { status: 'refused', reason: 'sharing_off' };
  return { links, self };
}

/** One account answers as before; several accounts answer as a list, each labelled with its Steam nickname. */
async function withTarget(deps: SteamToolDependencies, caller: SteamCaller, person: Person, work: (link: SteamLink) => Promise<unknown>): Promise<unknown> {
  const target = targetFor(deps, caller, person);
  if (!('links' in target)) return target;
  return guarded(deps, async () => {
    if (target.links.length === 1) return work(target.links[0]!);
    const accounts = [];
    for (const link of target.links) accounts.push({ account: link.personaName, result: await work(link) });
    return { status: 'ok', accountCount: accounts.length, accounts };
  });
}

export const minutesToHours = (minutes: number): number => Math.round(minutes / 6) / 10;
export const gameView = (game: GameStat) => ({ appId: game.appId, name: game.name ?? null, totalHours: minutesToHours(game.totalMinutes), ...(game.recentMinutes !== undefined ? { recentHours: minutesToHours(game.recentMinutes) } : {}) });

export function steamGetProfile(deps: SteamToolDependencies, caller: SteamCaller, params: { person: Person }): Promise<unknown> {
  return withTarget(deps, caller, params.person, async (link) => {
    const summary: PlayerSummary | undefined = (await deps.client.playerSummaries([link.steamId])).get(link.steamId);
    if (!summary) return { status: 'not_found', reason: 'profile_not_found' };
    return {
      status: 'ok',
      name: summary.name,
      steamId: link.steamId,
      profilePublic: summary.profilePublic,
      // A hidden profile reports "offline"; that is not the same as being offline.
      state: summary.profilePublic ? { known: true, personaState: summary.personaState ?? 0, game: summary.gameName ?? null } : { known: false, reason: 'profile_private' },
      accountCreatedAt: summary.profilePublic && summary.createdAt ? new Date(summary.createdAt).toISOString() : { known: false, reason: 'profile_private' },
    };
  });
}

export type PlaytimePeriod = 'today' | 'yesterday' | 'this_week' | 'date';

/** today / yesterday / this week (Monday first) / a given date, as business-day windows of the shared (PUBG) calendar. */
export function playtimeWindow(calendar: BusinessCalendar, period: PlaytimePeriod, date: string | undefined, now: number): { from: number; to: number; label: string } | undefined {
  const today = calendar.windowAt(now);
  const span = (day: string): string => `${day} ${calendar.start} → 次日 ${calendar.start}`;
  if (period === 'today') return { from: today.startMs, to: today.endMs, label: `今天（${span(calendar.label(today.startMs))}）` };
  if (period === 'yesterday') {
    const yesterday = calendar.windowAt(today.startMs - 1);
    return { from: yesterday.startMs, to: yesterday.endMs, label: `昨天（${span(calendar.label(yesterday.startMs))}）` };
  }
  if (period === 'this_week') {
    const [year, month, day] = calendar.label(today.startMs).split('-').map(Number);
    const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay(); // 0 = Sunday
    let monday = today;
    for (let back = (weekday + 6) % 7; back > 0; back -= 1) monday = calendar.windowAt(monday.startMs - 1);
    return { from: monday.startMs, to: today.endMs, label: `本周（${calendar.label(monday.startMs)} ${calendar.start} 起，周一为一周开始）` };
  }
  const window = date ? calendar.windowOf(date) : undefined;
  return window ? { from: window.startMs, to: window.endMs, label: `${date}（${span(date!)}）` } : undefined;
}

export const durationText = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}小时${rest}分钟` : `${rest}分钟`;
};

interface PlaySession { appId: string; gameName?: string; start: number; end: number }

/** Clips sessions to [from, to) and sums them per game and per business day; a session crossing the day boundary is split between the two days. */
export function aggregatePlay(calendar: BusinessCalendar, sessions: PlaySession[], from: number, to: number, game?: string): { games: Array<{ appId: string; name: string; minutes: number; text: string }>; totalMinutes: number; days: Array<{ date: string; minutes: number; text: string }> } {
  const wanted = game?.trim().toLowerCase();
  const perGame = new Map<string, { appId: string; name: string; ms: number }>();
  const perDay = new Map<string, number>();
  for (const session of sessions) {
    const name = session.gameName ?? session.appId;
    if (wanted && !name.toLowerCase().includes(wanted)) continue;
    const start = Math.max(session.start, from);
    const end = Math.min(session.end, to);
    if (end <= start) continue;
    const entry = perGame.get(session.appId) ?? { appId: session.appId, name, ms: 0 };
    entry.ms += end - start;
    perGame.set(session.appId, entry);
    for (let cursor = start; cursor < end; cursor = calendar.windowAt(cursor).endMs) {
      const dayEnd = Math.min(end, calendar.windowAt(cursor).endMs);
      perDay.set(calendar.label(cursor), (perDay.get(calendar.label(cursor)) ?? 0) + (dayEnd - cursor));
    }
  }
  const games = [...perGame.values()].map((entry) => ({ appId: entry.appId, name: entry.name, minutes: Math.round(entry.ms / 60_000) })).filter((entry) => entry.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes).map((entry) => ({ ...entry, text: durationText(entry.minutes) }));
  const days = [...perDay.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([day, ms]) => ({ date: day, minutes: Math.round(ms / 60_000), text: durationText(Math.round(ms / 60_000)) }));
  return { games, totalMinutes: games.reduce((sum, entry) => sum + entry.minutes, 0), days };
}

/** Several people asked about at once: one merged card, delivered once (the model hands it over, it does not restate each person). */
function groupPlaytime(deps: SteamToolDependencies, caller: SteamCaller, people: Person[], period: PlaytimePeriod, date: string | undefined, game: string | undefined): unknown {
  const results = people.slice(0, 8).map((person) => trackedPlaytime(deps, caller, person, period, date, game) as Record<string, unknown>);
  const bad = results.find((result) => result.status !== 'ok' && result.status !== undefined);
  if (bad) return bad;
  const first = results[0]!;
  const members = results.map((result) => ({
    name: typeof result.member === 'string' ? result.member : '成员',
    known: result.known === true,
    games: Array.isArray(result.games) ? result.games as Array<{ appId?: string; name: string; text: string }> : [],
    ...(typeof result.totalText === 'string' ? { totalText: result.totalText } : {}),
  }));
  const partial = results.find((result) => result.partial === true);
  const now = (deps.now ?? Date.now)();
  const displayText = renderPlaytimeGroupCard({ label: String(first.label), members, ...(partial && typeof partial.trackingSince === 'string' ? { partialSince: partial.trackingSince } : {}) }, new Date(now));
  return { status: 'ok', period: first.period, label: first.label, timezone: first.timezone, dayBoundary: first.dayBoundary, people: members, displayText, replyGuide: CARD_REPLY_GUIDE };
}

/** Time actually spent in games, from the sessions the poller recorded (not Steam's lifetime totals). */
function trackedPlaytime(deps: SteamToolDependencies, caller: SteamCaller, person: Person, period: PlaytimePeriod, date: string | undefined, game: string | undefined): unknown {
  const now = (deps.now ?? Date.now)();
  const calendar = deps.calendar ?? businessCalendar();
  const window = playtimeWindow(calendar, period, date, now);
  if (!window) return { status: 'invalid_date', reason: 'date_must_be_YYYY-MM-DD' };
  const target = targetFor(deps, caller, person);
  if (!('links' in target)) return target;
  const trackingSince = deps.store.playTrackingStartedAt();
  const base = { period: period === 'date' ? 'date' : period, label: window.label, timezone: calendar.timezone, dayBoundary: calendar.describe(), accountCount: target.links.length };
  if (window.to <= trackingSince) {
    return { status: 'ok', ...base, known: false, reason: 'before_tracking', trackingSince: `${calendar.format(trackingSince)}（${calendar.timezone}）`, note: '游戏时长是从这个时间之后才开始记录的，更早的日子没有数据。' };
  }
  if (target.links.every((link) => !link.broadcast)) return { status: 'ok', ...base, known: false, reason: 'tracking_off_while_announcements_off' };
  const sessions = deps.store.playSessions(target.links.map((link) => link.steamId), window.from, window.to, now);
  const { games, totalMinutes, days } = aggregatePlay(calendar, sessions, window.from, window.to, game);
  const partial = window.from < trackingSince;
  const subject = target.links[0]!;
  const name = (subject.personId ? caller.displayName?.(subject.personId) : undefined) || subject.personaName;
  const displayText = renderPlaytimeCard({
    name, label: window.label, games, totalText: durationText(totalMinutes),
    ...(partial ? { partialSince: `${calendar.format(trackingSince)}（${calendar.timezone}）` } : {}),
  }, new Date(now));
  return {
    status: 'ok', ...base, known: true, member: name, games, totalMinutes, totalText: durationText(totalMinutes),
    displayText, replyGuide: CARD_REPLY_GUIDE,
    ...(period === 'this_week' || days.length > 1 ? { days } : {}),
    ...(partial ? { partial: true, trackingSince: `${calendar.format(trackingSince)}（${calendar.timezone}）`, note: '记录是从这个时间才开始的，这段时间之前的游戏时长没有数据，上面只是记录开始之后的部分。' } : {}),
    ...(totalMinutes === 0 ? { note: '这段时间没有记录到游戏时长（只记录绑定账号在播报开启时的游戏状态，每分钟采样一次，误差约一分钟）。' } : {}),
  };
}

/**
 * Without a period: Steam's lifetime hours (total, top games, or one game). With a period (today / yesterday / this
 * week / a date): the time actually played in that window, per game and in total, merged over the person's accounts.
 */
export function steamGetPlaytime(deps: SteamToolDependencies, caller: SteamCaller, params: { person?: Person; people?: Person[]; game?: string; period?: PlaytimePeriod; date?: string }): Promise<unknown> {
  const everyone = params.people?.length ? params.people : params.person ? [params.person] : [];
  if (!everyone.length) return Promise.resolve({ status: 'invalid_request', reason: 'person_or_people_required' });
  if (params.period || params.date) {
    const period: PlaytimePeriod = params.period ?? 'date';
    if (everyone.length > 1) return Promise.resolve(groupPlaytime(deps, caller, everyone, period, params.date, params.game));
    return Promise.resolve(trackedPlaytime(deps, caller, everyone[0]!, period, params.date, params.game));
  }
  if (everyone.length > 1) return Promise.resolve({ status: 'invalid_request', reason: 'several_people_need_a_period', note: '一次问多个人的时长时请带 period（例如 today）。' });
  const only = everyone[0]!;
  return withTarget(deps, caller, only, async (link) => {
    const owned = unknownValue(await deps.client.ownedGames(link.steamId));
    if (!owned.known) return { status: 'ok', games: owned };
    const games = owned.value;
    const wanted = params.game?.trim().toLowerCase();
    const matches = wanted ? games.filter((game) => game.name?.toLowerCase().includes(wanted)) : [];
    const totalMinutes = games.reduce((sum, game) => sum + game.totalMinutes, 0);
    if (wanted) return { status: 'ok', game: matches.slice(0, 5).map(gameView), found: matches.length > 0 };
    return {
      status: 'ok',
      gameCount: games.length,
      totalHours: minutesToHours(totalMinutes),
      top: [...games].sort((a, b) => b.totalMinutes - a.totalMinutes).slice(0, 5).map(gameView),
    };
  });
}

/** Linked members of the caller's group (announcements on), one entry per person with all their accounts. */
export function groupMembersOf(deps: SteamToolDependencies, caller: SteamCaller): Array<{ key: string; name: string; links: SteamLink[] }> {
  if (!caller.groupId) return [];
  const byPerson = new Map<string, { key: string; name: string; links: SteamLink[] }>();
  for (const link of deps.store.broadcastMembers(caller.groupId)) {
    const key = link.personId ?? link.senderKey;
    const entry = byPerson.get(key) ?? { key, name: (link.personId ? caller.displayName?.(link.personId) : undefined) ?? link.personaName, links: [] };
    entry.links.push(link);
    byPerson.set(key, entry);
  }
  return [...byPerson.values()];
}

export const OWNED_CACHE_MS = 5 * 60_000;
export const OWNED_TOP_MAX = 20;
export const OWNED_RANK_MAX = 15;

export async function ownedFor(deps: SteamToolDependencies, steamId: string): Promise<Unknown<GameStat[]>> {
  const now = (deps.now ?? Date.now)();
  const cache = deps.ownedCache ??= new Map();
  const hit = cache.get(steamId);
  if (hit && now - hit.at <= OWNED_CACHE_MS) return hit.value;
  const value = await deps.client.ownedGames(steamId);
  cache.set(steamId, { at: now, value });
  return value;
}

interface LibraryResult {
  /** Accounts whose game list could be read. */
  readable: number;
  accounts: Array<{ account: string; known: boolean; gameCount?: number; totalHours?: number }>;
  gameCount: number;
  totalMinutes: number;
  games: GameStat[];
}

/** One person's library over all their accounts: a game owned on two accounts counts once, play time adds up. */
export async function libraryOf(deps: SteamToolDependencies, links: SteamLink[]): Promise<LibraryResult> {
  const merged = new Map<number, GameStat>();
  const accounts: LibraryResult['accounts'] = [];
  let readable = 0;
  let totalMinutes = 0;
  for (const link of links) {
    const owned = unknownValue(await ownedFor(deps, link.steamId));
    if (!owned.known) { accounts.push({ account: link.personaName, known: false }); continue; }
    readable += 1;
    const minutes = owned.value.reduce((sum, game) => sum + game.totalMinutes, 0);
    totalMinutes += minutes;
    accounts.push({ account: link.personaName, known: true, gameCount: owned.value.length, totalHours: minutesToHours(minutes) });
    for (const game of owned.value) {
      const existing = merged.get(game.appId);
      merged.set(game.appId, existing ? { ...existing, totalMinutes: existing.totalMinutes + game.totalMinutes, ...(existing.name ?? game.name ? { name: existing.name ?? game.name } : {}) } : game);
    }
  }
  return { readable, accounts, gameCount: merged.size, totalMinutes, games: [...merged.values()].sort((a, b) => b.totalMinutes - a.totalMinutes) };
}

/**
 * How many games a person owns, their total play time and their most played games, from GetOwnedGames (played free
 * games included). `all: true` ranks every linked member of the group (by games owned) instead; a member whose game
 * details are private is left out of the ranking and named as such. Several accounts of one person are merged.
 */
export function steamGetOwnedGames(deps: SteamToolDependencies, caller: SteamCaller, params: { person?: Person; all?: boolean; limit?: number; rankBy?: 'games' | 'hours' }): Promise<unknown> {
  return guarded(deps, async () => {
    if (params.all) {
      if (!caller.groupId) return { status: 'refused', reason: 'ranking_needs_a_group' };
      const byPerson = new Map<string, { name: string; links: SteamLink[] }>();
      for (const link of deps.store.broadcastMembers(caller.groupId)) {
        const key = link.personId ?? link.senderKey;
        const entry = byPerson.get(key) ?? { name: (link.personId ? caller.displayName?.(link.personId) : undefined) ?? link.personaName, links: [] };
        entry.links.push(link);
        byPerson.set(key, entry);
      }
      const ranked: Array<{ name: string; gameCount: number; totalHours: number; accountCount: number; topGame?: string }> = [];
      const hidden: string[] = [];
      for (const { name, links } of byPerson.values()) {
        const library = await libraryOf(deps, links);
        if (!library.readable) { hidden.push(name); continue; }
        ranked.push({ name, gameCount: library.gameCount, totalHours: minutesToHours(library.totalMinutes), accountCount: links.length, ...(library.games[0]?.name ? { topGame: library.games[0].name } : {}) });
      }
      const by = params.rankBy === 'hours' ? 'totalHours' : 'gameCount';
      ranked.sort((a, b) => b[by] - a[by] || a.name.localeCompare(b.name));
      return {
        status: 'ok', rankedBy: params.rankBy === 'hours' ? 'total_hours' : 'games_owned',
        ranking: ranked.slice(0, Math.min(Math.max(params.limit ?? OWNED_RANK_MAX, 1), OWNED_RANK_MAX)),
        ...(hidden.length ? { gameDetailsNotPublic: hidden, note: '这些成员的游戏详情未公开，没有计入排名。' } : {}),
        ...(ranked.length ? {} : { ranking: [], note: '群里没有人公开游戏详情，无法排名。' }),
      };
    }
    const target = targetFor(deps, caller, params.person ?? { reference: 'self' });
    if (!('links' in target)) return target;
    const library = await libraryOf(deps, target.links);
    if (!library.readable) return { status: 'ok', games: { known: false, reason: 'profile_private', note: '游戏详情未公开' }, accountCount: target.links.length };
    const limit = Math.min(Math.max(params.limit ?? 5, 1), OWNED_TOP_MAX);
    return {
      status: 'ok',
      gameCount: library.gameCount,
      totalHours: minutesToHours(library.totalMinutes),
      accountCount: target.links.length,
      ...(target.links.length > 1 ? { accounts: library.accounts } : {}),
      ...(library.readable < target.links.length ? { note: `有 ${target.links.length - library.readable} 个账号的游戏详情未公开，没有计入。` } : {}),
      top: library.games.slice(0, limit).map(gameView),
    };
  });
}

export function steamGetRecentGames(deps: SteamToolDependencies, caller: SteamCaller, params: { person: Person }): Promise<unknown> {
  return withTarget(deps, caller, params.person, async (link) => {
    const recent = await deps.client.recentGames(link.steamId);
    return recent.known ? { status: 'ok', recent: { known: true, value: recent.value.map(gameView) } } : { status: 'ok', recent };
  });
}

const ACHIEVEMENT_LIMIT_MAX = 20;

/** Which game: a numeric app id as given, else the best match among the person's games by name, else what they are playing now or played last. */
async function achievementGame(deps: SteamToolDependencies, link: SteamLink, game: string | undefined): Promise<{ appId: string; name?: string } | { status: string; reason: string }> {
  const wanted = game?.trim();
  if (wanted && /^\d{1,10}$/u.test(wanted)) return { appId: wanted };
  if (wanted) {
    const owned = unknownValue(await deps.client.ownedGames(link.steamId));
    if (!owned.known) return { status: 'ok', reason: owned.reason };
    const lower = wanted.toLowerCase();
    const matches = owned.value.filter((entry) => entry.name?.toLowerCase().includes(lower))
      .sort((a, b) => Number(b.name?.toLowerCase() === lower) - Number(a.name?.toLowerCase() === lower) || b.totalMinutes - a.totalMinutes);
    const best = matches[0];
    return best ? { appId: String(best.appId), ...(best.name ? { name: best.name } : {}) } : { status: 'not_found', reason: 'game_not_in_library' };
  }
  const summary = (await deps.client.playerSummaries([link.steamId])).get(link.steamId);
  if (summary?.gameId) return { appId: summary.gameId, ...(summary.gameName ? { name: summary.gameName } : {}) };
  const recent = unknownValue(await deps.client.recentGames(link.steamId));
  const last = recent.known ? recent.value[0] : undefined;
  return last ? { appId: String(last.appId), ...(last.name ? { name: last.name } : {}) } : { status: 'not_found', reason: 'no_game_to_look_up' };
}

/**
 * One person's achievements in one game (the one named, else the one they are playing or played last): how many are
 * unlocked, the rarest and the latest, or what is still missing. Needs the person's game details to be public.
 */
export function steamGetAchievements(deps: SteamToolDependencies, caller: SteamCaller, params: { person: Person; game?: string; mode?: AchievementMode; limit?: number }): Promise<unknown> {
  const client = deps.client;
  if (!client.playerAchievements || !client.achievementSchema || !client.achievementPercentages) return Promise.resolve({ status: 'unavailable', reason: 'achievements_not_supported' });
  const catalog = deps.achievementCatalog ??= new AchievementCatalog({ achievementSchema: client.achievementSchema.bind(client), achievementPercentages: client.achievementPercentages.bind(client) }, deps.now);
  const limit = Math.min(Math.max(params.limit ?? 5, 1), ACHIEVEMENT_LIMIT_MAX);
  return withTarget(deps, caller, params.person, async (link) => {
    const chosen = await achievementGame(deps, link, params.game);
    if (!('appId' in chosen)) return chosen.status === 'ok' ? { status: 'ok', achievements: { known: false, reason: chosen.reason } } : chosen;
    const result = await client.playerAchievements!(link.steamId, chosen.appId);
    if (!result.known) return { status: 'ok', game: { appId: chosen.appId, ...(chosen.name ? { name: chosen.name } : {}) }, achievements: { known: false, reason: result.reason } };
    if (!result.value.length) return { status: 'ok', game: { appId: chosen.appId, ...(chosen.name ? { name: chosen.name } : {}) }, achievements: { known: false, reason: 'not_available' } };
    const entry = await catalog.lookup(chosen.appId);
    return { status: 'ok', game: { appId: chosen.appId, ...(chosen.name ? { name: chosen.name } : {}) }, achievements: { known: true, value: summariseAchievements(result.value, entry, params.mode ?? 'summary', limit) } };
  });
}

export const FRIENDS_CACHE_MS = 60_000;
export const FRIENDS_MAX = 500;

export type FriendFilter = 'playing' | 'online' | 'all';

/** A group reply stays short: fewer friends listed per answer there than in a direct chat. */
export const FRIENDS_LIMIT_DIRECT = { default: 30, max: 100 };
export const FRIENDS_LIMIT_GROUP = { default: 15, max: 30 };

/**
 * A person's Steam friends, read from the Steam Web API (GetFriendList + GetPlayerSummaries) on demand, in a direct chat
 * or in a group. The person defaults to the asker's own linked account(s); another linked member can be asked about
 * unless they switched their announcements off. Several accounts are merged, a private friend list is reported as
 * such, and the answer is capped. Nothing is stored beyond a short cache and nothing is ever announced.
 */
export async function steamFriendsStatus(deps: SteamToolDependencies, caller: SteamCaller, params: { person?: Person; filter?: FriendFilter; name?: string; limit?: number }): Promise<unknown> {
  if (!caller.senderKey) return { status: 'refused', reason: 'trusted_sender_metadata_unavailable' };
  const target = targetFor(deps, caller, params.person ?? { reference: 'self' });
  if (!('links' in target)) return target.status === 'not_linked' && (params.person ?? { reference: 'self' }).reference === 'self'
    ? { status: 'not_linked', reason: 'link_your_own_steam_account_first' } : target;
  const own = target.links;
  const accountIds = own.map((link) => link.steamId);
  const cap = caller.groupId ? FRIENDS_LIMIT_GROUP : FRIENDS_LIMIT_DIRECT;
  return guarded(deps, async () => {
    const now = (deps.now ?? Date.now)();
    const cache = deps.friendsCache ??= new Map();
    const cacheKey = own.map((link) => link.steamId).sort().join(',');
    let entry = cache.get(cacheKey);
    if (!entry || now - entry.at > FRIENDS_CACHE_MS) {
      // Several accounts: the friends of all of them, once each, without the person's own accounts.
      const mine = new Set(own.map((link) => link.steamId));
      const merged = new Set<string>();
      let hidden = 0;
      let privateReason = 'friend_list_private';
      for (const link of own) {
        const list = await deps.client.friendList(link.steamId);
        if (!list.known) { hidden += 1; privateReason = list.reason; continue; }
        for (const id of list.value) if (!mine.has(id)) merged.add(id);
      }
      if (hidden === own.length) return { status: 'ok', friends: { known: false, reason: privateReason, note: '好友列表未公开' }, ...(own.length > 1 ? { accountsChecked: own.length } : {}) };
      const all = [...merged];
      const ids = all.slice(0, FRIENDS_MAX);
      const summaries = await deps.client.playerSummaries(ids);
      entry = { at: now, friends: ids.flatMap((id) => { const summary = summaries.get(id); return summary ? [summary] : []; }), truncated: all.length > FRIENDS_MAX, accountCount: own.length, accountsHidden: hidden };
      cache.set(cacheKey, entry);
    }
    let wanted = params.name?.trim().toLowerCase() || undefined;
    let nameIgnored: 'too_short' | 'own_nickname' | 'no_match' | undefined;
    // A one-character name is a probe, not a nickname; a name equal to the asked account's own nickname is that person, not a friend.
    if (wanted && [...wanted].length < 2) { nameIgnored = 'too_short'; wanted = undefined; }
    if (wanted) {
      const own = await deps.client.playerSummaries(accountIds);
      if ([...own.values()].some((summary) => summary.name.trim().toLowerCase() === wanted)) { nameIgnored = 'own_nickname'; wanted = undefined; }
    }
    if (wanted && !entry.friends.some((friend) => friend.name.toLowerCase().includes(wanted!))) { nameIgnored = 'no_match'; wanted = undefined; }
    const filter = nameIgnored ? 'all' : params.filter ?? 'playing';
    const rank = (friend: PlayerSummary): number => (friend.gameId ? 0 : friend.personaState && friend.personaState !== 0 ? 1 : 2);
    const matching = entry.friends
      .filter((friend) => friend.profilePublic || friend.personaState !== 0 || friend.gameId)
      .filter((friend) => !wanted || friend.name.toLowerCase().includes(wanted))
      .filter((friend) => filter === 'all' || (filter === 'online' ? rank(friend) <= 1 : rank(friend) === 0))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    const limit = Math.min(Math.max(params.limit ?? cap.default, 1), cap.max);
    const hidden = entry.friends.filter((friend) => !friend.profilePublic && friend.personaState === 0 && !friend.gameId).length;
    const shown = matching.slice(0, limit).map((friend) => ({
      name: friend.name,
      steamId: friend.steamId,
      state: (rank(friend) === 0 ? 'in_game' : rank(friend) === 1 ? 'online' : 'offline') as 'in_game' | 'online' | 'offline',
      game: friend.gameName ?? null,
      ...(friend.gameId ? { appId: friend.gameId } : {}),
    }));
    return {
      status: 'ok',
      ...(shown.length ? { displayText: renderPlayingCard({ friends: shown }, new Date(now)), replyGuide: CARD_REPLY_GUIDE } : {}),
      friendCount: entry.friends.length,
      truncated: entry.truncated,
      accountsChecked: entry.accountCount,
      accountsWithPrivateFriendList: entry.accountsHidden,
      // Friends with a hidden profile look offline whatever they are doing, so they are counted, never listed as offline.
      hiddenOrOfflineUnknown: hidden,
      matched: matching.length,
      ...(nameIgnored ? { note: '这次传的 name 无效（太短、是被查者自己的昵称或没有好友叫这个名字），已忽略，下面是完整结果；不要再用 name 重查。', nameIgnored } : {}),
      friends: matching.slice(0, limit).map((friend) => ({
        name: friend.name,
        steamId: friend.steamId,
        state: rank(friend) === 0 ? 'in_game' : rank(friend) === 1 ? 'online' : 'offline',
        game: friend.gameName ?? null,
        ...(rank(friend) === 2 && friend.lastLogoff ? { lastSeenAt: new Date(friend.lastLogoff).toISOString() } : {}),
      })),
    };
  });
}
