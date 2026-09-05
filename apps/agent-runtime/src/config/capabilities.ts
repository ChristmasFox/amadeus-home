import { MetricSchema, OperationSchema, GroupBySchema } from '../schema/query.js';

export const PUBG_CAPABILITIES = {
  version: 3,
  domain: 'pubg',
  supportedOperations: OperationSchema.options,
  supportedGroups: GroupBySchema.options,
  supportedMetrics: MetricSchema.options,
  supportedSelectors: ['time_range', 'last_n_matches', 'recent_days', 'relative_period', 'result_set'] as const,
  unsupportedCapabilities: ['weapon', 'telemetry', 'season_stats', 'lifetime_stats'],
} as const;

export type PubgCapability = typeof PUBG_CAPABILITIES;

export const METRIC_DICTIONARY = {
  matches: { sourceFields: ['matchId'], aggregation: 'count_distinct_match', positive: true },
  kills: { sourceFields: ['kills'], aggregation: 'sum', positive: true },
  assists: { sourceFields: ['assists'], aggregation: 'sum', positive: true },
  damage: { sourceFields: ['damage', 'damageDealt'], aggregation: 'sum', positive: true },
  avg_damage: { sourceFields: ['damage'], aggregation: 'sum / matches', positive: true },
  kd: { sourceFields: ['kills', 'deaths', 'rank'], aggregation: 'kills / deaths', positive: true },
  deaths: { sourceFields: ['deaths', 'rank'], aggregation: 'sum', positive: false },
  wins: { sourceFields: ['wins', 'rank'], aggregation: 'count rank == 1', positive: true },
  top10: { sourceFields: ['top10', 'rank'], aggregation: 'count rank <= 10', positive: true },
  rank: { sourceFields: ['rank'], aggregation: 'average', positive: false },
  dbnos: { sourceFields: ['dbnos'], aggregation: 'sum', positive: true },
  revives: { sourceFields: ['revives'], aggregation: 'sum', positive: true },
  headshot_kills: { sourceFields: ['headshotKills'], aggregation: 'sum', positive: true },
  survival_time: { sourceFields: ['survivalTime', 'timeSurvived'], aggregation: 'sum_seconds', positive: true },
  longest_kill: { sourceFields: ['longestKill'], aggregation: 'max', positive: true },
  performance_score: { sourceFields: ['kd', 'avg_damage', 'avg_kills', 'avg_rank', 'top10_rate'], aggregation: 'weighted_score', positive: true },
  chicken_index: { sourceFields: ['performance_score'], aggregation: '100 - performance_score', positive: false },
} as const;

export type SupportedMetric = keyof typeof METRIC_DICTIONARY;
