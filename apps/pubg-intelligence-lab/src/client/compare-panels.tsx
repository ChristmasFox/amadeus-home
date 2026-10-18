import { useMemo, useState, type ReactNode } from 'react';

export interface CompareMatch {
  t: number;
  rank: number | null;
  per: Record<string, { damage: number; kills: number; knocks: number; assists: number; survival: number; revives: number }>;
}

export interface CompareSeries {
  players: Array<{ accountId: string; name: string }>;
  matches: CompareMatch[];
}

type MetricKey = 'damage' | 'kills' | 'knocks' | 'assists' | 'survival';

const METRICS: Array<{ key: MetricKey; label: string; unit: string; digits: number }> = [
  { key: 'damage', label: '伤害', unit: '', digits: 0 },
  { key: 'kills', label: '击杀', unit: '', digits: 1 },
  { key: 'knocks', label: '击倒', unit: '', digits: 1 },
  { key: 'assists', label: '助攻', unit: '', digits: 1 },
  { key: 'survival', label: '存活', unit: '分', digits: 1 },
];

const mean = (values: readonly number[]): number | null => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

function quantile(values: readonly number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
}

function fmt(value: number | null, digits: number): string {
  return value === null ? '—' : value.toFixed(digits);
}

function valuesOf(series: CompareSeries, id: string, key: MetricKey): Array<{ t: number; value: number }> {
  return series.matches.filter((match) => match.per[id]).map((match) => ({ t: match.t, value: match.per[id]![key] }));
}

function Panel({ title, hint, children, className = '' }: { title: string; hint?: string; children: ReactNode; className?: string }) {
  return <section className={`av-panel ${className}`}><header><h3>{title}</h3>{hint && <span>{hint}</span>}</header>{children}</section>;
}

export interface CompareSide {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Same-match head to head

export function HeadToHead({ series, a, b }: { series: CompareSeries; a: CompareSide; b: CompareSide }) {
  const shared = series.matches.filter((match) => match.per[a.id] && match.per[b.id]);
  if (shared.length < 5) return <Panel title="同场对决" hint="两人同时在场的比赛里，谁更强"><p className="av-note">两人共同出场的比赛不足 5 场，无法逐场比较。</p></Panel>;
  return (
    <Panel title="同场对决" hint={`两人都在场的 ${shared.length} 场比赛，逐场比；差距小于 5% 算平`}>
      <div className="cp-h2h">
        {METRICS.map((metric) => {
          let winsA = 0;
          let winsB = 0;
          let ties = 0;
          for (const match of shared) {
            const left = match.per[a.id]![metric.key];
            const right = match.per[b.id]![metric.key];
            const top = Math.max(Math.abs(left), Math.abs(right));
            if (top === 0 || Math.abs(left - right) / top < 0.05) ties += 1;
            else if (left > right) winsA += 1;
            else winsB += 1;
          }
          const meanA = mean(shared.map((match) => match.per[a.id]![metric.key]));
          const meanB = mean(shared.map((match) => match.per[b.id]![metric.key]));
          const total = shared.length;
          return <div className="cp-h2h-row" key={metric.key}>
            <span className="num a">{winsA}</span>
            <div className="bar">
              <i className="a" style={{ width: `${(winsA / total) * 100}%` }} />
              <i className="tie" style={{ width: `${(ties / total) * 100}%` }} />
              <i className="b" style={{ width: `${(winsB / total) * 100}%` }} />
              <b>{metric.label}</b>
            </div>
            <span className="num b">{winsB}</span>
            <small>场均 <em className="a">{fmt(meanA, metric.digits)}</em> : <em className="b">{fmt(meanB, metric.digits)}</em>{metric.unit}{ties > 0 ? ` · 平 ${ties}` : ''}</small>
          </div>;
        })}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// 2 + 3. Trend and distribution, driven by one metric switch

const TREND_W = 640;
const TREND_H = 230;
const ROLLING = 10;

function rolling(values: Array<{ t: number; value: number }>, window: number): Array<{ t: number; value: number }> {
  return values.map((point, index) => ({ t: point.t, value: mean(values.slice(Math.max(0, index - window + 1), index + 1).map((item) => item.value))! }));
}

function TrendChart({ lines, digits }: { lines: Array<{ tone: 'a' | 'b'; points: Array<{ t: number; value: number }>; raw: Array<{ t: number; value: number }> }>; digits: number }) {
  const all = lines.flatMap((line) => line.points);
  if (all.length < 3) return <p className="av-note">场次太少，画不出趋势。</p>;
  const minT = Math.min(...all.map((point) => point.t));
  const maxT = Math.max(...all.map((point) => point.t));
  const raws = lines.flatMap((line) => line.raw.map((point) => point.value));
  const top = Math.max(...all.map((point) => point.value)) * 1.15 || 1;
  const left = 44;
  const bottom = 26;
  const x = (t: number) => left + ((t - minT) / Math.max(1, maxT - minT)) * (TREND_W - left - 10);
  const y = (value: number) => TREND_H - bottom - (value / top) * (TREND_H - bottom - 14);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => top * fraction);
  const months = new Set<string>();
  const labels: Array<{ t: number; text: string }> = [];
  for (let index = 0; index <= 4; index += 1) {
    const t = minT + ((maxT - minT) * index) / 4;
    const text = new Date(t).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
    if (!months.has(text)) { months.add(text); labels.push({ t, text }); }
  }
  void raws;
  return (
    <svg viewBox={`0 0 ${TREND_W} ${TREND_H}`} className="cp-trend" role="img" aria-label="滚动平均趋势">
      {ticks.map((tick) => <g key={tick}><line x1={left} x2={TREND_W - 10} y1={y(tick)} y2={y(tick)} className="grid" /><text x={left - 6} y={y(tick) + 3} textAnchor="end">{tick.toFixed(digits > 0 ? 1 : 0)}</text></g>)}
      {labels.map((label) => <text key={label.text} x={x(label.t)} y={TREND_H - 8} textAnchor="middle">{label.text}</text>)}
      {lines.map((line) => <g key={line.tone} className={line.tone}>
        {line.raw.map((point, index) => <circle key={index} cx={x(point.t)} cy={y(point.value)} r={1.6} className="raw" />)}
        <path d={`${line.points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.t).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ')}`} className="line" />
        <circle cx={x(line.points.at(-1)!.t)} cy={y(line.points.at(-1)!.value)} r={4} className="end" />
      </g>)}
    </svg>
  );
}

function Histogram({ a, b, digits }: { a: number[]; b: number[]; digits: number }) {
  const all = [...a, ...b];
  if (all.length < 8) return <p className="av-note">场次太少，画不出分布。</p>;
  const cap = quantile(all, 0.97) ?? 1;
  const bins = 14;
  const width = cap / bins || 1;
  const count = (values: number[]) => {
    const result = new Array<number>(bins).fill(0);
    for (const value of values) result[Math.min(bins - 1, Math.floor(value / width))]! += 1;
    return result.map((item) => item / Math.max(1, values.length));
  };
  const countA = count(a);
  const countB = count(b);
  const peak = Math.max(...countA, ...countB, 0.01);
  const W = 640;
  const H = 190;
  const left = 8;
  const bottom = 24;
  const slot = (W - left - 8) / bins;
  const medianA = quantile(a, 0.5);
  const medianB = quantile(b, 0.5);
  const x = (value: number) => left + Math.min(bins, value / width) * slot;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="cp-hist" role="img" aria-label="分布对比">
      {countA.map((value, index) => <rect key={`a${index}`} x={left + index * slot + 1} width={slot / 2 - 1} y={H - bottom - (value / peak) * (H - bottom - 18)} height={(value / peak) * (H - bottom - 18)} className="a" rx={2} />)}
      {countB.map((value, index) => <rect key={`b${index}`} x={left + index * slot + slot / 2} width={slot / 2 - 1} y={H - bottom - (value / peak) * (H - bottom - 18)} height={(value / peak) * (H - bottom - 18)} className="b" rx={2} />)}
      {medianA !== null && <g className="med a"><line x1={x(medianA)} x2={x(medianA)} y1={10} y2={H - bottom} /><text x={x(medianA)} y={9} textAnchor="middle">中位 {fmt(medianA, digits)}</text></g>}
      {medianB !== null && <g className="med b"><line x1={x(medianB)} x2={x(medianB)} y1={10} y2={H - bottom} /><text x={x(medianB)} y={H - bottom + 12} textAnchor="middle">中位 {fmt(medianB, digits)}</text></g>}
      {[0, 0.25, 0.5, 0.75, 1].map((fraction) => <text key={fraction} x={left + fraction * bins * slot} y={H - 4} textAnchor={fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'} className="axis">{fmt(cap * fraction, digits)}{fraction === 1 ? '+' : ''}</text>)}
    </svg>
  );
}

export function TrendAndSpread({ series, a, b }: { series: CompareSeries; a: CompareSide; b: CompareSide }) {
  const [key, setKey] = useState<MetricKey>('damage');
  const metric = METRICS.find((item) => item.key === key)!;
  const rawA = useMemo(() => valuesOf(series, a.id, key), [series, a.id, key]);
  const rawB = useMemo(() => valuesOf(series, b.id, key), [series, b.id, key]);
  const valuesA = rawA.map((point) => point.value);
  const valuesB = rawB.map((point) => point.value);
  const recent = (raw: Array<{ value: number }>) => {
    const last = raw.slice(-20).map((point) => point.value);
    const before = raw.slice(0, -20).map((point) => point.value);
    const now = mean(last);
    const base = mean(before);
    return { now, base, change: now !== null && base !== null && base > 0 && before.length >= 10 ? now / base - 1 : null };
  };
  const formA = recent(rawA);
  const formB = recent(rawB);
  const stat = (values: number[], fraction: number) => quantile(values, fraction);
  return (
    <Panel title="状态与稳定性" hint="切换指标，趋势和分布一起变化">
      <div className="cp-tabs">{METRICS.map((item) => <button type="button" key={item.key} className={item.key === key ? 'active' : ''} onClick={() => setKey(item.key)}>{item.label}</button>)}</div>
      <div className="cp-twin">
        <div>
          <h4>近 {ROLLING} 场滚动平均 <small>点 = 每一场，线 = 滚动平均</small></h4>
          <TrendChart digits={metric.digits} lines={[{ tone: 'a', points: rolling(rawA, ROLLING), raw: rawA }, { tone: 'b', points: rolling(rawB, ROLLING), raw: rawB }]} />
          <div className="cp-form">
            {[{ side: a, tone: 'a', form: formA }, { side: b, tone: 'b', form: formB }].map(({ side, tone, form }) => <span key={side.id} className={tone}>
              <b>{side.name.replace(/^SG_LabmemNo/u, 'No.')}</b> 近 20 场 {fmt(form.now, metric.digits)}
              {form.change !== null && <em className={form.change >= 0.1 ? 'up' : form.change <= -0.1 ? 'down' : ''}> {form.change >= 0 ? '+' : ''}{(form.change * 100).toFixed(0)}% vs 此前</em>}
            </span>)}
          </div>
        </div>
        <div>
          <h4>{metric.label}分布 <small>每根柱 = 该区间的场次占比</small></h4>
          <Histogram a={valuesA} b={valuesB} digits={metric.digits} />
          <div className="cp-spread">
            {[{ side: a, tone: 'a', values: valuesA }, { side: b, tone: 'b', values: valuesB }].map(({ side, tone, values }) => <span key={side.id} className={tone}>
              <b>{side.name.replace(/^SG_LabmemNo/u, 'No.')}</b>
              爆发（前 10%）{fmt(stat(values, 0.9), metric.digits)} · 保底（后 25%）{fmt(stat(values, 0.25), metric.digits)}
            </span>)}
          </div>
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Weapons side by side

export function WeaponCompare({ a, b, classLabel }: { a: { name: string; classShares: Array<{ weaponClass: string; share: number }>; weapons: Array<{ weapon: string; share: number }> }; b: { name: string; classShares: Array<{ weaponClass: string; share: number }>; weapons: Array<{ weapon: string; share: number }> }; classLabel: Record<string, string> }) {
  const classes = [...new Set([...a.classShares, ...b.classShares].map((entry) => entry.weaponClass))];
  const share = (side: typeof a, weaponClass: string) => side.classShares.find((entry) => entry.weaponClass === weaponClass)?.share ?? 0;
  const maxShare = Math.max(0.01, ...classes.flatMap((weaponClass) => [share(a, weaponClass), share(b, weaponClass)]));
  return (
    <Panel title="武器偏好对比" hint="按伤害占比；两侧条形越长，越偏爱这类武器">
      <div className="cp-weapons">
        {classes.sort((left, right) => share(b, right) + share(a, right) - share(a, left) - share(b, left)).map((weaponClass) => <div className="cp-weapon-row" key={weaponClass}>
          <span className="v a">{share(a, weaponClass) > 0 ? `${Math.round(share(a, weaponClass) * 100)}%` : '—'}</span>
          <span className="bar a"><i style={{ width: `${(share(a, weaponClass) / maxShare) * 100}%` }} /></span>
          <b>{classLabel[weaponClass] ?? weaponClass}</b>
          <span className="bar b"><i style={{ width: `${(share(b, weaponClass) / maxShare) * 100}%` }} /></span>
          <span className="v b">{share(b, weaponClass) > 0 ? `${Math.round(share(b, weaponClass) * 100)}%` : '—'}</span>
        </div>)}
      </div>
      <div className="cp-top-weapons">
        <div className="a"><h4>{a.name.replace(/^SG_LabmemNo/u, 'No.')} 常用</h4>{a.weapons.map((weapon) => <span key={weapon.weapon}>{weapon.weapon} <em>{Math.round(weapon.share * 100)}%</em></span>)}</div>
        <div className="b"><h4>{b.name.replace(/^SG_LabmemNo/u, 'No.')} 常用</h4>{b.weapons.map((weapon) => <span key={weapon.weapon}>{weapon.weapon} <em>{Math.round(weapon.share * 100)}%</em></span>)}</div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Strengths and fit

export interface Contrast {
  label: string;
  /** Positive when side A is ahead, negative when side B is ahead; magnitude is the relative gap. */
  gap: number;
}

/** How alike two players are: cosine similarity of their log ratios to the squad on the radar axes. */
export function styleSimilarity(left: number[], right: number[]): number | null {
  if (left.length < 4 || left.length !== right.length) return null;
  const dot = left.reduce((sum, value, index) => sum + value * right[index]!, 0);
  const normLeft = Math.sqrt(left.reduce((sum, value) => sum + value * value, 0));
  const normRight = Math.sqrt(right.reduce((sum, value) => sum + value * value, 0));
  return normLeft > 0 && normRight > 0 ? dot / (normLeft * normRight) : null;
}

export function Complement({ a, b, contrasts, similarity }: { a: CompareSide; b: CompareSide; contrasts: Contrast[]; similarity: number | null }) {
  const lead = (sign: 1 | -1) => contrasts.filter((item) => item.gap * sign > 0.1).sort((left, right) => Math.abs(right.gap) - Math.abs(left.gap)).slice(0, 4);
  const aLead = lead(1);
  const bLead = lead(-1);
  const verdict = similarity === null ? null
    : similarity >= 0.6 ? '风格相近：两人打法重叠度高，容易互相顶替，也可能抢同一种位置。'
      : similarity <= 0.1 ? '风格互补：两人的强项几乎不重叠，搭配起来能覆盖更多局面。'
        : '风格有交集也有差异：既能默契配合，又各有分工。';
  return (
    <Panel title="优势互补" hint="差距超过 10% 才算明显优势">
      {similarity !== null && <div className="cp-fit"><div className="meter"><i style={{ width: `${Math.max(0, Math.min(1, (similarity + 1) / 2)) * 100}%` }} /></div><span>风格相似度 <b>{Math.round(similarity * 100)}</b>　{verdict}</span></div>}
      <div className="cp-strengths">
        <div className="a"><h4>{a.name.replace(/^SG_LabmemNo/u, 'No.')} 更强</h4>{aLead.length ? <ul>{aLead.map((item) => <li key={item.label}><span>{item.label}</span><b>+{Math.round(Math.abs(item.gap) * 100)}%</b></li>)}</ul> : <p className="av-note">没有明显领先的维度。</p>}</div>
        <div className="b"><h4>{b.name.replace(/^SG_LabmemNo/u, 'No.')} 更强</h4>{bLead.length ? <ul>{bLead.map((item) => <li key={item.label}><span>{item.label}</span><b>+{Math.round(Math.abs(item.gap) * 100)}%</b></li>)}</ul> : <p className="av-note">没有明显领先的维度。</p>}</div>
      </div>
    </Panel>
  );
}
