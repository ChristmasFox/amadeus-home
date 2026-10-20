import { buildPubgToolPresentation, type PubgStatsPresentation } from '@agent/presentation';
import type { PubgDomainService, StatsToolInput } from '@agent/pubg-domain';
import type { DailyStatsSource } from './daily-review.js';

/**
 * The business day's 战绩 exactly as the pubg_query_stats tool answers a 昨日战绩 question (team report over the
 * day's time range, localized metrics and titles), so the daily message carries the same card the group knows.
 */
export function dailyStatsSource(service: () => PubgDomainService, timezone: string, businessDayStart = '06:00'): DailyStatsSource {
  return async (window) => {
    const from = new Date(window.startMs).toISOString();
    const to = new Date(window.endMs).toISOString();
    const envelope = await service().queryStats({
      sessionId: `pubg-daily-review:${window.businessDay}`,
      selector: { type: 'time_range', from, to, timezone, businessDayStart },
      metrics: ['matches'],
      operation: 'report',
      refresh: false,
    } as StatsToolInput);
    if (envelope.status === 'error') throw new Error(`daily stats failed: ${envelope.error?.code ?? 'error'}`);
    const built = buildPubgToolPresentation('pubg_query_stats', {
      status: envelope.status,
      data: envelope.data,
      dataUpdatedAt: envelope.asOf,
      sourceRange: { from, to },
      queryResolved: envelope.queryResolved,
      evidenceRefs: envelope.evidenceRefs,
    }, { timezone, now: envelope.asOf, localizedMetrics: true });
    if (built.presentation.type !== 'pubg_stats') throw new Error(`daily stats came back as ${built.presentation.type}`);
    return { presentation: built.presentation as PubgStatsPresentation, displayText: built.displayText, dataUpdatedAt: envelope.asOf ?? null };
  };
}
