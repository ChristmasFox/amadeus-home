import { renderSessionReview } from '@agent/presentation';
import {
  buildSessionReview,
  DEFAULT_REVIEW_FEATURE_VERSION,
  DEFAULT_TELEMETRY_PARSER_VERSION,
  planSessionReviews,
  SESSION_BASELINE_MS,
  SESSION_LOOKBACK_MS,
  sessionBaseline,
  squadMatches,
  type MatchReviewFacts,
  type NormalizedMatch,
  type SessionReviewLedger,
  type SessionReviewRecord,
  type SessionTeam,
  type SquadSession,
  type TelemetryFeatureKey,
  type TelemetryFeatureRecord,
} from '@agent/pubg-domain';
import {
  checkReviewTarget,
  queueOwnerBlockedNotice,
  reviewIdempotencyKey,
  sendReview,
  type ReportGateway,
  type ReportSubscription,
} from './session-review-delivery.js';

export type SessionReviewMode = 'off' | 'dry-run' | 'deliver';
export const SESSION_REVIEW_MAX_ATTEMPTS = 5;
export const SESSION_REVIEW_INTERVAL_MS = 5 * 60_000;

export interface SessionReviewStore extends SessionReviewLedger {
  listMatches(options: { fromMs?: number; toMs?: number; order?: 'asc' | 'desc' }): NormalizedMatch[];
  get(key: TelemetryFeatureKey): Promise<TelemetryFeatureRecord | null>;
}

export interface SessionReviewCycleInput {
  store: SessionReviewStore;
  team: SessionTeam & { tenantId: string; playerNames: ReadonlyMap<string, string> };
  mode: SessionReviewMode;
  subscription: ReportSubscription | null;
  gateway?: ReportGateway;
  ownerOutboxDir?: string;
  timezone: string;
  pageUrl?: string;
  now: Date;
  log?: (line: string) => void;
}

export interface CycleOutcome {
  sessionKey: string;
  result: 'skipped' | 'waiting' | 'dry_run' | 'sent' | 'pending_delivery' | 'blocked';
  detail?: string;
}

const enabledAtKey = (squadId: string) => `enabled-at:${squadId}`;

async function featuresFor(store: SessionReviewStore, matchIds: Iterable<string>): Promise<Map<string, MatchReviewFacts | null>> {
  const facts = new Map<string, MatchReviewFacts | null>();
  for (const matchId of matchIds) {
    const record = await store.get({ matchId, parserVersion: DEFAULT_TELEMETRY_PARSER_VERSION, featureVersion: DEFAULT_REVIEW_FEATURE_VERSION });
    facts.set(matchId, record?.facts ?? null);
  }
  return facts;
}

/** Builds and renders the review text for one closed session; shared by the worker and the manual CLI. */
export async function renderReviewFor(input: {
  store: SessionReviewStore;
  matches: readonly NormalizedMatch[];
  session: SquadSession;
  team: SessionReviewCycleInput['team'];
  timezone: string;
  pageUrl?: string;
  now: Date;
}): Promise<string> {
  const baseline = sessionBaseline(input.matches, input.team, input.session);
  const facts = await featuresFor(input.store, [...input.session.matches, ...baseline].map((item) => item.match.matchId));
  const review = buildSessionReview({
    session: input.session, baseline, team: input.team, facts, playerNames: input.team.playerNames,
    timezone: input.timezone, now: input.now, ...(input.pageUrl ? { pageUrl: input.pageUrl } : {}),
  });
  return renderSessionReview(review);
}

function recordFor(session: SquadSession, squadId: string, now: Date, fields: Pick<SessionReviewRecord, 'status' | 'detail' | 'message' | 'attempts'>): SessionReviewRecord {
  return {
    squadId, sessionKey: session.key, matchIds: session.matches.map((item) => item.match.matchId), lastMatchEndMs: session.lastEndMs,
    updatedAt: now.toISOString(), ...fields,
  };
}

type DeliveryInput = Pick<SessionReviewCycleInput, 'subscription' | 'gateway' | 'ownerOutboxDir' | 'team' | 'now'>;

async function deliver(input: DeliveryInput, session: SquadSession, message: string, attempts: number): Promise<Pick<SessionReviewRecord, 'status' | 'detail' | 'message' | 'attempts'>> {
  const block = async (reason: string, groupName?: string) => {
    if (input.ownerOutboxDir) {
      await queueOwnerBlockedNotice(input.ownerOutboxDir, { sessionKey: session.key, reason, occurredAt: input.now.toISOString(), ...(groupName ? { groupName } : {}) });
    }
    return { status: 'blocked' as const, detail: reason, message, attempts };
  };
  if (!input.subscription?.enabled || !input.gateway) return block('no_subscription');
  const check = await checkReviewTarget(input.gateway, input.subscription, input.team.tenantId);
  if (!check.ok) {
    // A directory hiccup is retried; a wrong target is held back for the owner to fix.
    if (check.reason === 'directory_unavailable' && attempts + 1 < SESSION_REVIEW_MAX_ATTEMPTS) return { status: 'pending_delivery', detail: check.reason, message, attempts: attempts + 1 };
    return block(check.reason, check.groupName);
  }
  try {
    await sendReview(input.gateway, input.subscription, message, reviewIdempotencyKey(session.key, input.subscription));
    return { status: 'sent', detail: `group:${check.groupName}`, message, attempts: attempts + 1 };
  } catch (error) {
    if (attempts + 1 >= SESSION_REVIEW_MAX_ATTEMPTS) return block('delivery_failed');
    return { status: 'pending_delivery', detail: error instanceof Error ? error.message.slice(0, 200) : 'send_failed', message, attempts: attempts + 1 };
  }
}

/** One deterministic pass: find closed sessions, then preview (dry-run) or deliver, and record every decision in the ledger. */
export async function runSessionReviewCycle(input: SessionReviewCycleInput): Promise<CycleOutcome[]> {
  if (input.mode === 'off') return [];
  const { store, team, now } = input;
  const log = input.log ?? (() => undefined);
  let enabledAt = store.getSessionReviewMeta(enabledAtKey(team.id));
  if (!enabledAt) {
    enabledAt = now.toISOString();
    store.setSessionReviewMeta(enabledAtKey(team.id), enabledAt);
  }
  const matches = store.listMatches({ fromMs: now.getTime() - SESSION_LOOKBACK_MS - SESSION_BASELINE_MS, order: 'asc' });
  const recent = squadMatches(matches, team.memberIds).filter((item) => item.endMs >= now.getTime() - SESSION_LOOKBACK_MS);
  const recentFacts = await featuresFor(store, recent.map((item) => item.match.matchId));
  const telemetry = new Set([...recentFacts].filter(([, facts]) => facts !== null).map(([matchId]) => matchId));
  const plans = planSessionReviews({
    matches, team, nowMs: now.getTime(), lastFetchFinishedMs: store.latestPrefetchFinishedMs(), enabledAtMs: Date.parse(enabledAt),
    telemetry, record: (key) => store.getSessionReview(team.id, key),
  });
  const outcomes: CycleOutcome[] = [];
  for (const plan of plans) {
    const { session } = plan;
    if (plan.decision === 'wait') { outcomes.push({ sessionKey: session.key, result: 'waiting', detail: plan.state.status === 'open' ? plan.state.reason : 'telemetry' }); continue; }
    if (plan.decision === 'skip') {
      store.putSessionReview(recordFor(session, team.id, now, { status: 'skipped', detail: plan.reason, message: null, attempts: 0 }));
      outcomes.push({ sessionKey: session.key, result: 'skipped', detail: plan.reason });
      continue;
    }
    const message = plan.decision === 'retry' && plan.record.message
      ? plan.record.message
      : await renderReviewFor({ store, matches, session, team, timezone: input.timezone, now, ...(input.pageUrl ? { pageUrl: input.pageUrl } : {}) });
    if (input.mode === 'dry-run') {
      store.putSessionReview(recordFor(session, team.id, now, { status: 'dry_run', detail: `${message.length} chars`, message, attempts: 0 }));
      log(`pubg session review dry-run ${session.key} (${session.matches.length} matches, ${message.length} chars)`);
      outcomes.push({ sessionKey: session.key, result: 'dry_run' });
      continue;
    }
    const attempts = plan.decision === 'retry' ? plan.record.attempts : 0;
    const fields = await deliver(input, session, message, attempts);
    store.putSessionReview(recordFor(session, team.id, now, fields));
    log(`pubg session review ${fields.status} ${session.key}${fields.detail ? ` (${fields.detail})` : ''}`);
    outcomes.push({ sessionKey: session.key, result: fields.status as CycleOutcome['result'], ...(fields.detail ? { detail: fields.detail } : {}) });
  }
  return outcomes;
}
