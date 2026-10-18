import { useMemo, useState, type ReactNode } from 'react';

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
    accountId: string; name: string; fights: number; minutes: number; shots: number; hits: number; hitRate: number | null; hitDamage: number; damagePerShot: number | null;
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

export interface TelemetryAnalytics {
  highlights: Insight[];
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

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' | undefined }) {
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
      <p className="av-note">{data.notes.join(' ')}</p>
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
        <p className="av-note">{data.notes.join(' ')}</p>
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
      <div className="av-kpis">
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

        <Panel title="武器效率" hint="命中率向全体均值收缩，小样本不会虚高">
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
      {squad.notes.length > 0 && <p className="av-note">{squad.notes.join(' ')}</p>}
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
      <p className="av-note">{data.notes.join(' ')}</p>
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
      <p className="av-note">圈数 = 遥测里 isGame 的整数部分。位置样本按小队成员每约 10 秒一次；「圈外」指离安全区中心超过其半径。</p>
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
      <p className="av-note">{data.notes.join(' ')}</p>
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
      <p className="av-note">{data.notes.join(' ')}</p>
    </div>
  );
}

function CombatPanel({ style, data }: { style: SquadStyle; data: TelemetryAnalytics }) {
  const bestOf = (pick: (entry: SquadStyle['funnel'][number]) => number | null, higherIsBetter = true) => {
    const values = style.funnel.map(pick).filter((value): value is number => value !== null);
    return values.length ? (higherIsBetter ? Math.max(...values) : Math.min(...values)) : null;
  };
  const top = { hit: bestOf((entry) => entry.hitRate), dps: bestOf((entry) => entry.damagePerShot), hpk: bestOf((entry) => entry.hitsPerKnock, false), conv: bestOf((entry) => entry.conversion), knock: bestOf((entry) => entry.knockRate), dpm: bestOf((entry) => entry.damagePerMinute) };
  const mark = (value: number | null, best: number | null) => (value !== null && best !== null && Math.abs(value - best) < 1e-9 ? 'best' : '');
  const maxRatio = Math.max(1.5, ...style.combat.map((entry) => entry.ratio ?? 0));
  return (
    <Panel title="谁更能打" hint="战斗力指数 = 每分钟伤害（含火箭筒/手雷/燃烧瓶，权重 50%）+ 交战击倒率（25%）+ 同枪型命中率（25%），比的是相对队友；只统计排位赛">
      <ul className="av-verdicts">
        <li><b>战绩口径</b><span>{data.longRun.verdict}</span></li>
        <li><b>全场口径</b><span>{data.lobby.verdict}</span></li>
        <li><b>交战口径</b><span>{style.combatVerdict}</span></li>
      </ul>
      {style.combatHighlights.length > 0 && <div className="av-chips av-strengths">{style.combatHighlights.map((entry) => <span key={`${entry.name}-${entry.label}`} className={`av-chip ${entry.ratio >= 1 ? 'form-hot' : 'weak'}`} title={entry.tier === 'lean' && entry.confidence !== null ? `倾向，方向把握 ${(entry.confidence * 100).toFixed(0)}%` : '稳定'}>
        {entry.name} · {entry.label} ×{entry.ratio.toFixed(2)} {entry.tier === 'stable' ? '●' : '◐'}
      </span>)}</div>}
      <div className="av-two even">
        <LongRunBoard data={data.longRun} />
        <LobbyBoard data={data.lobby} />
      </div>
      <div className="av-two even stacked">
        <div>
          <h4>战斗力榜（×1.00 = 与队友持平）</h4>
          {style.combat.map((entry) => <div className="av-combat-row" key={entry.accountId}>
            <span className="rank">{entry.rank}</span>
            <b>{entry.name}</b>
            <span className="av-bar-wrap"><Bar value={entry.ratio ?? 0} max={maxRatio} tone={(entry.ratio ?? 0) >= 1 ? 'mint' : 'amber'} /></span>
            <span className={`ratio ${entry.tier === 'stable' || entry.tier === 'lean' ? ((entry.ratio ?? 1) >= 1 ? 'up' : 'down') : ''}`}>{entry.ratio === null ? '—' : `×${entry.ratio.toFixed(2)}`}</span>
            <small>{entry.tier === 'stable' ? '稳定' : entry.tier === 'lean' ? `倾向 ${entry.confidence === null ? '' : `${(entry.confidence * 100).toFixed(0)}%`}` : '差距不显著'}{entry.low !== null && entry.high !== null ? ` · ${entry.low.toFixed(2)}–${entry.high.toFixed(2)}` : ''}</small>
          </div>)}
          <p className="av-note">排名只表示点估计的高低；差距不显著时，前几名之间不能说谁一定更强。</p>
        </div>
        <div>
          <h4>输出转化漏斗（射击 → 命中 → 击倒 → 击杀）</h4>
          <div className="av-table funnel">
            <div className="av-row head"><span>队员</span><span>射击</span><span>命中率</span><span>每发伤害</span><span>命中/击倒</span><span>交战击倒率</span><span>击倒转化</span></div>
            {style.funnel.map((entry) => <div className="av-row" key={entry.accountId}>
              <b>{entry.name}</b>
              <span>{int(entry.shots)}</span>
              <span className={mark(entry.hitRate, top.hit)}>{pct(entry.hitRate, 1)}</span>
              <span className={mark(entry.damagePerShot, top.dps)}>{entry.damagePerShot === null ? '—' : entry.damagePerShot.toFixed(1)}</span>
              <span className={mark(entry.hitsPerKnock, top.hpk)}>{entry.hitsPerKnock === null ? '—' : entry.hitsPerKnock.toFixed(1)}</span>
              <span className={mark(entry.knockRate, top.knock)}>{pct(entry.knockRate)}</span>
              <span className={mark(entry.conversion, top.conv)} title={`${entry.chainsFinished}/${entry.chainsDealt}`}>{pct(entry.conversion)}</span>
            </div>)}
          </div>
          <p className="av-note">命中/击倒越低说明每个击倒需要的命中越少；击倒转化 = 自己打倒的人最终被小队终结的比例（其余被救起或未观察到结果）；交战击倒率 = 参与的交战里至少打倒一人的比例。高亮为队内最优。漏斗里的射击和命中不含霰弹枪（一发多颗弹丸）和火箭筒/榴弹（不产生枪械命中）；命中率 = 对敌命中事件 ÷ 开火事件，绝对值和游戏内准确率不是一回事。指数里的命中率是「同枪型」比较：拿队友用同类枪的命中率，按你自己的用枪比例折算后再比，狙击手不会因为用栓狙就显得枪法更好。爆头率和击倒转化率仍在风格维度里展示，但不计入指数：真实数据里爆头率可靠性低、与胜负无关，转化率主要取决于队友是否补枪。</p>
        </div>
      </div>
    </Panel>
  );
}

function StyleMatrix({ style }: { style: SquadStyle }) {
  const readings = (key: string) => style.players.map((player) => player.axes.find((axis) => axis.key === key)!);
  const keys = style.players[0]!.axes.map((axis) => ({ key: axis.key, label: axis.label, group: axis.group }));
  return (
    <Panel title="风格对比矩阵" hint="每格 = 该队员 ÷ 队友合计；● 稳定 ◐ 倾向；绿色偏高、橙色偏低，悬停看数值">
      <div className="av-matrix" style={{ gridTemplateColumns: `minmax(150px,1.4fr) repeat(${style.players.length}, minmax(96px,1fr))` }}>
        <span className="head" />
        {style.players.map((player) => <span className="head" key={player.accountId}>{player.name}</span>)}
        {GROUPS.map((group) => <div className="av-matrix-group" key={group} style={{ display: 'contents' }}>
          <span className="group" style={{ gridColumn: `1 / span ${style.players.length + 1}` }}>{group}</span>
          {keys.filter((item) => item.group === group).map((item) => <div key={item.key} style={{ display: 'contents' }}>
            <span className="axis">{item.label}</span>
            {readings(item.key).map((reading, index) => <span key={style.players[index]!.accountId} className={`cell ${reading.tier}`} style={{ background: cellColor(reading) }} title={axisTitle(reading)}>
              {ratioText(reading)}<i>{TIER_MARK[reading.tier]}</i>
            </span>)}
          </div>)}
        </div>)}
      </div>
    </Panel>
  );
}

function SpreadPanel({ spreads }: { spreads: SquadStyle['spreads'] }) {
  const items = spreads.filter((item) => item.supported).slice(0, 8);
  if (!items.length) return null;
  return (
    <Panel title="队内差异最大的维度" hint="同一维度上，最高和最低的人差几倍；只列至少一端有稳定或倾向差异的">
      <div className="av-table spreads">
        <div className="av-row head"><span>维度</span><span>最高</span><span>最低</span><span>相差</span></div>
        {items.map((item) => <div className="av-row" key={item.key}>
          <b>{item.label}<small>{item.group}</small></b>
          <span>{item.highest.name} <em>{formatAxis(item.key, item.highest.value)}</em> {TIER_MARK[item.highest.tier]}</span>
          <span>{item.lowest.name} <em>{formatAxis(item.key, item.lowest.value)}</em> {TIER_MARK[item.lowest.tier]}</span>
          <span>{item.spread.toFixed(2)}×</span>
        </div>)}
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
      <p className="av-scope">基于 <b>{style.matches}</b> 场有归档遥测的比赛。每个维度都是「个人值 ÷ 队友合计值（不含自己）」：×1.00 即与队友持平。<b>● 稳定</b> = 95% 重抽样区间不含 1；<b>◐ 倾向</b> = 方向在 85% 以上的重抽样中一致，但区间跨过 1，只能说「更可能」。</p>
      <CombatPanel style={style} data={data} />
      <StyleMatrix style={style} />
      <div className="av-style-cards">
        {style.players.map((player) => <section className="av-panel av-style-card" key={player.accountId}>
          <header>
            <h3>{player.name}</h3>
            <span className="av-chips">{player.archetypes.map((entry) => <span key={entry.id} className={`av-chip ${entry.tier === 'stable' ? 'form-hot' : ''}`}>{archetypeLabel(entry)}</span>)}</span>
          </header>
          <p className="av-style-summary">{player.summary}</p>
          <div className="av-style-body">
            <div className="av-radar-wrap"><Radar axes={player.axes} /><small>虚线圈 = 队友平均 ×1.00；外圈 ×1.5，中心 ×0.67；实心点 = 稳定，半透明 = 倾向</small></div>
            <div>
              <h4>最突出的特点</h4>
              {player.traits.length ? <ul className="av-traits">{player.traits.map((trait) => <li key={trait.key}>
                <b className={trait.ratio >= 1 ? 'up' : 'down'}>×{trait.ratio.toFixed(2)}</b>
                <span>{trait.text}</span>
                <small className={`tier ${trait.tier}`}>{trait.tier === 'stable' ? '稳定' : `倾向 ${trait.confidence === null ? '' : `${(trait.confidence * 100).toFixed(0)}%`}`}</small>
              </li>)}</ul> : <p className="av-note">与队友相比没有明显偏离的维度。</p>}
            </div>
            <div>
              <h4>武器偏好</h4>
              <div className="av-chips">{player.weapons.map((weapon) => <span className="av-chip" key={weapon.weapon}>{weapon.weapon} {pct(weapon.share)}</span>)}</div>
              <div className="av-chips" style={{ marginTop: 6 }}>{player.classShares.map((entry) => <span className="av-chip" key={entry.weaponClass}>{CLASS_LABEL[entry.weaponClass] ?? entry.weaponClass} {pct(entry.share)}</span>)}</div>
              <p className="av-note">{player.matches} 场 · 存活 {Math.round(player.minutes)} 分钟{player.landingSpread !== null ? ` · 落地离队友中心平均 ${Math.round(player.landingSpread)}m` : ''}</p>
            </div>
          </div>
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
        </section>)}
      </div>
      <SpreadPanel spreads={style.spreads} />
      <Panel title="小队搭配" hint="风格重叠与缺口">
        {style.overlaps.length > 0 && <div><h4>风格相近的搭档</h4>{style.overlaps.map((overlap) => <p className="av-pair" key={overlap.accountIds.join('|')}><b>{overlap.names.join(' × ')}</b>相似度 {overlap.similarity.toFixed(2)}，都表现为：{overlap.sharedTraits.join('；')}。</p>)}</div>}
        {style.gaps.length > 0 && <div><h4>小队缺口</h4><ul className="av-traits">{style.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul></div>}
        {style.overlaps.length === 0 && style.gaps.length === 0 && <p className="av-note">没有发现明显的风格重叠或缺口。</p>}
        <p className="av-note">{style.notes.join(' ')}</p>
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
        <p className="av-note">{data.landing.notes.join(' ')}</p>
      </Panel>

      <RolePanel roles={data.roles} />
      <p className="av-note">{combat.notes.join(' ')}</p>
    </div>
  );
}
