import { adaptWorldlineNotification, renderOwnerNotification, type PresentationFact } from '@rine-kit/presentation';
import type { BusinessCalendar } from './business-day.js';
import { minutesText } from './notify.js';
import type { SteamLink, SteamStore } from './store.js';
import { aggregatePlay } from './tools.js';

/** How long after 09:30 a late start may still send that morning's message. */
export const DAILY_PLAYTIME_CATCH_UP_MINUTES = 180;

/**
 * The 游戏时长 block of the 09:30 report, as a deterministic Amadeus message (no model): for the business day that just
 * ended (06:00 → 06:00) each recorded member's time per game and in total, accounts of one person merged. Nothing is
 * sent when nobody played, or when recording only began after the day ended; members without play are named briefly,
 * and a window that began before recording says so instead of inventing hours.
 */
export function steamPlaytimeSection(calendar: BusinessCalendar, store: SteamStore, links: SteamLink[], window: { startMs: number; endMs: number }, now: number, nameOf: (personId: string | undefined, fallback: string) => string): string | undefined {
  if (!links.length) return undefined;
  const trackingSince = store.playTrackingStartedAt();
  if (window.endMs <= trackingSince) return undefined;
  const people = new Map<string, { name: string; ids: string[] }>();
  for (const link of links) {
    const key = link.personId ?? link.senderKey;
    const entry = people.get(key) ?? { name: nameOf(link.personId, link.personaName), ids: [] };
    entry.ids.push(link.steamId);
    people.set(key, entry);
  }
  const facts: PresentationFact[] = [];
  for (const { name, ids } of people.values()) {
    const { games, totalMinutes } = aggregatePlay(calendar, store.playSessions(ids, window.startMs, window.endMs, now), window.startMs, window.endMs);
    if (!totalMinutes) continue;
    const perGame = games.map((game) => `${game.name} ${minutesText(game.minutes)}`).join('，');
    facts.push({ label: name, value: games.length > 1 ? `${perGame}（合计 ${minutesText(totalMinutes)}）` : perGame, evidenceRefs: [] });
  }
  if (!facts.length) return undefined;
  const partial = window.startMs < trackingSince;
  const occurredAt = new Date(now).toISOString();
  const notification = adaptWorldlineNotification({
    type: 'worldline_notification_intent',
    eventType: 'steam.daily_playtime',
    kind: 'steam_activity',
    severity: 'info',
    significance: 'minor',
    eventKey: `steam:daily-playtime:${calendar.label(window.startMs)}:${links[0]?.steamId ?? ''}`,
    source: 'steam',
    headline: 'Steam 昨日游戏时长',
    summary: `业务日 ${calendar.label(window.startMs)}（${calendar.timezone} ${calendar.start} → 次日 ${calendar.start}）各成员的游戏时长。${partial ? `\n记录从 ${calendar.format(trackingSince)} 起，之前的部分没有数据。` : ''}`,
    facts,
    occurredAt,
    worldLineClosing: true,
  });
  return renderOwnerNotification(notification, { now: occurredAt });
}

export interface DailyPlaytimeDependencies {
  store: SteamStore;
  /** The same business-day calendar the PUBG daily review uses. */
  calendar: BusinessCalendar;
  now: number;
  nameOf: (personId: string | undefined, fallback: string) => string;
  send: (groupId: string, text: string, idempotencyKey: string) => Promise<void>;
  log?: (message: string) => void;
}

/**
 * The standalone 09:30 message, scheduled like the PUBG daily review (09:30 in the shared business time zone, for the
 * business day that just ended): per member and game, one message per announcing group, built only from that group's
 * members. It runs from the presence loop every minute, acts only inside a catch-up window after 09:30, and records each
 * (group, day) once, so a restart never repeats it and a late deploy never sends an old day. Nothing is sent when
 * nobody played.
 */
export async function runDailyPlaytime(deps: DailyPlaytimeDependencies): Promise<{ sent: number; skipped: number; failed: number }> {
  const { store, now, calendar } = deps;
  const report = { sent: 0, skipped: 0, failed: 0 };
  const day = calendar.latestComplete(now);
  const dueAt = calendar.dueAt(day);
  if (now < dueAt || now >= dueAt + DAILY_PLAYTIME_CATCH_UP_MINUTES * 60_000) return report;
  const window = calendar.windowOf(day);
  if (!window) return report;
  for (const groupId of store.activeGroups()) {
    const key = `steam:daily-playtime:${groupId}:${day}`;
    if (store.alreadyAnnounced(key)) continue;
    const text = steamPlaytimeSection(calendar, store, store.broadcastMembers(groupId), window, now, deps.nameOf);
    if (!text) { store.recordAnnouncement(key, groupId, now, 'skipped'); report.skipped += 1; continue; }
    try {
      await deps.send(groupId, text, key);
      store.recordAnnouncement(key, groupId, now, 'sent');
      report.sent += 1;
    } catch {
      store.recordAnnouncement(key, groupId, now, 'send_failed');
      report.failed += 1;
      deps.log?.('steam daily playtime send failed');
    }
  }
  return report;
}
