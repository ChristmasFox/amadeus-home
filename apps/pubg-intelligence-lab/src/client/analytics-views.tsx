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

export interface TelemetryAnalytics {
  highlights: Insight[];
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
      cells: Array<{ cell: string; matches: number; share: number; top10: Rate; medianPlacement: number | null; earlyWipeRate: number | null; averageDamage: number }>;
      topCellRepeatRate: number | null; medianSpreadMeters: number | null; points: Array<{ x: number; y: number }>;
    }>;
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

      <DeathPanel deaths={data.deaths} />

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
                <div className="av-row head"><span>方格</span><span>场次</span><span>前十率</span><span>早崩率</span><span>人均伤害</span></div>
                {map.cells.slice(0, 8).map((item) => <button type="button" className={`av-row ${item.cell === cell?.cell ? 'active' : ''}`} key={item.cell} onClick={() => setSelectedCell(item.cell)}>
                  <b>{item.cell}</b><span>{item.matches}</span><span>{pct(item.top10.rate)}</span><span className={(item.earlyWipeRate ?? 0) >= 0.4 ? 'down' : ''}>{pct(item.earlyWipeRate)}</span><span>{int(item.averageDamage)}</span>
                </button>)}
              </div>
              {cell && <p className="av-note">{cell.cell} 格：{cell.matches} 场，中位名次 {cell.medianPlacement === null ? '未知' : `#${cell.medianPlacement}`}，前十率区间 {ci(cell.top10)}。</p>}
            </div>
          </div>
        </>}
        <p className="av-note">{data.landing.notes.join(' ')}</p>
      </Panel>
      <p className="av-note">{combat.notes.join(' ')}</p>
    </div>
  );
}
