import type { CanonicalQuery, Metric, Selector } from '../schema/query.js';
import type { DataStatus } from '../schema/status.js';
import type { OperationData, QueryRow, StructuredResult } from '../data/model.js';
import { describeRange } from '../time/selector-resolver.js';
import { PresentationModelSchema, type PresentationModel, type PresentationSection } from '../platform/core/contracts.js';
import { buildMatchPickerPresentation, buildReviewPresentation } from '../review/presentation.js';

function value(row: QueryRow, metric: string, fallback: string | number = 0): string | number {
  const raw = row.metrics[metric];
  if (raw === null || raw === undefined || raw === '') return metric === 'kd' ? '—' : fallback;
  return raw;
}

function numberValue(row: QueryRow, metric: string): number {
  const raw = value(row, metric, 0);
  if (raw === '∞') return Number.POSITIVE_INFINITY;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fixed(valueToFormat: string | number, digits = 2): string {
  if (valueToFormat === '∞' || valueToFormat === Number.POSITIVE_INFINITY) return '—';
  const parsed = Number(valueToFormat);
  if (!Number.isFinite(parsed)) return '—';
  return parsed.toFixed(digits).replace(/\.00$/u, '').replace(/(\.\d)0$/u, '$1');
}

function kdFixed(valueToFormat: string | number): string {
  return fixed(valueToFormat, 1);
}

function integer(valueToFormat: string | number): string {
  if (valueToFormat === '∞' || valueToFormat === Number.POSITIVE_INFINITY) return '—';
  const parsed = Number(valueToFormat);
  return Number.isFinite(parsed) ? Math.round(parsed).toLocaleString('zh-CN') : '—';
}

function playerCard(row: QueryRow, position?: number): string[] {
  const prefix = position ? `${position <= 3 ? ['🥇', '🥈', '🥉'][position - 1] : `#${position}`} ${row.label}` : row.label;
  if (row.activityStatus === 'NO_ACTIVITY') return [prefix, '⚠️ NO_ACTIVITY ｜本期没有可确认的比赛数据'];
  const rank = row.bestRank ?? value(row, 'rank', '—');
  return [
    prefix,
    `   ⚔️ KD ${kdFixed(value(row, 'kd'))} ｜击杀 ${integer(value(row, 'kills'))} ｜死亡 ${integer(value(row, 'deaths'))} ｜助攻 ${integer(value(row, 'assists'))}`,
    `   🎯 伤害 ${integer(value(row, 'damage'))} ｜场均 ${integer(value(row, 'avg_damage'))} ｜💥 倒地 ${integer(value(row, 'dbnos'))} ｜❤️ 救援 ${integer(value(row, 'revives'))}`,
    `   🍗 吃鸡 ${integer(value(row, 'wins'))} ｜🏅 Top10 ${integer(value(row, 'top10'))} ｜最佳 #${rank} ｜🥔 菜鸡指数 ${fixed(value(row, 'chicken_index', '—'))}`,
  ];
}

function formatLocalDate(valueToFormat: string, timezone: string): string {
  const date = new Date(valueToFormat);
  if (!Number.isFinite(date.getTime())) return valueToFormat;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date).replaceAll('/', '-');
}

function selectorRange(selector: Selector): string {
  if (selector.type !== 'time_range') return describeRange(selector);
  const timezone = selector.timezone ?? 'Asia/Shanghai';
  return `${formatLocalDate(selector.start, timezone)} – ${formatLocalDate(selector.end, timezone)}`;
}

function statusPrefix(status: DataStatus): string[] {
  if (status === 'PARTIAL') return ['⚠️ 数据部分可用，以下结果可能不完整'];
  if (status === 'STALE') return ['⚠️ PUBG 数据源暂不可用，以下为本地已保存的旧数据'];
  if (status === 'COVERAGE_GAP') return ['⚠️ 当前数据覆盖不足，不能据此判断“没有比赛”'];
  if (status === 'SOURCE_UNAVAILABLE') return ['⚠️ PUBG 数据源暂时不可用，未将其误判为没有比赛'];
  if (status === 'REVIEW_PARTIAL') return ['⚠️ 基础战绩已找到，但详细战斗记录暂时无法获取'];
  if (status === 'MATCH_NOT_FOUND') return ['📭 没有找到可复盘的比赛'];
  if (status === 'MATCH_SELECTION_REQUIRED') return ['🎬 已找到多场比赛，请先选择一场'];
  return [];
}

function renderTeamSummary(data: OperationData): string[] {
  const team = (data.summary.team ?? {}) as Record<string, unknown>;
  return [
    '👥 小队总览',
    `🎮 比赛 ${integer(String(team.matches ?? data.summary.uniqueMatchCount ?? 0))} ｜💀 击杀 ${integer(String(team.kills ?? 0))} ｜🤝 助攻 ${integer(String(team.assists ?? 0))}`,
    `💥 倒地 ${integer(String(team.dbnos ?? 0))} ｜❤️ 救援 ${integer(String(team.revives ?? 0))} ｜🎯 总伤害 ${integer(String(team.damage ?? 0))}`,
    `📊 场均伤害 ${integer(String(team.avg_damage ?? 0))} ｜🍗 吃鸡 ${integer(String(team.wins ?? 0))} ｜🏅 Top10 ${integer(String(team.top10 ?? 0))}`,
    `⚔️ 合计 KD ${kdFixed(String(team.teamCombinedKD ?? team.kd ?? '—'))}`,
  ];
}

function highlightLine(label: string, rows: QueryRow[], metric: string): string {
  if (!rows.length) return `${label} 暂无数据`;
  const format = (row: QueryRow): string => {
    const raw = value(row, metric);
    const formatted = metric === 'kd'
      ? kdFixed(raw)
      : ['damage', 'kills', 'assists', 'dbnos', 'revives', 'wins', 'top10'].includes(metric)
        ? integer(raw)
        : fixed(raw);
    return `${row.label}（${formatted}）`;
  };
  return `${label} ${rows.map(format).join('、')}`;
}

function renderHighlights(data: OperationData): string[] {
  const highlights = data.highlights ?? {};
  const first = (key: string) => highlights[key] ?? [];
  const chicken = first('chicken_index');
  return [
    '✨ 本期亮点',
    highlightLine('👑 KD王', first('kd'), 'kd'),
    highlightLine('🔫 击杀王', first('kills'), 'kills'),
    highlightLine('💥 伤害王', first('damage'), 'damage'),
    highlightLine('🧎 倒地王', first('dbnos'), 'dbnos'),
    highlightLine('❤️ 救援王', first('revives'), 'revives'),
    highlightLine('🎯 最远击杀', first('longest_kill'), 'longest_kill'),
    chicken.length ? `🥔 拉完了\n${chicken.map((row) => `${row.label} · 菜鸡指数 ${fixed(value(row, 'chicken_index'))}\nKD ${kdFixed(value(row, 'kd'))} · 场均${integer(value(row, 'avg_damage'))}伤害`).join('\n')}` : '🥔 拉完了 暂无有效玩家',
  ];
}

export function renderTeamReport(result: StructuredResult, query: CanonicalQuery): string {
  const subjectLabel = query.subject.label ?? '四人组';
  const lines = [
    `🏆 PUBG · ${query.selector.label ?? describeRange(query.selector)}`,
    selectorRange(query.selector),
    `竞技模式 · ${subjectLabel} · 共 ${integer(String(result.data.summary.uniqueMatchCount ?? 0))} 场`,
    '',
    '🔥 KD 排名',
  ];
  result.data.rows.forEach((row, index) => lines.push('', ...playerCard(row, index + 1)));
  lines.push('', ...renderTeamSummary(result.data), '', ...renderHighlights(result.data));
  return [...statusPrefix(result.status), ...lines].join('\n');
}

function renderPlayerDetail(result: StructuredResult, query: CanonicalQuery): string {
  const lines = [
    `🎮 PUBG · ${query.selector.label ?? describeRange(query.selector)}`,
    selectorRange(query.selector),
    '',
  ];
  result.data.rows.forEach((row) => lines.push(...playerCard(row), ''));
  return [...statusPrefix(result.status), ...lines].join('\n').trim();
}

function renderRanking(result: StructuredResult): string {
  const metric = result.data.metric ?? 'kills';
  const title = metric === 'performance_score' ? '🔥 最强排名' : metric === 'chicken_index' ? '🥔 菜鸡指数排名' : `🏅 ${metricLabel(metric)} 排名`;
  const lines = [title, ''];
  result.data.rows.forEach((row, index) => {
    if (row.groupBy === 'player') lines.push(...playerCard(row, row.position ?? index + 1), '');
    else lines.push(...matchCard(row, row.position ?? index + 1), '');
  });
  return [...statusPrefix(result.status), ...lines].join('\n').trim();
}

function metricLabel(metric: Metric | string): string {
  const labels: Record<string, string> = {
    kd: 'KD', kills: '击杀', assists: '助攻', damage: '伤害', avg_damage: '场均伤害', dbnos: '倒地', revives: '救援', rank: '排名', wins: '吃鸡', top10: 'Top10', matches: '场次', longest_kill: '最远击杀', performance_score: '表现分', chicken_index: '菜鸡指数',
  };
  return labels[metric] ?? metric;
}

function matchCard(row: QueryRow, position?: number): string[] {
  const timestamp = row.timestamp ? formatLocalDate(new Date(row.timestamp).toISOString(), 'Asia/Shanghai') : '未知时间';
  const prefix = position ? `#${position} ${row.matchId ?? row.label}` : (row.matchId ?? row.label);
  return [
    prefix,
    `🕘 ${timestamp} ｜🗺️ ${row.mapName ?? '未知地图'} ｜${row.gameMode ?? '未知模式'}`,
    `⚔️ ${integer(value(row, 'kills'))}杀 ｜💥 ${integer(value(row, 'damage'))}伤害 ｜🏅 #${value(row, 'rank', '—')}`,
    `👥 ${row.players?.map((player) => `${player.displayName || player.playerName} ${player.kills}杀/${fixed(player.damage)}伤`).join(' · ') ?? '无参与者明细'}`,
  ];
}

function renderCompare(data: OperationData, status: DataStatus): string {
  const lines = ['⚖️ PUBG · 周期对比', ''];
  for (const segment of data.segments ?? []) {
    lines.push(`📌 ${segment.label} ｜${integer(String(segment.summary.uniqueMatchCount ?? 0))}场`);
    for (const row of segment.rows) lines.push(...playerCard(row, row.position), '');
  }
  if (data.rows.length) {
    lines.push('📈 第一周期 − 第二周期', '');
    for (const row of data.rows) {
      lines.push(`${row.label}`, `KD ${kdFixed(value(row, 'kd'))} ｜击杀 ${signed(value(row, 'kills'))} ｜伤害 ${signed(value(row, 'damage'))} ｜场均伤害 ${signed(value(row, 'avg_damage'))}`, '');
    }
  }
  return [...statusPrefix(status), ...lines].join('\n').trim();
}

function signed(valueToFormat: string | number, digits = 2): string {
  const parsed = valueToFormat === '∞' ? Number.POSITIVE_INFINITY : Number(valueToFormat);
  if (!Number.isFinite(parsed)) return '—';
  return `${parsed > 0 ? '+' : ''}${fixed(parsed, digits)}`;
}

function renderTrend(data: OperationData, status: DataStatus): string {
  const lines = ['📈 PUBG · 状态趋势', ''];
  for (const row of data.dailySeries ?? []) {
    lines.push(`${row.label} ｜KD ${kdFixed(value(row, 'kd'))} ｜场均伤害 ${integer(value(row, 'avg_damage'))} ｜击杀 ${integer(value(row, 'kills'))}`);
  }
  const change = data.change as { direction?: string; metrics?: Record<string, { from: number; to: number; delta: number }> } | undefined;
  if (change?.metrics) {
    lines.push('', `结论：${change.direction === 'up' ? '📈 变好了' : change.direction === 'down' ? '📉 变差了' : '➖ 基本稳定'}`);
    for (const [metric, item] of Object.entries(change.metrics)) lines.push(`${metricLabel(metric)} ${metric === 'kd' ? kdFixed(item.from) : fixed(item.from)} → ${metric === 'kd' ? kdFixed(item.to) : fixed(item.to)}（${signed(item.delta, metric === 'kd' ? 1 : 2)}）`);
  }
  return [...statusPrefix(status), ...lines].join('\n');
}

function renderList(data: OperationData, status: DataStatus): string {
  const lines = ['🎮 PUBG · 比赛列表', ''];
  for (const row of data.rows) lines.push(...matchCard(row), '');
  return [...statusPrefix(status), ...lines].join('\n').trim();
}

function renderStatus(result: StructuredResult): string {
  const errors = Array.isArray(result.data.summary.errors) ? result.data.summary.errors.join('、') : '';
  const messages: Record<DataStatus, string> = {
    OK: '查询完成。',
    NO_MATCHES: '✅ 数据覆盖完整，但这个时间范围内没有确认到比赛。',
    PARTIAL: '⚠️ 已返回部分数据，但结果可能不完整。',
    COVERAGE_GAP: '⚠️ 当前本地数据覆盖不足，不能判断这个时间范围是否没有比赛。',
    SOURCE_UNAVAILABLE: '⚠️ PUBG 数据源暂时不可用，无法确认完整战绩。',
    INVALID_QUERY: '⚠️ 查询条件无法验证。',
    UNKNOWN_PLAYER: '⚠️ 未识别到指定 PUBG 玩家。',
    UNSUPPORTED_CAPABILITY: '⚠️ 当前数据层不支持这个能力，未编造 PUBG 事实。',
    STALE: '⚠️ 数据源暂不可用，已使用本地旧数据。',
    MATCH_NOT_FOUND: '📭 没有找到可复盘的比赛。',
    MATCH_SELECTION_REQUIRED: '🎬 找到多场比赛，请选择要复盘的那一场。',
    REVIEW_PARTIAL: '⚠️ 基础战绩已经找到，但详细战斗记录暂时无法获取。',
    FIGHT_ANALYTICS_INVALID: '⚠️ 详细团战数据未通过一致性校验，暂不展示团战结论。',
  };
  return `${messages[result.status]}${errors ? `\n原因：${errors}` : ''}`;
}

export function renderResult(result: StructuredResult, query: CanonicalQuery): string {
  if (query.operation === 'review_match' && result.review) return buildReviewPresentation(result.review, query, result.resultSetId ?? null).fallbackText;
  if (query.operation === 'review_match' && result.matchPicker) return buildMatchPickerPresentation(result.matchPicker, query, result.resultSetId ?? null).fallbackText;
  if (result.status !== 'OK' && result.status !== 'STALE' && result.status !== 'PARTIAL' && result.status !== 'REVIEW_PARTIAL' && result.status !== 'NO_MATCHES') return renderStatus(result);
  if (result.status === 'NO_MATCHES') return renderStatus(result);
  if (query.operation === 'report' && query.groupBy === 'player') return query.subject.type === 'team' ? renderTeamReport(result, query) : renderPlayerDetail(result, query);
  if (query.operation === 'detail' && query.groupBy === 'player') return renderPlayerDetail(result, query);
  if (query.operation === 'compare') return renderCompare(result.data, result.status);
  if (query.operation === 'trend') return renderTrend(result.data, result.status);
  if (query.operation === 'list') return renderList(result.data, result.status);
  if (query.operation === 'rank' || query.operation === 'strongest' || query.operation === 'weakest') return renderRanking(result);
  if (query.groupBy === 'match') return renderRanking(result);
  return renderRanking(result);
}

export function buildPresentation(result: StructuredResult, query: CanonicalQuery): PresentationModel {
  if (query.operation === 'review_match' && result.matchPicker) return buildMatchPickerPresentation(result.matchPicker, query, result.resultSetId ?? null);
  if (query.operation === 'review_match' && result.review) return buildReviewPresentation(result.review, query, result.resultSetId ?? null);
  const fallbackText = renderResult(result, query);
  const sections: PresentationSection[] = result.data.rows.map((row) => ({
    type: `${row.groupBy}-card`,
    title: row.label,
    data: {
      key: row.key,
      metrics: row.metrics,
      matchId: row.matchId ?? null,
      timestamp: row.timestamp ?? null,
      activityStatus: row.activityStatus ?? 'ACTIVE',
    },
  }));
  if (result.data.summary && Object.keys(result.data.summary).length) {
    sections.push({
      type: 'summary',
      title: 'summary',
      data: result.data.summary,
    });
  }
  return PresentationModelSchema.parse({
    version: 1,
    type: query.operation,
    title: query.presentation.periodLabel ?? query.operation,
    sections: [{ type: 'text', text: fallbackText }, ...sections],
    fallbackText,
    metadata: {
      queryId: result.queryId,
      status: result.status,
      resultSetId: result.resultSetId ?? null,
    },
  });
}
