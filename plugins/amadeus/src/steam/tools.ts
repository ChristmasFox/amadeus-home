import { SteamApiError, type GameStat, type PlayerSummary, type SteamClient, type Unknown } from './client.js';
import { parseSteamReference } from './domain.js';
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
  /** Mirrors a new link into the identity store; returns the person id when the sender is a known person. */
  mirrorLink?: (steamId: string, label: string) => string | undefined;
}

export interface SteamToolDependencies {
  store: SteamStore;
  client: Pick<SteamClient, 'resolveVanity' | 'playerSummaries' | 'ownedGames' | 'recentGames' | 'hasKey'>;
  now?: () => number;
}

export type Person =
  | { reference: 'self' }
  | { reference: 'mention'; mentionIndex?: number }
  | { reference: 'reply_sender' }
  | { reference: 'alias'; alias: string };

const keyUnavailable = { status: 'unavailable', reason: 'steam_api_key_missing' } as const;

async function guarded<T>(deps: SteamToolDependencies, work: () => Promise<T>): Promise<T | typeof keyUnavailable | { status: 'unavailable'; reason: string }> {
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

export async function steamLinkAccount(deps: SteamToolDependencies, caller: SteamCaller, params: { reference: string; confirm?: boolean }): Promise<unknown> {
  const senderKey = requireSender(caller);
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
    const personId = caller.mirrorLink?.(steamId, summary.name);
    const result = deps.store.link({ senderKey, steamId, personaName: summary.name || steamId, ...(personId ? { personId } : {}), now: (deps.now ?? Date.now)() });
    if (result.status === 'conflict') return { status: 'conflict', reason: 'steam_account_already_linked_by_someone_else' };
    if (caller.groupId) deps.store.enroll(caller.groupId, senderKey);
    return { status: 'linked', name: summary.name, broadcast: true, groupEnrolled: Boolean(caller.groupId), groupAnnouncementsEnabled: caller.groupId ? deps.store.groupEnabled(caller.groupId) : undefined };
  });
}

export function steamUnlink(deps: SteamToolDependencies, caller: SteamCaller): unknown {
  return { status: deps.store.unlink(requireSender(caller)) ? 'unlinked' : 'not_linked' };
}

/** The personal "announce me" switch. Turning it on inside a group also enrols the person in that group. */
export function steamSetBroadcast(deps: SteamToolDependencies, caller: SteamCaller, params: { enabled: boolean }): unknown {
  const senderKey = requireSender(caller);
  if (!deps.store.linkBySender(senderKey)) return { status: 'not_linked' };
  deps.store.setBroadcast(senderKey, params.enabled);
  if (caller.groupId) {
    if (params.enabled) deps.store.enroll(caller.groupId, senderKey);
    else deps.store.leaveGroup(caller.groupId, senderKey);
  }
  return { status: 'ok', broadcast: params.enabled, group: caller.groupId ? 'this_group' : undefined };
}

export function steamGroupSettings(deps: SteamToolDependencies, caller: SteamCaller, params: { enabled?: boolean }): unknown {
  if (!caller.groupId) return { status: 'refused', reason: 'only_available_in_a_group' };
  if (params.enabled !== undefined) {
    if (!caller.isOwner) return { status: 'refused', reason: 'owner_only' };
    deps.store.setGroup(caller.groupId, params.enabled);
  }
  return { status: 'ok', announcementsEnabled: deps.store.groupEnabled(caller.groupId), announced: deps.store.broadcastMembers(caller.groupId).length };
}

type Target = { link: SteamLink; self: boolean } | { status: string; reason: string };

function targetFor(deps: SteamToolDependencies, caller: SteamCaller, person: Person): Target {
  let link: SteamLink | undefined;
  if (person.reference === 'self') {
    link = deps.store.linkBySender(requireSender(caller));
  } else if (person.reference === 'mention') {
    const key = caller.mentions[person.mentionIndex ?? 0];
    if (!key) return { status: 'not_found', reason: 'trusted_mention_metadata_unavailable' };
    link = deps.store.linkBySender(key);
  } else if (person.reference === 'reply_sender') {
    if (!caller.replySender) return { status: 'not_found', reason: 'trusted_reply_sender_metadata_unavailable' };
    link = deps.store.linkBySender(caller.replySender);
  } else {
    const personId = caller.personForAlias?.(person.alias);
    link = personId ? deps.store.linkByPerson(personId) : undefined;
  }
  if (!link) return { status: 'not_linked', reason: 'no_steam_account_linked' };
  const self = link.senderKey === caller.senderKey;
  // Switching announcements off also stops other people reading that person's Steam data.
  if (!self && !link.broadcast) return { status: 'refused', reason: 'sharing_off' };
  return { link, self };
}

async function withTarget(deps: SteamToolDependencies, caller: SteamCaller, person: Person, work: (link: SteamLink) => Promise<unknown>): Promise<unknown> {
  const target = targetFor(deps, caller, person);
  if (!('link' in target)) return target;
  return guarded(deps, () => work(target.link));
}

const minutesToHours = (minutes: number): number => Math.round(minutes / 6) / 10;
const gameView = (game: GameStat) => ({ appId: game.appId, name: game.name ?? null, totalHours: minutesToHours(game.totalMinutes), ...(game.recentMinutes !== undefined ? { recentHours: minutesToHours(game.recentMinutes) } : {}) });

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

export function steamGetPlaytime(deps: SteamToolDependencies, caller: SteamCaller, params: { person: Person; game?: string }): Promise<unknown> {
  return withTarget(deps, caller, params.person, async (link) => {
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

export function steamGetRecentGames(deps: SteamToolDependencies, caller: SteamCaller, params: { person: Person }): Promise<unknown> {
  return withTarget(deps, caller, params.person, async (link) => {
    const recent = await deps.client.recentGames(link.steamId);
    return recent.known ? { status: 'ok', recent: { known: true, value: recent.value.map(gameView) } } : { status: 'ok', recent };
  });
}
