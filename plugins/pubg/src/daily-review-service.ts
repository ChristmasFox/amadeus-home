import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { loadTeamConfig, SqlitePubgRepository } from '@rine-kit/pubg-domain';
import { loadReviewSubscription, type ReportGateway, type ReportSubscription } from './session-review-delivery.js';
import { DAILY_REVIEW_RETRY_MS, nextDailyReviewAt, runDailyReview, type DailyOutcome, type DailyReviewMode, type DailyStatsSource } from './daily-review.js';

interface DailyReviewConfig {
  databasePath?: string;
  teamConfigFile?: string;
  timezone?: string;
  businessDayStart?: string;
  /** off (default), dry-run (render and record, never send) or deliver: the daily 09:30 review. */
  sessionReviewMode?: DailyReviewMode;
  reviewGroupTargetFile?: string;
  reviewGroupExpectedName?: string;
  reviewGroupAccountId?: string;
  reviewPageBaseUrl?: string;
  ownerNotificationOutboxDir?: string;
}

/** When to run next: the next 09:30, or sooner (but never more often than the retry interval) while a day is unfinished. */
export function nextDailyRunAt(outcome: DailyOutcome | null, now: Date, timezone: string, businessDayStart?: string): Date {
  const scheduled = nextDailyReviewAt(now, timezone, businessDayStart);
  if (outcome && (outcome.result === 'pending_delivery' || (outcome.result === 'waiting' && outcome.detail !== 'not_due'))) {
    return new Date(Math.min(scheduled.getTime(), now.getTime() + DAILY_REVIEW_RETRY_MS));
  }
  return scheduled;
}

/**
 * One timer inside the plugin service: it sleeps until 09:30 (Asia/Shanghai by default) and runs the daily review once;
 * a run that could not finish (delivery failure, no fetch yet after the day ended) is tried again every ten minutes
 * until the next 09:30. On start it runs once to catch up a day that came due while the gateway was down; the ledger
 * makes that a no-op for a day already handled. stop() clears the timer, so nothing keeps running in the background.
 */
export function registerDailyReviewService(api: OpenClawPluginApi, statsFor: (config: DailyReviewConfig) => DailyStatsSource): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  api.registerService({
    id: 'pubg-daily-review',
    async start() {
      stopped = false;
      const config = (api.pluginConfig ?? {}) as DailyReviewConfig;
      const mode = config.sessionReviewMode ?? 'off';
      if (mode === 'off') { api.logger.info('pubg daily review is off'); return; }
      const timezone = config.timezone ?? 'Asia/Shanghai';
      const team = loadTeamConfig({ path: config.teamConfigFile ?? process.env.PUBG_TEAM_CONFIG_FILE, required: true });
      const store = new SqlitePubgRepository(config.databasePath ?? process.env.PUBG_DATABASE_PATH ?? '/data/pubg.sqlite');
      let subscription: ReportSubscription | null = null;
      if (mode === 'deliver') {
        try {
          if (!config.reviewGroupTargetFile || !config.reviewGroupExpectedName || !config.reviewGroupAccountId) throw new Error('review group target file, expected name and account are required');
          subscription = await loadReviewSubscription({
            targetFile: config.reviewGroupTargetFile, expectedName: config.reviewGroupExpectedName, accountId: config.reviewGroupAccountId, squadId: team.id,
          });
        } catch (error) {
          // Without a valid subscription the day is recorded as blocked and the owner is told.
          api.logger.warn(`pubg daily review subscription unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const stats = statsFor(config);
      const run = async () => {
        let outcome: DailyOutcome | null = null;
        try {
          outcome = await runDailyReview({
            store,
            team: { id: team.id, label: team.label, tenantId: 'lab', memberIds: team.players.map((player) => player.id), playerNames: new Map(team.players.map((player) => [player.id, player.name])) },
            mode,
            subscription,
            gateway: api.runtime.gateway as unknown as ReportGateway,
            ...(config.ownerNotificationOutboxDir ? { ownerOutboxDir: config.ownerNotificationOutboxDir } : {}),
            timezone,
            ...(config.businessDayStart ? { businessDayStart: config.businessDayStart } : {}),
            ...(config.reviewPageBaseUrl ? { shareBaseUrl: config.reviewPageBaseUrl } : {}),
            stats,
            now: new Date(),
            log: (line) => api.logger.info(line),
          });
        } catch (error) {
          api.logger.warn(`pubg daily review run failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        schedule(outcome);
      };
      const schedule = (outcome: DailyOutcome | null) => {
        if (stopped) return;
        const now = new Date();
        const at = nextDailyRunAt(outcome, now, timezone, config.businessDayStart);
        timer = setTimeout(() => { void run(); }, Math.max(1_000, at.getTime() - now.getTime()));
        timer.unref();
        api.logger.info(`pubg daily review next run ${at.toISOString()} (${mode})`);
      };
      void run();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  });
}
