import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Complement, HeadToHead, TrendAndSpread, WeaponCompare, styleSimilarity, type CompareSeries, type Contrast } from './compare-panels.js';

export interface Rate { successes: number; trials: number; rate: number | null; low: number | null; high: number | null }
export type Trend = 'up' | 'down' | 'flat' | 'insufficient';
export type Form = 'hot' | 'steady' | 'cold' | 'insufficient';

export interface MetricSummary {
  key: string; label: string; samples: number; mean: number; median: number; latest: number | null; ewma: number | null;
  formZ: number | null; form: Form; trend: Trend; latestPercentile: number | null;
}

export interface DifferenceEstimate { delta: number | null; low: number | null; high: number | null; significant: boolean }

export interface Insight { id: string; tone: 'good' | 'warn' | 'info'; title: string; detail: string; evidence: string }

export interface PlayerProfiles {
  matches: number;
  players: Array<{
    id: string; name: string; matches: number; minutesAlive: number; healPerMinute: number | null; boostPerMinute: number | null; armorBreaks: number;
    armorBreakConversion: Rate; friendlyDamageDealt: number; friendlyDamageTaken: number; flashPerMatch: number | null; rideKmPerMatch: number | null; healVsSquad: number | null;
  }>;
  squadFriendlyDamage: number;
  notes: string[];
}

export interface PerformanceAnalytics {
  highlights: Insight[];
  profiles: PlayerProfiles;
  scope: { squadLabel: string; selectedMatches: number; telemetryMatches: number; archivedMatches: number; mode: string; completeOnly: boolean };
  series: Array<{ matchId: string; timestamp: number; mapLabel: string; placement: number | null; damage: number; kills: number }>;
  lineups: {
    lineups: Array<{ names: string[]; size: number; matches: number; rankedMatches: number; top10: Rate; win: Rate; medianPlacement: number | null; averageDamage: number }>;
    members: Array<{ id: string; name: string; withMatches: number; withoutMatches: number; withTop10: Rate; withoutTop10: Rate; difference: DifferenceEstimate; withDamage: number | null; withoutDamage: number | null }>;
    notes: string[];
  };
  squad: {
    ruleVersion: string; matches: number; rankedMatches: number; win: Rate; top10: Rate; medianPlacement: number | null; placementTrend: Trend;
    players: Array<{ id: string; name: string; matches: number; metrics: MetricSummary[]; damageShare: number | null; killShare: number | null }>;
    notes: string[];
  };
  maps: Array<{
    mapName: string; label: string; matches: number; rankedMatches: number; win: Rate; top10: Rate; medianPlacement: number | null;
    averageDamage: number; averageKills: number; averageSurvivalTime: number; damageIndex: number | null;
  }>;
  weapons: Array<{
    weapon: string; shots: number; hits: number; rawHitRate: number | null; shrunkHitRate: number | null; damagePerHit: number | null;
    edge: number | null; kills: number; reliable: boolean;
  }>;
}

export type StyleTier = 'stable' | 'lean' | 'even' | 'unknown';
export interface StyleAxisReading {
  key: string; group: string; label: string; value: number | null; matesValue: number | null; ratio: number | null;
  low: number | null; high: number | null; confidence: number | null; tier: StyleTier; direction: 'high' | 'low' | null; stable: boolean;
}
export interface SquadStyle {
  matches: number;
  players: Array<{
    accountId: string; name: string; matches: number; minutes: number; axes: StyleAxisReading[];
    traits: Array<{ key: string; text: string; ratio: number; tier: 'stable' | 'lean'; confidence: number | null }>;
    archetypes: Array<{ id: string; label: string; score: number; tier: 'stable' | 'lean' | 'slight' | 'balanced' }>;
    classShares: Array<{ weaponClass: string; share: number }>;
    weapons: Array<{ weapon: string; share: number }>;
    landingSpread: number | null; summary: string;
  }>;
  combatVerdict: string;
  combatHighlights: Array<{ name: string; label: string; ratio: number; tier: 'stable' | 'lean'; confidence: number | null }>;
  combat: Array<{
    accountId: string; name: string; rank: number; ratio: number | null; low: number | null; high: number | null; confidence: number | null; tier: StyleTier;
    components: Array<{ key: string; label: string; ratio: number | null; tier: StyleTier }>;
  }>;
  funnel: Array<{
    accountId: string; name: string; fights: number; minutes: number; shots: number; hits: number; hitRate: number | null; firstShotRate: number | null; followShotRate: number | null; burstShare: number | null; idleShare: number | null; finishingShare: number | null; hitDamage: number; damagePerShot: number | null;
    damagePerMinute: number | null; knocks: number; hitsPerKnock: number | null; kills: number; knockFights: number; knockRate: number | null;
    chainsDealt: number; chainsFinished: number; conversion: number | null;
  }>;
  spreads: Array<{
    key: string; group: string; label: string;
    highest: { name: string; value: number; ratio: number | null; tier: StyleTier };
    lowest: { name: string; value: number; ratio: number | null; tier: StyleTier };
    spread: number; supported: boolean;
  }>;
  overlaps: Array<{ accountIds: [string, string]; names: [string, string]; similarity: number; sharedTraits: string[] }>;
  gaps: string[];
  notes: string[];
}

export interface FightBucket { key: string; label: string; fights: number; wins: number; losses: number; draws: number; winRate: Rate }
export interface LongRunReading { ratio: number | null; low: number | null; high: number | null; confidence: number | null; tier: StyleTier; direction: 'high' | 'low' | null }
export interface LongRunCombat {
  matches: number;
  verdict: string;
  notes: string[];
  entries: Array<{ accountId: string; name: string; matches: number; rank: number; composite: LongRunReading; metrics: Array<{ key: string; label: string } & LongRunReading> }>;
}
export interface LobbyInterval { mean: number | null; low: number | null; high: number | null }
export interface LobbyCombat {
  matches: number;
  lobbySize: number | null;
  verdict: string;
  notes: string[];
  entries: Array<{ accountId: string; name: string; matches: number; rank: number; damage: LobbyInterval; knocks: LobbyInterval; composite: LobbyInterval; tier: 'above' | 'below' | 'even' | 'unknown'; medianDamagePerMinute: number | null }>;
}

export interface StreakSummary {
  matches: number;
  players: Array<{ accountId: string; name: string; matches: number; takedowns: number; two: number; three: number; fourPlus: number; longest: number; chainedShare: Rate | null; multiPerTen: number | null; wipeTakedowns: number; soloWipes: number }>;
  wipes: {
    total: number; perMatch: number | null; matchShare: Rate | null; fullTeam: number; solo: number;
    bySize: Array<{ wiped: number; count: number }>; byStage: Array<{ stage: 'early' | 'mid' | 'late'; count: number }>; medianSeconds: number | null;
    leaders: Array<{ accountId: string; name: string; wipeTakedowns: number; led: number; solo: number }>;
  };
  wiped: { observed: number; singleTeam: Rate | null; singlePlayer: number };
  highlights: string[];
  notes: string[];
}

export interface DownSummaryData {
  matches: number; downs: number;
  byCause: Array<{ cause: string; label: string; advice: string; count: number; share: number; died: number }>;
  alone: Rate; revived: Rate; noReturnFire: Rate;
  byMember: Array<{ member: string; downs: number; causes: Array<{ cause: string; count: number }> }>;
  byStage: Array<{ stage: 'early' | 'mid' | 'late'; downs: number; noReturnFire: number }>;
  insights: string[];
}
export interface RotationSummaryData {
  matches: number; bluePenaltyRate: Rate; averageBlueDamage: number | null; averageBlueSeconds: number | null; averageDistanceKm: number | null; vehicleShare: number | null;
  averageLandingToFight: number | null; lateEntry: Rate; averageMargin: number | null;
  byPhase: Array<{ phase: number; circles: number; lateRate: number | null; medianEnter: number | null; averageMargin: number | null; averageOutside: number | null; averageDistance: number | null }>;
  insights: string[];
}

export interface TelemetryAnalytics {
  highlights: Insight[];
  streaks: StreakSummary;
  downs: DownSummaryData;
  rotation: RotationSummaryData;
  longRun: LongRunCombat;
  lobby: LobbyCombat;
  style: SquadStyle;
  fights: { fights: number; overall: FightBucket; byInitiator: FightBucket[]; byStage: FightBucket[]; byThirdParty: FightBucket[]; byDuration: FightBucket[]; notes: string[] };
  roles: Array<{
    accountId: string; name: string; fights: number; firstKnockShare: number | null; firstDownedShare: number | null; reviveShare: number | null; killShare: number | null;
    counts: { fights: number; firstKnocks: number; firstDowned: number; knocksDealt: number; timesDowned: number; kills: number; revives: number }; titles: string[];
  }>;
  distance: {
    matches: number; totalDealt: number; totalTaken: number; longRangeGap: number | null;
    bands: Array<{ id: string; label: string; dealt: number; taken: number; dealtShare: number | null; takenShare: number | null; headshotShare: number | null }>;
    weapons: Array<{ weapon: string; damage: number; shares: number[]; mainBand: string }>;
  };
  zone: {
    matches: number; blueDamagePerMatch: number | null; blueDamageShare: number | null;
    phases: Array<{ phase: number; samples: number; outsideRate: Rate; binShares: [number, number, number, number] | null; blueDamage: number }>;
  };
  scope: { squadLabel: string; eligibleMatches: number; analyzedMatches: number; missingArchiveMatches: number; unavailableMatches: number; limit: number; from: string | null; to: string | null };
  combat: {
    matches: number; groups: number;
    firstKnock: { forUs: number; againstUs: number; ourRate: Rate };
    leadConversion: { held: number; lost: number; heldRate: Rate };
    followUp: { observed: number; missed: number; medianSeconds: number | null };
    revive: { knocked: number; revived: number; killed: number; unresolved: number; reviveRate: Rate; medianSeconds: number | null };
    finish: { downed: number; finished: number; finishRate: Rate; medianSeconds: number | null };
    thirdParty: { againstUs: number; byUs: number; againstRate: Rate };
    notes: string[];
  };
  deaths: {
    deaths: number;
    afterKnock: { count: number; rate: Rate };
    stages: Array<{ stage: string; deaths: number; share: number }>;
    wipeStages: Array<{ stage: string; wipes: number }>;
    weapons: Array<{ weapon: string; deaths: number }>;
    unknownWeapon: number;
  };
  landing: {
    maps: Array<{
      mapName: string; label: string; sizeKm: number | null; matches: number; matchesWithLanding: number;
      cells: Array<{ cell: string; region: string | null; matches: number; share: number; top10: Rate; medianPlacement: number | null; earlyWipeRate: number | null; averageDamage: number }>;
      topCellRepeatRate: number | null; medianSpreadMeters: number | null; points: Array<{ x: number; y: number }>;
    }>;
    contest: {
      matches: number;
      buckets: Array<{ key: string; label: string; matches: number; top10: Rate; earlyWipe: Rate; medianPlacement: number | null }>;
      earlyWipeEdge: DifferenceEstimate; top10Edge: DifferenceEstimate;
    };
    notes: string[];
  };
}

const TREND = { up: '↗', down: '↘', flat: '→', insufficient: '·' } as const;
const FORM_TEXT = { hot: '火热', steady: '平稳', cold: '低迷', insufficient: '样本不足' } as const;

function pct(value: number | null, digits = 0): string {
  return value === null ? '—' : `${(value * 100).toFixed(digits)}%`;
}

function int(value: number | null): string {
  return value === null ? '—' : Math.round(value).toLocaleString('zh-CN');
}

function ci(rate: Rate): string {
  return rate.low === null || rate.high === null ? '样本不足' : `${pct(rate.low)}–${pct(rate.high)}`;
}

function seconds(value: number | null): string {
  return value === null ? '—' : value >= 60 ? `${Math.floor(value / 60)}分${Math.round(value % 60)}秒` : `${value.toFixed(1)}秒`;
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string | undefined; tone?: 'good' | 'warn' | undefined }) {
  return <div className={`av-kpi ${tone ?? ''}`}><span>{label}</span><b>{value}</b>{sub && <small>{sub}</small>}</div>;
}

function Panel({ title, hint, children, className = '' }: { title: string; hint?: string; children: ReactNode; className?: string }) {
  return <section className={`av-panel ${className}`}><header><h3>{title}</h3>{hint && <span>{hint}</span>}</header>{children}</section>;
}

function Bar({ value, max = 1, tone = 'mint' }: { value: number; max?: number; tone?: 'mint' | 'teal' | 'amber' }) {
  return <i className={`av-bar ${tone}`}><u style={{ width: `${Math.max(2, Math.min(100, (value / max) * 100))}%` }} /></i>;
}

function FormChip({ metric }: { metric: MetricSummary }) {
  return <span className={`av-chip form-${metric.form}`} title={metric.formZ === null ? '样本不足，不判断状态' : `近 5 场相对此前基线 z=${metric.formZ.toFixed(1)}`}>
    {TREND[metric.trend]} {FORM_TEXT[metric.form]}
  </span>;
}

function HighlightsPanel({ items }: { items: Insight[] }) {
  if (!items.length) return null;
  return (
    <Panel title="关键发现" hint="规则自动提炼；只列出样本足够且区间不含零的结论" className="av-highlights">
      <div className="av-insights">
        {items.map((item) => <article key={item.id} className={`av-insight ${item.tone}`}>
          <h4><i>{item.tone === 'good' ? '↗' : item.tone === 'warn' ? '!' : '·'}</i>{item.title}</h4>
          <p>{item.detail}</p>
          <small>{item.evidence}</small>
        </article>)}
      </div>
    </Panel>
  );
}

function percentile(values: readonly number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * (sorted.length - 1)))]!;
}

function rolling(values: readonly number[], window: number): number[] {
  return values.map((_, index) => {
    const slice = values.slice(Math.max(0, index - window + 1), index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

function dateText(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
}

const TREND_WIDTH = 560;
const TREND_HEIGHT = 150;

function DamageChart({ series }: { series: PerformanceAnalytics['series'] }) {
  const values = series.map((point) => point.damage);
  const smooth = rolling(values, 10);
  const cap = Math.max(1, percentile(values, 0.95) * 1.15);
  const x = (index: number) => (series.length < 2 ? TREND_WIDTH / 2 : (index / (series.length - 1)) * TREND_WIDTH);
  const y = (value: number) => TREND_HEIGHT - 8 - (Math.min(value, cap) / cap) * (TREND_HEIGHT - 20);
  return (
    <svg viewBox={`0 0 ${TREND_WIDTH} ${TREND_HEIGHT}`} className="av-trend-svg" role="img" aria-label="人均伤害走势">
      <line x1="0" x2={TREND_WIDTH} y1={TREND_HEIGHT - 8} y2={TREND_HEIGHT - 8} className="axis" />
      {values.map((value, index) => <rect key={series[index]!.matchId} x={x(index) - 1.2} y={y(value)} width="2.4" height={TREND_HEIGHT - 8 - y(value)} className={value > cap ? 'bar clipped' : 'bar'} />)}
      <polyline points={smooth.map((value, index) => `${x(index)},${y(value)}`).join(' ')} className="line" />
      <text x="2" y="10" className="label">{Math.round(cap)}{values.some((value) => value > cap) ? '+（极端场次已截断）' : ''}</text>
    </svg>
  );
}

function PlacementChart({ series }: { series: PerformanceAnalytics['series'] }) {
  const ranked = series.map((point, index) => ({ placement: point.placement, index })).filter((item) => item.placement !== null);
  const cap = 30;
  const x = (index: number) => (series.length < 2 ? TREND_WIDTH / 2 : (index / (series.length - 1)) * TREND_WIDTH);
  const y = (placement: number) => 8 + (Math.min(placement, cap) - 1) / (cap - 1) * (TREND_HEIGHT - 20);
  const smooth = rolling(ranked.map((item) => Math.min(item.placement!, cap)), 10);
  return (
    <svg viewBox={`0 0 ${TREND_WIDTH} ${TREND_HEIGHT}`} className="av-trend-svg" role="img" aria-label="名次走势">
      <line x1="0" x2={TREND_WIDTH} y1={y(10)} y2={y(10)} className="axis dash" />
      {ranked.map((item) => <circle key={item.index} cx={x(item.index)} cy={y(item.placement!)} r={item.placement === 1 ? 3.4 : 2.2} className={item.placement === 1 ? 'dot win' : item.placement! <= 10 ? 'dot top' : 'dot out'} />)}
      <polyline points={ranked.map((item, index) => `${x(item.index)},${y(smooth[index]!)}`).join(' ')} className="line" />
      <text x="2" y={y(10) - 3} className="label">前十线</text>
    </svg>
  );
}

function TrendPanel({ series }: { series: PerformanceAnalytics['series'] }) {
  if (series.length < 8) return null;
  const recent = series.slice(-20);
  const before = series.slice(0, -20);
  const avg = (items: PerformanceAnalytics['series']) => percentile(items.map((point) => point.damage), 0.5);
  const top10Rate = (items: PerformanceAnalytics['series']) => {
    const ranked = items.filter((point) => point.placement !== null);
    return ranked.length ? ranked.filter((point) => point.placement! <= 10).length / ranked.length : null;
  };
  const recentTop = top10Rate(recent);
  const beforeTop = top10Rate(before);
  const damageDelta = before.length ? avg(recent) / avg(before) - 1 : null;
  return (
    <Panel title={`近 ${series.length} 场走势`} hint={`${dateText(series[0]!.timestamp)} – ${dateText(series.at(-1)!.timestamp)} · 粗线为 10 场滚动均值`}>
      <div className="av-trend-summary">
        <span>近 20 场人均伤害（中位）<b>{int(avg(recent))}</b>{damageDelta !== null && <em className={damageDelta >= 0 ? 'up' : 'down'}>{damageDelta >= 0 ? '+' : ''}{(damageDelta * 100).toFixed(0)}% vs 此前</em>}</span>
        <span>近 20 场前十率 <b>{pct(recentTop)}</b>{recentTop !== null && beforeTop !== null && <em className={recentTop >= beforeTop ? 'up' : 'down'}>{recentTop >= beforeTop ? '+' : ''}{((recentTop - beforeTop) * 100).toFixed(0)}pt vs 此前</em>}</span>
      </div>
      <div className="av-trend">
        <figure><figcaption>人均伤害（每场）</figcaption><DamageChart series={series} /></figure>
        <figure><figcaption>名次（越靠上越好，绿点吃鸡）</figcaption><PlacementChart series={series} /></figure>
      </div>
    </Panel>
  );
}

function ProfilePanel({ data }: { data: PlayerProfiles }) {
  if (data.players.length < 1 || data.matches < 5) return null;
  return (
    <Panel title="队员补给与协作画像" hint={`基于 ${data.matches} 场有遥测特征的比赛 · 用药按存活分钟归一`}>
      <div className="av-table profiles">
        <div className="av-row head"><span>队员</span><span>用药/分钟</span><span>对比队友</span><span>破甲转化</span><span>误伤 造成/承受</span><span>烟闪/场</span><span>载具 km/场</span></div>
        {data.players.map((player) => {
          const use = player.healPerMinute === null || player.boostPerMinute === null ? null : player.healPerMinute + player.boostPerMinute;
          const low = player.healVsSquad !== null && player.healVsSquad < 0.5;
          return <div className="av-row" key={player.id}>
            <b>{player.name}</b>
            <span>{use === null ? '—' : use.toFixed(2)}<small>{player.matches} 场</small></span>
            <span className={low ? 'down' : ''}>{player.healVsSquad === null ? '—' : `${(player.healVsSquad * 100).toFixed(0)}%`}</span>
            <span title={`95% ${ci(player.armorBreakConversion)}`}>{pct(player.armorBreakConversion.rate)}<small>{player.armorBreaks} 次</small></span>
            <span>{int(player.friendlyDamageDealt)} / {int(player.friendlyDamageTaken)}</span>
            <span>{player.flashPerMatch === null ? '—' : player.flashPerMatch.toFixed(2)}</span>
            <span>{player.rideKmPerMatch === null ? '—' : player.rideKmPerMatch.toFixed(1)}</span>
          </div>;
        })}
      </div>
      <Notes>{data.notes.join(' ')}</Notes>
    </Panel>
  );
}

function LineupPanel({ data }: { data: PerformanceAnalytics['lineups'] }) {
  const members = data.members.filter((member) => member.withMatches >= 5 && member.withoutMatches >= 5);
  if (!data.lineups.length && !members.length) return null;
  return (
    <div className="av-two">
      <Panel title="阵容表现" hint="至少 5 场的出场组合">
        <div className="av-table lineups">
          <div className="av-row head"><span>组合</span><span>人数</span><span>场次</span><span>前十率</span><span>人均伤害</span></div>
          {data.lineups.slice(0, 8).map((lineup) => <div className="av-row" key={lineup.names.join('|')}>
            <b className="av-wrap">{lineup.names.join(' · ')}</b><span>{lineup.size}</span><span>{lineup.matches}</span>
            <span title={`95% ${ci(lineup.top10)}`}>{pct(lineup.top10.rate)} <small>{ci(lineup.top10)}</small></span><span>{int(lineup.averageDamage)}</span>
          </div>)}
        </div>
      </Panel>
      <Panel title="谁在场更好打" hint="在场 vs 缺席的前十率差（95% 区间）">
        <div className="av-table impact">
          <div className="av-row head"><span>队员</span><span>在场</span><span>缺席</span><span>前十率差</span></div>
          {members.map((member) => {
            const difference = member.difference;
            return <div className="av-row" key={member.id}>
              <b>{member.name}</b>
              <span>{pct(member.withTop10.rate)} <small>{member.withMatches} 场</small></span>
              <span>{pct(member.withoutTop10.rate)} <small>{member.withoutMatches} 场</small></span>
              <span className={difference.significant ? (difference.delta! > 0 ? 'up' : 'down') : ''}>
                {difference.delta === null ? '—' : `${difference.delta >= 0 ? '+' : ''}${(difference.delta * 100).toFixed(0)}pt`}
                <small>{difference.significant ? '显著' : '不显著'}</small>
              </span>
            </div>;
          })}
          {!members.length && <p className="av-note">没有同时满足在场与缺席各 5 场的队员。</p>}
        </div>
        <Notes>{data.notes.join(' ')}</Notes>
      </Panel>
    </div>
  );
}

export function OverviewView({ data, loading }: { data: PerformanceAnalytics | null; loading: boolean }) {
  const [showSmallMaps, setShowSmallMaps] = useState(false);
  if (!data) return <div className="av-empty">{loading ? '正在计算统计…' : '暂无统计数据。'}</div>;
  const { squad } = data;
  if (!squad.matches) return <div className="av-empty">当前小队和日期范围内没有比赛。调整左侧筛选后重试。</div>;
  const playerMatches = squad.players.reduce((sum, player) => sum + player.matches, 0);
  const weighted = (key: string) => playerMatches
    ? squad.players.reduce((sum, player) => sum + (player.metrics.find((metric) => metric.key === key)?.mean ?? 0) * player.matches, 0) / playerMatches
    : null;
  const mainMaps = data.maps.filter((map) => map.matches >= 5);
  const smallMaps = data.maps.filter((map) => map.matches < 5);
  const maxMapDamage = Math.max(1, ...data.maps.map((map) => map.averageDamage));
  const weapons = data.weapons.filter((weapon) => weapon.reliable && weapon.rawHitRate !== null).slice(0, 8);
  const maxHit = Math.max(0.01, ...weapons.map((weapon) => weapon.shrunkHitRate ?? 0));

  return (
    <div className="av-stack">
      <div className="av-kpis six">
        <Kpi label="比赛场次" value={int(squad.matches)} sub={data.scope.completeOnly ? `仅完整遥测 · ${squad.rankedMatches} 场有排名` : `${squad.rankedMatches} 场有排名 · ${data.scope.archivedMatches} 场有完整遥测`} />
        <Kpi label="吃鸡率" value={pct(squad.win.rate, 1)} sub={`${squad.win.successes}/${squad.win.trials} · 95% ${ci(squad.win)}`} />
        <Kpi label="前十率" value={pct(squad.top10.rate, 1)} sub={`${squad.top10.successes}/${squad.top10.trials} · 95% ${ci(squad.top10)}`} />
        <Kpi label="中位名次" value={squad.medianPlacement === null ? '—' : `#${squad.medianPlacement}`} sub={`名次趋势 ${TREND[squad.placementTrend]}`} tone={squad.placementTrend === 'up' ? 'good' : squad.placementTrend === 'down' ? 'warn' : undefined} />
        <Kpi label="人均伤害" value={int(weighted('damage'))} sub="每人每场平均" />
        <Kpi label="人均击杀" value={weighted('kills') === null ? '—' : weighted('kills')!.toFixed(2)} sub="每人每场平均" />
      </div>

      <HighlightsPanel items={data.highlights} />

      <TrendPanel series={data.series} />

      <Panel title="队员状态" hint="近 5 场对比此前基线（中位数 / MAD）">
        <div className="av-table players">
          <div className="av-row head"><span>队员</span><span>场次</span><span>伤害 中位→近期</span><span>击杀 中位→近期</span><span>状态</span><span>伤害占比</span></div>
          {squad.players.map((player) => {
            const damage = player.metrics.find((metric) => metric.key === 'damage')!;
            const kills = player.metrics.find((metric) => metric.key === 'kills')!;
            return <div className="av-row" key={player.id}>
              <b>{player.name}</b>
              <span>{player.matches}</span>
              <span>{int(damage.median)} → <em>{int(damage.ewma)}</em></span>
              <span>{kills.median.toFixed(1)} → <em>{kills.ewma === null ? '—' : kills.ewma.toFixed(1)}</em></span>
              <FormChip metric={damage} />
              <span className="av-share"><Bar value={player.damageShare ?? 0} max={Math.max(0.01, ...squad.players.map((item) => item.damageShare ?? 0))} />{pct(player.damageShare)}</span>
            </div>;
          })}
        </div>
      </Panel>

      <div className="av-two">
        <Panel title="地图表现" hint="前十率带 95% 区间；5 场以上才计入主表">
          <div className="av-table maps">
            <div className="av-row head"><span>地图</span><span>场次</span><span>前十率</span><span>中位名次</span><span>场均伤害</span></div>
            {mainMaps.map((map) => <div className="av-row" key={map.mapName}>
              <b>{map.label}</b><span>{map.matches}</span>
              <span title={`95% ${ci(map.top10)}`}>{pct(map.top10.rate)} <small>{ci(map.top10)}</small></span>
              <span>{map.medianPlacement === null ? '—' : `#${map.medianPlacement}`}</span>
              <span className="av-share"><Bar value={map.averageDamage} max={maxMapDamage} tone="teal" />{int(map.averageDamage)}{map.damageIndex !== null && <small className={map.damageIndex >= 1 ? 'up' : 'down'}>×{map.damageIndex.toFixed(2)}</small>}</span>
            </div>)}
            {!mainMaps.length && <p className="av-note">没有达到 5 场的地图。</p>}
          </div>
          {smallMaps.length > 0 && <button type="button" className="av-link" onClick={() => setShowSmallMaps((value) => !value)}>{showSmallMaps ? '收起' : '展开'}小样本地图与模式（{smallMaps.length}）</button>}
          {showSmallMaps && <div className="av-table maps">{smallMaps.map((map) => <div className="av-row" key={map.mapName}><b>{map.label}</b><span>{map.matches}</span><span>{pct(map.top10.rate)}</span><span>{map.medianPlacement === null ? '—' : `#${map.medianPlacement}`}</span><span>{int(map.averageDamage)}</span></div>)}</div>}
          <p className="av-note">×系数 = 该图人均伤害 ÷ 全图人均伤害，仅供参考。</p>
        </Panel>

        <Panel title="武器效率" hint="命中率向全体均值收缩，小样本不会虚高；这里是早期口径（含交战外开枪和补倒地的枪），和「打法风格」页的命中率不是同一个数">
          <div className="av-table weapons">
            <div className="av-row head"><span>武器</span><span>射击</span><span>收缩命中率</span><span>每中伤害</span><span>击杀</span></div>
            {weapons.map((weapon) => <div className="av-row" key={weapon.weapon}>
              <b>{weapon.weapon}</b><span>{int(weapon.shots)}</span>
              <span className="av-share"><Bar value={weapon.shrunkHitRate ?? 0} max={maxHit} tone="amber" />{pct(weapon.shrunkHitRate, 1)}{weapon.edge !== null && <small className={weapon.edge >= 0 ? 'up' : 'down'}>{weapon.edge >= 0 ? '+' : ''}{(weapon.edge * 100).toFixed(1)}</small>}</span>
              <span>{int(weapon.damagePerHit)}</span><span>{weapon.kills}</span>
            </div>)}
            {!weapons.length && <p className="av-note">遥测缓存中没有足够射击样本。</p>}
          </div>
        </Panel>
      </div>
      <ProfilePanel data={data.profiles} />
      <LineupPanel data={data.lineups} />
      {squad.notes.length > 0 && <Notes>{squad.notes.join(' ')}</Notes>}
    </div>
  );
}

function LandingMap({ map, selectedCell, onSelect }: { map: TelemetryAnalytics['landing']['maps'][number]; selectedCell: string; onSelect: (cell: string) => void }) {
  const size = map.sizeKm ?? 8;
  const maxShare = Math.max(0.01, ...map.cells.map((cell) => cell.share));
  const cellByLabel = new Map(map.cells.map((cell) => [cell.cell, cell]));
  const cells: ReactNode[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const label = `${String.fromCharCode(65 + col)}${row + 1}`;
      const stat = cellByLabel.get(label);
      cells.push(<g key={label} onClick={() => stat && onSelect(label)} className={`av-cell ${stat ? 'used' : ''} ${selectedCell === label ? 'selected' : ''}`}>
        <rect x={col} y={row} width={1} height={1} style={stat ? { fillOpacity: 0.12 + 0.7 * (stat.share / maxShare) } : undefined} />
        {stat && <text x={col + 0.5} y={row + 0.58} textAnchor="middle">{stat.matches}</text>}
      </g>);
    }
  }
  return (
    <svg className="av-landing-map" viewBox={`-0.5 -0.5 ${size + 1} ${size + 1}`} role="img" aria-label={`${map.label} 落点热力图`}>
      {cells}
      {map.points.map((point, index) => <circle key={index} cx={point.x / 1000} cy={point.y / 1000} r={0.07} className="av-dot" />)}
      {Array.from({ length: size }, (_, index) => <text key={`c${index}`} x={index + 0.5} y={-0.12} textAnchor="middle" className="av-axis">{String.fromCharCode(65 + index)}</text>)}
      {Array.from({ length: size }, (_, index) => <text key={`r${index}`} x={-0.15} y={index + 0.6} textAnchor="end" className="av-axis">{index + 1}</text>)}
    </svg>
  );
}

function CombatCard({ title, value, sub, detail, tone }: { title: string; value: string; sub: string; detail: string; tone?: 'good' | 'warn' | undefined }) {
  return <div className={`av-combat ${tone ?? ''}`}><span>{title}</span><b>{value}</b><small>{sub}</small><p>{detail}</p></div>;
}

function DeathPanel({ deaths }: { deaths: TelemetryAnalytics['deaths'] }) {
  if (!deaths.deaths) return null;
  const maxStage = Math.max(1, ...deaths.stages.map((stage) => stage.deaths));
  const maxWeapon = Math.max(1, ...deaths.weapons.map((weapon) => weapon.deaths));
  return (
    <Panel title="淘汰分析" hint={`${deaths.deaths} 次队员淘汰 · 阶段按淘汰时场上剩余队伍数划分`}>
      <div className="av-three">
        <div>
          <h4>淘汰阶段</h4>
          {deaths.stages.map((stage) => <div className="av-bar-row" key={stage.stage}><span>{stage.stage}</span><Bar value={stage.deaths} max={maxStage} tone="amber" /><b>{stage.deaths}</b><small>{pct(stage.share)}</small></div>)}
          <p className="av-note">开局 ≥20 队 · 中期 10–19 · 后期 5–9 · 决赛圈 ≤4。</p>
        </div>
        <div>
          <h4>被什么武器淘汰</h4>
          {deaths.weapons.map((weapon) => <div className="av-bar-row" key={weapon.weapon}><span>{weapon.weapon}</span><Bar value={weapon.deaths} max={maxWeapon} /><b>{weapon.deaths}</b></div>)}
          {deaths.unknownWeapon > 0 && <p className="av-note">{deaths.unknownWeapon} 次无武器记录（毒圈、坠落等）。</p>}
        </div>
        <div>
          <h4>倒地后被补</h4>
          <div className="av-bigstat"><b>{pct(deaths.afterKnock.rate.rate)}</b><small>{deaths.afterKnock.count}/{deaths.deaths} · 区间 {ci(deaths.afterKnock.rate)}</small></div>
          <p className="av-note">这部分淘汰发生在倒地之后，队友及时救援或封烟有机会避免。</p>
          {deaths.wipeStages.length > 0 && <>
            <h4>全队淘汰阶段</h4>
            <div className="av-chips">{deaths.wipeStages.map((stage) => <span className="av-chip" key={stage.stage}>{stage.stage} × {stage.wipes}</span>)}</div>
          </>}
        </div>
      </div>
    </Panel>
  );
}

const regionName = (region: string | null): string => (region ? region.charAt(0).toUpperCase() + region.slice(1) : '');

function FightPanel({ data }: { data: TelemetryAnalytics['fights'] }) {
  if (data.fights < 20) return null;
  const groups: Array<[string, FightBucket[]]> = [['谁先开火', data.byInitiator], ['交战阶段（剩余队伍数）', data.byStage], ['有无第三方', data.byThirdParty], ['持续时间', data.byDuration]];
  return (
    <Panel title="交战环境与胜率" hint={`${data.fights} 场分出倒地的交战 · 胜 ${data.overall.wins} / 负 ${data.overall.losses} / 平 ${data.overall.draws}`}>
      <div className="av-fight-groups">
        {groups.map(([title, buckets]) => <div key={title}>
          <h4>{title}</h4>
          {buckets.filter((bucket) => bucket.wins + bucket.losses > 0).map((bucket) => <div className="av-bar-row wide" key={bucket.key} title={`95% ${ci(bucket.winRate)}`}>
            <span>{bucket.label}</span><Bar value={bucket.winRate.rate ?? 0} max={1} tone={(bucket.winRate.rate ?? 0) >= 0.5 ? 'mint' : 'amber'} /><b>{pct(bucket.winRate.rate)}</b><small>{bucket.wins}胜 {bucket.losses}负 {bucket.draws}平</small>
          </div>)}
        </div>)}
      </div>
      <Notes>{data.notes.join(' ')}</Notes>
    </Panel>
  );
}

function DistancePanel({ data }: { data: TelemetryAnalytics['distance'] }) {
  if (data.totalDealt < 600) return null;
  const maxShare = Math.max(0.01, ...data.bands.flatMap((band) => [band.dealtShare ?? 0, band.takenShare ?? 0]));
  return (
    <Panel title="交战距离画像" hint={`枪械伤害：打出 ${int(data.totalDealt)} · 承受 ${int(data.totalTaken)}`}>
      <div className="av-two even">
        <div>
          <h4>在多远打出 / 承受伤害</h4>
          <div className="av-table distance">
            <div className="av-row head"><span>距离</span><span>打出</span><span>承受</span><span>爆头占比</span></div>
            {data.bands.map((band) => <div className="av-row" key={band.id}>
              <b>{band.label}</b>
              <span className="av-share"><Bar value={band.dealtShare ?? 0} max={maxShare} />{pct(band.dealtShare)}</span>
              <span className="av-share"><Bar value={band.takenShare ?? 0} max={maxShare} tone="amber" />{pct(band.takenShare)}</span>
              <span>{pct(band.headshotShare)}</span>
            </div>)}
          </div>
          <p className="av-note">{data.longRangeGap === null ? '远距离输出与承伤没有明显差距。' : data.longRangeGap > 0.05 ? `承受的 ≥75m 伤害比打出的多 ${(data.longRangeGap * 100).toFixed(0)}pt。` : data.longRangeGap < -0.05 ? `打出的 ≥75m 伤害比承受的多 ${(-data.longRangeGap * 100).toFixed(0)}pt。` : '远距离输出与承伤基本持平。'}</p>
        </div>
        <div>
          <h4>各武器的主战距离</h4>
          <div className="av-weapon-dist">
            {data.weapons.map((weapon) => <div className="av-weapon-row" key={weapon.weapon}>
              <b>{weapon.weapon}</b>
              <i className="av-stack-bar">{weapon.shares.map((share, index) => <u key={index} className={`band${index}`} style={{ width: `${share * 100}%` }} title={`${data.bands[index]!.label} ${pct(share)}`} />)}</i>
              <small>{weapon.mainBand.split(' ')[0]} · {int(weapon.damage)}</small>
            </div>)}
          </div>
          <div className="av-legend">{data.bands.map((band, index) => <span key={band.id}><i className={`band${index}`} />{band.label}</span>)}</div>
        </div>
      </div>
    </Panel>
  );
}

const CAUSE_COLOR: Record<string, string> = { ambush_far: '#eeb96a', ambush_close: '#d98a3d', crossfire: '#d9a8f0', isolated: '#f0a0a0', lost_duel: '#69d9c3', bluezone: '#8fb8ff', environment: '#6f8581' };
const STAGE_NAME = { early: '前期 1–2 圈', mid: '中期 3–4 圈', late: '后期 5 圈起' } as const;

function DownCausePanel({ data, names }: { data: DownSummaryData; names: Map<string, string> }) {
  if (data.downs < 10) return null;
  const maxCount = Math.max(1, ...data.byCause.map((entry) => entry.count));
  return (
    <Panel title="倒地原因" hint={`${data.matches} 场遥测里小队共 ${data.downs} 次被击倒；原因看倒地前 20 秒谁打了谁、身边有没有队友`}>
      <div className="av-kpis">
        <Kpi label="倒地前没还手" value={pct(data.noReturnFire.rate)} sub={`被玩家击倒的 ${data.noReturnFire.trials} 次里 · 95% ${ci(data.noReturnFire)}`} tone="warn" />
        <Kpi label="倒地后被救起" value={pct(data.revived.rate)} sub={`${data.revived.successes}/${data.revived.trials} 次有结果的倒地`} tone={(data.revived.rate ?? 0) >= 0.4 ? 'good' : 'warn'} />
        <Kpi label="倒地时身边没队友" value={pct(data.alone.rate)} sub={`150 米内无人 · ${data.alone.successes}/${data.alone.trials}`} />
        <Kpi label="场均倒地" value={data.matches ? (data.downs / data.matches).toFixed(1) : '—'} sub="每场全队倒地次数" />
      </div>
      {data.insights.length > 0 && <ul className="av-verdicts">{data.insights.map((line) => <li key={line}><b>发现</b><span>{line}</span></li>)}</ul>}
      <div className="cp-causes">
        {data.byCause.map((entry) => <div className="cause-row" key={entry.cause} title={entry.advice}>
          <b><i style={{ background: CAUSE_COLOR[entry.cause] ?? '#6f8581' }} />{entry.label}</b>
          <span className="bar"><u style={{ width: `${(entry.count / maxCount) * 100}%`, background: CAUSE_COLOR[entry.cause] ?? '#6f8581' }} /></span>
          <em>{entry.count} 次 · {pct(entry.share)}</em>
          <small>其中被淘汰 {entry.died}</small>
        </div>)}
      </div>
      <div className="av-two even">
        <div>
          <h4>每个人的倒地构成</h4>
          {data.byMember.map((member) => <div className="cp-member" key={member.member}>
            <b>{(names.get(member.member) ?? '队员').replace(/^SG_LabmemNo/u, 'No.')}</b>
            <span className="stack">{member.causes.map((entry) => <u key={entry.cause} title={`${data.byCause.find((item) => item.cause === entry.cause)?.label ?? entry.cause} ${entry.count}`} style={{ flex: entry.count, background: CAUSE_COLOR[entry.cause] ?? '#6f8581' }} />)}</span>
            <small>{member.downs} 次</small>
          </div>)}
        </div>
        <div>
          <h4>哪个阶段最容易被先手打倒</h4>
          {data.byStage.map((entry) => <div className="cp-member" key={entry.stage}>
            <b>{STAGE_NAME[entry.stage]}</b>
            <span className="stack"><u style={{ flex: entry.noReturnFire, background: '#eeb96a' }} /><u style={{ flex: Math.max(0, entry.downs - entry.noReturnFire), background: '#2c4141' }} /></span>
            <small>{entry.downs ? `${Math.round((entry.noReturnFire / entry.downs) * 100)}% 没还手` : '—'}（{entry.downs} 次）</small>
          </div>)}
        </div>
      </div>
      <Notes>倒地原因按优先级判定：不是玩家造成的（毒圈、坠落等）→ 环境 / 毒圈；20 秒内被两支以上队伍打到 → 多队混战；对攻击者所在队伍没有任何输出：150 米以外为远程先手，其余为近距离偷袭；有还手但 150 米内没有队友 → 落单；其余算正面交战落败。「倒地前没还手」只统计被玩家击倒的次数。鼠标悬停在原因上有对应的改进建议。</Notes>
    </Panel>
  );
}

function RotationPanel({ data }: { data: RotationSummaryData }) {
  if (data.matches < 10) return null;
  const maxLate = 1;
  return (
    <Panel title="转圈与进圈" hint={`${data.matches} 场遥测；白圈 = 下一个安全区，这里看小队有没有在毒圈开始收缩前走进去`}>
      <div className="av-kpis">
        <Kpi label="第 3 圈起转晚的圈" value={pct(data.lateEntry.rate)} sub={`毒圈开始收缩时还没进白圈 · ${data.lateEntry.successes}/${data.lateEntry.trials} · 95% ${ci(data.lateEntry)}`} tone={(data.lateEntry.rate ?? 0) >= 0.4 ? 'warn' : undefined} />
        <Kpi label="平均提前量" value={data.averageMargin === null ? '—' : `${data.averageMargin >= 0 ? '+' : ''}${Math.round(data.averageMargin)} 秒`} sub="第 3 圈起，进圈比毒圈收缩早多少" tone={(data.averageMargin ?? 0) >= 15 ? 'good' : 'warn'} />
        <Kpi label="吃到毒的对局" value={pct(data.bluePenaltyRate.rate)} sub={`场均 ${data.averageBlueDamage === null ? '—' : Math.round(data.averageBlueDamage)} 点毒伤 · ${data.averageBlueSeconds === null ? '—' : Math.round(data.averageBlueSeconds)} 秒在毒里`} />
        <Kpi label="场均路程" value={data.averageDistanceKm === null ? '—' : `${data.averageDistanceKm.toFixed(1)} km`} sub={`载具占 ${pct(data.vehicleShare)}`} />
        <Kpi label="落地到首战" value={data.averageLandingToFight === null ? '—' : clockText(data.averageLandingToFight)} sub="平均多久打响第一场交战" />
      </div>
      {data.insights.length > 0 && <ul className="av-verdicts">{data.insights.map((line) => <li key={line}><b>发现</b><span>{line}</span></li>)}</ul>}
      <div className="av-table rotation">
        <div className="av-row head"><span>圈</span><span>样本</span><span>转晚的比例</span><span>中位进圈用时</span><span>平均提前量</span><span>刷新时离白圈</span><span>平均路程</span></div>
        {data.byPhase.filter((entry) => entry.circles >= 5).map((entry) => <div className="av-row" key={entry.phase}>
          <b>第 {entry.phase} 圈</b>
          <span>{entry.circles}</span>
          <span className="late"><i style={{ width: `${Math.min(100, ((entry.lateRate ?? 0) / maxLate) * 100)}%` }} /><em>{pct(entry.lateRate)}</em></span>
          <span>{entry.medianEnter === null ? '—' : `${Math.round(entry.medianEnter)} 秒`}</span>
          <span className={(entry.averageMargin ?? 0) >= 0 ? 'up' : 'down'}>{entry.averageMargin === null ? '—' : `${entry.averageMargin >= 0 ? '+' : ''}${Math.round(entry.averageMargin)} 秒`}</span>
          <span>{entry.averageOutside === null ? '—' : `${Math.round(entry.averageOutside)} 米`}</span>
          <span>{entry.averageDistance === null ? '—' : entry.averageDistance >= 1000 ? `${(entry.averageDistance / 1000).toFixed(1)} km` : `${Math.round(entry.averageDistance)} m`}</span>
        </div>)}
      </div>
      <Notes>遥测里 poisonGasWarning 是下一个安全区（游戏里的白圈，整个阶段固定），safetyZone 是正在向它收缩的毒圈边界（蓝圈）。「转晚」= 小队中心在蓝圈开始收缩时还没走进白圈（或始终没进去）；提前量 = 蓝圈开始收缩的时间减去进圈时间，负数表示被毒圈追上。只统计小队还活着的阶段，所以活得越久、经过的圈越多，吃到的毒也越多——这里不拿毒伤和名次做对比，那会因为存活时间不同而得出相反的结论。</Notes>
    </Panel>
  );
}

function clockText(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function ZonePanel({ data }: { data: TelemetryAnalytics['zone'] }) {
  const phases = data.phases.filter((phase) => phase.samples >= 40);
  if (!phases.length) return null;
  const maxOutside = Math.max(0.05, ...phases.map((phase) => phase.outsideRate.rate ?? 0));
  return (
    <Panel title="圈位压力" hint={`${data.matches} 场 · 每场吃毒 ${int(data.blueDamagePerMatch)} · 毒伤占承伤 ${pct(data.blueDamageShare)}`}>
      <div className="av-table zone">
        <div className="av-row head"><span>圈数</span><span>样本</span><span>在毒圈里的时间</span><span>相对安全区中心的位置</span><span>毒伤</span></div>
        {phases.map((phase) => <div className="av-row" key={phase.phase}>
          <b>第 {phase.phase} 圈</b><span>{int(phase.samples)}</span>
          <span className="av-share" title={`95% ${ci(phase.outsideRate)}`}><Bar value={phase.outsideRate.rate ?? 0} max={maxOutside} tone="amber" />{pct(phase.outsideRate.rate, 1)}</span>
          <span>{phase.binShares ? <i className="av-stack-bar">{phase.binShares.map((share, index) => <u key={index} className={`zone${index}`} style={{ width: `${share * 100}%` }} title={`${['圈中心 <50%', '中间 50–85%', '圈边 85–100%', '圈外'][index]} ${pct(share)}`} />)}</i> : '—'}</span>
          <span>{int(phase.blueDamage)}</span>
        </div>)}
      </div>
      <div className="av-legend"><span><i className="zone0" />圈中心</span><span><i className="zone1" />中间</span><span><i className="zone2" />圈边</span><span><i className="zone3" />圈外</span></div>
      <Notes>圈数 = 遥测里 isGame 的整数部分。位置样本按小队成员每约 10 秒一次；「圈外」指离安全区中心超过其半径。</Notes>
    </Panel>
  );
}

function RolePanel({ roles }: { roles: TelemetryAnalytics['roles'] }) {
  if (roles.length < 2 || roles.every((role) => role.fights < 20)) return null;
  return (
    <Panel title="队内分工" hint="按交战事件统计；占比 ≥ 40% 才授予称号">
      <div className="av-table roles">
        <div className="av-row head"><span>队员</span><span>参与交战</span><span>先手击倒</span><span>最先被倒</span><span>救援</span><span>人头</span><span>称号</span></div>
        {roles.map((role) => <div className="av-row" key={role.accountId}>
          <b>{role.name}</b><span>{role.fights}</span>
          <span>{role.counts.firstKnocks}<small>{pct(role.firstKnockShare)}</small></span>
          <span>{role.counts.firstDowned}<small>{pct(role.firstDownedShare)}</small></span>
          <span>{role.counts.revives}<small>{pct(role.reviveShare)}</small></span>
          <span>{role.counts.kills}<small>{pct(role.killShare)}</small></span>
          <span className="av-chips">{role.titles.length ? role.titles.map((title) => <span className="av-chip form-hot" key={title}>{title}</span>) : <span className="av-note">—</span>}</span>
        </div>)}
      </div>
    </Panel>
  );
}

function ContestPanel({ contest }: { contest: TelemetryAnalytics['landing']['contest'] }) {
  if (contest.matches < 16) return null;
  return (
    <div className="av-contest">
      <h4>落点被争抢的代价（500m 内有其他队降落）</h4>
      <div className="av-table contest">
        <div className="av-row head"><span>情况</span><span>场次</span><span>早崩率</span><span>前十率</span><span>中位名次</span></div>
        {contest.buckets.map((bucket) => <div className="av-row" key={bucket.key}>
          <b>{bucket.label}</b><span>{bucket.matches}</span>
          <span title={`95% ${ci(bucket.earlyWipe)}`}>{pct(bucket.earlyWipe.rate)}</span>
          <span title={`95% ${ci(bucket.top10)}`}>{pct(bucket.top10.rate)}</span>
          <span>{bucket.medianPlacement === null ? '—' : `#${bucket.medianPlacement}`}</span>
        </div>)}
      </div>
      {contest.earlyWipeEdge.delta !== null && <p className="av-note">有争抢相对无争抢：早崩率 {contest.earlyWipeEdge.delta >= 0 ? '+' : ''}{(contest.earlyWipeEdge.delta * 100).toFixed(0)}pt{contest.earlyWipeEdge.significant ? '（显著）' : '（不显著）'}；前十率 {contest.top10Edge.delta === null ? '—' : `${contest.top10Edge.delta >= 0 ? '+' : ''}${(contest.top10Edge.delta * 100).toFixed(0)}pt${contest.top10Edge.significant ? '（显著）' : '（不显著）'}`}。</p>}
    </div>
  );
}

const CLASS_LABEL: Record<string, string> = { AR: '突击步枪', SMG: '冲锋枪', DMR: '射手步枪', SR: '狙击枪', LMG: '机枪', SG: '霰弹枪', Pistol: '手枪', other: '其他' };
const GROUPS = ['战斗效率', '射击', '节奏', '协作与补给', '位置与风险'];
/** Axes drawn on each player's radar: three or four from every group, ratio to teammates. */
const RADAR_KEYS = ['combat', 'hitRate', 'conversion', 'range', 'farShare', 'precision', 'tempo', 'initiative', 'revive', 'supplies', 'isolation', 'risk'];
/** log2(1.5): the teammate ratio that reaches the outer ring (and its inverse reaches the centre). */
const RADAR_LOG_SPAN = Math.log2(1.5);
const TIER_MARK: Record<StyleTier, string> = { stable: '●', lean: '◐', even: '', unknown: '' };
const TIER_TEXT: Record<StyleTier, string> = { stable: '稳定', lean: '倾向', even: '持平', unknown: '样本不足' };

function ratioText(reading: StyleAxisReading): string {
  return reading.ratio === null ? '—' : `×${reading.ratio.toFixed(2)}`;
}

function cellColor(reading: StyleAxisReading): string | undefined {
  if (reading.ratio === null || reading.tier === 'unknown') return undefined;
  const strength = Math.min(1, Math.abs(Math.log2(reading.ratio)) / 0.8);
  const alpha = (reading.tier === 'stable' ? 0.15 + 0.5 * strength : reading.tier === 'lean' ? 0.08 + 0.3 * strength : 0.03 + 0.08 * strength).toFixed(2);
  return reading.ratio >= 1 ? `rgba(184,242,119,${alpha})` : `rgba(238,185,106,${alpha})`;
}

function axisTitle(reading: StyleAxisReading): string {
  const range = reading.low !== null && reading.high !== null ? `，95% 区间 ${reading.low.toFixed(2)}–${reading.high.toFixed(2)}` : '';
  const confidence = reading.confidence !== null ? `，方向把握 ${(reading.confidence * 100).toFixed(0)}%` : '';
  return `${reading.label}：个人 ${reading.value === null ? '—' : formatAxis(reading.key, reading.value)}，队友 ${reading.matesValue === null ? '—' : formatAxis(reading.key, reading.matesValue)}${range}${confidence}（${TIER_TEXT[reading.tier]}）`;
}

function archetypeLabel(entry: SquadStyle['players'][number]['archetypes'][number]): string {
  return entry.tier === 'slight' ? `偏${entry.label}` : entry.tier === 'lean' ? `${entry.label}（倾向）` : entry.label;
}

function Radar({ axes }: { axes: StyleAxisReading[] }) {
  const size = 240;
  const center = size / 2;
  const radius = 82;
  const ordered = RADAR_KEYS.map((key) => axes.find((axis) => axis.key === key)).filter((axis): axis is StyleAxisReading => axis !== undefined);
  const angle = (index: number) => -Math.PI / 2 + (index / ordered.length) * Math.PI * 2;
  const scale = (ratio: number | null) => Math.max(0, Math.min(1, 0.5 + 0.5 * Math.log2(ratio ?? 1) / RADAR_LOG_SPAN));
  const at = (index: number, fraction: number) => [center + Math.cos(angle(index)) * radius * fraction, center + Math.sin(angle(index)) * radius * fraction] as const;
  const polygon = ordered.map((axis, index) => at(index, axis.ratio === null ? 0.5 : scale(axis.ratio)).join(',')).join(' ');
  return (
    <svg viewBox={`-60 -8 ${size + 120} ${size + 16}`} className="av-radar" role="img" aria-label="打法雷达图">
      {[0.5, 1].map((ring) => <polygon key={ring} points={ordered.map((_, index) => at(index, ring).join(',')).join(' ')} className={ring === 0.5 ? 'ring avg' : 'ring'} />)}
      {ordered.map((_, index) => { const [x, y] = at(index, 1); return <line key={index} x1={center} y1={center} x2={x} y2={y} className="spoke" />; })}
      <polygon points={polygon} className="shape" />
      {ordered.map((axis, index) => { const [x, y] = at(index, axis.ratio === null ? 0.5 : scale(axis.ratio)); return <circle key={axis.key} cx={x} cy={y} r={3.2} className={`dot ${axis.tier}`}><title>{axisTitle(axis)}</title></circle>; })}
      {ordered.map((axis, index) => { const [x, y] = at(index, 1.17); return <text key={axis.key} x={x} y={y} textAnchor={x < center - 6 ? 'end' : x > center + 6 ? 'start' : 'middle'} dominantBaseline="middle" className={`label ${axis.tier === 'stable' || axis.tier === 'lean' ? axis.direction ?? '' : ''}`}>{axis.label}</text>; })}
    </svg>
  );
}

function LongRunBoard({ data }: { data: LongRunCombat }) {
  const maxRatio = Math.max(1.5, ...data.entries.map((entry) => entry.composite.ratio ?? 0));
  return (
    <div>
      <h4>长期战绩（{data.matches} 场 · 比队友公平份额多拿多少）</h4>
      <p className="av-verdict small">{data.verdict}</p>
      {data.entries.map((entry) => <div className="av-combat-row" key={entry.accountId}>
        <span className="rank">{entry.rank}</span>
        <b>{entry.name}</b>
        <span className="av-bar-wrap"><Bar value={entry.composite.ratio ?? 0} max={maxRatio} tone={(entry.composite.ratio ?? 0) >= 1 ? 'mint' : 'amber'} /></span>
        <span className={`ratio ${entry.composite.tier === 'stable' || entry.composite.tier === 'lean' ? ((entry.composite.ratio ?? 1) >= 1 ? 'up' : 'down') : ''}`}>{entry.composite.ratio === null ? '—' : `×${entry.composite.ratio.toFixed(2)}`}</span>
        <small>{entry.composite.tier === 'stable' ? '稳定' : entry.composite.tier === 'lean' ? `倾向 ${entry.composite.confidence === null ? '' : `${(entry.composite.confidence * 100).toFixed(0)}%`}` : '接近公平份额'}{entry.composite.low !== null && entry.composite.high !== null ? ` · ${entry.composite.low.toFixed(2)}–${entry.composite.high.toFixed(2)}` : ''}</small>
      </div>)}
      <div className="av-table longrun">
        <div className="av-row head"><span>队员</span>{data.entries[0]?.metrics.map((metric) => <span key={metric.key}>{metric.label}</span>)}</div>
        {data.entries.map((entry) => <div className="av-row" key={entry.accountId}>
          <b>{entry.name}</b>
          {entry.metrics.map((metric) => <span key={metric.key} className={metric.tier === 'stable' || metric.tier === 'lean' ? (metric.direction === 'high' ? 'up' : 'down') : ''}>{metric.ratio === null ? '—' : `×${metric.ratio.toFixed(2)}`}{metric.tier === 'stable' ? ' ●' : metric.tier === 'lean' ? ' ◐' : ''}</span>)}
        </div>)}
      </div>
      <Notes>{data.notes.join(' ')}</Notes>
    </div>
  );
}

function LobbyBoard({ data }: { data: LobbyCombat }) {
  return (
    <div>
      <h4>相对全场玩家（{data.matches} 场遥测 · 全场约 {data.lobbySize === null ? '—' : Math.round(data.lobbySize)} 人）</h4>
      <p className="av-verdict small">{data.verdict}</p>
      {data.entries.map((entry) => <div className="av-combat-row" key={entry.accountId}>
        <span className="rank">{entry.rank}</span>
        <b>{entry.name}</b>
        <span className="av-bar-wrap"><Bar value={entry.composite.mean ?? 0} max={1} tone={(entry.composite.mean ?? 0) >= 0.5 ? 'mint' : 'amber'} /></span>
        <span className={`ratio ${entry.tier === 'above' ? 'up' : entry.tier === 'below' ? 'down' : ''}`}>{entry.composite.mean === null ? '—' : `${(entry.composite.mean * 100).toFixed(0)} 分位`}</span>
        <small>{entry.tier === 'above' ? '明显高于全场中位' : entry.tier === 'below' ? '明显低于全场中位' : '接近全场中位'}{entry.composite.low !== null && entry.composite.high !== null ? ` · ${(entry.composite.low * 100).toFixed(0)}–${(entry.composite.high * 100).toFixed(0)}` : ''}</small>
      </div>)}
      <div className="av-table longrun">
        <div className="av-row head"><span>队员</span><span>伤害分位</span><span>击倒分位</span><span>中位 每分钟伤害</span><span>场次</span></div>
        {data.entries.map((entry) => <div className="av-row" key={entry.accountId}>
          <b>{entry.name}</b>
          <span>{entry.damage.mean === null ? '—' : `${(entry.damage.mean * 100).toFixed(0)}`}</span>
          <span>{entry.knocks.mean === null ? '—' : `${(entry.knocks.mean * 100).toFixed(0)}`}</span>
          <span>{entry.medianDamagePerMinute === null ? '—' : entry.medianDamagePerMinute.toFixed(0)}</span>
          <span>{entry.matches}</span>
        </div>)}
      </div>
      <Notes>{data.notes.join(' ')}</Notes>
    </div>
  );
}

const STAGE_TEXT = { early: '前期 1–2 圈', mid: '中期 3–4 圈', late: '后期 5 圈起' } as const;

function StreakPanel({ data }: { data: StreakSummary }) {
  if (!data.matches) return null;
  const { wipes } = data;
  const maxMulti = Math.max(1, ...data.players.map((player) => player.multiPerTen ?? 0));
  const wipeLead = new Map(wipes.leaders.map((entry) => [entry.accountId, entry]));
  return (
    <Panel title="连杀与灭队" hint={`${data.matches} 场遥测；连杀 = 同一人 60 秒节奏内放倒多名不同敌人，灭队 = 敌队最后一波全部由本队放倒`}>
      <div className="av-kpis six">
        <Kpi label="灭队次数" value={int(wipes.total)} sub={wipes.perMatch === null ? undefined : `平均每场 ${wipes.perMatch.toFixed(2)} 次`} />
        <Kpi label="有灭队的比赛" value={pct(wipes.matchShare?.rate ?? null)} sub={wipes.matchShare ? `95% ${ci(wipes.matchShare)}` : undefined} />
        <Kpi label="满编灭队" value={int(wipes.fullTeam)} sub="一波放倒 4 人" />
        <Kpi label="单人灭队" value={int(wipes.solo)} sub="一人放倒这一波全部敌人" tone={wipes.solo ? 'good' : undefined} />
        <Kpi label="灭队用时" value={seconds(wipes.medianSeconds)} sub="首个到最后一个放倒，中位数" />
        <Kpi label="被同一队灭" value={pct(data.wiped.singleTeam?.rate ?? null)} sub={data.wiped.observed ? `${data.wiped.observed} 次被淘汰 · 其中被单人灭 ${data.wiped.singlePlayer} 次` : '样本不足'} tone="warn" />
      </div>
      {data.highlights.length > 0 && <ul className="av-verdicts">{data.highlights.map((line) => <li key={line}><b>要点</b><span>{line}</span></li>)}</ul>}
      <div className="av-streak-grid">
        <div>
          <h4>连杀（每 10 场）</h4>
          {data.players.map((player) => <div className="av-combat-row" key={player.accountId}>
            <span className="rank">{player.longest}</span>
            <b>{player.name}</b>
            <span className="av-bar-wrap"><i className="av-stack-bar" style={{ width: `${Math.max(2, ((player.multiPerTen ?? 0) / maxMulti) * 100)}%` }} title={`双杀 ${player.two} · 三杀 ${player.three} · 四杀+ ${player.fourPlus}`}>
              {([['two', player.two], ['three', player.three], ['four', player.fourPlus]] as const).map(([kind, count]) => count > 0 && <u key={kind} className={kind} style={{ flex: count }} />)}
            </i></span>
            <span className="ratio">{player.multiPerTen === null ? '—' : player.multiPerTen.toFixed(1)}</span>
            <small>双杀 {player.two} · 三杀 {player.three} · 四杀+ {player.fourPlus}</small>
          </div>)}
          <div className="av-legend small"><span className="two">双杀</span><span className="three">三杀</span><span className="four">四杀+</span><span>左侧数字 = 最长连杀</span></div>
        </div>
        <div>
          <h4>灭队构成</h4>
          <div className="av-table streak">
            <div className="av-row head"><span>一波放倒</span><span>次数</span></div>
            {wipes.bySize.map((entry) => <div className="av-row" key={entry.wiped}><b>{entry.wiped === 4 ? '4 人（满编）' : `${entry.wiped} 人`}</b><span>{entry.count}</span></div>)}
            {wipes.byStage.map((entry) => <div className="av-row" key={entry.stage}><b>{STAGE_TEXT[entry.stage]}</b><span>{entry.count}</span></div>)}
          </div>
        </div>
      </div>
      <div className="av-table longrun">
        <div className="av-row head"><span>队员</span><span>放倒</span><span>连杀占比</span><span>灭队中放倒</span><span>主导 / 单人灭队</span></div>
        {data.players.map((player) => <div className="av-row" key={player.accountId}>
          <b>{player.name}</b>
          <span>{player.takedowns}</span>
          <span title={player.chainedShare ? `95% ${ci(player.chainedShare)}` : undefined}>{pct(player.chainedShare?.rate ?? null)}</span>
          <span>{player.wipeTakedowns}</span>
          <span>{wipeLead.get(player.accountId)?.led ?? 0} / {player.soloWipes}</span>
        </div>)}
      </div>
      <Notes>{data.notes.join(' ')}</Notes>
    </Panel>
  );
}

/** "高 84%" / "低 26%" instead of a raw ratio, so a cell reads as a sentence. */
function differenceText(reading: StyleAxisReading): string {
  if (reading.ratio === null) return '—';
  if (reading.tier !== 'stable' && reading.tier !== 'lean') return '≈ 持平';
  const percent = Math.round(Math.abs(reading.ratio - 1) * 100);
  return reading.ratio >= 1 ? `高 ${percent}%` : `低 ${percent}%`;
}

function StyleMatrix({ style }: { style: SquadStyle }) {
  const [showAll, setShowAll] = useState(false);
  const readings = (key: string) => style.players.map((player) => player.axes.find((axis) => axis.key === key)!);
  const keys = style.players[0]!.axes.map((axis) => ({ key: axis.key, label: axis.label, group: axis.group }));
  const notable = (key: string) => readings(key).some((reading) => reading.tier === 'stable' || reading.tier === 'lean');
  const visible = keys.filter((item) => showAll || notable(item.key));
  const hidden = keys.length - keys.filter((item) => notable(item.key)).length;
  return (
    <Panel title="风格对比矩阵" hint="每格 = 这个人比另外三名队友高或低多少">
      <div className="av-matrix-legend">
        <span className="up">高 84%<small>明显比队友高</small></span>
        <span className="down">低 26%<small>明显比队友低</small></span>
        <span className="even">≈ 持平<small>差不多，或差距可能只是运气</small></span>
        <span className="mark">● 可靠　◐ 大概率</span>
        <span className="hint">格子下方小字 = 这个人的实际数值；悬停看队友数值和区间</span>
      </div>
      <div className="av-matrix" style={{ gridTemplateColumns: `minmax(150px,1.4fr) repeat(${style.players.length}, minmax(96px,1fr))` }}>
        <span className="head" />
        {style.players.map((player, index) => <span className={`head ${PLAYER_TONES[index % 4]}`} key={player.accountId} title={player.name}>{player.name.replace(/^SG_LabmemNo/u, 'No.')}</span>)}
        {GROUPS.map((group) => {
          const rows = visible.filter((item) => item.group === group);
          if (!rows.length) return null;
          return <div className="av-matrix-group" key={group} style={{ display: 'contents' }}>
            <span className="group" style={{ gridColumn: `1 / span ${style.players.length + 1}` }}>{group}</span>
            {rows.map((item) => <div key={item.key} style={{ display: 'contents' }}>
              <span className="axis">{item.label}</span>
              {readings(item.key).map((reading, index) => {
                const tone = reading.tier === 'stable' || reading.tier === 'lean' ? (reading.ratio !== null && reading.ratio >= 1 ? 'up' : 'down') : 'even';
                return <span key={style.players[index]!.accountId} className={`cell ${reading.tier} ${tone}`} style={{ background: cellColor(reading) }} title={axisTitle(reading)}>
                  <span className="main">{tone === 'up' ? '▲ ' : tone === 'down' ? '▼ ' : ''}{differenceText(reading)}<i>{TIER_MARK[reading.tier]}</i></span>
                  <small>{reading.value === null ? '' : formatAxis(reading.key, reading.value)}</small>
                </span>;
              })}
            </div>)}
          </div>;
        })}
      </div>
      {hidden > 0 && <button type="button" className="av-link av-matrix-toggle" onClick={() => setShowAll((value) => !value)}>
        {showAll ? '只看有明显差异的维度' : `显示全部 ${keys.length} 个维度（另有 ${hidden} 个维度四人都差不多）`}
      </button>}
    </Panel>
  );
}

const PLAYER_TONES = ['p0', 'p1', 'p2', 'p3'] as const;

function tierWord(tier: StyleTier, confidence: number | null): string {
  return tier === 'stable' ? '稳定' : tier === 'lean' ? `倾向${confidence === null ? '' : ` ${(confidence * 100).toFixed(0)}%`}` : '差距不显著';
}

/** Log-scale position of a ratio on a 0.5–2 axis, 0..1. */
function ratioPos(ratio: number): number {
  return Math.max(0, Math.min(1, (Math.log2(ratio) + 1) / 2));
}

/** A ratio as a bar growing left (below 1) or right (above 1) from the centre line. */
function DivergingBar({ ratio, tier }: { ratio: number | null; tier: StyleTier }) {
  if (ratio === null) return <span className="av-div-bar" />;
  const pos = ratioPos(ratio);
  const left = Math.min(pos, 0.5);
  const width = Math.abs(pos - 0.5);
  return <span className="av-div-bar"><i className={`${ratio >= 1 ? 'up' : 'down'} ${tier}`} style={{ left: `${left * 100}%`, width: `${Math.max(1.5, width * 100)}%` }} /></span>;
}

function RosterStrip({ style }: { style: SquadStyle }) {
  const order = style.combat.map((entry) => entry.accountId);
  const players = [...style.players].sort((left, right) => order.indexOf(left.accountId) - order.indexOf(right.accountId));
  return (
    <div className="av-roster">
      {players.map((player) => {
        const combat = style.combat.find((entry) => entry.accountId === player.accountId);
        const toneIndex = style.players.findIndex((item) => item.accountId === player.accountId);
        const lead = player.archetypes[0];
        return <article className={`av-roster-card ${PLAYER_TONES[toneIndex % 4]}`} key={player.accountId}>
          <header>
            <span className="avatar">{player.name.replace(/^SG_LabmemNo/u, '').slice(0, 3)}</span>
            <div><b>{player.name}</b>{lead && <small>{archetypeLabel(lead)}</small>}</div>
            {combat && <span className="rank">#{combat.rank}</span>}
          </header>
          {combat && <div className="power">
            <span className={`value ${combat.tier === 'stable' || combat.tier === 'lean' ? ((combat.ratio ?? 1) >= 1 ? 'up' : 'down') : ''}`}>{combat.ratio === null ? '—' : `×${combat.ratio.toFixed(2)}`}</span>
            <span className="caption">战斗力 · {tierWord(combat.tier, combat.confidence)}</span>
            <div className="av-forest mini">
              <i className="one" />
              {combat.low !== null && combat.high !== null && <u style={{ left: `${ratioPos(combat.low) * 100}%`, width: `${(ratioPos(combat.high) - ratioPos(combat.low)) * 100}%` }} />}
              {combat.ratio !== null && <b style={{ left: `${ratioPos(combat.ratio) * 100}%` }} />}
            </div>
          </div>}
          <ul>
            {player.traits.slice(0, 3).map((trait) => <li key={trait.key}>
              <span>{trait.text}</span>
              <em className={trait.ratio >= 1 ? 'up' : 'down'}>×{trait.ratio.toFixed(2)}</em>
            </li>)}
            {!player.traits.length && <li><span>和队友没有明显差别</span></li>}
          </ul>
        </article>;
      })}
    </div>
  );
}

function ForestRow({ name, rank, ratio, low, high, tier, confidence }: { name: string; rank: number; ratio: number | null; low: number | null; high: number | null; tier: StyleTier; confidence: number | null }) {
  const tone = tier === 'stable' || tier === 'lean' ? ((ratio ?? 1) >= 1 ? 'up' : 'down') : 'even';
  return (
    <div className="av-forest-row">
      <span className="rank">{rank}</span>
      <b title={name}>{name.replace(/^SG_LabmemNo/u, 'No.')}</b>
      <div className="av-forest">
        <i className="one" />
        {low !== null && high !== null && <u className={tone} style={{ left: `${ratioPos(low) * 100}%`, width: `${Math.max(0.5, (ratioPos(high) - ratioPos(low)) * 100)}%` }} />}
        {ratio !== null && <b className={tone} style={{ left: `${ratioPos(ratio) * 100}%` }} />}
      </div>
      <span className={`ratio ${tone}`}>{ratio === null ? '—' : `×${ratio.toFixed(2)}`}</span>
      <small>{tierWord(tier, confidence)}</small>
    </div>
  );
}

function lensCell(kind: 'ratio' | 'percentile', value: number | null, tone: 'up' | 'down' | 'even'): ReactNode {
  if (value === null) return <span className="av-lens-cell even">—</span>;
  return <span className={`av-lens-cell ${tone}`}>{kind === 'ratio' ? `×${value.toFixed(2)}` : `${Math.round(value * 100)}`}</span>;
}

function CombatPanel({ style, data }: { style: SquadStyle; data: TelemetryAnalytics }) {
  const lensTone = (tier: StyleTier, ratio: number | null): 'up' | 'down' | 'even' => (tier === 'stable' || tier === 'lean') && ratio !== null ? (ratio >= 1 ? 'up' : 'down') : 'even';
  const steps: Array<{ key: string; label: string; pick: (entry: SquadStyle['funnel'][number]) => number | null; text: (value: number) => string; lowIsBetter?: boolean }> = [
    { key: 'dpm', label: '每分钟伤害', pick: (entry) => entry.damagePerMinute, text: (value) => value.toFixed(1) },
    { key: 'hit', label: '命中率', pick: (entry) => entry.hitRate, text: (value) => `${(value * 100).toFixed(1)}%` },
    { key: 'hpk', label: '每个击倒需命中', pick: (entry) => entry.hitsPerKnock, text: (value) => value.toFixed(1), lowIsBetter: true },
    { key: 'knock', label: '交战击倒率', pick: (entry) => entry.knockRate, text: (value) => `${(value * 100).toFixed(0)}%` },
    { key: 'conv', label: '击倒转化', pick: (entry) => entry.conversion, text: (value) => `${(value * 100).toFixed(0)}%` },
  ];
  return (
    <Panel title="谁更能打" hint="三种口径互相印证：交战表现、长期战绩份额、相对全场">
      <ul className="av-verdicts">
        <li><b>交战口径</b><span>{style.combatVerdict}</span></li>
        <li><b>战绩口径</b><span>{data.longRun.verdict}</span></li>
        <li><b>全场口径</b><span>{data.lobby.verdict}</span></li>
      </ul>
      <div className="av-combat-top">
        <div>
          <h4>战斗力指数 <small>点 = 估计值，横条 = 95% 区间，竖线 = 与队友持平</small></h4>
          {style.combat.map((entry) => <ForestRow key={entry.accountId} name={entry.name} rank={entry.rank} ratio={entry.ratio} low={entry.low} high={entry.high} tier={entry.tier} confidence={entry.confidence} />)}
          <div className="av-forest-axis"><span>×0.5</span><span>×0.71</span><span>×1</span><span>×1.41</span><span>×2</span></div>
        </div>
        <div>
          <h4>三口径对照 <small>绿 / 橙 = 稳定或倾向偏高 / 偏低</small></h4>
          <div className="av-lens">
            <span className="head">队员</span><span className="head">交战</span><span className="head">战绩份额</span><span className="head">全场分位</span>
            {style.combat.map((entry) => {
              const longRun = data.longRun.entries.find((row) => row.accountId === entry.accountId);
              const lobby = data.lobby.entries.find((row) => row.accountId === entry.accountId);
              return <Fragment key={entry.accountId}>
                <b title={entry.name}>{entry.name.replace(/^SG_LabmemNo/u, 'No.')}</b>
                {lensCell('ratio', entry.ratio, lensTone(entry.tier, entry.ratio))}
                {lensCell('ratio', longRun?.composite.ratio ?? null, longRun ? lensTone(longRun.composite.tier, longRun.composite.ratio) : 'even')}
                {lensCell('percentile', lobby?.composite.mean ?? null, lobby?.tier === 'above' ? 'up' : lobby?.tier === 'below' ? 'down' : 'even')}
              </Fragment>;
            })}
          </div>
          <small className="av-lens-foot">交战 {style.matches} 场遥测 · 战绩 {data.longRun.matches} 场 · 全场 {data.lobby.matches} 场</small>
        </div>
      </div>
      <h4>输出转化 <small>每格 4 根柱 = 4 名队员，亮色为队内最佳</small></h4>
      <div className="av-multiples">
        {steps.map((step) => {
          const values = style.funnel.map((entry) => step.pick(entry));
          const known = values.filter((value): value is number => value !== null);
          const max = Math.max(...known, 0) || 1;
          const best = known.length ? (step.lowIsBetter ? Math.min(...known) : Math.max(...known)) : null;
          return <div className="av-multiple" key={step.key}>
            <span className="title">{step.label}{step.lowIsBetter ? <small>越低越好</small> : null}</span>
            <div className="bars">{style.funnel.map((entry, index) => {
              const value = values[index] ?? null;
              const toneIndex = style.players.findIndex((player) => player.accountId === entry.accountId);
              return <div className="col" key={entry.accountId} title={`${entry.name}：${value === null ? '—' : step.text(value)}`}>
                <em>{value === null ? '—' : step.text(value)}</em>
                <i className={`${PLAYER_TONES[toneIndex % 4]} ${value !== null && value === best ? 'best' : ''}`} style={{ height: `${value === null ? 0 : Math.max(4, (value / max) * 100)}%` }} />
                <small>{entry.name.replace(/^SG_LabmemNo/u, 'No.')}</small>
              </div>;
            })}</div>
          </div>;
        })}
      </div>
      <details className="av-more"><summary>明细：长期战绩、全场分位与漏斗原始数字</summary>
        <div className="av-two even">
          <LongRunBoard data={data.longRun} />
          <LobbyBoard data={data.lobby} />
        </div>
        <div className="av-table funnel">
          <div className="av-row head"><span>队员</span><span>交战内开枪</span><span>命中率</span><span>首发命中</span><span>连射命中</span><span>连射占比</span><span>交战外开枪</span><span>每发伤害</span><span>命中/击倒</span><span>交战击倒率</span><span>击倒转化</span></div>
          {style.funnel.map((entry) => <div className="av-row" key={entry.accountId}>
            <b>{entry.name}</b><span>{int(entry.shots)}</span><span>{pct(entry.hitRate, 1)}</span><span>{pct(entry.firstShotRate, 1)}</span><span>{pct(entry.followShotRate, 1)}</span><span>{pct(entry.burstShare)}</span><span>{pct(entry.idleShare)}</span><span>{entry.damagePerShot === null ? '—' : entry.damagePerShot.toFixed(1)}</span>
            <span>{entry.hitsPerKnock === null ? '—' : entry.hitsPerKnock.toFixed(1)}</span><span>{pct(entry.knockRate)}</span><span title={`${entry.chainsFinished}/${entry.chainsDealt}`}>{pct(entry.conversion)}</span>
          </div>)}
        </div>
      </details>
      <Notes>战斗力指数 = 每分钟伤害（含火箭筒 / 手雷 / 燃烧瓶，权重 50%）+ 交战击倒率（25%）+ 同枪型命中率（25%），都是相对队友的比值，只统计排位赛。排名只表示点估计的高低；区间重叠时不能说谁一定更强。命中率 = 打中站立敌人的枪数 ÷ 交战内开的枪数。每一枪通过 attackId 和伤害事件一一配对（霰弹枪一发多颗弹丸也只算一枪）；「交战内」指这一枪前后 8 秒内双方任何一边受过伤，交战外的开枪（对墙、载具、空地、试枪）单独统计为「交战外开枪」，不算打空；打进倒地敌人的补枪既不算命中也不算打空，单独统计，不进分母。首发命中 = 一次连发的第一枪或单点射击，连射命中 = 与上一枪间隔不超过 0.12 秒的后续子弹，两者的差距反映压枪和扫射习惯。命中率的绝对值和游戏内准确率不是一回事（遥测里自动武器每颗子弹都记一次开火）；指数里的命中率是「同枪型」比较，狙击手不会因为用栓狙就显得枪法更好。击倒转化 = 自己打倒的人最终被小队终结的比例。爆头率和击倒转化率不计入指数：真实数据里爆头率可靠性低、与胜负无关，转化率主要取决于队友是否补枪。</Notes>
    </Panel>
  );
}

function PlayerCard({ player, toneIndex }: { player: SquadStyle['players'][number]; toneIndex: number }) {
  const maxWeapon = Math.max(0.01, ...player.weapons.map((weapon) => weapon.share));
  return (
    <section className={`av-panel av-pcard ${PLAYER_TONES[toneIndex % 4]}`}>
      <header>
        <h3>{player.name}</h3>
        <span className="av-chips">{player.archetypes.map((entry) => <span key={entry.id} className={`av-chip ${entry.tier === 'stable' ? 'form-hot' : ''}`}>{archetypeLabel(entry)}</span>)}</span>
      </header>
      <p className="av-style-summary">{player.summary}</p>
      <div className="av-pcard-body">
        <div className="av-radar-wrap"><Radar axes={player.axes} /></div>
        <div className="av-pcard-side">
          <div>
          <h4>最突出的特点</h4>
          {player.traits.length ? <ul className="av-trait-bars">{player.traits.slice(0, 5).map((trait) => <li key={trait.key}>
            <span className="text">{trait.text}</span>
            <DivergingBar ratio={trait.ratio} tier={trait.tier} />
            <b className={trait.ratio >= 1 ? 'up' : 'down'}>×{trait.ratio.toFixed(2)}</b>
            <small className={`tier ${trait.tier}`}>{trait.tier === 'stable' ? '●' : '◐'}</small>
          </li>)}</ul> : <p className="av-note">与队友相比没有明显偏离的维度。</p>}
          </div>
          <div>
          <h4>武器偏好</h4>
          <div className="av-weapon-row">
            <ul className="av-weapon-bars">{player.weapons.map((weapon) => <li key={weapon.weapon}><span>{weapon.weapon}</span><i><u style={{ width: `${(weapon.share / maxWeapon) * 100}%` }} /></i><b>{pct(weapon.share)}</b></li>)}</ul>
          </div>
          </div>
        </div>
      </div>
      <footer>{player.matches} 场 · 存活 {Math.round(player.minutes)} 分钟{player.landingSpread !== null ? ` · 落地离队友中心平均 ${Math.round(player.landingSpread)}m` : ''}</footer>
      <details className="av-axis-detail"><summary>全部维度的数值</summary>
        <div className="av-table style-axes">
          <div className="av-row head"><span>维度</span><span>个人</span><span>队友</span><span>比值</span><span>95% 区间</span><span>判定</span></div>
          {player.axes.map((axis) => <div className="av-row" key={axis.key} title={axisTitle(axis)}>
            <b>{axis.label}</b>
            <span>{axis.value === null ? '—' : formatAxis(axis.key, axis.value)}</span>
            <span>{axis.matesValue === null ? '—' : formatAxis(axis.key, axis.matesValue)}</span>
            <span className={axis.tier === 'stable' || axis.tier === 'lean' ? (axis.direction === 'high' ? 'up' : 'down') : ''}>{ratioText(axis)}</span>
            <span>{axis.low === null || axis.high === null ? '—' : `${axis.low.toFixed(2)}–${axis.high.toFixed(2)}`}</span>
            <span>{TIER_TEXT[axis.tier]}{TIER_MARK[axis.tier] ? ` ${TIER_MARK[axis.tier]}` : ''}</span>
          </div>)}
        </div>
      </details>
    </section>
  );
}

/** One axis per row, each member a dot on a shared scale: where the squad spreads out the most. */
function SpreadPanel({ style }: { style: SquadStyle }) {
  const items = style.spreads.filter((item) => item.supported).slice(0, 8);
  if (!items.length) return null;
  return (
    <Panel title="队内差异最大的维度" hint="每行一条刻度，点 = 每名队员；只列至少一端有稳定或倾向差异的维度">
      <div className="av-legend">{style.players.map((player, index) => <span key={player.accountId} className={PLAYER_TONES[index % 4]}>{player.name}</span>)}</div>
      <div className="av-strips">
        {items.map((item) => {
          const points = style.players.map((player, index) => ({ player, index, value: player.axes.find((axis) => axis.key === item.key)?.value ?? null }))
            .filter((point): point is typeof point & { value: number } => point.value !== null);
          const low = Math.min(...points.map((point) => point.value));
          const high = Math.max(...points.map((point) => point.value));
          const span = high - low || 1;
          const positioned = points.map((point) => ({ ...point, left: 6 + ((point.value - low) / span) * 88 })).sort((left, right) => left.left - right.left);
          // Labels of neighbouring dots would overlap, so every other close neighbour puts its label underneath.
          const below = new Set<string>();
          positioned.forEach((point, index) => {
            const previous = positioned[index - 1];
            if (previous && point.left - previous.left < 9 && !below.has(previous.player.accountId)) below.add(point.player.accountId);
          });
          return <div className="av-strip" key={item.key}>
            <span className="label">{item.label}<small>{item.group} · 相差 {item.spread.toFixed(2)}×</small></span>
            <div className="track">
              <i className="line" />
              {positioned.map((point) => <b key={point.player.accountId} className={`${PLAYER_TONES[point.index % 4]} ${below.has(point.player.accountId) ? 'below' : ''}`} style={{ left: `${point.left}%` }} title={`${point.player.name}：${formatAxis(item.key, point.value)}`}>
                <em>{formatAxis(item.key, point.value)}</em>
              </b>)}
            </div>
          </div>;
        })}
      </div>
    </Panel>
  );
}

export function StyleView({ data, loading, error, onReload }: { data: TelemetryAnalytics | null; loading: boolean; error: string; onReload: () => void }) {
  if (loading && !data) return <div className="av-empty"><div className="av-spinner" />正在读取归档遥测并计算每个人的打法…首次约需一分钟，之后会缓存。</div>;
  if (error && !data) return <div className="av-empty">{error}<button type="button" className="av-link" onClick={onReload}>重试</button></div>;
  if (!data) return <div className="av-empty">暂无风格分析。</div>;
  const { style } = data;
  if (style.players.length === 0) return <div className="av-empty">当前范围没有可用于风格分析的遥测数据。</div>;
  return (
    <div className="av-stack">
      <p className="av-scope">基于 <b>{style.matches}</b> 场有归档遥测的排位赛 · ×1.00 = 与队友持平 · <b>●</b> 稳定 <b>◐</b> 倾向</p>
      <Notes>每个维度都是「个人值 ÷ 队友合计值（不含自己）」。● 稳定 = 95% 重抽样区间不含 1；◐ 倾向 = 方向在 85% 以上的重抽样中一致，但区间跨过 1，只能说「更可能」。</Notes>
      <RosterStrip style={style} />
      <CombatPanel style={style} data={data} />
      {data.streaks && <StreakPanel data={data.streaks} />}
      <StyleMatrix style={style} />
      <div className="av-pcards">
        {style.players.map((player, index) => <PlayerCard key={player.accountId} player={player} toneIndex={index} />)}
      </div>
      <SpreadPanel style={style} />
      <Panel title="小队搭配" hint="风格重叠与缺口">
        {style.overlaps.length > 0 && <div><h4>风格相近的搭档</h4>{style.overlaps.map((overlap) => <p className="av-pair" key={overlap.accountIds.join('|')}><b>{overlap.names.join(' × ')}</b>相似度 {overlap.similarity.toFixed(2)}，都表现为：{overlap.sharedTraits.join('；')}。</p>)}</div>}
        {style.gaps.length > 0 && <div><h4>小队缺口</h4><ul className="av-traits">{style.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul></div>}
        {style.overlaps.length === 0 && style.gaps.length === 0 && <p className="av-note">没有发现明显的风格重叠或缺口。</p>}
        <Notes>{style.notes.join(' ')}</Notes>
      </Panel>
    </div>
  );
}

const PERCENT_AXES = new Set(['farShare', 'closeShare', 'marksman', 'closeGun', 'precision', 'initiative', 'lateGame', 'isolation', 'zoneEdge', 'hitRate', 'knockRate', 'conversion']);

function formatAxis(key: string, value: number): string {
  if (key === 'range') return `${Math.round(value)}m`;
  if (key === 'earlyLoot') return `${value.toFixed(0)} 件`;
  if (key === 'foot') return `${Math.round(value)}m/分`;
  if (key === 'dpm') return `${value.toFixed(0)}/分`;
  if (key === 'combat') return `×${value.toFixed(2)}`;
  if (key === 'dmgPerShot') return value.toFixed(1);
  if (PERCENT_AXES.has(key)) return `${(value * 100).toFixed(0)}%`;
  return value.toFixed(2);
}

export function FieldView({ data, loading, error, onReload }: { data: TelemetryAnalytics | null; loading: boolean; error: string; onReload: () => void }) {
  const maps = useMemo(() => (data?.landing.maps ?? []).filter((map) => map.matchesWithLanding > 0), [data]);
  const [mapName, setMapName] = useState('');
  const [selectedCell, setSelectedCell] = useState('');
  if (loading && !data) return <div className="av-empty"><div className="av-spinner" />正在读取归档遥测并重建交战…首次约需 10 秒，之后会缓存。</div>;
  if (error && !data) return <div className="av-empty">{error}<button type="button" className="av-link" onClick={onReload}>重试</button></div>;
  if (!data) return <div className="av-empty">暂无遥测分析。</div>;
  const { combat, scope } = data;
  const map = maps.find((item) => item.mapName === mapName) ?? maps[0];
  const cell = map?.cells.find((item) => item.cell === selectedCell) ?? map?.cells[0];

  return (
    <div className="av-stack">
      <p className="av-scope">基于 <b>{scope.analyzedMatches}</b> 场有归档遥测的比赛{scope.from && scope.to ? `（${dateText(Date.parse(scope.from))} – ${dateText(Date.parse(scope.to))}）` : ''}，共 {combat.groups} 次交战。{scope.missingArchiveMatches > 0 ? `另有 ${scope.missingArchiveMatches} 场没有归档（PUBG 只保留约 14 天遥测，过期后无法补回）。` : ''}{scope.unavailableMatches > 0 ? `${scope.unavailableMatches} 场读取失败。` : ''}</p>

      <HighlightsPanel items={data.highlights} />

      <Panel title="交战质量" hint="只统计已观察到的事件；区间为 95% Wilson">
        <div className="av-combats">
          <CombatCard title="首倒占比" value={pct(combat.firstKnock.ourRate.rate)} sub={`我方 ${combat.firstKnock.forUs} · 对方 ${combat.firstKnock.againstUs}`}
            detail={`交战中先打倒对手的比例，区间 ${ci(combat.firstKnock.ourRate)}。`} tone={(combat.firstKnock.ourRate.rate ?? 0) >= 0.5 ? 'good' : 'warn'} />
          <CombatCard title="先手优势保持" value={pct(combat.leadConversion.heldRate.rate)} sub={`${combat.leadConversion.held} 保持 · ${combat.leadConversion.lost} 被追平/反超`}
            detail="我方首倒后，观察到的倒地数优势是否维持到交战结束。" />
          <CombatCard title="首倒后追击" value={seconds(combat.followUp.medianSeconds)} sub={`${combat.followUp.observed} 次追击 · ${combat.followUp.missed} 次窗口内无`}
            detail="我方首倒后，对同一对手的下一次有效接触的中位间隔（30 秒窗口）。" />
          <CombatCard title="倒地被救起" value={pct(combat.revive.reviveRate.rate)} sub={`${combat.revive.revived}/${combat.revive.knocked} · 中位 ${seconds(combat.revive.medianSeconds)}`}
            detail={`我方队员被打倒后被救起的比例；${combat.revive.killed} 次被补掉，${combat.revive.unresolved} 次未观察到结果。`} tone={(combat.revive.reviveRate.rate ?? 1) < 0.3 ? 'warn' : undefined} />
          <CombatCard title="补刀转化" value={pct(combat.finish.finishRate.rate)} sub={`${combat.finish.finished}/${combat.finish.downed} · 中位 ${seconds(combat.finish.medianSeconds)}`}
            detail="我方打倒对手后最终补掉的比例；剩余可能被救起或未观察到结果。" tone="good" />
          <CombatCard title="第三方介入" value={pct(combat.thirdParty.againstRate.rate)} sub={`被介入 ${combat.thirdParty.againstUs} · 我方介入 ${combat.thirdParty.byUs}`}
            detail="时间重叠的第三队接触候选占交战比例，不代表对方意图。" />
        </div>
      </Panel>

      <FightPanel data={data.fights} />

      <DeathPanel deaths={data.deaths} />

      <DownCausePanel data={data.downs} names={new Map(data.style.players.map((player) => [player.accountId, player.name]))} />

      <RotationPanel data={data.rotation} />

      <DistancePanel data={data.distance} />

      <ZonePanel data={data.zone} />

      <Panel title="落点偏好" hint="1km 方格；点 = 单人落点，数字 = 该格作为小队主落点的场数">
        {!map && <p className="av-note">这些比赛没有可读取的落地事件。</p>}
        {map && <>
          <div className="av-tabs mini">{maps.map((item) => <button key={item.mapName} type="button" className={item.mapName === map.mapName ? 'active' : ''} onClick={() => { setMapName(item.mapName); setSelectedCell(''); }}>{item.label} <small>{item.matchesWithLanding}</small></button>)}</div>
          <div className="av-landing">
            <LandingMap map={map} selectedCell={cell?.cell ?? ''} onSelect={setSelectedCell} />
            <div className="av-landing-side">
              <div className="av-kpis small">
                <Kpi label="同点重复率" value={pct(map.topCellRepeatRate)} sub="最常用方格占比" />
                <Kpi label="队内分散" value={map.medianSpreadMeters === null ? '—' : `${Math.round(map.medianSpreadMeters)}m`} sub="成员距小队中心中位" />
              </div>
              <div className="av-table cells">
                <div className="av-row head"><span>方格 · 地名</span><span>场次</span><span>前十率</span><span>早崩率</span><span>人均伤害</span></div>
                {map.cells.slice(0, 8).map((item) => <button type="button" className={`av-row ${item.cell === cell?.cell ? 'active' : ''}`} key={item.cell} onClick={() => setSelectedCell(item.cell)}>
                  <b>{item.cell}{item.region && <small>{regionName(item.region)}</small>}</b><span>{item.matches}</span><span>{pct(item.top10.rate)}</span><span className={(item.earlyWipeRate ?? 0) >= 0.4 ? 'down' : ''}>{pct(item.earlyWipeRate)}</span><span>{int(item.averageDamage)}</span>
                </button>)}
              </div>
              {cell && <p className="av-note">{cell.cell} 格：{cell.matches} 场，中位名次 {cell.medianPlacement === null ? '未知' : `#${cell.medianPlacement}`}，前十率区间 {ci(cell.top10)}。</p>}
            </div>
          </div>
        </>}
        <ContestPanel contest={data.landing.contest} />
        <Notes>{data.landing.notes.join(' ')}</Notes>
      </Panel>

      <RolePanel roles={data.roles} />
      <Notes>{combat.notes.join(' ')}</Notes>
    </div>
  );
}

export function Notes({ children, label = '口径说明' }: { children: ReactNode; label?: string }) {
  return <details className="av-notes"><summary>{label}</summary><div>{children}</div></details>;
}

// ---------------------------------------------------------------------------------------------------------------
// Single match against each member's usual level.

export interface RelativeReading {
  key: string;
  label: string;
  format: 'int' | 'minutes' | 'percent' | 'decimal';
  higherIsBetter: boolean;
  value: number | null;
  median: number | null;
  percentile: number | null;
  goodness: number | null;
  historyCount: number;
}

export interface MatchRelativeData {
  matchId: string;
  telemetry: boolean;
  historyMatches: number;
  players: Array<{ accountId: string; name: string; historyMatches: number; form: number | null; metrics: RelativeReading[] }>;
  placement: { value: number | null; goodness: number | null; historyCount: number };
  highlights: Array<{ tone: 'good' | 'bad' | 'info'; text: string }>;
  notes: string[];
}

function relativeText(format: RelativeReading['format'], value: number | null): string {
  if (value === null) return '—';
  if (format === 'percent') return `${(value * 100).toFixed(1)}%`;
  if (format === 'minutes') return `${value.toFixed(1)}分`;
  if (format === 'decimal') return value.toFixed(1);
  return String(Math.round(value));
}

function toneOf(goodness: number | null): 'good' | 'bad' | 'mid' {
  if (goodness === null) return 'mid';
  return goodness >= 0.65 ? 'good' : goodness <= 0.35 ? 'bad' : 'mid';
}

/** A 270° gauge: 0 at the lower left, 100 at the lower right, 50 straight up. */
function Gauge({ value, label }: { value: number | null; label: string }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const sweep = circumference * 0.75;
  return (
    <svg viewBox="0 0 100 100" className={`av-gauge ${toneOf(value)}`} role="img" aria-label={`${label} ${value === null ? '未知' : Math.round(value * 100)}`}>
      <circle cx="50" cy="52" r={radius} className="track" strokeDasharray={`${sweep} ${circumference}`} transform="rotate(135 50 52)" />
      {value !== null && <circle cx="50" cy="52" r={radius} className="fill" strokeDasharray={`${Math.max(1, sweep * value)} ${circumference}`} transform="rotate(135 50 52)" />}
      <text x="50" y="54" className="value">{value === null ? '—' : Math.round(value * 100)}</text>
      <text x="50" y="72" className="label">{label}</text>
    </svg>
  );
}

function PercentileTrack({ reading }: { reading: RelativeReading }) {
  const tone = toneOf(reading.goodness);
  return (
    <div className="av-ptrack" title={reading.median === null ? '历史不足，暂不比较' : `平时中位 ${relativeText(reading.format, reading.median)} · ${reading.historyCount} 场历史`}>
      <span className="label">{reading.label}<small>{reading.median === null ? '历史不足' : `平时 ${relativeText(reading.format, reading.median)}`}</small></span>
      <span className="track"><i className="mid" />{reading.goodness !== null && <b className={`dot ${tone}`} style={{ left: `${reading.goodness * 100}%` }} />}</span>
      <span className={`val ${tone}`}>{relativeText(reading.format, reading.value)}</span>
    </div>
  );
}

export function MatchRelativePanel({ data, loading }: { data: MatchRelativeData | null; loading: boolean }) {
  if (loading && !data) return <section className="av-panel av-relative"><header><h3>这局相对平时</h3><span>正在对比每个人的历史…</span></header><div className="av-spinner" /></section>;
  if (!data || !data.players.length) return null;
  return (
    <section className="av-panel av-relative">
      <header><h3>这局相对平时</h3><span>每个人只和自己的 {data.historyMatches} 场历史比；圆环 = 综合分位，50 为平常水平</span></header>
      {data.highlights.length > 0 && <ul className="av-relative-highlights">{data.highlights.map((item) => <li key={item.text} className={item.tone}>{item.text}</li>)}</ul>}
      <div className="av-relative-grid" style={{ ["--cols" as string]: Math.min(4, Math.max(1, data.players.length)) }}>
        {data.players.map((player) => <div className="av-relative-card" key={player.accountId}>
          <div className="head"><Gauge value={player.form} label="综合分位" /><div><b>{player.name}</b><small>{player.historyMatches} 场历史</small></div></div>
          {player.metrics.filter((reading) => reading.value !== null).map((reading) => <PercentileTrack key={reading.key} reading={reading} />)}
        </div>)}
      </div>
      <div className="av-ptrack-legend"><span>← 比平时差</span><span>平常</span><span>比平时好 →</span></div>
      <Notes>{data.notes.join(' ')}{!data.telemetry ? ' 这一局没有归档遥测，只比较战绩里的数值。' : ''}</Notes>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Head-to-head player comparison.

interface CompareMetric {
  key: string;
  group: string;
  label: string;
  a: number | null;
  b: number | null;
  text: (value: number) => string;
  /** Which direction is better; null for style axes where neither side "wins". */
  better: 'high' | 'low' | null;
}

const ratioFmt = (value: number) => `×${value.toFixed(2)}`;
const pctFmt = (value: number) => `${(value * 100).toFixed(0)}%`;
const oneFmt = (value: number) => value.toFixed(1);
const intFmt = (value: number) => String(Math.round(value));

function buildCompareMetrics(data: TelemetryAnalytics, a: string, b: string): CompareMetric[] {
  const { style } = data;
  const pick = <T,>(rows: readonly T[], id: string, key: (row: T) => string) => rows.find((row) => key(row) === id);
  const axis = (id: string, key: string) => style.players.find((player) => player.accountId === id)?.axes.find((item) => item.key === key)?.value ?? null;
  const make = (key: string, group: string, label: string, get: (id: string) => number | null | undefined, text: (value: number) => string, better: CompareMetric['better']): CompareMetric =>
    ({ key, group, label, a: get(a) ?? null, b: get(b) ?? null, text, better });
  const funnel = (id: string) => pick(style.funnel, id, (row) => row.accountId);
  const streak = (id: string) => data.streaks ? pick(data.streaks.players, id, (row) => row.accountId) : undefined;
  const role = (id: string) => pick(data.roles, id, (row) => row.accountId);
  return [
    make('combat', '综合实力', '战斗力指数', (id) => pick(style.combat, id, (row) => row.accountId)?.ratio, ratioFmt, 'high'),
    make('longRun', '综合实力', '长期战绩份额', (id) => pick(data.longRun.entries, id, (row) => row.accountId)?.composite.ratio, ratioFmt, 'high'),
    make('lobby', '综合实力', '全场分位', (id) => pick(data.lobby.entries, id, (row) => row.accountId)?.composite.mean, (value) => `${(value * 100).toFixed(0)}`, 'high'),
    make('dpm', '输出', '每分钟伤害', (id) => funnel(id)?.damagePerMinute, oneFmt, 'high'),
    make('hit', '输出', '命中率', (id) => funnel(id)?.hitRate, (value) => `${(value * 100).toFixed(1)}%`, 'high'),
    make('firstShot', '输出', '首发命中率', (id) => funnel(id)?.firstShotRate, (value) => `${(value * 100).toFixed(1)}%`, 'high'),
    make('followShot', '输出', '连射命中率', (id) => funnel(id)?.followShotRate, (value) => `${(value * 100).toFixed(1)}%`, 'high'),
    make('dps', '输出', '每发伤害', (id) => funnel(id)?.damagePerShot, oneFmt, 'high'),
    make('knock', '输出', '交战击倒率', (id) => funnel(id)?.knockRate, pctFmt, 'high'),
    make('conv', '输出', '击倒转化', (id) => funnel(id)?.conversion, pctFmt, 'high'),
    make('multi', '连杀与灭队', '每 10 场连杀', (id) => streak(id)?.multiPerTen, oneFmt, 'high'),
    make('chain', '连杀与灭队', '连杀占比', (id) => streak(id)?.chainedShare?.rate, pctFmt, 'high'),
    make('longest', '连杀与灭队', '最长连杀', (id) => streak(id)?.longest, intFmt, 'high'),
    make('wipe', '连杀与灭队', '每 10 场灭队放倒', (id) => { const row = streak(id); return row && row.matches ? (row.wipeTakedowns / row.matches) * 10 : null; }, oneFmt, 'high'),
    make('solo', '连杀与灭队', '单人灭队', (id) => streak(id)?.soloWipes, intFmt, 'high'),
    make('firstKnock', '交战角色', '首倒占比', (id) => role(id)?.firstKnockShare, pctFmt, 'high'),
    make('firstDowned', '交战角色', '先被打倒', (id) => role(id)?.firstDownedShare, pctFmt, 'low'),
    make('revive', '交战角色', '救援占比', (id) => role(id)?.reviveShare, pctFmt, 'high'),
    make('risk', '交战角色', '每次交战被击倒', (id) => axis(id, 'risk'), (value) => value.toFixed(2), 'low'),
    make('burst', '打法（无优劣）', '连射占比', (id) => funnel(id)?.burstShare, pctFmt, null),
    make('idle', '打法（无优劣）', '交战外开枪占比', (id) => funnel(id)?.idleShare, pctFmt, null),
    make('range', '打法（无优劣）', '交战距离', (id) => axis(id, 'range'), (value) => `${Math.round(value)}m`, null),
    make('initiative', '打法（无优劣）', '先手比例', (id) => axis(id, 'initiative'), pctFmt, null),
    make('tempo', '打法（无优劣）', '参战频率', (id) => axis(id, 'tempo'), (value) => `${value.toFixed(2)}/分`, null),
    make('supplies', '打法（无优劣）', '补给使用', (id) => axis(id, 'supplies'), (value) => `${value.toFixed(2)}/分`, null),
    make('isolation', '打法（无优劣）', '脱队程度', (id) => axis(id, 'isolation'), pctFmt, null),
  ];
}

function winnerOf(metric: CompareMetric): 'a' | 'b' | null {
  if (metric.better === null || metric.a === null || metric.b === null) return null;
  const top = Math.max(Math.abs(metric.a), Math.abs(metric.b));
  if (top === 0 || Math.abs(metric.a - metric.b) / top < 0.03) return null;
  return (metric.a > metric.b) === (metric.better === 'high') ? 'a' : 'b';
}

function RadarCompare({ series }: { series: Array<{ name: string; axes: StyleAxisReading[]; tone: 'a' | 'b' }> }) {
  const size = 240;
  const center = size / 2;
  const radius = 82;
  const keys = RADAR_KEYS.filter((key) => series.every((item) => item.axes.some((axis) => axis.key === key)));
  const angle = (index: number) => -Math.PI / 2 + (index / keys.length) * Math.PI * 2;
  const scale = (ratio: number | null) => Math.max(0, Math.min(1, 0.5 + 0.5 * Math.log2(ratio ?? 1) / RADAR_LOG_SPAN));
  const at = (index: number, fraction: number) => [center + Math.cos(angle(index)) * radius * fraction, center + Math.sin(angle(index)) * radius * fraction] as const;
  const labels = series[0]?.axes ?? [];
  return (
    <svg viewBox={`-60 -8 ${size + 120} ${size + 16}`} className="av-radar compare" role="img" aria-label="两人打法雷达对比">
      {[0.25, 0.5, 0.75, 1].map((ring) => <polygon key={ring} points={keys.map((_, index) => at(index, ring).join(',')).join(' ')} className={ring === 0.5 ? 'ring avg' : 'ring'} />)}
      {keys.map((_, index) => { const [x, y] = at(index, 1); return <line key={index} x1={center} y1={center} x2={x} y2={y} className="spoke" />; })}
      {series.map((item) => <polygon key={item.name} className={`shape ${item.tone}`} points={keys.map((key, index) => at(index, scale(item.axes.find((axis) => axis.key === key)?.ratio ?? null)).join(',')).join(' ')}><title>{item.name}</title></polygon>)}
      {series.map((item) => keys.map((key, index) => { const [x, y] = at(index, scale(item.axes.find((axis) => axis.key === key)?.ratio ?? null)); return <circle key={`${item.name}-${key}`} cx={x} cy={y} r={2.6} className={`dot ${item.tone}`} />; }))}
      {keys.map((key, index) => { const [x, y] = at(index, 1.17); return <text key={key} x={x} y={y} textAnchor={x < center - 6 ? 'end' : x > center + 6 ? 'start' : 'middle'} dominantBaseline="middle" className="label">{labels.find((axis) => axis.key === key)?.label ?? key}</text>; })}
    </svg>
  );
}

export function CompareView({ data, loading, error, onReload, series }: { data: TelemetryAnalytics | null; loading: boolean; error: string; onReload: () => void; series: CompareSeries | null }) {
  const [picked, setPicked] = useState<{ a: string; b: string }>({ a: '', b: '' });
  if (loading && !data) return <div className="av-empty"><div className="av-spinner" />正在读取归档遥测…首次约需一分钟，之后会缓存。</div>;
  if (error && !data) return <div className="av-empty">{error}<button type="button" className="av-link" onClick={onReload}>重试</button></div>;
  if (!data || data.style.players.length < 2) return <div className="av-empty">当前范围少于两名有遥测数据的队员，无法对比。</div>;
  const ids = data.style.players.map((player) => player.accountId);
  const ranked = data.style.combat.map((entry) => entry.accountId).filter((id) => ids.includes(id));
  const a = ids.includes(picked.a) ? picked.a : ranked[0] ?? ids[0]!;
  const b = ids.includes(picked.b) && picked.b !== a ? picked.b : (ranked.find((id) => id !== a) ?? ids.find((id) => id !== a)!);
  const playerA = data.style.players.find((player) => player.accountId === a)!;
  const playerB = data.style.players.find((player) => player.accountId === b)!;
  const metrics = buildCompareMetrics(data, a, b);
  const winners = metrics.map(winnerOf);
  const winsA = winners.filter((winner) => winner === 'a').length;
  const winsB = winners.filter((winner) => winner === 'b').length;
  const groups = [...new Set(metrics.map((metric) => metric.group))];
  const contrasts: Contrast[] = metrics.filter((metric) => metric.better !== null && metric.a !== null && metric.b !== null).map((metric) => {
    const top = Math.max(Math.abs(metric.a!), Math.abs(metric.b!)) || 1;
    const raw = (metric.a! - metric.b!) / top;
    return { label: metric.label, gap: metric.better === 'low' ? -raw : raw };
  });
  const logRatios = (axes: StyleAxisReading[]) => RADAR_KEYS.map((key) => Math.log2(axes.find((axis) => axis.key === key)?.ratio ?? 1));
  const similarity = styleSimilarity(logRatios(playerA.axes), logRatios(playerB.axes));
  const sideA = { id: a, name: playerA.name };
  const sideB = { id: b, name: playerB.name };
  const choose = (slot: 'a' | 'b', id: string) => setPicked((current) => {
    const next = { a, b, [slot]: id };
    if (next.a === next.b) next[slot === 'a' ? 'b' : 'a'] = slot === 'a' ? b === id ? a : b : a === id ? b : a;
    return next;
  });
  return (
    <div className="av-stack">
      <section className="av-panel av-versus">
        <div className="av-versus-side a">
          <div className="av-picker">{data.style.players.map((player) => <button type="button" key={player.accountId} className={player.accountId === a ? 'active' : ''} onClick={() => choose('a', player.accountId)}>{player.name}</button>)}</div>
          <h2>{playerA.name}</h2>
          <span className="av-chips">{playerA.archetypes.slice(0, 2).map((entry) => <span className="av-chip" key={entry.id}>{archetypeLabel(entry)}</span>)}</span>
        </div>
        <div className="av-versus-score"><b className="a">{winsA}</b><span>:</span><b className="b">{winsB}</b><small>有优劣的指标里领先的项数（差距小于 3% 算平）</small></div>
        <div className="av-versus-side b">
          <div className="av-picker">{data.style.players.map((player) => <button type="button" key={player.accountId} className={player.accountId === b ? 'active' : ''} onClick={() => choose('b', player.accountId)}>{player.name}</button>)}</div>
          <h2>{playerB.name}</h2>
          <span className="av-chips">{playerB.archetypes.slice(0, 2).map((entry) => <span className="av-chip" key={entry.id}>{archetypeLabel(entry)}</span>)}</span>
        </div>
      </section>
      <Complement a={sideA} b={sideB} contrasts={contrasts} similarity={similarity} />
      <div className="av-compare-grid">
        <Panel title="打法雷达" hint="相对全队其他人的比值；虚线圈 = 持平">
          <RadarCompare series={[{ name: playerA.name, axes: playerA.axes, tone: 'a' }, { name: playerB.name, axes: playerB.axes, tone: 'b' }]} />
          <div className="av-legend"><span className="a">{playerA.name}</span><span className="b">{playerB.name}</span></div>
        </Panel>
        <Panel title="逐项对比" hint="高亮 = 这一项更好的一方；内部可滚动" className="cp-scroll-panel">
          <div className="cp-scroll">
          {groups.map((group) => <div className="av-fly-group" key={group}>
            <h4>{group}</h4>
            {metrics.filter((metric) => metric.group === group).map((metric) => {
              const winner = winnerOf(metric);
              const top = Math.max(Math.abs(metric.a ?? 0), Math.abs(metric.b ?? 0)) || 1;
              return <div className="av-fly" key={metric.key}>
                <span className={`v a ${winner === 'a' ? 'win' : ''}`}>{metric.a === null ? '—' : metric.text(metric.a)}</span>
                <span className="bar a"><i className={winner === 'a' ? 'win' : ''} style={{ width: `${(Math.abs(metric.a ?? 0) / top) * 100}%` }} /></span>
                <b>{metric.label}{metric.better === 'low' ? <small>越低越好</small> : null}</b>
                <span className="bar b"><i className={winner === 'b' ? 'win' : ''} style={{ width: `${(Math.abs(metric.b ?? 0) / top) * 100}%` }} /></span>
                <span className={`v b ${winner === 'b' ? 'win' : ''}`}>{metric.b === null ? '—' : metric.text(metric.b)}</span>
              </div>;
            })}
          </div>)}
          </div>
        </Panel>
      </div>
      {series ? <>
        <HeadToHead series={series} a={sideA} b={sideB} />
        <TrendAndSpread series={series} a={sideA} b={sideB} />
      </> : <div className="av-empty"><div className="av-spinner" />正在读取逐场数据…</div>}
      <WeaponCompare a={{ name: playerA.name, classShares: playerA.classShares, weapons: playerA.weapons }} b={{ name: playerB.name, classShares: playerB.classShares, weapons: playerB.weapons }} classLabel={CLASS_LABEL} />
      <Notes>战斗力指数、打法维度和角色都基于 {data.style.matches} 场有归档遥测的排位赛；长期战绩份额基于 {data.longRun.matches} 场战绩；全场分位基于 {data.lobby.matches} 场。两人的数值都是各自全部场次的汇总，不要求同场。领先项数只是计数，不代表统计上显著；统计判定见「打法风格」页的稳定 / 倾向标记。</Notes>
    </div>
  );
}
