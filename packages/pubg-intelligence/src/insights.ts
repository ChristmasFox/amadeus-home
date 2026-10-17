import {
  newcombeDifference, type LineupAnalytics, type MapAnalytics, type MatchSeriesPoint, type RateEstimate, type SquadAnalytics, wilsonInterval, median,
} from './analytics.js';
import type { CombatQualitySummary, DeathSummary } from './combat-quality.js';
import type { LandingPreference } from './landing.js';

export const INSIGHT_RULE_VERSION = 'highlight-rules-v1' as const;
export const INSIGHT_MAX = 6;
export const INSIGHT_MAP_MIN_MATCHES = 15;
export const INSIGHT_REVIVE_MIN_KNOCKS = 15;
export const INSIGHT_DEATH_MIN = 30;
export const INSIGHT_RECENT_MATCHES = 20;

export type InsightTone = 'good' | 'warn' | 'info';

export interface Insight {
  id: string;
  tone: InsightTone;
  title: string;
  detail: string;
  /** Short sample/interval statement so every claim carries its own uncertainty. */
  evidence: string;
}

const pct = (value: number | null, digits = 0): string => (value === null ? '—' : `${(value * 100).toFixed(digits)}%`);
const interval = (rate: RateEstimate): string => (rate.low === null || rate.high === null ? '区间不足' : `95% 区间 ${pct(rate.low)}–${pct(rate.high)}`);

/** Orders warnings first, then good news, then context, and keeps the list short enough to read. */
export function rankInsights(insights: Insight[]): Insight[] {
  const weight: Record<InsightTone, number> = { warn: 0, good: 1, info: 2 };
  return insights.sort((left, right) => weight[left.tone] - weight[right.tone] || left.id.localeCompare(right.id)).slice(0, INSIGHT_MAX);
}

export interface PerformanceInsightInput {
  squad: SquadAnalytics;
  maps: readonly MapAnalytics[];
  lineups: LineupAnalytics;
  series: readonly MatchSeriesPoint[];
}

export function buildPerformanceInsights(input: PerformanceInsightInput): Insight[] {
  const insights: Insight[] = [];

  for (const member of input.lineups.members) {
    if (member.withMatches < 5 || member.withoutMatches < 5 || !member.difference.significant || member.difference.delta === null) continue;
    const delta = member.difference.delta;
    insights.push({
      id: `member-${member.id}`,
      tone: delta > 0 ? 'good' : 'warn',
      title: `${member.name} ${delta > 0 ? '在场时前十率明显更高' : '在场时前十率明显更低'}`,
      detail: `在场 ${pct(member.withTop10.rate)}（${member.withMatches} 场）对比缺席 ${pct(member.withoutTop10.rate)}（${member.withoutMatches} 场），差 ${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(0)} 个百分点。这是相关性，不等于个人贡献。`,
      evidence: `差值 95% 区间 ${(member.difference.low! * 100).toFixed(0)} 到 ${(member.difference.high! * 100).toFixed(0)}pt`,
    });
  }

  const rankedMaps = input.maps.filter((map) => map.rankedMatches >= INSIGHT_MAP_MIN_MATCHES);
  const totalTrials = input.maps.reduce((sum, map) => sum + map.top10.trials, 0);
  const totalSuccess = input.maps.reduce((sum, map) => sum + map.top10.successes, 0);
  for (const map of rankedMaps) {
    const rest = wilsonInterval(totalSuccess - map.top10.successes, totalTrials - map.top10.trials);
    const difference = newcombeDifference(map.top10, rest);
    if (!difference.significant || difference.delta === null) continue;
    insights.push({
      id: `map-${map.mapName}`,
      tone: difference.delta > 0 ? 'good' : 'warn',
      title: `${map.label}前十率${difference.delta > 0 ? '明显高于' : '明显低于'}其他地图`,
      detail: `${map.label} ${pct(map.top10.rate)}（${map.rankedMatches} 场）对比其他地图 ${pct(rest.rate)}，中位名次 ${map.medianPlacement === null ? '未知' : `#${map.medianPlacement}`}。`,
      evidence: `差值 95% 区间 ${(difference.low! * 100).toFixed(0)} 到 ${(difference.high! * 100).toFixed(0)}pt`,
    });
  }

  for (const player of input.squad.players) {
    const damage = player.metrics.find((metric) => metric.key === 'damage');
    if (!damage || damage.form === 'steady' || damage.form === 'insufficient' || damage.formZ === null) continue;
    insights.push({
      id: `form-${player.id}`,
      tone: damage.form === 'hot' ? 'good' : 'warn',
      title: `${player.name} 近 5 场伤害${damage.form === 'hot' ? '明显高于' : '明显低于'}自己的常态`,
      detail: `此前基线中位 ${Math.round(damage.baselineMedian ?? 0)}，近 5 场均值 ${Math.round(damage.recentMean ?? 0)}。`,
      evidence: `稳健 z = ${damage.formZ.toFixed(1)}（|z| ≥ 1.5 才标记）`,
    });
  }

  const recent = input.series.slice(-INSIGHT_RECENT_MATCHES);
  const before = input.series.slice(0, -INSIGHT_RECENT_MATCHES);
  const rate = (items: readonly MatchSeriesPoint[]) => {
    const ranked = items.filter((point) => point.placement !== null);
    return wilsonInterval(ranked.filter((point) => point.placement! <= 10).length, ranked.length);
  };
  if (recent.length >= INSIGHT_RECENT_MATCHES && before.length >= 30) {
    const recentRate = rate(recent);
    const beforeRate = rate(before);
    const difference = newcombeDifference(recentRate, beforeRate);
    if (difference.significant && difference.delta !== null) {
      insights.push({
        id: 'recent-top10',
        tone: difference.delta > 0 ? 'good' : 'warn',
        title: `近 ${INSIGHT_RECENT_MATCHES} 场前十率${difference.delta > 0 ? '明显回升' : '明显下滑'}`,
        detail: `近 ${INSIGHT_RECENT_MATCHES} 场 ${pct(recentRate.rate)} 对比此前 ${pct(beforeRate.rate)}。`,
        evidence: `差值 95% 区间 ${(difference.low! * 100).toFixed(0)} 到 ${(difference.high! * 100).toFixed(0)}pt`,
      });
    }
    const recentDamage = median(recent.map((point) => point.damage));
    const beforeDamage = median(before.map((point) => point.damage));
    if (recentDamage !== null && beforeDamage !== null && beforeDamage > 0 && Math.abs(recentDamage / beforeDamage - 1) >= 0.3) {
      const change = recentDamage / beforeDamage - 1;
      insights.push({
        id: 'recent-damage',
        tone: change > 0 ? 'good' : 'warn',
        title: `近 ${INSIGHT_RECENT_MATCHES} 场人均伤害中位数${change > 0 ? '上升' : '下降'} ${Math.abs(change * 100).toFixed(0)}%`,
        detail: `中位数 ${Math.round(recentDamage)} 对比此前 ${Math.round(beforeDamage)}（用中位数，避免个别爆发场次拉偏）。`,
        evidence: `${recent.length} 场对 ${before.length} 场；变化 ≥ 30% 才提示`,
      });
    }
  }
  return rankInsights(insights);
}

export interface CombatInsightInput {
  combat: CombatQualitySummary;
  deaths: DeathSummary;
  landing: LandingPreference;
}

export function buildCombatInsights(input: CombatInsightInput): Insight[] {
  const { combat, deaths, landing } = input;
  const insights: Insight[] = [];

  const revive = combat.revive;
  if (revive.knocked >= INSIGHT_REVIVE_MIN_KNOCKS && revive.reviveRate.high !== null && revive.reviveRate.high < 0.4) {
    const finish = combat.finish.finishRate.rate;
    insights.push({
      id: 'revive-weak',
      tone: 'warn',
      title: `队员倒地后只有 ${pct(revive.reviveRate.rate)} 被救起`,
      detail: `${revive.knocked} 次倒地中救起 ${revive.revived} 次、被补掉 ${revive.killed} 次${finish === null ? '' : `；对比我们补掉对手的 ${pct(finish)}，救援是明显短板`}。`,
      evidence: `${interval(revive.reviveRate)}，样本 ${revive.knocked} 次`,
    });
  }

  if (deaths.deaths >= INSIGHT_DEATH_MIN && deaths.afterKnock.rate.low !== null && deaths.afterKnock.rate.low > 0.5) {
    insights.push({
      id: 'death-after-knock',
      tone: 'warn',
      title: `${pct(deaths.afterKnock.rate.rate)} 的淘汰发生在倒地之后`,
      detail: `${deaths.deaths} 次淘汰里有 ${deaths.afterKnock.count} 次是先倒地再被补掉。倒地后的封烟、拉人或爬走有机会改变结果。`,
      evidence: interval(deaths.afterKnock.rate),
    });
  }

  const first = combat.firstKnock;
  if (first.forUs + first.againstUs >= 20 && first.ourRate.low !== null && first.ourRate.high !== null) {
    if (first.ourRate.low > 0.5) {
      insights.push({ id: 'first-knock', tone: 'good', title: `首倒占比 ${pct(first.ourRate.rate)}，开战更常是我方先手`, detail: `${first.forUs + first.againstUs} 次有明确首倒的交战里我方先倒地对手 ${first.forUs} 次。`, evidence: interval(first.ourRate) });
    } else if (first.ourRate.high < 0.5) {
      insights.push({ id: 'first-knock', tone: 'warn', title: `首倒占比只有 ${pct(first.ourRate.rate)}，开战更常被对手先手`, detail: `${first.forUs + first.againstUs} 次有明确首倒的交战里对手先倒地我方 ${first.againstUs} 次。`, evidence: interval(first.ourRate) });
    }
  }

  const lead = combat.leadConversion;
  if (lead.held + lead.lost >= 20 && lead.heldRate.rate !== null && lead.heldRate.rate < 0.8) {
    insights.push({ id: 'lead-lost', tone: 'info', title: `先手优势有 ${pct(1 - lead.heldRate.rate)} 被追平或反超`, detail: `我方首倒后，${lead.lost} 次被对手把倒地数追平或反超（共 ${lead.held + lead.lost} 次）。`, evidence: interval(lead.heldRate) });
  }

  if (combat.groups >= 30 && combat.thirdParty.againstRate.rate !== null && combat.thirdParty.againstRate.rate >= 0.3) {
    insights.push({ id: 'third-party', tone: 'info', title: `${pct(combat.thirdParty.againstRate.rate)} 的交战出现第三方介入候选`, detail: `${combat.groups} 次交战里有 ${combat.thirdParty.againstUs} 次时间重叠的第三队接触；这只是候选，不代表对方意图。`, evidence: interval(combat.thirdParty.againstRate) });
  }

  const topStage = [...deaths.stages].sort((left, right) => right.deaths - left.deaths)[0];
  if (deaths.deaths >= INSIGHT_DEATH_MIN && topStage && topStage.stage !== '未知' && topStage.share >= 0.5) {
    insights.push({ id: 'death-stage', tone: 'info', title: `${pct(topStage.share)} 的淘汰集中在${topStage.stage}`, detail: `${deaths.deaths} 次淘汰里 ${topStage.deaths} 次发生在${topStage.stage}阶段（按淘汰时剩余队伍数划分）。`, evidence: `样本 ${deaths.deaths} 次` });
  }

  const map = landing.maps.find((item) => item.matchesWithLanding >= 6);
  if (map && map.topCellRepeatRate !== null && map.topCellRepeatRate >= 0.5) {
    insights.push({ id: `landing-${map.mapName}`, tone: 'info', title: `${map.label}落点集中：${pct(map.topCellRepeatRate)} 的场次落在 ${map.cells[0]!.cell} 格`, detail: `${map.matchesWithLanding} 场有落点记录，队内成员落点距小队中心中位 ${map.medianSpreadMeters === null ? '未知' : `${Math.round(map.medianSpreadMeters)}m`}。`, evidence: `样本 ${map.matchesWithLanding} 场` });
  }
  return rankInsights(insights);
}
