import { renderDailyReview, type PubgStatsPresentation, type SessionReviewPresentation } from '@rine-kit/presentation';
import {
  buildSessionReview,
  businessDayWindow,
  dailyReviewKey,
  dailySquadSession,
  DEFAULT_REVIEW_FEATURE_VERSION,
  DEFAULT_TELEMETRY_PARSER_VERSION,
  latestCompleteBusinessDay,
  localTimeOn,
  SESSION_BASELINE_MS,
  sessionBaseline,
  type MatchReviewFacts,
  type NormalizedMatch,
  type ReviewShareStore,
  type SessionReviewLedger,
  type SessionReviewRecord,
  type SessionTeam,
  type SquadSession,
  type TelemetryFeatureKey,
  type TelemetryFeatureRecord,
} from '@rine-kit/pubg-domain';
import { issueQueryShare, querySharePlayers, queryShareTeamTotals } from './query-share.js';
import {
  checkReviewTarget,
  queueOwnerBlockedNotice,
  reviewIdempotencyKey,
  sendReview,
  type ReportGateway,
  type ReportSubscription,
} from './session-review-delivery.js';

/**
 * The once-a-day squad review: at 09:30 local time it covers the business day that just ended (yesterday 06:00 to
 * today 06:00) in one message with the rich 战绩 card and a share link. A business day is sent at most once.
 */
export type DailyReviewMode = 'off' | 'dry-run' | 'deliver';
export const DAILY_REVIEW_TIME = '09:30';
export const DAILY_REVIEW_MAX_ATTEMPTS = 5;
/** A failed or waiting run is tried again this much later, never more often. */
export const DAILY_REVIEW_RETRY_MS = 10 * 60_000;
/** Without a fetch that finished after the day ended the run waits, but only this long past the scheduled time. */
export const DAILY_REVIEW_FETCH_GRACE_MS = 2 * 60 * 60_000;
/** Stands in for the share link in the ledger copy; the token only ever exists in the delivered message. */
export const DAILY_REVIEW_LINK = 'https://pubg.invalid/s/{{review-share-link}}';

export interface DailyReviewStore extends SessionReviewLedger, ReviewShareStore {
  listMatches(options: { fromMs?: number; toMs?: number; order?: 'asc' | 'desc' }): NormalizedMatch[];
  get(key: TelemetryFeatureKey): Promise<TelemetryFeatureRecord | null>;
}

export type DailyTeam = SessionTeam & { tenantId: string; playerNames: ReadonlyMap<string, string> };

/** The pubg_query_stats answer for the business day, as the tool builds it for a 昨日战绩 question. */
export interface DailyStats {
  presentation: PubgStatsPresentation;
  /** The plain block the share page keeps. */
  displayText: string;
  dataUpdatedAt: string | null;
}

export type DailyStatsSource = (window: { businessDay: string; startMs: number; endMs: number }) => Promise<DailyStats>;

export interface DailyReviewInput {
  store: DailyReviewStore;
  team: DailyTeam;
  mode: DailyReviewMode;
  subscription: ReportSubscription | null;
  gateway?: ReportGateway;
  ownerOutboxDir?: string;
  timezone: string;
  businessDayStart?: string;
  shareBaseUrl?: string;
  stats: DailyStatsSource;
  now: Date;
  log?: (line: string) => void;
}

export interface DailyOutcome {
  businessDay: string;
  sessionKey: string;
  result: 'done' | 'skipped' | 'waiting' | 'dry_run' | 'sent' | 'pending_delivery' | 'blocked';
  detail?: string;
}

export const dailyEnabledAtKey = (squadId: string) => `daily-enabled-at:${squadId}`;

/** When the review of `businessDay` is due: 09:30 on the calendar day after it. */
export function dailyReviewDueAt(businessDay: string, timezone: string): Date {
  return localTimeOn(businessDay, DAILY_REVIEW_TIME, timezone, 1);
}

/** The next 09:30 strictly after `now`. */
export function nextDailyReviewAt(now: Date, timezone: string, businessDayStart?: string): Date {
  const due = dailyReviewDueAt(latestCompleteBusinessDay(now, timezone, businessDayStart), timezone);
  return due.getTime() > now.getTime() ? due : localTimeOn(latestCompleteBusinessDay(now, timezone, businessDayStart), DAILY_REVIEW_TIME, timezone, 2);
}

async function featuresFor(store: Pick<DailyReviewStore, 'get'>, matchIds: Iterable<string>): Promise<Map<string, MatchReviewFacts | null>> {
  const facts = new Map<string, MatchReviewFacts | null>();
  for (const matchId of matchIds) {
    const record = await store.get({ matchId, parserVersion: DEFAULT_TELEMETRY_PARSER_VERSION, featureVersion: DEFAULT_REVIEW_FEATURE_VERSION });
    facts.set(matchId, record?.facts ?? null);
  }
  return facts;
}

export interface ComposedDailyReview {
  session: SquadSession;
  review: SessionReviewPresentation;
  stats: DailyStats;
  render(link: string): string;
}

/** Builds one business day's review and its 战绩 card; null when the squad did not play together that day. Shared with the CLI preview. */
export async function composeDailyReview(input: {
  store: Pick<DailyReviewStore, 'listMatches' | 'get'>;
  team: DailyTeam;
  businessDay: string;
  timezone: string;
  businessDayStart?: string;
  stats: DailyStatsSource;
  now: Date;
}): Promise<ComposedDailyReview | null> {
  const window = businessDayWindow(input.businessDay, input.timezone, input.businessDayStart);
  const matches = input.store.listMatches({ fromMs: window.startMs - SESSION_BASELINE_MS, order: 'asc' });
  const session = dailySquadSession(matches, input.team, window);
  if (!session) return null;
  const baseline = sessionBaseline(matches, input.team, session);
  const facts = await featuresFor(input.store, [...session.matches, ...baseline].map((item) => item.match.matchId));
  const review = buildSessionReview({ session, baseline, team: input.team, facts, playerNames: input.team.playerNames, timezone: input.timezone, now: input.now });
  const stats = await input.stats(window);
  return {
    session, review, stats,
    render: (link) => renderDailyReview({ review: { ...review, link }, stats: stats.presentation, link, timezone: input.timezone, now: input.now }),
  };
}

function recordFor(key: string, squadId: string, session: SquadSession | null, endMs: number, now: Date, fields: Pick<SessionReviewRecord, 'status' | 'detail' | 'message' | 'attempts'>): SessionReviewRecord {
  return {
    squadId, sessionKey: key, matchIds: session ? session.matches.map((item) => item.match.matchId) : [], lastMatchEndMs: session?.lastEndMs ?? endMs,
    updatedAt: now.toISOString(), ...fields,
  };
}

type Fields = Pick<SessionReviewRecord, 'status' | 'detail' | 'message' | 'attempts'>;

async function deliver(input: DailyReviewInput, composed: ComposedDailyReview, attempts: number): Promise<Fields> {
  const { session } = composed;
  const ledgerCopy = composed.render(DAILY_REVIEW_LINK);
  const block = async (reason: string, extra: { groupName?: string; error?: string } = {}): Promise<Fields> => {
    if (input.ownerOutboxDir) await queueOwnerBlockedNotice(input.ownerOutboxDir, { sessionKey: session.key, reason, occurredAt: input.now.toISOString(), ...extra });
    return { status: 'blocked', detail: extra.error ? `${reason}: ${extra.error}` : reason, message: ledgerCopy, attempts };
  };
  if (!input.subscription?.enabled || !input.gateway) return block('no_subscription');
  // The review always goes out with its share page; without an origin to link to it is held back, never sent bare.
  if (!input.shareBaseUrl) return block('share_link_unavailable');
  const check = await checkReviewTarget(input.gateway, input.subscription, input.team.tenantId);
  if (!check.ok) {
    // A directory hiccup is transient: retry, and tell the owner once when it outlasts the attempt limit.
    if (check.reason === 'directory_unavailable') {
      if (attempts + 1 === DAILY_REVIEW_MAX_ATTEMPTS && input.ownerOutboxDir) {
        await queueOwnerBlockedNotice(input.ownerOutboxDir, { sessionKey: session.key, reason: check.reason, occurredAt: input.now.toISOString(), ...(check.error ? { error: check.error } : {}) });
      }
      return { status: 'pending_delivery', detail: check.error ? `${check.reason}: ${check.error}` : check.reason, message: ledgerCopy, attempts: attempts + 1 };
    }
    return block(check.reason, check.groupName ? { groupName: check.groupName } : {});
  }
  try {
    const link = issueQueryShare({
      toolName: 'pubg_query_stats', matchIds: session.matches.map((item) => item.match.matchId), displayText: composed.stats.displayText,
      dataUpdatedAt: composed.stats.dataUpdatedAt, timezone: input.timezone, squadId: input.team.id, shareBaseUrl: input.shareBaseUrl,
      store: input.store, now: input.now, sessionKey: session.key,
      players: querySharePlayers(composed.stats.presentation), teamTotals: queryShareTeamTotals(composed.stats.displayText),
    });
    if (!link) throw new Error('share link was not issued');
    await sendReview(input.gateway, input.subscription, composed.render(link), reviewIdempotencyKey(session.key, input.subscription));
    return { status: 'sent', detail: `group:${check.groupName}`, message: ledgerCopy, attempts: attempts + 1 };
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 200);
    if (attempts + 1 >= DAILY_REVIEW_MAX_ATTEMPTS) return block('delivery_failed', { error: message });
    return { status: 'pending_delivery', detail: message, message: ledgerCopy, attempts: attempts + 1 };
  }
}

/** One run for the latest complete business day: preview (dry-run) or deliver it, recording the decision in the ledger. */
export async function runDailyReview(input: DailyReviewInput): Promise<DailyOutcome> {
  const { store, team, now, timezone } = input;
  const log = input.log ?? (() => undefined);
  const businessDay = latestCompleteBusinessDay(now, timezone, input.businessDayStart);
  const window = businessDayWindow(businessDay, timezone, input.businessDayStart);
  const key = dailyReviewKey(team.id, businessDay);
  const outcome = (result: DailyOutcome['result'], detail?: string): DailyOutcome => {
    log(`pubg daily review ${result} ${key}${detail ? ` (${detail})` : ''}`);
    return { businessDay, sessionKey: key, result, ...(detail ? { detail } : {}) };
  };
  if (input.mode === 'off') return outcome('skipped', 'off');
  const record = store.getSessionReview(team.id, key);
  if (record && record.status !== 'pending_delivery' && !(record.status === 'dry_run' && input.mode === 'deliver')) return outcome('done', record.status);
  let enabledAt = store.getSessionReviewMeta(dailyEnabledAtKey(team.id));
  if (!enabledAt) {
    enabledAt = now.toISOString();
    store.setSessionReviewMeta(dailyEnabledAtKey(team.id), enabledAt);
  }
  const dueAt = dailyReviewDueAt(businessDay, timezone);
  if (now.getTime() < dueAt.getTime()) return outcome('waiting', 'not_due');
  // Days that were already due when the daily review was switched on are skipped, never backfilled.
  if (!record && dueAt.getTime() < Date.parse(enabledAt)) {
    store.putSessionReview(recordFor(key, team.id, null, window.endMs, now, { status: 'skipped', detail: 'before_enable', message: null, attempts: 0 }));
    return outcome('skipped', 'before_enable');
  }
  // PUBG lists a match a few minutes after it ends; without a fetch after the day ended its last matches may be missing.
  const fetched = store.latestPrefetchFinishedMs();
  if ((fetched === null || fetched < window.endMs) && now.getTime() < dueAt.getTime() + DAILY_REVIEW_FETCH_GRACE_MS) return outcome('waiting', 'fetch_not_after_day');
  const attempts = record?.status === 'pending_delivery' ? record.attempts : 0;
  let composed: ComposedDailyReview | null;
  try {
    composed = await composeDailyReview({ store, team, businessDay, timezone, ...(input.businessDayStart ? { businessDayStart: input.businessDayStart } : {}), stats: input.stats, now });
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 200);
    const status = attempts + 1 >= DAILY_REVIEW_MAX_ATTEMPTS ? 'blocked' : 'pending_delivery';
    store.putSessionReview(recordFor(key, team.id, null, window.endMs, now, { status, detail: `compose_failed: ${message}`, message: null, attempts: attempts + 1 }));
    return outcome(status, `compose_failed: ${message}`);
  }
  if (!composed) {
    store.putSessionReview(recordFor(key, team.id, null, window.endMs, now, { status: 'skipped', detail: 'no_matches', message: null, attempts: 0 }));
    return outcome('skipped', 'no_matches');
  }
  if (input.mode === 'dry-run') {
    const message = composed.render(DAILY_REVIEW_LINK);
    store.putSessionReview(recordFor(key, team.id, composed.session, window.endMs, now, { status: 'dry_run', detail: `${message.length} chars`, message, attempts: 0 }));
    return outcome('dry_run', `${composed.session.matches.length} matches, ${message.length} chars`);
  }
  const fields = await deliver(input, composed, attempts);
  store.putSessionReview(recordFor(key, team.id, composed.session, window.endMs, now, fields));
  return outcome(fields.status as DailyOutcome['result'], fields.detail ?? undefined);
}
