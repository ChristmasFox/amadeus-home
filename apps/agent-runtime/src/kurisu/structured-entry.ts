import { randomUUID } from 'node:crypto';
import { CanonicalQuerySchema, type CanonicalQuery } from '../schema/query.js';
import type { ToolCall } from './contracts.js';

export interface HomeHubStructuredCommand {
  domain: 'homehub';
  operation: 'list' | 'status' | 'diagnose' | 'errors';
  serviceIds: string[];
  includeMetrics?: boolean;
}

export interface RadarStructuredCommand {
  domain: 'radar';
  operation: 'list' | 'status' | 'stats';
  watchId?: string;
  includeRuns?: boolean;
}

export type StructuredDomainCommand = HomeHubStructuredCommand | RadarStructuredCommand;

/**
 * Adapt an already validated PUBG query to the common tool boundary.
 * Natural-language planning happens at the selected LangBot host; this
 * function only accepts canonical data and never interprets message text.
 */
export function pubgToolCall(query: CanonicalQuery, callId = `pubg_${randomUUID()}`): ToolCall {
  const canonical = CanonicalQuerySchema.parse(query);
  if (canonical.operation === 'review_match') {
    const matchId = canonical.matchSelector?.type === 'match_id' ? canonical.matchSelector.matchId : '';
    if (!matchId) throw new Error('review_match requires an explicit match ID');
    return { id: callId, name: 'kurisu.pubg.review', arguments: { matchId, detail: 'full' } };
  }
  if (canonical.operation === 'list') {
    return {
      id: callId,
      name: 'kurisu.pubg.list',
      arguments: {
        subject: { type: canonical.subject.type === 'players' ? 'player' : canonical.subject.type, ids: canonical.subject.ids },
        timeRange: selectorToTimeRange(canonical),
        limit: canonical.limit ?? 10,
      },
    };
  }
  return {
    id: callId,
    name: 'kurisu.pubg.query',
    arguments: {
      operation: canonical.operation === 'detail' ? 'report' : canonical.operation === 'strongest' || canonical.operation === 'weakest' ? 'rank' : canonical.operation,
      subject: { type: canonical.subject.type === 'players' ? 'player' : canonical.subject.type, ids: canonical.subject.ids },
      timeRange: selectorToTimeRange(canonical),
      metrics: canonical.metrics.filter((metric) => ['kd', 'kills', 'assists', 'damage', 'dbnos', 'revives', 'rank', 'wins', 'top10', 'survival_time'].includes(metric)),
      ...(canonical.matchSelector?.type === 'match_id' ? { matchId: canonical.matchSelector.matchId } : {}),
    },
  };
}

export function homeHubToolCall(command: HomeHubStructuredCommand, callId = `homehub_${randomUUID()}`): ToolCall {
  validateServiceIds(command.serviceIds);
  return {
    id: callId,
    name: `kurisu.homehub.${command.operation}`,
    arguments: {
      serviceIds: [...command.serviceIds],
      includeMetrics: command.includeMetrics === true,
    },
  };
}

export function radarToolCall(command: RadarStructuredCommand, callId = `radar_${randomUUID()}`): ToolCall {
  return {
    id: callId,
    name: `kurisu.radar.${command.operation}`,
    arguments: {
      ...(command.watchId ? { watchId: command.watchId } : {}),
      includeRuns: command.includeRuns === true,
    },
  };
}

function selectorToTimeRange(query: CanonicalQuery): Record<string, string> | undefined {
  const selector = query.selector;
  if (selector.type === 'time_range') {
    return { kind: 'range', start: selector.start, end: selector.end, timezone: selector.timezone };
  }
  if (selector.type === 'relative_period') return { kind: selector.value, timezone: 'Asia/Shanghai' };
  if (selector.type === 'recent_days') return { kind: 'recent', start: String(selector.count), timezone: 'Asia/Shanghai' };
  if (selector.type === 'last_n_matches') return { kind: 'recent', start: String(selector.count), timezone: 'Asia/Shanghai' };
  return undefined;
}

function validateServiceIds(serviceIds: string[]): void {
  for (const serviceId of serviceIds) {
    if (!/^[A-Za-z0-9_.:-]{1,128}$/u.test(serviceId)) throw new Error('invalid HomeHub service ID');
  }
}
