import { containsInternalTimeTerms } from '../time/format.js';
import type {
  PresentationTextItem,
  PubgComparisonPresentation,
  PubgComparisonSegment,
  PubgMatchDetailPresentation,
  PubgMatchListPresentation,
  PubgMatchReviewPresentation,
  PubgMetricRow,
  PubgPeriodReviewPresentation,
  PubgPresentation,
  PubgPresentationScalar,
  PubgPresentationStatus,
  PubgSourceRange,
  PubgStatsPresentation,
  PubgStatusPresentation,
  PubgTeamDamagePresentation,
} from '../contracts/pubg.js';
import {
  assertValid,
  validatePubgComparisonPresentation,
  validatePubgMatchDetailPresentation,
  validatePubgMatchListPresentation,
  validatePubgMatchReviewPresentation,
  validatePubgPeriodReviewPresentation,
  validatePubgStatsPresentation,
  validatePubgStatusPresentation,
  validatePubgTeamDamagePresentation,
} from '../validation/validate.js';

export interface PubgToolPresentationInput {
  toolName?: string;
  status?: PubgPresentationStatus;
  data: unknown;
  dataUpdatedAt: string;
  sourceRange?: PubgSourceRange;
  queryResolved?: Record<string, unknown>;
  evidenceRefs?: {
    matchIds?: string[];
    playerIds?: string[];
    fields?: string[];
  };
  error?: { code?: string; reason?: string };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback: string): string {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!candidate || containsInternalTimeTerms(candidate)) return fallback;
  return candidate;
}

function scalar(value: unknown): PubgPresentationScalar {
  if (value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value;
  return null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function sourceRange(input: PubgToolPresentationInput): PubgSourceRange | undefined {
  const range = input.sourceRange;
  if (!range) return undefined;
  const segments = range.segments?.filter((segment) => segment.label.trim()) ?? [];
  if (range.from === null && range.to === null && segments.length === 0) return undefined;
  return { from: range.from, to: range.to, ...(segments.length ? { segments } : {}) };
}

function evidencePool(input: PubgToolPresentationInput, extra: string[] = []): Set<string> {
  return new Set([
    ...(input.evidenceRefs?.matchIds ?? []),
    ...(input.evidenceRefs?.playerIds ?? []),
    ...(input.evidenceRefs?.fields ?? []),
    ...extra,
  ]);
}

function evidenceFor(value: unknown, known: ReadonlySet<string>): string[] {
  const row = record(value);
  const raw = Array.isArray(row.evidenceRefs) ? row.evidenceRefs : Array.isArray(row.evidenceIds) ? row.evidenceIds : [];
  return raw.filter((item): item is string => typeof item === 'string' && known.has(item));
}

function textItems(value: unknown, fallbackEvidence: string[] = []): PresentationTextItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = record(item);
    const rawText = typeof row.text === 'string' && row.text.trim()
      ? row.text
      : typeof row.title === 'string'
        ? `${row.title}${typeof row.text === 'string' && row.text ? `：${row.text}` : ''}`
        : '';
    if (!rawText.trim()) return [];
    const refs = Array.isArray(row.evidenceIds)
      ? row.evidenceIds.filter((id): id is string => typeof id === 'string')
      : Array.isArray(row.evidenceRefs)
        ? row.evidenceRefs.filter((id): id is string => typeof id === 'string')
        : fallbackEvidence;
    return [{ text: rawText.trim(), evidenceRefs: refs }];
  });
}

function values(value: unknown): Record<string, PubgPresentationScalar> {
  const source = record(value);
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, scalar(item)]));
}

function metricRows(value: unknown, known: ReadonlySet<string>): PubgMetricRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = record(item);
    const label = text(row.label ?? row.key, '未知对象');
    const position = row.position === null ? null : numberOrNull(row.position);
    const rowEvidence = evidenceFor(row, known);
    return [{
      label,
      values: values(row.metrics ?? row.values),
      ...(row.position !== undefined ? { position } : {}),
      evidenceRefs: rowEvidence,
    }];
  });
}

function queryLabel(input: PubgToolPresentationInput, fallback: string): string {
  const query = record(input.queryResolved);
  const selector = record(query.resolvedSelector ?? query.selector);
  return text(selector.label ?? record(query.summary).periodLabel, fallback);
}

function statusMessage(status: PubgPresentationStatus): string {
  if (status === 'partial') return '结果不完整，缺失事实保持为未知。';
  if (status === 'no_matches') return '没有找到符合条件的比赛。';
  if (status === 'error') return '当前数据源无法完成这次查询，没有使用旧聊天数据代替。';
  return '';
}

function base(input: PubgToolPresentationInput): { status: PubgPresentationStatus; dataUpdatedAt: string; sourceRange?: PubgSourceRange } {
  const status = input.status ?? 'ok';
  const range = sourceRange(input);
  return { status, dataUpdatedAt: input.dataUpdatedAt, ...(range ? { sourceRange: range } : {}) };
}

function knownFor(input: PubgToolPresentationInput, extra: string[] = []): Set<string> {
  const known = evidencePool(input, extra);
  for (const item of extra) known.add(item);
  return known;
}

export function buildPubgStatusPresentation(input: PubgToolPresentationInput): PubgStatusPresentation {
  const status = input.status ?? 'error';
  const toolName = input.toolName ?? 'pubg';
  const title = toolName === 'pubg_resolve_players'
    ? 'PUBG 玩家查询'
    : toolName === 'pubg_prefetch_telemetry'
      ? 'PUBG Telemetry 同步'
      : toolName === 'pubg_telemetry_sync_report'
        ? 'PUBG Telemetry D-mail'
        : 'PUBG 查询状态';
  const errorCode = stringOrNull(input.error?.code);
  const message = status === 'error' && input.error?.reason
    ? `查询失败：${text(input.error.reason, '数据源返回错误。')}`
    : statusMessage(status) || '查询完成。';
  const presentation: PubgStatusPresentation = {
    ...base(input),
    type: 'pubg_status',
    headline: title,
    message,
    ...(errorCode ? { errorCode } : {}),
    evidenceRefs: input.evidenceRefs?.matchIds ?? [],
  };
  return assertValid(validatePubgStatusPresentation(presentation, evidencePool(input)));
}

export function buildPubgStatsPresentation(input: PubgToolPresentationInput): PubgStatsPresentation {
  const data = record(input.data);
  const known = knownFor(input);
  const summary = record(data.summary);
  const rows = metricRows(data.rows, known);
  const matchCount = numberOrNull(summary.uniqueMatchCount);
  const summaryText = typeof data.summary === 'string'
    ? text(data.summary, '战绩已生成。')
    : matchCount === null
      ? '战绩已生成。'
      : `共 ${matchCount} 场。`;
  const query = record(input.queryResolved);
  const presentation: PubgStatsPresentation = {
    ...base(input),
    type: 'pubg_stats',
    headline: queryLabel(input, 'PUBG 战绩'),
    operation: text(data.operation ?? query.operation, 'report'),
    groupBy: text(data.groupBy ?? query.groupBy, 'player'),
    summary: `${statusMessage(input.status ?? 'ok')}${statusMessage(input.status ?? 'ok') ? '\n' : ''}${summaryText}`,
    rows,
    evidenceRefs: input.evidenceRefs?.matchIds ?? [],
  };
  return assertValid(validatePubgStatsPresentation(presentation, known));
}

export function buildPubgMatchListPresentation(input: PubgToolPresentationInput): PubgMatchListPresentation {
  const data = record(input.data);
  const known = knownFor(input);
  const matches = Array.isArray(data.matches) ? data.matches.flatMap((item) => {
    const row = record(item);
    const matchId = stringOrNull(row.matchId);
    if (!matchId) return [];
    const players = Array.isArray(row.players) ? row.players.map((player) => {
      const value = record(player);
      return `${text(value.name ?? value.playerName, '未知玩家')} 击杀${scalar(value.kills) ?? '未知'} 伤害${scalar(value.damage) ?? '未知'}`;
    }).join('；') : '';
    return [{
      matchId,
      startedAt: stringOrNull(row.startedAt),
      mapName: text(row.mapName, '未知地图'),
      gameMode: text(row.gameMode, '未知模式'),
      placement: numberOrNull(row.placement),
      summary: players || '玩家事实未知',
      evidenceRefs: evidenceFor(row, known),
    }];
  }) : [];
  const total = numberOrNull(data.total);
  const summary = total === null ? `返回 ${matches.length} 场比赛。` : `共 ${total} 场比赛，当前返回 ${matches.length} 场。`;
  const presentation: PubgMatchListPresentation = {
    ...base(input),
    type: 'pubg_match_list',
    headline: queryLabel(input, 'PUBG 比赛列表'),
    summary: `${statusMessage(input.status ?? 'ok')}${statusMessage(input.status ?? 'ok') ? '\n' : ''}${summary}`,
    matches,
    evidenceRefs: input.evidenceRefs?.matchIds ?? [],
  };
  return assertValid(validatePubgMatchListPresentation(presentation, known));
}

function comparisonSegmentRange(input: PubgToolPresentationInput, index: number): PubgSourceRange | undefined {
  const segment = input.sourceRange?.segments?.[index];
  if (!segment) return undefined;
  return { from: segment.from, to: segment.to };
}

export function buildPubgComparisonPresentation(input: PubgToolPresentationInput): PubgComparisonPresentation {
  const data = record(input.data);
  const known = knownFor(input);
  const segments: PubgComparisonSegment[] = Array.isArray(data.segments)
    ? data.segments.map((item, index) => {
      const segment = record(item);
      const range = comparisonSegmentRange(input, index);
      return {
        label: text(segment.label, `区间 ${index + 1}`),
        ...(range ? { sourceRange: range } : {}),
        rows: metricRows(segment.rows, known),
      };
    })
    : [];
  const presentation: PubgComparisonPresentation = {
    ...base(input),
    type: 'pubg_comparison',
    headline: 'PUBG 对比',
    summary: `${statusMessage(input.status ?? 'ok')}${statusMessage(input.status ?? 'ok') ? '\n' : ''}已保留两个区间的独立来源范围。`,
    rows: metricRows(data.rows, known),
    segments,
    evidenceRefs: input.evidenceRefs?.matchIds ?? [],
  };
  return assertValid(validatePubgComparisonPresentation(presentation, known));
}

export function buildPubgMatchDetailPresentation(input: PubgToolPresentationInput): PubgMatchDetailPresentation {
  const data = record(input.data);
  const match = record(data.match);
  const known = knownFor(input);
  const matchId = stringOrNull(match.matchId) ?? '未知对局';
  const players = Array.isArray(match.players) ? match.players.flatMap((item) => {
    const player = record(item);
    const label = text(player.displayName ?? player.playerName ?? player.accountId, '未知玩家');
    return [{
      label,
      values: values({ kills: player.kills, assists: player.assists, damage: player.damage, dbnos: player.dbnos, rank: player.rank }),
      evidenceRefs: evidenceFor(player, known),
    }];
  }) : [];
  const presentation: PubgMatchDetailPresentation = {
    ...base(input),
    type: 'pubg_match_detail',
    headline: `${text(match.mapName, '未知地图')} · ${matchId}`,
    matchId,
    startedAt: stringOrNull(match.createdAt ?? match.startedAt),
    mapName: text(match.mapName, '未知地图'),
    gameMode: text(match.gameMode, '未知模式'),
    duration: numberOrNull(match.duration),
    players,
    evidenceRefs: input.evidenceRefs?.matchIds ?? [],
  };
  return assertValid(validatePubgMatchDetailPresentation(presentation, known));
}

export function buildPubgMatchReviewPresentation(input: { data: unknown; dataUpdatedAt: string; status?: PubgPresentationStatus; sourceRange?: PubgSourceRange; evidenceRefs?: PubgToolPresentationInput['evidenceRefs'] }): PubgMatchReviewPresentation {
  const data = record(input.data);
  const facts = record(data.facts);
  const match = record(facts.match);
  const squad = record(facts.squad);
  const analysis = record(data.derivedAnalysis);
  const evidence = Array.isArray(facts.evidence) ? facts.evidence.flatMap((item) => {
    const id = record(item).id;
    return typeof id === 'string' ? [id] : [];
  }) : [];
  const known = new Set([...(input.evidenceRefs?.matchIds ?? []), ...(input.evidenceRefs?.playerIds ?? []), ...evidence]);
  const keyMoments = textItems(analysis.turningPoints, evidence);
  const highlights = textItems(analysis.awards, evidence);
  const improvements = textItems(analysis.actionPlan ?? analysis.improvements);
  const summary = typeof analysis.summary === 'string' && analysis.summary.trim() ? analysis.summary : '本场复盘事实已生成。';
  const mapName = typeof match.mapName === 'string' ? match.mapName : '未知地图';
  const ordinal = numberOrNull(match.ordinal);
  const candidate: PubgMatchReviewPresentation = {
    status: input.status ?? 'ok',
    dataUpdatedAt: input.dataUpdatedAt,
    ...(input.sourceRange ? { sourceRange: input.sourceRange } : {}),
    type: 'pubg_match_review',
    headline: `${ordinal === null ? '' : `第${ordinal}局 · `}${mapName}`,
    overview: {
      placement: numberOrNull(squad.placement),
      kills: numberOrNull(squad.kills),
      assists: numberOrNull(squad.assists),
      damage: numberOrNull(squad.damage),
      dbnos: numberOrNull(squad.knocks),
      revives: numberOrNull(squad.revives),
    },
    keyMoments,
    highlights,
    improvements,
    analysis: summary,
    evidenceRefs: evidence,
  };
  return assertValid(validatePubgMatchReviewPresentation(candidate, known));
}

export function buildPubgPeriodReviewPresentation(input: PubgToolPresentationInput): PubgPeriodReviewPresentation {
  const data = record(input.data);
  const rawReviews = Array.isArray(data.reviews) ? data.reviews : [];
  const reviewEvidence = rawReviews.flatMap((item) => {
    const wrapper = record(item);
    const facts = record(record(wrapper.data ?? wrapper).facts);
    return Array.isArray(facts.evidence)
      ? facts.evidence.flatMap((evidence) => {
        const id = record(evidence).id;
        return typeof id === 'string' && id.trim() ? [id] : [];
      })
      : [];
  });
  const known = knownFor(input, reviewEvidence);
  const orderedMatches = rawReviews.flatMap((item, index) => {
    const wrapper = record(item);
    const reviewData = record(wrapper.data ?? wrapper);
    const facts = record(reviewData.facts);
    const match = record(facts.match ?? wrapper.match);
    const squad = record(facts.squad);
    const matchId = stringOrNull(wrapper.matchId ?? match.matchId);
    if (!matchId) return [];
    return [{
      matchId,
      label: `${index + 1}. ${text(match.mapName, '未知地图')}`,
      startedAt: stringOrNull(match.createdAt ?? match.startedAt),
      placement: numberOrNull(squad.placement ?? match.placement),
    }];
  });
  const matches = orderedMatches.length ? orderedMatches : (Array.isArray(data.matches) ? data.matches.flatMap((item, index) => {
    const match = record(item);
    const matchId = stringOrNull(match.matchId);
    return matchId ? [{ matchId, label: `${index + 1}. ${text(match.mapName, '未知地图')}`, startedAt: stringOrNull(match.startedAt), placement: numberOrNull(match.placement) }] : [];
  }) : []);
  const reviewItems = rawReviews.flatMap((item) => {
    const wrapper = record(item);
    return textItems(record(record(wrapper.data ?? wrapper).derivedAnalysis).awards, [...known]);
  });
  const summaryValue = data.summary;
  const summary = typeof summaryValue === 'string' && summaryValue.trim()
    ? summaryValue
    : `${matches.length} 场对局${input.status === 'partial' ? '，部分 Telemetry 暂不可用' : ''}。`;
  const period = record(data.period);
  const label = text(period.label ?? queryLabel(input, 'PUBG 周期复盘'), 'PUBG 周期复盘');
  const candidate: PubgPeriodReviewPresentation = {
    ...base(input),
    type: 'pubg_period_review',
    period: { label, ...(stringOrNull(period.displayDate) ? { displayDate: stringOrNull(period.displayDate)! } : {}) },
    summary,
    orderedMatches: matches,
    highlights: textItems(data.highlights, [...known, ...input.evidenceRefs?.matchIds ?? []]).concat(reviewItems).slice(0, 12),
    patterns: textItems(data.patterns, [...known]).slice(0, 12),
    analysis: text(data.analysis, input.status === 'partial' ? '周期结果存在覆盖缺口，未知事实未被补成确定值。' : '周期复盘事实已按 Domain 返回顺序整理。'),
    evidenceRefs: input.evidenceRefs?.matchIds ?? [],
  };
  return assertValid(validatePubgPeriodReviewPresentation(candidate, known));
}

function playerName(value: unknown): string {
  const row = record(value);
  return text(row.name ?? row.displayName ?? row.playerId, '未知玩家');
}

export function buildPubgTeamDamagePresentation(input: PubgToolPresentationInput): PubgTeamDamagePresentation {
  const data = record(input.data);
  const known = knownFor(input);
  const directions = Array.isArray(data.directions) ? data.directions.flatMap((item) => {
    const row = record(item);
    const actor = playerName(row.actor);
    const victim = playerName(row.victim);
    return [{
      actor,
      victim,
      hitCount: numberOrNull(row.hitCount),
      damage: numberOrNull(row.damage),
      complete: row.complete === true,
      evidenceRefs: evidenceFor(row, known),
    }];
  }) : [];
  const source = stringOrNull(data.source);
  const meleeKind = stringOrNull(data.meleeKind);
  const direction = text(data.direction, directions.length ? directions.map((item) => `${item.actor} → ${item.victim}`).join('、') : 'all directions');
  const totalHitCount = numberOrNull(data.totalHitCount);
  const totalDamage = numberOrNull(data.totalDamage);
  const summary = input.status === 'partial'
    ? '部分 Telemetry 暂不可用，未知数量没有被当作 0。'
    : directions.length ? `共 ${directions.length} 个方向。` : statusMessage(input.status ?? 'ok') || '未发现队友动作。';
  const candidate: PubgTeamDamagePresentation = {
    ...base(input),
    type: 'pubg_team_damage',
    headline: 'PUBG 队友动作/误伤',
    direction,
    source,
    meleeKind,
    totalHitCount,
    totalDamage,
    directions,
    summary,
    evidenceRefs: input.evidenceRefs?.matchIds ?? [],
  };
  return assertValid(validatePubgTeamDamagePresentation(candidate, known));
}

/** Build one validated presentation for any registered native PUBG tool. */
export function buildPubgPresentation(input: PubgToolPresentationInput): PubgPresentation {
  switch (input.toolName) {
    case 'pubg_query_stats': return buildPubgStatsPresentation(input);
    case 'pubg_search_matches': return buildPubgMatchListPresentation(input);
    case 'pubg_compare_stats': return buildPubgComparisonPresentation(input);
    case 'pubg_get_match': return buildPubgMatchDetailPresentation(input);
    case 'pubg_get_review_facts':
      if (input.status === 'error' || input.status === 'no_matches') return buildPubgStatusPresentation(input);
      return buildPubgMatchReviewPresentation(input);
    case 'pubg_get_period_review':
      if (input.status === 'error') return buildPubgStatusPresentation(input);
      return buildPubgPeriodReviewPresentation(input);
    case 'pubg_query_team_damage': return buildPubgTeamDamagePresentation(input);
    case 'pubg_resolve_players':
    case 'pubg_prefetch_telemetry':
    case 'pubg_telemetry_sync_report':
    default: return buildPubgStatusPresentation(input);
  }
}
