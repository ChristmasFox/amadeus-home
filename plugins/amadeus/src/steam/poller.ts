import {
  announcementKey, applyObservation, DEFAULT_POLICY, planBroadcast,
  type BroadcastPolicy, type Candidate, type EventKind, type PresenceChange, type StoredPresence, type UnlockedAchievement,
} from './domain.js';
import { AchievementCatalog, type AchievementClient } from './achievements.js';
import { observationFrom, SteamApiError, type PlayerSummary } from './client.js';
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
}

export interface AnnouncementFacts {
  groupId: string;
  people: AnnouncementPerson[];
}

export interface PollerDependencies {
  store: SteamStore;
  client: { playerSummaries(ids: string[]): Promise<Map<string, PlayerSummary>> } & Partial<AchievementClient>;
  /** Writes the announcement text from the facts (the Kurisu voice); rejects when no valid text could be made. */
  compose: (facts: AnnouncementFacts) => Promise<string>;
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
const slotOf = (change: PresenceChange): string => (change.kind === 'achievement_unlocked' ? `${change.steamId}|achievements|${change.gameId ?? ''}` : change.steamId);

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
        if (event) { report.events += 1; this.enqueue(event); }
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
      const merged = event.kind === 'achievement_unlocked' && earlier?.achievements
        ? { ...event, at: earlier.at, achievements: [...earlier.achievements, ...(event.achievements ?? []).filter((item) => !earlier.achievements!.some((known) => known.apiName === item.apiName))] }
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
        ...(multiple && shown !== link.personaName ? { steamName: link.personaName } : {}),
        kind: change.kind,
        ...(change.gameName ? { game: change.gameName } : {}),
        ...(change.achievements ? { achievements: change.achievements } : {}),
      }];
    });
    if (!people.length) return;
    let text: string;
    try {
      text = await this.deps.compose({ groupId, people });
    } catch {
      // No fixed template: a failed compose is recorded and nothing is sent.
      store.recordAnnouncement(key, groupId, now, 'compose_failed');
      report.failed += 1;
      this.log('steam announcement compose failed; not sent');
      return;
    }
    try {
      await this.deps.send(groupId, text, key);
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
