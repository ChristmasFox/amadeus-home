import { useEffect, useRef, useState } from 'react';
import type { HighlightKind, MatchHighlight } from '@rine-kit/pubg-intelligence';
import { drawHighlightPoster, exportHighlightPoster, highlightClock, highlightDate } from './highlight-poster.js';
import './highlights.css';

interface HighlightsResponse {
  scope: { selectedMatches: number; analyzedMatches: number; missingMatches: number; failedMatches: number; eligibleMatches: number; truncated: boolean; night: string | null };
  items: MatchHighlight[];
  notes: string[];
}
const labels: Record<HighlightKind, string> = { streak: '连续击倒', wipe: '观测灭队', comeback: '逆风反击', rescue: '队友救援' };

export function HighlightsView({ squadId, mode, from, to }: { squadId: string; mode: string; from: string; to: string }) {
  const [window, setWindow] = useState('recent');
  const [limit, setLimit] = useState(20);
  const [kind, setKind] = useState('all');
  const [data, setData] = useState<HighlightsResponse | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!squadId) return;
    const controller = new AbortController();
    setLoading(true); setData(null); setSelectedId(''); setError(''); setNotice('');
    const params = new URLSearchParams({ squadId, mode, window, limit: String(limit) });
    if (from) params.set('from', from); if (to) params.set('to', to);
    void fetch(`/api/highlights?${params}`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('highlights_failed');
      return response.json() as Promise<HighlightsResponse>;
    }).then((result) => { setData(result); setSelectedId(result.items[0]?.id ?? ''); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError('高光读取失败，请重试。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [squadId, mode, from, to, window, limit, revision]);
  const items = data?.items.filter((item) => kind === 'all' || item.kind === kind) ?? [];
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  useEffect(() => {
    let cancelled = false;
    setNotice('');
    if (canvas.current && selected) {
      drawHighlightPoster(canvas.current, selected);
      void document.fonts.ready.then(() => { if (!cancelled && canvas.current) drawHighlightPoster(canvas.current, selected); });
    }
    return () => { cancelled = true; };
  }, [selected]);
  const exportPoster = async (share: boolean) => {
    if (!selected || exporting) return;
    setExporting(true); setNotice('');
    try { setNotice(await exportHighlightPoster(selected, share) === 'shared' ? '海报已交给系统分享。' : 'PNG 海报已下载，可以直接发到群里。'); }
    catch (reason) { if (!(reason instanceof Error && reason.name === 'AbortError')) setNotice('海报生成失败，请重试。'); }
    finally { setExporting(false); }
  };
  return <div className="workspace-body hl-page">
    <header className="hl-heading"><div><span className="eyebrow">YOUR SQUAD / BEST MOMENTS</span><h1>把精彩，留在这一页。</h1><p>跨局精选连杀、观测灭队、逆风反击与救援。选一个瞬间，带走一张海报。</p></div>
      <div className="hl-controls"><label>采样范围<select aria-label="高光采样范围" value={window} onChange={(event) => setWindow(event.target.value)}><option value="recent">近 N 场</option><option value="night">最近一晚</option></select></label><label>最多读取<select aria-label="高光对局数" value={limit} onChange={(event) => setLimit(Number(event.target.value))}>{[10, 20, 50, 100].map((n) => <option value={n} key={n}>{n} 场</option>)}</select></label></div>
    </header>
    <div className="hl-status" aria-live="polite">{loading ? '正在从原始遥测整理高光…' : data ? `选取 ${data.scope.selectedMatches} 场 · 已分析 ${data.scope.analyzedMatches} 场 · 缺归档 ${data.scope.missingMatches} 场 · 读取失败 ${data.scope.failedMatches} 场${data.scope.night ? ` · ${data.scope.night} 晚（06:00–次日06:00）` : ''}${data.scope.truncated ? ` · 范围共 ${data.scope.eligibleMatches} 场，已按上限截取` : ''}` : ''}</div>
    <p className="hl-scope-note">沿用左侧小队、模式及日期；最近 N 场按实际出战抽样，缺失遥测不以更早的比赛补齐，完整遥测开关不改变这里的抽样。</p>
    {error && <div className="inline-error">{error} <button type="button" onClick={() => setRevision((value) => value + 1)}>重试</button></div>}
    <div className="hl-filters" aria-label="高光类型">{([['all', '全部'], ...Object.entries(labels)]).map(([value, label]) => <button type="button" key={value} aria-pressed={kind === value} onClick={() => setKind(value!)}>{label} <small>{data?.items.filter((item) => value === 'all' || item.kind === value).length ?? 0}</small></button>)}</div>
    {!loading && data && !items.length && <div className="hl-empty"><b>这段记录里还没有匹配的高光。</b><p>可以换一种类型、扩大日期或增加读取场数。缺失遥测的比赛无法判断。</p></div>}
    {selected && <div className="hl-grid"><section className="hl-list" aria-label="跨局高光列表">{items.map((item) => <button type="button" className={`hl-item ${selected.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => { setSelectedId(item.id); setNotice(''); }} aria-pressed={selected.id === item.id}>
      <span className={`hl-type ${item.kind}`}>{labels[item.kind]}</span><strong>{item.title}</strong><span>{item.players.map((player) => player.name).join(' × ')}</span><small>{highlightDate(item.createdAt)} · {item.mapLabel}</small><small>{highlightClock(item.startSeconds)}–{highlightClock(item.endSeconds)} · 对局 {item.matchId.slice(0, 12)}</small>
    </button>)}</section>
      <section className="hl-detail" aria-label="高光详情"><div className="hl-detail-head"><div><span className="eyebrow">MOMENT / {labels[selected.kind]}</span><h2>{selected.title}</h2></div><span>{highlightClock(selected.startSeconds)}</span></div><p className="hl-summary">{selected.summary}</p>
        <div className="hl-actions"><a className="hl-replay" href={`?${new URLSearchParams({ tab: 'match', match: selected.matchId, squadId, mode, t: String(selected.startSeconds), ...(selected.fightIndex === null ? {} : { fight: String(selected.fightIndex) }) })}`}>↗ 跳到这段回放</a><button type="button" disabled={exporting} onClick={() => void exportPoster(false)}>{exporting ? '生成中…' : '下载 PNG 海报'}</button>{typeof navigator.share === 'function' && <button type="button" disabled={exporting} onClick={() => void exportPoster(true)}>分享海报</button>}</div>
        {notice && <p className="hl-notice" role="status">{notice}</p>}
        <canvas ref={canvas} className="hl-poster" aria-label="高光海报预览" />
        <details className="hl-evidence" open><summary>证据摘要 · {selected.evidence.length} 条原始事件</summary><code>对局 {selected.matchId}</code>{selected.evidence.map((ref) => <div key={ref.eventId}><b>{highlightClock(ref.timeSeconds)} · {ref.type}</b><span>{ref.description}</span><code>{ref.eventId}</code></div>)}</details>
        {selected.notes.map((note) => <p className="hl-note" key={note}>{note}</p>)}
      </section></div>}
    {data && <div className="hl-notes">{data.notes.map((note) => <p key={note}>{note}</p>)}</div>}
  </div>;
}
