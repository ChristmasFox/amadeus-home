import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { loadTeamConfig, SqlitePubgRepository } from '@agent/pubg-domain';
import { loadReviewSubscription, type ReportGateway, type ReportSubscription } from './session-review-delivery.js';
import { runSessionReviewCycle, SESSION_REVIEW_INTERVAL_MS, type SessionReviewMode } from './session-review-worker.js';

interface SessionReviewConfig {
  databasePath?: string;
  teamConfigFile?: string;
  timezone?: string;
  sessionReviewMode?: SessionReviewMode;
  reviewGroupTargetFile?: string;
  reviewGroupExpectedName?: string;
  reviewGroupAccountId?: string;
  reviewPageBaseUrl?: string;
  ownerNotificationOutboxDir?: string;
}

/**
 * Background check after the hourly fetch: closed squad sessions are previewed (dry-run) or delivered to the one
 * configured WhatsApp group. Off unless sessionReviewMode is set.
 */
export function registerSessionReviewWorker(api: OpenClawPluginApi): void {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  api.registerService({
    id: 'pubg-session-review-worker',
    async start() {
      const config = (api.pluginConfig ?? {}) as SessionReviewConfig;
      const mode = config.sessionReviewMode ?? 'off';
      if (mode === 'off') { api.logger.info('pubg session review worker is off'); return; }
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
          // Without a valid subscription every closed session is recorded as blocked and the owner is told.
          api.logger.warn(`pubg session review subscription unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const cycle = async () => {
        if (running) return;
        running = true;
        try {
          await runSessionReviewCycle({
            store,
            team: { id: team.id, label: team.label, tenantId: 'lab', memberIds: team.players.map((player) => player.id), playerNames: new Map(team.players.map((player) => [player.id, player.name])) },
            mode,
            subscription,
            gateway: api.runtime.gateway as unknown as ReportGateway,
            ...(config.ownerNotificationOutboxDir ? { ownerOutboxDir: config.ownerNotificationOutboxDir } : {}),
            timezone: config.timezone ?? 'Asia/Shanghai',
            ...(config.reviewPageBaseUrl ? { shareBaseUrl: config.reviewPageBaseUrl } : {}),
            now: new Date(),
            log: (line) => api.logger.info(line),
          });
        } catch (error) {
          api.logger.warn(`pubg session review cycle failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          running = false;
        }
      };
      await cycle();
      timer = setInterval(() => { void cycle(); }, SESSION_REVIEW_INTERVAL_MS);
      timer.unref();
      api.logger.info(`pubg session review worker started (${mode})`);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  });
}
