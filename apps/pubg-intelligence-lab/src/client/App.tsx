import { useEffect, useMemo, useState, type FormEvent } from 'react';

interface SquadOption {
  id: string;
  label: string;
  members: string[];
  matchCount: number;
}

interface Bootstrap {
  matchCount: number;
  telemetryCachedMatchCount: number;
  parserVersion: string;
  featureVersion: string;
  dateFrom: string | null;
  dateTo: string | null;
  modelEnabled: boolean;
  selectedSquadId: string;
  squads: SquadOption[];
}

interface MatchRow {
  matchId: string;
  createdAt: string | null;
  mapName: string;
  gameMode: string;
  duration: number;
  placement: number | null;
  kills: number;
  damage: number;
  players: Array<{ name: string; kills: number; damage: number; rank: number | null }>;
  telemetry: 'HIT' | 'MISSING';
}

interface MatchDetail {
  match: MatchRow;
  telemetry: { status: 'HIT' | 'MISSING'; parserVersion: string; featureVersion: string; createdAt?: string };
  analysis: {
    summary: string;
    teamStory: string | null;
    good: string[];
    improvements: string[];
    players: Array<{ name: string; kills: number; knocks: number; damage: number; revives: number; role: string | null }>;
  };
  evidence: Array<{ id: string; source: 'match_store' | 'telemetry'; kind: string; description: string }>;
}

interface ResearchReport {
  status: 'ok' | 'partial' | 'empty';
  action: string;
  metric: string | null;
  scope: { squadLabel: string; from: string | null; to: string | null; selectedMatches: number; availableMatches: number };
  summary: { totalKills: number; totalDamage: number; averageKills: number; averageDamage: number; averageKnocks: number; averageRevives: number; wins: number; top10: number; rankedMatches: number; winRate: number | null; top10Rate: number | null };
  telemetry: { currentCacheMatches: number; missingCurrentCacheMatches: number; coverageRate: number | null };
  players: Array<{ id: string; name: string; matches: number; kills: number; damage: number; knocks: number; revives: number; averageDamage: number; wins: number }>;
  breakdown: Array<{ label: string; matches: number; rankedMatches: number; total: number; average: number; wins: number; top10: number }>;
  evidence: Array<{ id: string; matchId: string; occurredAt: string | null; mapName: string; source: string; field: string; value: string; description: string }>;
  evidenceCount: number;
  answer: string;
}

interface ResearchResponse {
  runId: string;
  intent: { action: string; metric: string | null; groupBy: string | null };
  plannerSource: 'ai-sdk' | 'local-rule';
  report: ResearchReport;
}

interface ChatEntry {
  role: 'user' | 'assistant';
  text: string;
  result?: ResearchResponse;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? 'request_failed');
  return payload;
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

function number(value: number): string {
  return Math.round(value).toLocaleString('zh-CN');
}

function percent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function safeQuestion(value: string): string {
  return value.slice(0, 1200)
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/gu, '[手机号已隐藏]')
    .replace(/\b(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})\b/giu, '[凭据已隐藏]')
    .replace(/\b(api[_ -]?key|access[_ -]?token|app[_ -]?secret|bot[_ -]?token|password)\s*[:=]\s*[^\s,;]+/giu, '$1=[凭据已隐藏]');
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

function ResultBlock({ result }: { result: ResearchResponse }) {
  const { report } = result;
  const maxBar = Math.max(1, ...report.breakdown.map((item) => item.average));
  return (
    <div className="result-block">
      <div className="result-heading"><span className="result-dot" />研究结果 <span className="result-scope">{report.scope.squadLabel} · {report.scope.selectedMatches} 场</span></div>
      <p className="result-answer">{report.answer}</p>
      <div className="result-metrics">
        <Metric label="平均伤害" value={number(report.summary.averageDamage)} />
        <Metric label="总击杀" value={number(report.summary.totalKills)} />
        <Metric label="吃鸡" value={`${report.summary.wins}`} detail={percent(report.summary.winRate)} />
        <Metric label="Telemetry v6" value={`${report.telemetry.currentCacheMatches}/${report.scope.selectedMatches}`} detail={percent(report.telemetry.coverageRate)} />
      </div>
      {report.breakdown.length > 0 && <div className="breakdown-list">
        {report.breakdown.map((item) => <div className="breakdown-row" key={item.label}>
          <div className="breakdown-label"><span>{item.label}</span><small>{item.matches} 场 · {number(item.average)} / 场</small></div>
          <div className="bar-track"><i style={{ width: `${Math.max(3, item.average / maxBar * 100)}%` }} /></div>
        </div>)}
      </div>}
      {report.action === 'player_comparison' && report.players.length > 0 && <div className="mini-player-list">
        {report.players.slice(0, 5).map((player, index) => <div className="mini-player" key={player.id}><span className="mini-rank">0{index + 1}</span><span>{player.name}</span><b>{number(report.metric === 'kills' ? player.kills : player.damage)}</b><small>{report.metric === 'kills' ? 'kills' : 'damage'}</small></div>)}
      </div>}
      <div className="result-foot"><span>{report.evidenceCount} 条比赛证据</span><span className={report.status === 'partial' ? 'status-partial' : ''}>{report.status === 'partial' ? 'Telemetry 部分覆盖' : report.status === 'empty' ? '无匹配数据' : 'Match Store 已核对'}</span></div>
    </div>
  );
}

export function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [squadId, setSquadId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [totalMatches, setTotalMatches] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selectedMatchId, setSelectedMatchId] = useState('');
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [activeResearch, setActiveResearch] = useState<ResearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void json<Bootstrap>('/api/bootstrap').then((data) => {
      setBootstrap(data);
      setSquadId(data.selectedSquadId);
      setFrom(data.dateFrom ?? '');
      setTo(data.dateTo ?? '');
    }).catch(() => setError('无法读取本地只读数据快照。'));
  }, []);

  useEffect(() => {
    if (!bootstrap || !squadId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ squadId, offset: String(offset) });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (search.trim()) params.set('search', search.trim());
    void json<{ total: number; matches: MatchRow[] }>(`/api/matches?${params}`, { signal: controller.signal })
      .then((data) => {
        setTotalMatches(data.total);
        setMatches((current) => offset === 0 ? data.matches : [...current, ...data.matches]);
        if (offset === 0 && data.matches[0] && !data.matches.some((item) => item.matchId === selectedMatchId)) setSelectedMatchId(data.matches[0].matchId);
        if (offset === 0 && !data.matches.length) setSelectedMatchId('');
      })
      .catch((reason: unknown) => { if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError('比赛列表读取失败。'); });
    return () => controller.abort();
  }, [bootstrap, squadId, from, to, search, offset]);

  useEffect(() => {
    if (!selectedMatchId || !squadId) { setDetail(null); return; }
    const controller = new AbortController();
    setDetailLoading(true);
    void json<MatchDetail>(`/api/matches/${encodeURIComponent(selectedMatchId)}?squadId=${encodeURIComponent(squadId)}`, { signal: controller.signal })
      .then(setDetail)
      .catch((reason: unknown) => { if (!(reason instanceof DOMException && reason.name === 'AbortError')) setDetail(null); })
      .finally(() => setDetailLoading(false));
    return () => controller.abort();
  }, [selectedMatchId, squadId]);

  const currentSquad = useMemo(() => bootstrap?.squads.find((squad) => squad.id === squadId), [bootstrap, squadId]);

  async function submitQuestion(event?: FormEvent, suggested?: string) {
    event?.preventDefault();
    const value = safeQuestion((suggested ?? question).trim());
    if (!value || loading) return;
    setQuestion('');
    setError('');
    setLoading(true);
    setChat((entries) => [...entries, { role: 'user', text: value }]);
    try {
      const result = await json<ResearchResponse>('/api/research', {
        method: 'POST',
        body: JSON.stringify({ question: value, squadId, from, to }),
      });
      setActiveResearch(result);
      setChat((entries) => [...entries, { role: 'assistant', text: result.report.answer, result }]);
    } catch {
      setChat((entries) => [...entries, { role: 'assistant', text: '这次研究没有完成。请检查时间范围后重试。' }]);
    } finally {
      setLoading(false);
    }
  }

  function changeScope(action: () => void) {
    action();
    setOffset(0);
    setMatches([]);
    setSelectedMatchId('');
    setDetail(null);
  }

  if (!bootstrap && !error) return <div className="boot-screen"><div className="boot-mark">P</div><span>正在载入本地研究快照</span></div>;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark">P<span>•</span></div><div><strong>PUBG INTELLIGENCE LAB</strong><small>LOCAL RESEARCH / R0</small></div></div>
        <div className="topbar-right"><div className="source-pill"><span className="pulse" />只读快照 <b>{number(bootstrap?.matchCount ?? 0)} 场</b></div><div className="model-pill"><i>{bootstrap?.modelEnabled ? '✦' : '⌁'}</i>{bootstrap?.modelEnabled ? 'AI SDK 已配置' : '本地语义解析'}</div><div className="avatar">IL</div></div>
      </header>

      <main className="dashboard">
        <aside className="left-rail">
          <div className="rail-heading"><div><span className="eyebrow">DATA SCOPE</span><h1>比赛档案</h1></div><span className="count-chip">{totalMatches}</span></div>
          <label className="field-label" htmlFor="squad">研究小队</label>
          <select id="squad" value={squadId} onChange={(event) => changeScope(() => setSquadId(event.target.value))}>
            <option value="all">全部队员 · {bootstrap?.matchCount ?? 0} 场</option>
            {bootstrap?.squads.map((squad) => <option value={squad.id} key={squad.id}>{squad.label} · {squad.members.length} 人</option>)}
          </select>
          <div className="selected-roster">{currentSquad?.members.map((member) => <span key={member}>{member}</span>) ?? <span>显示全部已记录队员</span>}</div>
          <div className="date-grid"><label><span className="field-label">开始日期</span><input type="date" value={from} min={bootstrap?.dateFrom ?? undefined} max={to || undefined} onChange={(event) => changeScope(() => setFrom(event.target.value))} /></label><label><span className="field-label">结束日期</span><input type="date" value={to} min={from || undefined} max={bootstrap?.dateTo ?? undefined} onChange={(event) => changeScope(() => setTo(event.target.value))} /></label></div>
          <label className="search-box"><span>⌕</span><input type="search" placeholder="搜索地图或模式" value={search} onChange={(event) => changeScope(() => setSearch(event.target.value))} /><kbd>⌘ K</kbd></label>
          <div className="match-list-heading"><span>历史比赛</span><span>{matches.length} / {totalMatches}</span></div>
          <div className="match-list">
            {matches.map((match, index) => <button className={`match-row ${selectedMatchId === match.matchId ? 'active' : ''}`} key={match.matchId} onClick={() => setSelectedMatchId(match.matchId)}>
              <div className="match-row-top"><span className="match-index">{String(totalMatches - (offset + index)).padStart(3, '0')}</span><span className="match-date">{dateLabel(match.createdAt)}</span><span className={`telemetry-dot ${match.telemetry === 'HIT' ? 'hit' : ''}`} title={match.telemetry === 'HIT' ? 'v6 特征缓存' : '无 v6 特征缓存'} /></div>
              <div className="match-map">{match.mapName}<span>{match.placement ? `#${match.placement}` : '排名未知'}</span></div>
              <div className="match-mini-stats"><span>{match.gameMode.replace('squad-', '') || 'squad'}</span><span>{match.kills} kills</span><span>{number(match.damage)} dmg</span></div>
            </button>)}
            {!matches.length && <div className="empty-list">该筛选条件下没有比赛</div>}
            {matches.length < totalMatches && <button className="load-more" onClick={() => setOffset((value) => value + 100)}>加载更多比赛 <span>↓</span></button>}
          </div>
          <div className="rail-footer"><span>数据源</span><b>Lab SQLite · 只读</b><small>事件缓存 {bootstrap?.telemetryCachedMatchCount ?? 0} 场 / v6</small></div>
        </aside>

        <section className="center-panel">
          <div className="section-title"><div><span className="eyebrow">SQUAD PERFORMANCE DESK</span><h2>研究对话</h2></div><span className="private-badge"><i /> PRIVATE LOCAL</span></div>
          <div className="chat-panel">
            {chat.length === 0 && <div className="chat-welcome"><div className="welcome-orbit"><span>✳</span></div><span className="eyebrow">RESEARCH ASSISTANT / READY</span><h3>从比赛数据里<br /><em>找出下一步。</em></h3><p>用自然语言探索历史对局。每项结论都带有比赛证据，Telemetry 缺失时只分析基础战绩。</p><div className="suggestion-grid">
              {['最近比赛的平均伤害趋势', '比较队员的击杀和伤害', '按地图拆分前十率', 'Telemetry 缓存覆盖情况'].map((item) => <button key={item} onClick={() => void submitQuestion(undefined, item)}>{item}<span>↗</span></button>)}
            </div></div>}
            {chat.map((entry, index) => <div className={`chat-entry ${entry.role}`} key={`${entry.role}-${index}`}>
              <div className="chat-entry-avatar">{entry.role === 'user' ? '你' : 'P'}</div>
              <div className="chat-entry-body"><div className="chat-entry-label">{entry.role === 'user' ? '研究问题' : `LAB ANALYSIS${entry.result ? ` · ${entry.result.plannerSource === 'ai-sdk' ? 'AI SDK' : 'LOCAL'}` : ''}`}</div><p>{entry.text}</p>{entry.result && <ResultBlock result={entry.result} />}</div>
            </div>)}
            {loading && <div className="thinking"><span /><span /><span />正在整理比赛证据…</div>}
          </div>
          <form className="composer" onSubmit={(event) => void submitQuestion(event)}>
            <div className="composer-top"><span>研究问题</span><span>↵ 发送</span></div>
            <textarea rows={2} placeholder="例如：比较最近一个月队员的伤害贡献" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submitQuestion(); } }} />
            <div className="composer-bottom"><span><i />仅使用当前小队与时间范围</span><button type="submit" disabled={!question.trim() || loading}>分析 <b>↗</b></button></div>
          </form>
          <div className="ai-note">{bootstrap?.modelEnabled ? '研究问题会发送到已配置模型做意图识别；统计计算在本机完成。' : '当前使用本地规则解析；不连接外部模型。'} 实验结果独立保存在本机。</div>
        </section>

        <aside className="right-rail">
          <div className="rail-heading analysis-heading"><div><span className="eyebrow">MATCH INSIGHT</span><h2>{detail ? '单局分析' : '分析面板'}</h2></div><span className="spark-icon">✳</span></div>
          {error && <div className="inline-error">{error}</div>}
          {detailLoading && <div className="skeleton-card"><span /><span /><span /></div>}
          {detail && <>
            <div className="selected-match-card"><div className="selected-match-image"><span>{detail.match.mapName.toUpperCase()}</span><i>#{detail.match.placement ?? '—'}</i><div className="image-lines" /></div><div className="selected-match-meta"><div><b>{dateLabel(detail.match.createdAt)}</b><span>{detail.match.gameMode}</span></div><span className={`cache-tag ${detail.telemetry.status === 'HIT' ? 'cached' : 'missing'}`}>{detail.telemetry.status === 'HIT' ? 'V6 CACHED' : 'BASE FACTS'}</span></div>
              <div className="match-metric-grid"><Metric label="击杀" value={number(detail.match.kills)} /><Metric label="伤害" value={number(detail.match.damage)} /><Metric label="队员" value={String(detail.analysis.players.length)} /></div>
            </div>
            <div className="insight-copy"><span className="eyebrow">DOMAIN REVIEW</span><p>{detail.analysis.summary}</p>{detail.analysis.teamStory && <p className="team-story">{detail.analysis.teamStory}</p>}</div>
            {detail.analysis.players.length > 0 && <div className="player-detail-list"><div className="card-label">队员表现 <span>本局</span></div>{detail.analysis.players.slice(0, 4).map((player) => <div className="player-detail" key={player.name}><div className="player-avatar">{player.name.slice(0, 1)}</div><div className="player-detail-name"><b>{player.name}</b><small>{player.role ?? '比赛贡献'}</small></div><div className="player-detail-value"><b>{number(player.damage)}</b><small>伤害</small></div></div>)}</div>}
            {detail.analysis.good.length > 0 && <div className="analysis-list"><div className="card-label">有效执行 <span className="green">+{detail.analysis.good.length}</span></div>{detail.analysis.good.slice(0, 3).map((item, index) => <p key={index}><i>↗</i>{item}</p>)}</div>}
            {detail.analysis.improvements.length > 0 && <div className="analysis-list"><div className="card-label">可复盘点 <span className="amber">{detail.analysis.improvements.length}</span></div>{detail.analysis.improvements.slice(0, 3).map((item, index) => <p key={index}><i>·</i>{item}</p>)}</div>}
          </>}
          {activeResearch && <div className="evidence-card"><div className="evidence-heading"><div><span className="eyebrow">EVIDENCE LEDGER</span><b>研究证据</b></div><span>{activeResearch.report.evidenceCount}</span></div><div className="evidence-list">{activeResearch.report.evidence.slice(0, 10).map((item) => <button className="evidence-row" key={item.id} onClick={() => setSelectedMatchId(item.matchId)}><div className="evidence-ref">{item.source === 'telemetry_feature' ? 'T' : 'M'}</div><div><span>{dateLabel(item.occurredAt)} · {item.mapName}</span><b>{item.value}</b><small>{item.description}</small></div><i>↗</i></button>)}</div></div>}
          {!detail && !activeResearch && !detailLoading && <div className="right-empty"><div className="evidence-empty-icon">⌁</div><b>等待研究输入</b><p>选择一场历史比赛查看领域分析，或发起研究问题。证据会在这里展开。</p></div>}
          {detail && <div className="evidence-card detail-evidence"><div className="evidence-heading"><div><span className="eyebrow">SOURCE TRACE</span><b>单局证据链</b></div><span>{detail.evidence.length}</span></div><div className="evidence-list">{detail.evidence.slice(0, 8).map((item) => <div className="evidence-row static" key={item.id}><div className={`evidence-ref ${item.source === 'telemetry' ? 'telemetry-ref' : ''}`}>{item.id}</div><div><span>{item.source === 'telemetry' ? 'Telemetry 特征' : 'Match Store'} · {item.kind}</span><small>{item.description}</small></div></div>)}</div></div>}
          <div className="right-footer"><span>解析器版本</span><b>{bootstrap?.parserVersion} / {bootstrap?.featureVersion}</b><small>原始事件流已压缩，不在本地实验中重新下载。</small></div>
        </aside>
      </main>
    </div>
  );
}
