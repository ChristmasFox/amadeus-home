import {
  announcementKey, applyObservation, DEFAULT_POLICY, planBroadcast,
  type BroadcastPolicy, type Candidate, type PresenceChange, type StoredPresence,
} from './domain.js';
import { observationFrom, type PlayerSummary } from './client.js';
import type { SteamStore } from './store.js';

export interface AnnouncementPerson {
  name: string;
  game?: string;
}

export interface AnnouncementFacts {
  groupId: string;
  people: AnnouncementPerson[];
}

export interface PollerDependencies {
  store: SteamStore;
  client: { playerSummaries(ids: string[]): Promise<Map<string, PlayerSummary>> };
  /** Writes the announcement text from the facts (the Kurisu voice); rejects when no valid text could be made. */
  compose: (facts: AnnouncementFacts) => Promise<string>;
  send: (groupId: string, text: string, idempotencyKey: string) => Promise<void>;
  now?: () => number;
  policy?: BroadcastPolicy;
  /** Optional membership check before sending; a false answer (or a failure) skips that person. */
  isMember?: (groupId: string, senderKey: string) => Promise<boolean>;
  /** Known members per group (from the identity store); linked people among them are enrolled before each poll. */
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
export class PresencePoller {
  private readonly queue = new Map<string, Map<string, Candidate>>();
  private readonly policy: BroadcastPolicy;
  private readonly now: () => number;

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
      for (const steamId of ids) {
        const summary = summaries.get(steamId);
        if (!summary) continue;
        const observation = observationFrom(summary);
        const { next, event } = applyObservation(store.presence(steamId), observation, now);
        store.savePresence(steamId, next);
        if (next.state === 'offline') this.dropFromQueues(steamId);
        if (event) { report.events += 1; this.enqueue(event, next); }
      }
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

  private dropFromQueues(steamId: string): void {
    for (const group of this.queue.values()) group.delete(steamId);
  }

  private enqueue(event: PresenceChange, record: StoredPresence): void {
    const link = this.deps.store.linkBySteamId(event.steamId);
    if (!link || !link.broadcast) return;
    for (const groupId of this.deps.store.groupsOf(link.senderKey)) {
      if (!this.deps.store.groupEnabled(groupId)) continue;
      const group = this.queue.get(groupId) ?? new Map<string, Candidate>();
      group.set(event.steamId, { ...event, ...(record.lastNotifiedAt !== undefined ? { lastNotifiedAt: record.lastNotifiedAt } : {}) });
      this.queue.set(groupId, group);
    }
  }

  private async flush(report: TickReport): Promise<void> {
    const { store } = this.deps;
    for (const [groupId, group] of [...this.queue]) {
      const members = new Map(store.broadcastMembers(groupId).map((link) => [link.steamId, link]));
      // A switched-off group, an opted-out person or someone who left is dropped, never announced.
      for (const steamId of [...group.keys()]) {
        const link = members.get(steamId);
        let allowed = store.groupEnabled(groupId) && link !== undefined;
        if (allowed && this.deps.isMember) {
          try { allowed = await this.deps.isMember(groupId, link!.senderKey); } catch { allowed = false; }
        }
        if (!allowed) { group.delete(steamId); report.skipped += 1; }
      }
      if (!group.size) { this.queue.delete(groupId); continue; }
      const now = this.now();
      const plan = planBroadcast([...group.values()], now, store.announcedInLastHour(groupId, now), this.policy);
      for (const dropped of plan.skipped) { group.delete(dropped.steamId); report.skipped += 1; this.log(`steam announcement skipped reason=${dropped.reason}`); }
      if (plan.send) {
        for (const change of plan.send) group.delete(change.steamId);
        await this.announce(groupId, plan.send, members, report);
      }
      if (!group.size) this.queue.delete(groupId);
    }
  }

  private async announce(groupId: string, changes: PresenceChange[], members: Map<string, { personaName: string }>, report: TickReport): Promise<void> {
    const { store } = this.deps;
    const key = announcementKey(groupId, changes);
    if (store.alreadyAnnounced(key)) return;
    const now = this.now();
    const people = changes.map((change) => ({
      name: members.get(change.steamId)?.personaName ?? '',
      ...(change.gameName ? { game: change.gameName } : {}),
    })).filter((person) => person.name);
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
    for (const change of changes) {
      const record = store.presence(change.steamId);
      if (record) store.savePresence(change.steamId, { ...record, lastNotifiedAt: now });
    }
    report.sent += 1;
  }
}
