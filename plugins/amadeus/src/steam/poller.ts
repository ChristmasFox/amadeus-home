import { gameLabel } from './game-aliases.js';
import {
  announcementKey, applyObservation, DEFAULT_POLICY, planBroadcast,
  type BroadcastPolicy, type Candidate, type EventKind, type PresenceChange, type StoredPresence, type UnlockedAchievement,
} from './domain.js';
import { AchievementCatalog, type AchievementClient } from './achievements.js';
import { observationFrom, SteamApiError, type PlayerSummary } from './client.js';
import { MIN_STOP_MINUTES } from './notify.js';
import type { SteamLink, SteamStore } from './store.js';

export interface AnnouncementPerson {
  /** The person's name (their identity display name, else the Steam nickname). */
  name: string;
  /** The Steam nickname, given only when the person has several accounts so they can be told apart. */
  steamName?: string;
  kind: EventKind;
  game?: string;
  /** For achievement_unlocked. */
  achievements?: UnlockedAchievement[];
  /** For stopped_playing: how long the session lasted. */
  durationMinutes?: number;
  /** For switched_game: the game just left and its length, when long enough to count. */
  previous?: { gameName?: string; minutes?: number };
}

export interface AnnouncementFacts {
  groupId: string;
  people: AnnouncementPerson[];
}

export interface PollerDependencies {
  store: SteamStore;
  client: { playerSummaries(ids: string[]): Promise<Map<string, PlayerSummary>> } & Partial<AchievementClient>;
  /** Renders the announcement(s) from the facts (a deterministic Amadeus template); one text per message to send. */
  compose: (facts: AnnouncementFacts) => string | string[] | Promise<string | string[]>;
  send: (groupId: string, text: string, idempotencyKey: string) => Promise<void>;
  now?: () => number;
  policy?: BroadcastPolicy;
  /** Optional membership check before sending; a false answer (or a failure) skips that person. */
  isMember?: (groupId: string, senderKey: string) => Promise<boolean>;
  /** Known members per group (from the identity store); linked people among them are enrolled before each poll. */
  /** The person's display name from the identity store, if known. */
  displayName?: (personId: string) => string | undefined;
  groupPeople?: () => Array<{ groupId: string; personIds: string[] }>;
  log?: (message: string) => void;
}

export interface TickReport {
  watched: number;
  events: number;
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * One poll cycle plus the announcement queue. The first observation of a SteamID only sets its baseline, so a restart
 * never replays history; queued arrivals live in memory only and are dropped by a restart on purpose.
 */
/** One queue slot per person for presence events (the newest wins); achievements of one game share a slot and are merged. */
const slotOf = (change: PresenceChange): string => (change.kind === 'achievement_unlocked' ? `${change.steamId}|achievements|${change.gameId ?? ''}` : change.kind === 'stopped_playing' ? `${change.steamId}|stopped|${change.at}` : change.steamId);

/** An unlock older than this when first seen (offline sync, a long gap) is absorbed silently: nothing historic is announced. */
const FRESH_UNLOCK_MS = 30 * 60_000;

export class PresencePoller {
  private readonly queue = new Map<string, Map<string, Candidate>>();
  private readonly policy: BroadcastPolicy;
  private readonly now: () => number;
  private catalog: AchievementCatalog | undefined;

  constructor(private readonly deps: PollerDependencies) {
    this.policy = deps.policy ?? DEFAULT_POLICY;
    this.now = deps.now ?? Date.now;
    // A previous run's open play sessions end where they were last seen.
    deps.store.closeStalePlaySessions();
  }

  private log(message: string): void { this.deps.log?.(message); }

  async tick(): Promise<TickReport> {
    const { store } = this.deps;
    const report: TickReport = { watched: 0, events: 0, sent: 0, skipped: 0, failed: 0 };
    this.reconcile();
    const ids = store.watchedSteamIds();
    report.watched = ids.length;
    if (ids.length) {
      const summaries = await this.deps.client.playerSummaries(ids);
      const now = this.now();
      const playing: Array<{ steamId: string; appId: string; gameName?: string }> = [];
      for (const steamId of ids) {
        const summary = summaries.get(steamId);
        if (!summary) continue;
        const observation = observationFrom(summary);
        const before = store.presence(steamId);
        const { next, event } = applyObservation(before, observation, now);
        store.savePresence(steamId, next);
        if (next.state === 'offline') this.dropFromQueues(steamId);
        const { closed } = store.recordPlay(steamId, next.state === 'in_game' && next.gameId ? { appId: next.gameId, ...(next.gameName ? { name: next.gameName } : {}) } : undefined, now,
          { ...(before?.state === 'in_game' && before.gameId === next.gameId ? { startHint: before.since } : {}) });
        const minutes = closed ? Math.round((closed.endedAt - closed.startedAt) / 60_000) : 0;
        const counts = closed !== undefined && closed.reason !== 'gap' && minutes >= MIN_STOP_MINUTES;
        // Leaving one game for another is announced once, as the switch (with the length of the game just left); only a real stop gets its own notice.
        // The switch always says which game was left; the length is added only when that session was long enough to count.
        const leftName = (closed?.gameName ?? before?.gameName) || undefined;
        const leftId = (closed?.appId ?? before?.gameId) || undefined;
        const enriched = event && event.kind === 'switched_game' && (leftName || (closed && counts))
          ? { ...event, previous: { ...(leftId ? { gameId: leftId } : {}), ...(leftName ? { gameName: leftName } : {}), ...(closed && counts ? { minutes } : {}) } }
          : event;
        if (enriched) { report.events += 1; this.enqueue(enriched); }
        if (closed && counts && closed.reason === 'stopped') {
          report.events += 1;
          this.enqueue({ steamId, kind: 'stopped_playing', at: now, gameId: closed.appId, ...(closed.gameName ? { gameName: closed.gameName } : {}), durationMinutes: minutes });
        }
        // Achievements are read for the game being played now, and once more right after it ends (unlocks often sync then).
        if (next.state === 'in_game' && next.gameId) playing.push({ steamId, appId: next.gameId, ...(next.gameName ? { gameName: next.gameName } : {}) });
        else if (before?.state === 'in_game' && before.gameId) playing.push({ steamId, appId: before.gameId, ...(before.gameName ? { gameName: before.gameName } : {}) });
      }
      report.events += await this.checkAchievements(playing, now);
    }
    await this.flush(report);
    return report;
  }

  /** Linked people who belong to an announcing group join its list on their own; someone who opted out stays out. */
  private reconcile(): void {
    if (!this.deps.groupPeople) return;
    try {
      for (const { groupId, personIds } of this.deps.groupPeople()) {
        if (!this.deps.store.groupEnabled(groupId)) continue;
        const added = this.deps.store.enrollPeople(groupId, personIds);
        if (added) this.log(`steam enrolled ${added} linked member(s) into a group`);
      }
    } catch (error) {
      this.log(`steam member reconcile failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  /** Diffs each playing account's unlocked achievements against its baseline; returns how many events were queued. */
  private async checkAchievements(playing: Array<{ steamId: string; appId: string; gameName?: string }>, now: number): Promise<number> {
    const client = this.deps.client;
    if (!client.playerAchievements || !client.achievementSchema || !client.achievementPercentages || !playing.length) return 0;
    const catalog = this.catalog ??= new AchievementCatalog({ achievementSchema: client.achievementSchema.bind(client), achievementPercentages: client.achievementPercentages.bind(client) }, this.now);
    const { store } = this.deps;
    let queued = 0;
    for (const { steamId, appId, gameName } of playing) {
      try {
        const result = await client.playerAchievements(steamId, appId);
        if (!result.known) continue;
        const unlocked = result.value.filter((entry) => entry.achieved);
        const baseline = store.achievementBaseline(steamId, appId);
        store.saveAchievementBaseline(steamId, appId, unlocked.map((entry) => entry.apiName));
        if (!baseline) continue; // first sight of this game: baseline only, nothing is replayed
        const known = new Set(baseline);
        const fresh = unlocked.filter((entry) => !known.has(entry.apiName) && (entry.unlockedAt === undefined || now - entry.unlockedAt <= FRESH_UNLOCK_MS));
        if (!fresh.length) continue;
        const detail = await catalog.lookup(appId);
        const achievements = fresh.map((entry): UnlockedAchievement => {
          const percent = detail.percent.get(entry.apiName);
          return { apiName: entry.apiName, name: entry.name ?? detail.definitions.get(entry.apiName)?.name ?? entry.apiName, ...(percent !== undefined ? { globalPercent: percent } : {}) };
        });
        this.enqueue({ steamId, kind: 'achievement_unlocked', at: now, gameId: appId, ...(gameName ? { gameName } : {}), achievements });
        queued += 1;
      } catch (error) {
        // Private or unsupported games are skipped quietly; a rate limit ends this round of reads early.
        if (error instanceof SteamApiError && error.code === 'rate_limited') break;
      }
    }
    return queued;
  }

  private dropFromQueues(steamId: string): void {
    for (const group of this.queue.values()) group.delete(steamId);
  }

  private enqueue(event: PresenceChange): void {
    const link = this.deps.store.linkBySteamId(event.steamId);
    if (!link || !link.broadcast) return;
    for (const groupId of this.deps.store.groupsOf(link.senderKey)) {
      if (!this.deps.store.groupEnabled(groupId)) continue;
      const group = this.queue.get(groupId) ?? new Map<string, Candidate>();
      const slot = slotOf(event);
      const earlier = group.get(slot);
      // Unlocks arriving before the merge window closes join the earlier ones instead of replacing them.
      // A person who just came online (or back) and starts or changes a game before the window closes is still announced as
      // coming online, now with the game: the newest event must not replace the arrival.
      const arrival = earlier && (earlier.kind === 'came_online' || earlier.kind === 'back_from_away') && (event.kind === 'started_playing' || event.kind === 'switched_game');
      const merged = event.kind === 'achievement_unlocked' && earlier?.achievements
        ? { ...event, at: earlier.at, achievements: [...earlier.achievements, ...(event.achievements ?? []).filter((item) => !earlier.achievements!.some((known) => known.apiName === item.apiName))] }
        : arrival
          ? { steamId: event.steamId, kind: earlier.kind, at: earlier.at, ...(event.gameId ? { gameId: event.gameId } : {}), ...(event.gameName ? { gameName: event.gameName } : {}) }
          : { ...event };
      group.set(slot, merged);
      this.queue.set(groupId, group);
    }
  }

  private async flush(report: TickReport): Promise<void> {
    const { store } = this.deps;
    for (const [groupId, group] of [...this.queue]) {
      const members = new Map(store.broadcastMembers(groupId).map((link) => [link.steamId, link]));
      // A switched-off group, an opted-out person or someone who left is dropped, never announced.
      for (const [slot, candidate] of [...group]) {
        const link = members.get(candidate.steamId);
        let allowed = store.groupEnabled(groupId) && link !== undefined;
        if (allowed && this.deps.isMember) {
          try { allowed = await this.deps.isMember(groupId, link!.senderKey); } catch { allowed = false; }
        }
        if (!allowed) { group.delete(slot); report.skipped += 1; }
      }
      if (!group.size) { this.queue.delete(groupId); continue; }
      const now = this.now();
      const plan = planBroadcast([...group.values()], now, this.policy);
      if (plan.send) {
        for (const change of plan.send) group.delete(slotOf(change));
        await this.announce(groupId, plan.send, members, report);
      }
      if (!group.size) this.queue.delete(groupId);
    }
  }

  private async announce(groupId: string, changes: PresenceChange[], members: Map<string, SteamLink>, report: TickReport): Promise<void> {
    const { store } = this.deps;
    const key = announcementKey(groupId, changes);
    if (store.alreadyAnnounced(key)) return;
    const now = this.now();
    const people = changes.flatMap((change) => {
      const link = members.get(change.steamId);
      if (!link) return [];
      const shown = (link.personId ? this.deps.displayName?.(link.personId) : undefined) || link.personaName;
      const multiple = store.accountCount(link) > 1;
      return [{
        name: shown,
        ...(shown !== link.personaName || multiple ? { steamName: link.personaName } : {}),
        kind: change.kind,
        ...(change.gameName ? { game: gameLabel(change.gameId, change.gameName)! } : {}),
        ...(change.achievements ? { achievements: change.achievements } : {}),
        ...(change.durationMinutes !== undefined ? { durationMinutes: change.durationMinutes } : {}),
        ...(change.previous ? { previous: { ...change.previous, ...(change.previous.gameName ? { gameName: gameLabel(change.previous.gameId, change.previous.gameName)! } : {}) } } : {}),
      }];
    });
    if (!people.length) return;
    let texts: string[];
    try {
      const composed = await this.deps.compose({ groupId, people });
      texts = (Array.isArray(composed) ? composed : [composed]).filter((text) => text.trim());
      if (!texts.length) throw new Error('empty');
    } catch {
      // A failed render is recorded and nothing is sent.
      store.recordAnnouncement(key, groupId, now, 'compose_failed');
      report.failed += 1;
      this.log('steam announcement compose failed; not sent');
      return;
    }
    try {
      for (const [index, text] of texts.entries()) await this.deps.send(groupId, text, index === 0 ? key : `${key}#${index}`);
    } catch {
      store.recordAnnouncement(key, groupId, now, 'send_failed');
      report.failed += 1;
      this.log('steam announcement send failed');
      return;
    }
    store.recordAnnouncement(key, groupId, now, 'sent');
    report.sent += 1;
  }
}
