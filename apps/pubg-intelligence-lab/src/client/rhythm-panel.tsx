import type { ReactNode } from 'react';

interface Interval { mean: number | null; low: number | null; high: number | null }
interface Rate { successes: number; trials: number; rate: number | null; low: number | null; high: number | null }
interface Contrast { diff: number | null; low: number | null; high: number | null; a: number | null; b: number | null; nA: number; nB: number; clear: boolean }

export interface RhythmData {
  matches: number;
  sessions: number;
  sessionStats: { medianGames: number | null; longShare: number | null; medianMinutes: number | null };
  byIndex: Array<{ index: number; orMore: boolean; matches: number; damage: Interval; top10: Rate; medianPlacement: number | null }>;
  byHour: Array<{ hour: number; matches: number; top10: Rate; meanDamage: number | null }>;
  warmup: { damage: Contrast; top10: Contrast } | null;
  fatigue: { damage: Contrast; top10: Contrast; sessions: number } | null;
  tilt: { damage: Contrast; top10: Contrast } | null;
  bestHour: { hour: number; top10: number; matches: number } | null;
  current: { nextGame: number; gamesSoFar: number; minutesSinceLast: number; startedAt: number } | null;
  insights: string[];
  notes: string[];
}

const MIN_HOUR_MATCHES = 12;
const pct = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);

function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <section className="av-panel"><header><h3>{title}</h3>{hint && <span>{hint}</span>}</header>{children}</section>;
}

interface Bar { label: string; value: number | null; low: number | null; high: number | null; count: number; tone?: 'first' | 'dim' | undefined }

/** Bars with 95% whiskers; `max` fixes the scale so two charts of the same metric line up. */
function BarChart({ bars, max, format, unit, width = 520, height = 210 }: { bars: Bar[]; max: number; format: (value: number) => string; unit: string; width?: number; height?: number }) {
  const left = 8;
  const bottom = 36;
  const slot = (width - left - 8) / Math.max(1, bars.length);
  const y = (value: number) => height - bottom - (Math.min(value, max) / max) * (height - bottom - 24);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="rh-bars" role="img" aria-label={unit}>
      <line x1={left} x2={width - 8} y1={height - bottom} y2={height - bottom} className="base" />
      {[0.5, 1].map((fraction) => <line key={fraction} x1={left} x2={width - 8} y1={y(max * fraction)} y2={y(max * fraction)} className="grid" />)}
      {bars.map((bar, index) => {
        const x = left + index * slot + slot * 0.18;
        const w = slot * 0.64;
        const cx = x + w / 2;
        return <g key={bar.label} className={`bar ${bar.tone ?? ''}`}>
          {bar.value !== null && <rect x={x} y={y(bar.value)} width={w} height={Math.max(1, height - bottom - y(bar.value))} rx={3}><title>{`${bar.label}：${format(bar.value)}（${bar.count} 场）`}</title></rect>}
          {bar.low !== null && bar.high !== null && <path d={`M${cx},${y(bar.low)}V${y(bar.high)}M${cx - 4},${y(bar.low)}h8M${cx - 4},${y(bar.high)}h8`} className="whisker" />}
          {bar.value !== null && <text x={cx} y={y(bar.high ?? bar.value) - 5} textAnchor="middle" className="val">{format(bar.value)}</text>}
          <text x={cx} y={height - bottom + 14} textAnchor="middle" className="cat">{bar.label}</text>
          <text x={cx} y={height - bottom + 27} textAnchor="middle" className="n">{bar.count}场</text>
        </g>;
      })}
    </svg>
  );
}

function verdict(contrast: Contrast | null | undefined, goodWhenPositive = true): { text: string; tone: 'good' | 'bad' | 'none' | 'wait' } {
  if (!contrast || contrast.low === null) return { text: '样本不足', tone: 'wait' };
  if (!contrast.clear) return { text: '没有可靠差别', tone: 'none' };
  const better = (contrast.diff ?? 0) > 0 === goodWhenPositive;
  return { text: better ? '有把握：更好' : '有把握：更差', tone: better ? 'good' : 'bad' };
}

function ContrastLine({ label, contrast, unit, scale = 1, digits = 0 }: { label: string; contrast: Contrast | null | undefined; unit: string; scale?: number; digits?: number }) {
  const state = verdict(contrast);
  const f = (value: number | null) => (value === null ? '—' : (value * scale).toFixed(digits));
  return (
    <div className="rh-line">
      <span className="label">{label}</span>
      <b>{f(contrast?.a ?? null)}{unit}</b><span className="vs">对</span><b>{f(contrast?.b ?? null)}{unit}</b>
      <i className={`chip ${state.tone}`}>{state.text}</i>
      {contrast && contrast.low !== null && <small>差 {contrast.diff !== null && contrast.diff > 0 ? '+' : ''}{f(contrast.diff)}{unit}，区间 {f(contrast.low)} 到 {f(contrast.high)}</small>}
    </div>
  );
}

export function RhythmPanel({ data }: { data: RhythmData }) {
  if (data.matches < 20) return null;
  const maxDamage = Math.max(50, ...data.byIndex.map((row) => row.damage.high ?? row.damage.mean ?? 0)) * 1.08;
  const indexBars = (pick: (row: RhythmData['byIndex'][number]) => { value: number | null; low: number | null; high: number | null }): Bar[] => data.byIndex.map((row) => ({ label: `第${row.index}${row.orMore ? '+' : ''}局`, ...pick(row), count: row.matches, tone: row.index === 1 ? 'first' : undefined }));
  const hours = data.byHour.filter((row) => row.matches >= 3);
  const warm = data.warmup;
  const warmState = verdict(warm?.damage);
  return (
    <Panel title="状态与时段" hint={`${data.matches} 场排位 · ${data.sessions} 个时段（间隔超过 40 分钟算新时段）· 不受「仅看完整遥测」影响`}>
      <div className="rh-cards">
        <div className={`rh-card ${data.current ? 'live' : ''}`}>
          <small>{data.current ? '正在进行的时段' : '时段规律'}</small>
          {data.current ? <>
            <b className="big">第 {data.current.nextGame} 局</b>
            <p>今晚已打 {data.current.gamesSoFar} 局，距上一局 {data.current.minutesSinceLast} 分钟。{data.current.gamesSoFar === 0 ? '' : warmState.tone === 'bad' ? '' : '接着打。'}</p>
          </> : <>
            <b className="big">{data.sessionStats.medianGames === null ? '—' : `${data.sessionStats.medianGames} 局`}</b>
            <p>每个时段的中位局数；{data.sessionStats.longShare === null ? '' : `${Math.round(data.sessionStats.longShare * 100)}% 的时段打了 8 局以上，`}{data.sessionStats.medianMinutes === null ? '' : `中位时长约 ${Math.round(data.sessionStats.medianMinutes)} 分钟。`}</p>
          </>}
        </div>
        <div className="rh-card">
          <small>热身效应：第一局 对 之后各局</small>
          <ContrastLine label="人均伤害" contrast={warm?.damage} unit="" />
          <ContrastLine label="前十率" contrast={warm?.top10} unit="%" scale={100} />
        </div>
        <div className="rh-card">
          <small>疲劳与「上头」</small>
          <ContrastLine label="长时段最后 3 局 对 前 3 局" contrast={data.fatigue?.damage} unit="" />
          <ContrastLine label="早死后的下一局 对 其他局" contrast={data.tilt?.damage} unit="" />
        </div>
      </div>

      {data.insights.length > 0 && <ul className="av-verdicts">{data.insights.map((line) => <li key={line}><b>结论</b><span>{line}</span></li>)}</ul>}

      <div className="rh-charts">
        <div>
          <h4>第几局：人均伤害 <small>柱 = 平均，须线 = 95% 区间</small></h4>
          <BarChart bars={indexBars((row) => ({ value: row.damage.mean, low: row.damage.low, high: row.damage.high }))} max={maxDamage} format={(value) => String(Math.round(value))} unit="人均伤害" />
        </div>
        <div>
          <h4>第几局：前十率 <small>须线 = 95% Wilson 区间</small></h4>
          <BarChart bars={indexBars((row) => ({ value: row.top10.rate, low: row.top10.low, high: row.top10.high }))} max={1} format={pct} unit="前十率" />
        </div>
      </div>
      <h4>一天里的哪个钟点 <small>北京时间；{MIN_HOUR_MATCHES} 场以上的钟点用实色，其余淡色仅供参考</small></h4>
      <BarChart
        bars={hours.map((row) => ({ label: `${String(row.hour).padStart(2, '0')}时`, value: row.top10.rate, low: row.top10.low, high: row.top10.high, count: row.matches, tone: row.matches >= MIN_HOUR_MATCHES ? (row.hour === data.bestHour?.hour ? 'first' : undefined) : 'dim' }))}
        max={1}
        format={pct}
        unit="各钟点前十率"
        width={1080}
        height={230}
      />
      <details className="av-notes"><summary>口径说明</summary><div>{data.notes.join(' ')}</div></details>
    </Panel>
  );
}
