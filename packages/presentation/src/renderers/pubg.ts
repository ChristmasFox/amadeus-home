import type {
  PubgComparisonPresentation,
  PubgMatchDetailPresentation,
  PubgMatchListPresentation,
  PubgMatchReviewPresentation,
  PubgMetricRow,
  PubgPeriodReviewPresentation,
  PubgPresentationBase,
  PubgSourceRange,
  PubgStatsPresentation,
  PubgStatusPresentation,
  PubgTeamDamagePresentation,
} from '../contracts/pubg.js';
import { formatDisplayRange, formatDisplayTime } from '../time/format.js';
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

export interface PubgRenderOptions {
  timezone?: string;
  now?: Date | string;
}

function timeOptions(options: PubgRenderOptions, extra: { forceDate?: boolean } = {}) {
  return {
    ...extra,
    ...(options.timezone ? { timezone: options.timezone } : {}),
    ...(options.now ? { now: options.now } : {}),
  };
}

function userText(value: string): string {
  return value
    .replace(/Asia\/Shanghai/gu, '北京时间')
    .replace(/UTC\+?08(?::00)?/gu, '北京时间')
    .replace(/自然日|业务日/gu, '日期');
}

function value(value: string | number | null): string {
  return value === null ? '未知' : userText(String(value));
}

function statusLine(status: PubgPresentationBase['status']): string | null {
  if (status === 'partial') return '结果不完整：缺失事实保持为未知。';
  if (status === 'no_matches') return '没有找到符合条件的比赛。';
  if (status === 'error') return '当前数据源无法完成这次查询，没有使用旧聊天数据代替。';
  return null;
}

function sourceRangeLines(range: PubgSourceRange | undefined, options: PubgRenderOptions): string[] {
  if (!range) return [];
  const segments = range.segments ?? [];
  if (segments.length > 1) {
    return ['数据范围：', ...segments.map((segment) => `- ${userText(segment.label)}：${formatDisplayRange(segment.from, segment.to, timeOptions(options))}`)];
  }
  return [`数据范围：${formatDisplayRange(range.from, range.to, timeOptions(options))}`];
}

function footer(presentation: PubgPresentationBase, options: PubgRenderOptions): string[] {
  const updated = formatDisplayTime(presentation.dataUpdatedAt, timeOptions(options)) ?? '未知';
  return ['', ...sourceRangeLines(presentation.sourceRange, options), `数据更新时间：${updated}`];
}

function metricRow(row: PubgMetricRow): string {
  const entries = Object.entries(row.values).map(([key, item]) => `${userText(key)}=${value(item)}`);
  const rank = row.position === undefined ? '' : `（序号：${value(row.position)}）`;
  return `- ${userText(row.label)}${rank}${entries.length ? `：${entries.join('，')}` : ''}`;
}

export function renderPubgStatus(presentation: PubgStatusPresentation, options: PubgRenderOptions = {}): string {
  const validated = assertValid(validatePubgStatusPresentation(presentation));
  const lines = [userText(validated.headline), ''];
  const status = statusLine(validated.status);
  if (status) lines.push(status, '');
  lines.push(userText(validated.message));
  return lines.concat(footer(validated, options)).join('\n');
}

export function renderPubgStats(presentation: PubgStatsPresentation, options: PubgRenderOptions = {}): string {
  const validated = assertValid(validatePubgStatsPresentation(presentation));
  const lines = [userText(validated.headline), '', userText(validated.summary)];
  if (validated.rows.length) lines.push('', ...validated.rows.map(metricRow));
  return lines.concat(footer(validated, options)).join('\n');
}

export function renderPubgMatchList(presentation: PubgMatchListPresentation, options: PubgRenderOptions = {}): string {
  const validated = assertValid(validatePubgMatchListPresentation(presentation));
  const lines = [userText(validated.headline), '', userText(validated.summary)];
  if (validated.matches.length) {
    lines.push('', '对局列表：', ...validated.matches.map((match) => {
      const startedAt = match.startedAt ? formatDisplayTime(match.startedAt, timeOptions(options, { forceDate: true })) : '未知';
      return `- ${startedAt}｜${userText(match.mapName)}｜${userText(match.gameMode)}｜第${value(match.placement)}名｜${userText(match.summary)}`;
    }));
  }
  return lines.concat(footer(validated, options)).join('\n');
}

export function renderPubgComparison(presentation: PubgComparisonPresentation, options: PubgRenderOptions = {}): string {
  const validated = assertValid(validatePubgComparisonPresentation(presentation));
  const lines = [userText(validated.headline), '', userText(validated.summary)];
  if (validated.rows.length) lines.push('', '差值（前段 - 后段）：', ...validated.rows.map(metricRow));
  for (const segment of validated.segments) {
    lines.push('', `区间：${userText(segment.label)}`);
    if (segment.sourceRange) lines.push(...sourceRangeLines(segment.sourceRange, options));
    if (segment.rows.length) lines.push(...segment.rows.map(metricRow));
  }
  return lines.concat(footer(validated, options)).join('\n');
}

export function renderPubgMatchDetail(presentation: PubgMatchDetailPresentation, options: PubgRenderOptions = {}): string {
  const validated = assertValid(validatePubgMatchDetailPresentation(presentation));
  const startedAt = validated.startedAt ? formatDisplayTime(validated.startedAt, timeOptions(options, { forceDate: true })) : '未知';
  const lines = [userText(validated.headline), '', `对局：${userText(validated.matchId)}`, `开始：${startedAt}`, `地图：${userText(validated.mapName)}｜模式：${userText(validated.gameMode)}`, `时长：${value(validated.duration)}`];
  if (validated.players.length) lines.push('', '玩家：', ...validated.players.map((player) => {
    const entries = Object.entries(player.values).map(([key, item]) => `${userText(key)}=${value(item)}`);
    return `- ${userText(player.label)}${entries.length ? `：${entries.join('，')}` : ''}`;
  }));
  return lines.concat(footer(validated, options)).join('\n');
}

export function renderPubgMatchReview(presentation: PubgMatchReviewPresentation, options: PubgRenderOptions = {}): string {
  const validated = assertValid(validatePubgMatchReviewPresentation(presentation));
  const lines = [userText(validated.headline), ''];
  const status = statusLine(validated.status);
  if (status) lines.push(status, '');
  lines.push(`排名：${value(validated.overview.placement)}｜击杀：${value(validated.overview.kills)}｜助攻：${value(validated.overview.assists)}`, `伤害：${value(validated.overview.damage)}｜倒地：${value(validated.overview.dbnos)}｜救援：${value(validated.overview.revives)}`);
  if (validated.keyMoments.length) lines.push('', '关键时刻：', ...validated.keyMoments.map((item) => `- ${userText(item.text)}`));
  if (validated.highlights.length) lines.push('', '亮点：', ...validated.highlights.map((item) => `- ${userText(item.text)}`));
  if (validated.improvements.length) lines.push('', '改进：', ...validated.improvements.map((item) => `- ${userText(item.text)}`));
  lines.push('', userText(validated.analysis));
  return lines.concat(footer(validated, options)).join('\n');
}

export function renderPubgPeriodReview(presentation: PubgPeriodReviewPresentation, options: PubgRenderOptions = {}): string {
  const validated = assertValid(validatePubgPeriodReviewPresentation(presentation));
  const lines = [validated.period.displayDate ? `${userText(validated.period.label)}（${userText(validated.period.displayDate)}）` : userText(validated.period.label), ''];
  const status = statusLine(validated.status);
  if (status) lines.push(status, '');
  lines.push(userText(validated.summary));
  if (validated.orderedMatches.length) {
    lines.push('', '对局顺序：', ...validated.orderedMatches.map((match) => `- ${userText(match.label)} ${match.startedAt ? `（${formatDisplayTime(match.startedAt, timeOptions(options, { forceDate: true }))}）` : ''}：第${value(match.placement)}名`));
  }
  if (validated.highlights.length) lines.push('', '亮点：', ...validated.highlights.map((item) => `- ${userText(item.text)}`));
  if (validated.patterns.length) lines.push('', '模式：', ...validated.patterns.map((item) => `- ${userText(item.text)}`));
  lines.push('', userText(validated.analysis));
  return lines.concat(footer(validated, options)).join('\n');
}

export function renderPubgTeamDamage(presentation: PubgTeamDamagePresentation, options: PubgRenderOptions = {}): string {
  const validated = assertValid(validatePubgTeamDamagePresentation(presentation));
  const lines = [userText(validated.headline), '', `方向：${userText(validated.direction)}`];
  const status = statusLine(validated.status);
  if (status) lines.push(status);
  if (validated.source || validated.meleeKind) lines.push(`筛选：${userText(validated.source ?? '全部')}${validated.meleeKind ? ` / ${userText(validated.meleeKind)}` : ''}`);
  lines.push(`总次数：${value(validated.totalHitCount)}｜总伤害：${value(validated.totalDamage)}`, '', userText(validated.summary));
  if (validated.directions.length) lines.push('', '方向明细：', ...validated.directions.map((direction) => `- ${userText(direction.actor)} → ${userText(direction.victim)}：${value(direction.hitCount)} 次，${value(direction.damage)} 伤害${direction.complete ? '' : '（不完整）'}`));
  return lines.concat(footer(validated, options)).join('\n');
}

export function formatPubgSourceRange(from: string | null, to: string | null, options: PubgRenderOptions = {}): string {
  return `数据范围：${formatDisplayRange(from, to, timeOptions(options))}`;
}
