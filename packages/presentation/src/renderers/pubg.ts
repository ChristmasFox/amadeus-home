import type { PubgMatchReviewPresentation, PubgPeriodReviewPresentation } from '../contracts/pubg.js';
import { formatDisplayRange, formatDisplayTime } from '../time/format.js';
import { assertValid, validatePubgMatchReviewPresentation, validatePubgPeriodReviewPresentation } from '../validation/validate.js';

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

export function renderPubgMatchReview(presentation: PubgMatchReviewPresentation, options: PubgRenderOptions = {}): string {
  const validated = assertValid(validatePubgMatchReviewPresentation(presentation));
  const lines = [validated.headline, '', `排名：${validated.overview.placement ?? '未知'}｜击杀：${validated.overview.kills ?? '未知'}｜助攻：${validated.overview.assists ?? '未知'}`, `伤害：${validated.overview.damage ?? '未知'}｜倒地：${validated.overview.dbnos ?? '未知'}｜救援：${validated.overview.revives ?? '未知'}`];
  if (validated.keyMoments.length) lines.push('', '关键时刻：', ...validated.keyMoments.map((item) => `- ${item.text}`));
  if (validated.highlights.length) lines.push('', '亮点：', ...validated.highlights.map((item) => `- ${item.text}`));
  if (validated.improvements.length) lines.push('', '改进：', ...validated.improvements.map((item) => `- ${item.text}`));
  lines.push('', validated.analysis);
  const display = formatDisplayTime(validated.dataUpdatedAt, timeOptions(options));
  if (display) lines.push('', `数据更新时间：${display}`);
  return lines.join('\n');
}

export function renderPubgPeriodReview(presentation: PubgPeriodReviewPresentation, options: PubgRenderOptions = {}): string {
  const validated = assertValid(validatePubgPeriodReviewPresentation(presentation));
  const lines = [validated.period.displayDate ? `${validated.period.label}（${validated.period.displayDate}）` : validated.period.label, '', validated.summary];
  if (validated.orderedMatches.length) {
    lines.push('', '对局顺序：', ...validated.orderedMatches.map((match) => `- ${match.label} ${match.startedAt ? `（${formatDisplayTime(match.startedAt, timeOptions(options, { forceDate: true }))}）` : ''}：第${match.placement ?? '未知'}名`));
  }
  if (validated.highlights.length) lines.push('', '亮点：', ...validated.highlights.map((item) => `- ${item.text}`));
  if (validated.patterns.length) lines.push('', '模式：', ...validated.patterns.map((item) => `- ${item.text}`));
  lines.push('', validated.analysis);
  const display = formatDisplayTime(validated.dataUpdatedAt, timeOptions(options));
  if (display) lines.push('', `数据更新时间：${display}`);
  return lines.join('\n');
}

export function formatPubgSourceRange(from: string | null, to: string | null, options: PubgRenderOptions = {}): string {
  return `数据来源时间范围：${formatDisplayRange(from, to, timeOptions(options))}`;
}
