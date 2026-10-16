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

interface BattleTimelineEvent {
  id: string;
  sourceEventId: string;
  type: string;
  rawType: string;
  timeSeconds: number;
  timestampSource: string;
  actorRef: string | null;
  victimRef: string | null;
  actorTeamRef: string | null;
  victimTeamRef: string | null;
  damage: number | null;
  weapon: string | null;
  location: { x: number | null; y: number | null; z: number | null } | null;
}

interface BattleEpisode {
  id: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  participantRefs: string[];
  teams: Array<{
    teamRef: string | null;
    memberRefs: string[];
    tracked: boolean;
    lastObserved: { active: number; knocked: number; dead: number; unknown: number; completeness: string };
  }>;
  firstKnock: { sourceEventId: string; attackerRef: string | null; victimRef: string | null; timeSeconds: number } | null;
  knockChains: Array<{ knockEventId: string; knockedPlayerRef: string | null; attackerRef: string | null; knockAtSeconds: number; outcome: 'KILL' | 'REVIVE' | null; outcomeEventId: string | null; outcomeAtSeconds: number | null; elapsedSeconds: number | null; windowSeconds: number }>;
  timeline: BattleTimelineEvent[];
  positions: Array<{ sourceEventId: string; playerRef: string; teamRef: string | null; timeSeconds: number; location: { x: number | null; y: number | null; z: number | null } }>;
  circleSampleRefs: string[];
  circleTransitionRefs: string[];
  evidenceEventIds: string[];
  diagnostics: { conflictingStateTransitions: number; unknownTeamContacts: number; ambiguousContextEvents: number; positionsSuppressedBySampling: number };
}

interface BattleCircleSample {
  id: string;
  sourceEventId: string;
  timeSeconds: number | null;
  timestampSource: string;
  alivePlayers: number | null;
  aliveTeams: number | null;
  safetyZone: { center: { x: number | null; y: number | null; z: number | null } | null; radius: number | null };
  poisonGasWarningZone: { center: { x: number | null; y: number | null; z: number | null } | null; radius: number | null };
}

interface BattleCircleTransition {
  id: string;
  fromSampleId: string;
  toSampleId: string;
  fromSourceEventId: string;
  toSourceEventId: string;
  timeSeconds: number;
  changedZones: string[];
}

interface BattleMatchResponse {
  matchId: string;
  status: 'available' | 'no_contact_events' | 'unavailable';
  reason?: string;
  schemaVersion?: number;
  parserVersion?: string;
  episodes?: BattleEpisode[];
  circleSamples?: BattleCircleSample[];
  circleTransitions?: BattleCircleTransition[];
  labels?: { players: Record<string, string>; teams: Record<string, string>; tacticalPlayers?: Record<string, string> };
  diagnostics?: Record<string, number>;
  tactical?: TacticalMatchAnalysis;
}

interface TacticalEvidenceRef {
  matchId: string;
  eventId: string | null;
  timeSeconds: number | null;
  kind: string;
  actorRef?: string | null;
  victimRef?: string | null;
}

interface TacticalInsightCandidate {
  id: string;
  ruleId: string;
  ruleVersion: string;
  category: string;
  title: string;
  status: 'observed' | 'not_observed' | 'incomplete' | 'insufficient_data';
  statement: string;
  metric: { numerator: number | null; denominator: number | null; sampleSize: number; value: number | null; unit: string };
  supportEvents: TacticalEvidenceRef[];
  counterexamples: TacticalEvidenceRef[];
  quality: { grade: 'high' | 'moderate' | 'low' | 'insufficient'; reasons: string[] };
  assumptions: string[];
  pairRefs?: [string, string];
}

interface TacticalMatchAnalysis {
  schemaVersion: number;
  ruleVersion: string;
  matchId: string;
  candidates: TacticalInsightCandidate[];
  pairObservations: Array<{ pairRef: string; pairRefs: [string, string]; matchId: string; eligible: boolean; opportunityCount: number; sharedEngagementCount: number; supportEvents: TacticalEvidenceRef[]; counterexamples: TacticalEvidenceRef[] }>;
  diagnostics: Record<string, number>;
}

interface FrequentPairResponse {
  status: 'available' | 'insufficient_data';
  ruleVersion: string;
  requestedMatches: number;
  analyzedMatches: number;
  unavailableMatches: number;
  candidateCount: number;
  candidates: TacticalInsightCandidate[];
  ruleCoverage: Array<{ ruleId: string; matchCount: number; evaluatedMatchCount: number; unknownMatchCount: number; sampleSize: number; supportEventCount: number; counterexampleEventCount: number }>;
  labels: Record<string, string>;
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
  assistant: {
    version: string;
    status: 'answered' | 'abstained' | 'degraded';
    source: 'ai-sdk' | 'deterministic-fallback';
    template: 'tactical_coaching' | 'squad_humor' | 'chronological_story';
    answer: string;
    claims: Array<{ kind: 'fact' | 'inference' | 'hypothesis'; text: string; evidenceRefs: string[]; evidenceCount: number; assumptions: string[]; uncertainty: string | null }>;
    evidence: Array<{ ref: string; matchId: string; eventId: string | null; timeSeconds: number | null; kind: string }>;
    toolNames: string[];
    degradedReason: string | null;
    labels: Record<string, string>;
  };
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

function battleTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '时间未知';
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

function battleTypeLabel(type: string): string {
  return ({ ATTACK: '开火', DAMAGE: '命中/伤害', KNOCK: '击倒', KILL: '淘汰', REVIVE: '救援', POSITION: '位置采样' } as Record<string, string>)[type] ?? type;
}

function vectorLabel(value: { x: number | null; y: number | null; z: number | null } | null): string {
  if (!value) return '位置未知';
  const fields = [value.x, value.y, value.z].map((part) => part === null ? '—' : Math.round(part).toLocaleString('zh-CN'));
  return `X ${fields[0]} · Y ${fields[1]} · Z ${fields[2]}`;
}

function percent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function TacticalCandidateCard({ candidate, labels }: { candidate: TacticalInsightCandidate; labels: Record<string, string> }) {
  const pairLabel = candidate.pairRefs?.map((ref) => labels[ref] ?? ref).join(' × ');
  const metricValue = candidate.metric.value === null ? '未知' : candidate.metric.value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  const statusLabel = ({ observed: '已观察', not_observed: '无机会样本', incomplete: '部分数据', insufficient_data: '证据不足' } as const)[candidate.status];
  const qualityLabel = ({ high: '较强', moderate: '中等', low: '有限', insufficient: '不足' } as const)[candidate.quality.grade];
  const playerLabel = (ref: string | null | undefined) => ref ? labels[ref] ?? `成员 ${ref.slice(-5)}` : '未知';
  const renderEvidence = (ref: TacticalEvidenceRef, index: number, kind: string) => <div className="tactical-ref-item" key={`${kind}-${index}`}>
    <code>{ref.matchId} / {ref.eventId ?? '比赛级引用'} · {ref.kind}</code>
    {(ref.actorRef || ref.victimRef) && <small>{playerLabel(ref.actorRef)} → {playerLabel(ref.victimRef)}</small>}
  </div>;
  return <article className={`tactical-candidate quality-${candidate.quality.grade}`}>
    <div className="tactical-candidate-heading"><b>{candidate.title}</b><span>{statusLabel} · {qualityLabel}</span></div>
    {pairLabel && <div className="tactical-pair-label">{pairLabel}</div>}
    <p>{candidate.statement}</p>
    <div className="tactical-metric">分子/分母 {candidate.metric.numerator ?? '未知'} / {candidate.metric.denominator ?? '未知'} · 样本 {candidate.metric.sampleSize} · 值 {metricValue} {candidate.metric.unit}</div>
    {candidate.quality.reasons.map((reason, index) => <small className="tactical-note" key={`quality-${index}`}>{reason}</small>)}
    {candidate.assumptions.map((assumption, index) => <small className="tactical-note" key={`assumption-${index}`}>规则：{assumption}</small>)}
    {candidate.supportEvents.length > 0 && <div className="tactical-refs"><span>支持事件</span>{candidate.supportEvents.map((ref, index) => renderEvidence(ref, index, 'support'))}</div>}
    {candidate.counterexamples.length > 0 && <div className="tactical-refs counterexample"><span>反例 / 未支持样本</span>{candidate.counterexamples.map((ref, index) => renderEvidence(ref, index, 'counter'))}</div>}
  </article>;
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

function resolveMemberAliases(value: string, labels: Record<string, string>): string {
  return Object.entries(labels).sort(([left], [right]) => right.length - left.length)
    .reduce((text, [alias, label]) => text.replaceAll(alias, label), value);
}

function ResultBlock({ result, onEvidence }: { result: ResearchResponse; onEvidence: (evidence: ResearchResponse['assistant']['evidence'][number]) => void }) {
  const { report } = result;
  const maxBar = Math.max(1, ...report.breakdown.map((item) => item.average));
  return (
    <div className="result-block">
      <div className="result-heading"><span className="result-dot" />研究结果 <span className="result-scope">{report.scope.squadLabel} · {report.scope.selectedMatches} 场 · {result.assistant.source === 'ai-sdk' ? 'AI SDK' : '本地降级'}</span></div>
      <p className="result-answer">{resolveMemberAliases(result.assistant.answer, result.assistant.labels)}</p>
      {result.assistant.degradedReason && <div className="assistant-degraded">{result.assistant.degradedReason === 'model_unavailable'
        ? '未配置可用 AI 模型；本次展示本机确定性统计。可设置 PUBG_INTELLIGENCE_AI_BASE_URL、PUBG_INTELLIGENCE_AI_API_KEY，并将模型留空以优先尝试 Gemini。'
        : 'AI 输出未通过证据校验；已回退到本机确定性统计。'}</div>}
      {result.assistant.claims.length > 0 && <div className="assistant-claims">{result.assistant.claims.map((claim, index) => <div className="assistant-claim" key={`${claim.kind}-${index}`}>
        <span className={`claim-kind ${claim.kind}`}>{claim.kind === 'fact' ? '事实' : claim.kind === 'inference' ? '推断' : '假设'}</span>
        <p>{resolveMemberAliases(claim.text, result.assistant.labels)}</p>
        <small>{claim.evidenceCount} 条证据</small>
        {claim.assumptions.map((assumption, assumptionIndex) => <small key={`${index}-assumption-${assumptionIndex}`}>假设：{resolveMemberAliases(assumption, result.assistant.labels)}</small>)}
        {claim.uncertainty && <small>{resolveMemberAliases(claim.uncertainty, result.assistant.labels)}</small>}
        <div className="assistant-evidence-links">{claim.evidenceRefs.map((ref) => {
          const evidence = result.assistant.evidence.find((item) => item.ref === ref);
          return evidence ? <button type="button" key={ref} onClick={() => onEvidence(evidence)}>
            {evidence.matchId}{evidence.eventId ? ` · ${evidence.eventId}` : ' · 比赛级引用'}
          </button> : null;
        })}</div>
      </div>)}</div>}
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
  const [battleData, setBattleData] = useState<BattleMatchResponse | null>(null);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState('');
  const [battleLoading, setBattleLoading] = useState(false);
  const [battleError, setBattleError] = useState('');
  const [frequentPairs, setFrequentPairs] = useState<FrequentPairResponse | null>(null);
  const [frequentPairsLoading, setFrequentPairsLoading] = useState(false);
  const [frequentPairsError, setFrequentPairsError] = useState('');
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [researchTemplate, setResearchTemplate] = useState<ResearchResponse['assistant']['template']>('tactical_coaching');
  const [pendingEvidence, setPendingEvidence] = useState<ResearchResponse['assistant']['evidence'][number] | null>(null);
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
    setBattleData(null);
    setSelectedEpisodeId('');
    setBattleError('');
    setDetailLoading(true);
    void json<MatchDetail>(`/api/matches/${encodeURIComponent(selectedMatchId)}?squadId=${encodeURIComponent(squadId)}`, { signal: controller.signal })
      .then(setDetail)
      .catch((reason: unknown) => { if (!(reason instanceof DOMException && reason.name === 'AbortError')) setDetail(null); })
      .finally(() => setDetailLoading(false));
    return () => controller.abort();
  }, [selectedMatchId, squadId]);

  const currentSquad = useMemo(() => bootstrap?.squads.find((squad) => squad.id === squadId), [bootstrap, squadId]);

  useEffect(() => {
    setFrequentPairs(null);
    setFrequentPairsError('');
  }, [squadId, from, to]);

  const selectedEpisode = battleData?.episodes?.find((episode) => episode.id === selectedEpisodeId) ?? battleData?.episodes?.[0] ?? null;
  const circleSamplesById = useMemo(() => new Map((battleData?.circleSamples ?? []).map((sample) => [sample.id, sample])), [battleData]);

  async function loadBattleReconstruction(focusEventId?: string | null) {
    if (!selectedMatchId || battleLoading) return;
    setBattleLoading(true);
    setBattleError('');
    setBattleData(null);
    setSelectedEpisodeId('');
    try {
      const scope = new URLSearchParams({ squadId });
      if (from) scope.set('from', from);
      if (to) scope.set('to', to);
      const result = await json<BattleMatchResponse>(`/api/matches/${encodeURIComponent(selectedMatchId)}/episodes?${scope}`);
      setBattleData(result);
      const focused = focusEventId ? result.episodes?.find((episode) => episode.evidenceEventIds.includes(focusEventId)) : undefined;
      setSelectedEpisodeId(focused?.id ?? result.episodes?.[0]?.id ?? '');
    } catch {
      setBattleError('交战重建读取失败，请稍后重试。');
    } finally {
      setBattleLoading(false);
    }
  }

  function openAssistantEvidence(evidence: ResearchResponse['assistant']['evidence'][number]) {
    setPendingEvidence(evidence);
    if (evidence.matchId !== selectedMatchId) setSelectedMatchId(evidence.matchId);
    else if (evidence.eventId) {
      void loadBattleReconstruction(evidence.eventId);
      setPendingEvidence(null);
    } else setPendingEvidence(null);
  }

  useEffect(() => {
    if (!pendingEvidence || pendingEvidence.matchId !== selectedMatchId || detailLoading) return;
    const focusEventId = pendingEvidence.eventId;
    setPendingEvidence(null);
    if (focusEventId) void loadBattleReconstruction(focusEventId);
  }, [pendingEvidence, selectedMatchId, detailLoading]);

  async function loadFrequentPairs() {
    if (!squadId || frequentPairsLoading) return;
    setFrequentPairsLoading(true);
    setFrequentPairsError('');
    setFrequentPairs(null);
    try {
      const scope = new URLSearchParams({ squadId, limit: '30' });
      if (from) scope.set('from', from);
      if (to) scope.set('to', to);
      setFrequentPairs(await json<FrequentPairResponse>(`/api/tactics/recurrent-pairs?${scope}`));
    } catch {
      setFrequentPairsError('跨局共同交战分析失败；快照保持只读。');
    } finally {
      setFrequentPairsLoading(false);
    }
  }

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
        body: JSON.stringify({
          question: value,
          squadId,
          from,
          to,
          template: researchTemplate,
          history: chat.slice(-6).map(({ role, text }) => ({ role, text })),
        }),
      });
      setActiveResearch(result);
      setChat((entries) => [...entries, { role: 'assistant', text: result.assistant.answer, result }]);
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
        <div className="brand-lockup"><div className="brand-mark">P<span>•</span></div><div><strong>PUBG INTELLIGENCE LAB</strong><small>LOCAL RESEARCH / R1</small></div></div>
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
              <div className="chat-entry-body"><div className="chat-entry-label">{entry.role === 'user' ? '研究问题' : `LAB ANALYSIS${entry.result ? ` · ${entry.result.assistant.source === 'ai-sdk' ? 'AI SDK' : 'LOCAL'}` : ''}`}</div><p>{entry.text}</p>{entry.result && <ResultBlock result={entry.result} onEvidence={openAssistantEvidence} />}</div>
            </div>)}
            {loading && <div className="thinking"><span /><span /><span />正在整理比赛证据…</div>}
          </div>
          <form className="composer" onSubmit={(event) => void submitQuestion(event)}>
            <div className="composer-top"><label>研究问题 <select value={researchTemplate} onChange={(event) => setResearchTemplate(event.target.value as ResearchResponse['assistant']['template'])}>
              <option value="tactical_coaching">战术复盘</option><option value="squad_humor">小队轻松叙事</option><option value="chronological_story">时间线故事</option>
            </select></label><span>↵ 发送</span></div>
            <textarea rows={2} placeholder="例如：比较最近一个月队员的伤害贡献" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submitQuestion(); } }} />
            <div className="composer-bottom"><span><i />仅使用当前小队与时间范围</span><button type="submit" disabled={!question.trim() || loading}>分析 <b>↗</b></button></div>
          </form>
          <div className="ai-note">{bootstrap?.modelEnabled ? 'AI SDK 可读取当前范围内的统计、交战和证据；数值由本机确定性规则计算。' : '未配置模型时仅使用本机确定性统计，并明确标记降级。'} 对话上下文不能改变小队或日期范围。</div>
        </section>

        <aside className="right-rail">
          <div className="rail-heading analysis-heading"><div><span className="eyebrow">MATCH INSIGHT</span><h2>{detail ? '单局分析' : '分析面板'}</h2></div><span className="spark-icon">✳</span></div>
          {error && <div className="inline-error">{error}</div>}
          {detailLoading && <div className="skeleton-card"><span /><span /><span /></div>}
          {detail && <>
            <div className="selected-match-card"><div className="selected-match-image"><span>{detail.match.mapName.toUpperCase()}</span><i>#{detail.match.placement ?? '—'}</i><div className="image-lines" /></div><div className="selected-match-meta"><div><b>{dateLabel(detail.match.createdAt)}</b><span>{detail.match.gameMode}</span></div><span className={`cache-tag ${detail.telemetry.status === 'HIT' ? 'cached' : 'missing'}`}>{detail.telemetry.status === 'HIT' ? 'V6 CACHED' : 'BASE FACTS'}</span></div>
              <div className="match-metric-grid"><Metric label="击杀" value={number(detail.match.kills)} /><Metric label="伤害" value={number(detail.match.damage)} /><Metric label="队员" value={String(detail.analysis.players.length)} /></div>
              <button className="battle-load-button" onClick={() => void loadBattleReconstruction()} disabled={battleLoading}>
                {battleLoading ? '正在读取遥测并重建…' : battleData?.matchId === selectedMatchId ? '重新读取交战时间线' : '重建交战时间线'} <span>↗</span>
              </button>
            </div>
            <div className="insight-copy"><span className="eyebrow">DOMAIN REVIEW</span><p>{detail.analysis.summary}</p>{detail.analysis.teamStory && <p className="team-story">{detail.analysis.teamStory}</p>}</div>
            {detail.analysis.players.length > 0 && <div className="player-detail-list"><div className="card-label">队员表现 <span>本局</span></div>{detail.analysis.players.slice(0, 4).map((player) => <div className="player-detail" key={player.name}><div className="player-avatar">{player.name.slice(0, 1)}</div><div className="player-detail-name"><b>{player.name}</b><small>{player.role ?? '比赛贡献'}</small></div><div className="player-detail-value"><b>{number(player.damage)}</b><small>伤害</small></div></div>)}</div>}
            {detail.analysis.good.length > 0 && <div className="analysis-list"><div className="card-label">有效执行 <span className="green">+{detail.analysis.good.length}</span></div>{detail.analysis.good.slice(0, 3).map((item, index) => <p key={index}><i>↗</i>{item}</p>)}</div>}
            {detail.analysis.improvements.length > 0 && <div className="analysis-list"><div className="card-label">可复盘点 <span className="amber">{detail.analysis.improvements.length}</span></div>{detail.analysis.improvements.slice(0, 3).map((item, index) => <p key={index}><i>·</i>{item}</p>)}</div>}
          </>}
          {detail && <button className="tactical-pairs-button" onClick={() => void loadFrequentPairs()} disabled={frequentPairsLoading}>
            {frequentPairsLoading ? '正在分析当前范围比赛…' : frequentPairs ? `重跑跨局常搭对分析 · ${frequentPairs.analyzedMatches} 场` : '分析跨局常搭对候选 · 最多 30 场'} <span>↗</span>
          </button>}
          {frequentPairsError && <div className="inline-error">{frequentPairsError}</div>}
          {frequentPairs && <section className="tactical-analysis tactical-pair-analysis">
            <div className="evidence-heading"><div><span className="eyebrow">SOCIAL · MATCH HOLDOUT</span><b>重复共同交战候选</b></div><span>{frequentPairs.analyzedMatches}/{frequentPairs.requestedMatches}</span></div>
            <div className="tactical-integrity">规则 {frequentPairs.ruleVersion} · 读取 {frequentPairs.analyzedMatches} 场 · 不可用 {frequentPairs.unavailableMatches} 场 · 共同交战候选 {frequentPairs.candidateCount}</div>
            <details className="tactical-coverage"><summary>逐规则样本覆盖（{frequentPairs.ruleCoverage.length} 条规则）</summary>{frequentPairs.ruleCoverage.map((row) => <div className="tactical-coverage-row" key={row.ruleId}><b>{row.ruleId}</b><span>可评估 {row.evaluatedMatchCount}/{row.matchCount} · 样本 {row.sampleSize} · 支持事件 {row.supportEventCount} · 反例事件 {row.counterexampleEventCount} · 未知比赛 {row.unknownMatchCount}</span></div>)}</details>
            {frequentPairs.candidates.map((candidate) => <TacticalCandidateCard key={candidate.id} candidate={candidate} labels={frequentPairs.labels} />)}
            {!frequentPairs.candidates.length && <p className="tactical-empty">当前范围没有可形成关系候选的同队双人样本。</p>}
          </section>}
          {battleData?.tactical && <section className="tactical-analysis">
            <div className="evidence-heading"><div><span className="eyebrow">TACTICAL / SOCIAL / ROTATION</span><b>单局规则候选</b></div><span>{battleData.tactical.ruleVersion}</span></div>
            <div className="tactical-integrity">schema {battleData.tactical.schemaVersion} · 交战 {battleData.tactical.diagnostics.episodeCount} · 位置样本 {battleData.tactical.diagnostics.positionEventCount} · 队伍字段不完整 {battleData.tactical.diagnostics.incompleteTeamEventCount} · 未识别来源 {battleData.tactical.diagnostics.unmatchedBattleSourceCount}</div>
            {battleData.tactical.candidates.map((candidate) => <TacticalCandidateCard key={candidate.id} candidate={candidate} labels={battleData.labels?.tacticalPlayers ?? {}} />)}
          </section>}
          {activeResearch && <div className="evidence-card"><div className="evidence-heading"><div><span className="eyebrow">EVIDENCE LEDGER</span><b>研究证据</b></div><span>{activeResearch.report.evidenceCount}</span></div><div className="evidence-list">{activeResearch.report.evidence.slice(0, 10).map((item) => <button className="evidence-row" key={item.id} onClick={() => setSelectedMatchId(item.matchId)}><div className="evidence-ref">{item.source === 'telemetry_feature' ? 'T' : 'M'}</div><div><span>{dateLabel(item.occurredAt)} · {item.mapName}</span><b>{item.value}</b><small>{item.description}</small></div><i>↗</i></button>)}</div></div>}
          {!detail && !activeResearch && !detailLoading && <div className="right-empty"><div className="evidence-empty-icon">⌁</div><b>等待研究输入</b><p>选择一场历史比赛查看领域分析，或发起研究问题。证据会在这里展开。</p></div>}
          {detail && <div className="evidence-card detail-evidence"><div className="evidence-heading"><div><span className="eyebrow">SOURCE TRACE</span><b>单局证据链</b></div><span>{detail.evidence.length}</span></div><div className="evidence-list">{detail.evidence.slice(0, 8).map((item) => <div className="evidence-row static" key={item.id}><div className={`evidence-ref ${item.source === 'telemetry' ? 'telemetry-ref' : ''}`}>{item.id}</div><div><span>{item.source === 'telemetry' ? 'Telemetry 特征' : 'Match Store'} · {item.kind}</span><small>{item.description}</small></div></div>)}</div></div>}
          {battleError && <div className="inline-error">{battleError}</div>}
          {battleData?.status === 'unavailable' && <div className="battle-empty"><b>原始遥测不可用</b><span>{battleData.reason === 'no_telemetry_asset_in_snapshot' ? '只读快照没有保存该比赛的遥测资产引用。' : '读取或解析遥测失败；快照未被修改。'}</span></div>}
          {battleData?.status === 'no_contact_events' && <div className="battle-empty"><b>未重建出交战片段</b><span>未发现满足启发式的对敌伤害、击倒或淘汰事件。此结果不代表没有发生交战。</span><small>{battleData.diagnostics?.sameTeamContactEventCount ?? 0} 条同队事件被排除 · {battleData.diagnostics?.untimedContactEventCount ?? 0} 条接触事件缺少时间</small></div>}
          {battleData?.status === 'available' && <section className="battle-reconstruction">
            <div className="evidence-heading"><div><span className="eyebrow">BATTLE RECONSTRUCTION</span><b>交战片段</b></div><span>v{battleData.parserVersion} · {battleData.episodes?.length ?? 0}</span></div>
            <div className="battle-integrity">接触 {battleData.diagnostics?.contactEventCount ?? 0} · 未归属 {battleData.diagnostics?.unassignedContactEventCount ?? 0} · 同队排除 {battleData.diagnostics?.sameTeamContactEventCount ?? 0} · 无效伤害 {battleData.diagnostics?.ineffectiveContactEventCount ?? 0}<br />未知阶段 {battleData.diagnostics?.unknownPhaseContactEventCount ?? 0} · 重复来源 {battleData.diagnostics?.duplicateSourceEventCount ?? 0} · 重复分配 {battleData.diagnostics?.duplicateTimelineAssignmentCount ?? 0} · 队伍未知 {battleData.diagnostics?.unknownTeamContactEventCount ?? 0}<br />状态冲突 {battleData.diagnostics?.conflictingStateTransitionCount ?? 0} · 上下文歧义 {battleData.diagnostics?.ambiguousContextEventCount ?? 0} · 未决 knock 链 {battleData.diagnostics?.unresolvedKnockChainCount ?? 0}<br />圈变化 {battleData.circleTransitions?.length ?? 0} · 未知阶段圈样本 {battleData.diagnostics?.unknownPhaseCircleSampleCount ?? 0} · 共享圈采样 {battleData.diagnostics?.sharedCircleSampleContextCount ?? 0}</div>
            <div className="battle-episode-list">
              {battleData.episodes?.map((episode, index) => <button className={`battle-episode-row ${selectedEpisode?.id === episode.id ? 'active' : ''}`} key={episode.id} onClick={() => setSelectedEpisodeId(episode.id)}>
                <span className="battle-episode-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="battle-episode-main"><b>{battleTime(episode.startSeconds)}–{battleTime(episode.endSeconds)}</b><small>{episode.teams.map((team) => team.teamRef ? battleData.labels?.teams[team.teamRef] ?? '未知队伍' : '队伍未知').join(' vs ')}</small></span>
                <span className="battle-episode-count">{episode.timeline.length}<small>事件</small></span>
              </button>)}
            </div>
            {selectedEpisode && <div className="battle-episode-detail">
              <div className="battle-episode-summary"><span>{battleTime(selectedEpisode.startSeconds)}–{battleTime(selectedEpisode.endSeconds)} · {number(selectedEpisode.durationSeconds)} 秒</span><span>{selectedEpisode.participantRefs.length} 位参与者</span></div>
              {selectedEpisode.firstKnock && <div className="battle-first-knock"><span>首个 knock</span><b>{battleTime(selectedEpisode.firstKnock.timeSeconds)} · {selectedEpisode.firstKnock.attackerRef ? battleData.labels?.players[selectedEpisode.firstKnock.attackerRef] ?? '未知队员' : '未知攻击者'} → {selectedEpisode.firstKnock.victimRef ? battleData.labels?.players[selectedEpisode.firstKnock.victimRef] ?? '未知队员' : '未知目标'}</b><small>证据 {selectedEpisode.firstKnock.sourceEventId}</small></div>}
              <div className="battle-team-states"><div className="card-label">队伍存活状态 <span>仅统计已观测队员</span></div>{selectedEpisode.teams.map((team, index) => <div className="battle-team-state" key={`${team.teamRef ?? 'unknown'}-${index}`}><b>{team.teamRef ? battleData.labels?.teams[team.teamRef] ?? '未知队伍' : '队伍未知'}{team.tracked ? ' · 当前小队' : ''}</b><span>存活观测 {team.lastObserved.active} · 击倒 {team.lastObserved.knocked} · 淘汰 {team.lastObserved.dead} · 未知 {team.lastObserved.unknown}</span></div>)}</div>
              {selectedEpisode.knockChains.length > 0 && <div className="battle-chain-list"><div className="card-label">Knock → kill / revive <span>窗口 120 秒</span></div>{selectedEpisode.knockChains.map((chain) => <div className="battle-chain-row" key={chain.knockEventId}><b>{chain.knockedPlayerRef ? battleData.labels?.players[chain.knockedPlayerRef] ?? '未知队员' : '未知目标'}</b><span>{chain.outcome === 'KILL' ? `淘汰 · ${chain.elapsedSeconds} 秒` : chain.outcome === 'REVIVE' ? `救援 · ${chain.elapsedSeconds} 秒` : '窗口内无唯一结果证据'}</span><small>{chain.knockEventId}{chain.outcomeEventId ? ` → ${chain.outcomeEventId}` : ''}</small></div>)}</div>}
              {selectedEpisode.circleSampleRefs.length > 0 && <div className="battle-circle-list"><div className="card-label">毒圈与存活采样 <span>{selectedEpisode.circleSampleRefs.length} 条</span></div>{selectedEpisode.circleSampleRefs.map((ref) => {
                const sample = circleSamplesById.get(ref);
                if (!sample) return null;
                return <div className="battle-circle-row" key={ref}><b>{battleTime(sample.timeSeconds)} · {sample.aliveTeams ?? '—'} 队 / {sample.alivePlayers ?? '—'} 人</b><span>安全圈半径 {sample.safetyZone.radius ?? '未知'} · 中心 {vectorLabel(sample.safetyZone.center)}</span><small>毒圈预警半径 {sample.poisonGasWarningZone.radius ?? '未知'} · 来源 {sample.sourceEventId} · {sample.timestampSource}</small></div>;
              })}</div>}
              {selectedEpisode.circleTransitionRefs.length > 0 && <div className="battle-circle-list"><div className="card-label">圈状态变化 <span>{selectedEpisode.circleTransitionRefs.length} 次</span></div>{selectedEpisode.circleTransitionRefs.map((ref) => {
                const transition = battleData.circleTransitions?.find((item) => item.id === ref);
                if (!transition) return null;
                return <div className="battle-circle-row" key={ref}><b>{battleTime(transition.timeSeconds)} · {transition.changedZones.join(' / ')}</b><small>{transition.fromSourceEventId} → {transition.toSourceEventId}</small></div>;
              })}</div>}
              {selectedEpisode.positions.length > 0 && <div className="battle-position-list"><div className="card-label">采样位置 <span>{selectedEpisode.positions.length} 个保留样本</span></div>{selectedEpisode.positions.map((position) => <div className="battle-position-row" key={position.sourceEventId}><span>{battleTime(position.timeSeconds)}</span><b>{battleData.labels?.players[position.playerRef] ?? '未知队员'}</b><small>{vectorLabel(position.location)} · {position.sourceEventId}</small></div>)}</div>}
              <div className="battle-timeline"><div className="card-label">底层事件时间线 <span>{selectedEpisode.timeline.length} 条</span></div>{selectedEpisode.timeline.map((item) => <div className="battle-event-row" key={item.sourceEventId}><span className="battle-event-time">{battleTime(item.timeSeconds)}</span><span className={`battle-event-kind ${item.type.toLowerCase()}`}>{battleTypeLabel(item.type)}</span><span className="battle-event-description">{item.actorRef ? battleData.labels?.players[item.actorRef] ?? '未知队员' : '未知来源'}{item.victimRef ? ` → ${battleData.labels?.players[item.victimRef] ?? '未知队员'}` : ''}{item.damage !== null ? ` · ${number(item.damage)} 伤害` : ''}{item.weapon ? ` · ${item.weapon}` : ''}</span><small>{item.sourceEventId} · {item.timestampSource}</small></div>)}</div>
              <div className="battle-evidence-chain"><span>证据链</span><small>{selectedEpisode.evidenceEventIds.join(' · ')}</small></div>
              {(selectedEpisode.diagnostics.unknownTeamContacts > 0 || selectedEpisode.diagnostics.ambiguousContextEvents > 0 || selectedEpisode.diagnostics.conflictingStateTransitions > 0 || selectedEpisode.diagnostics.positionsSuppressedBySampling > 0) && <div className="battle-uncertainty">未决计数：未知队伍 {selectedEpisode.diagnostics.unknownTeamContacts} · 歧义上下文 {selectedEpisode.diagnostics.ambiguousContextEvents} · 冲突状态 {selectedEpisode.diagnostics.conflictingStateTransitions} · 位置降采样 {selectedEpisode.diagnostics.positionsSuppressedBySampling}</div>}
            </div>}
            <div className="battle-evaluation-note">启发式：对敌有效 DAMAGE / KNOCK / KILL 按队伍对聚合；相邻接触间隔 ≤28 秒合并，或 knock 后 120 秒内对应 kill 延续。位置按队员每 15 秒取首条样本；歧义事件不强行归属。圈采样仅作为时间邻近的上下文证据，可被相邻 episode 共享。</div>
          </section>}
          <div className="right-footer"><span>解析器版本</span><b>{bootstrap?.parserVersion} / {bootstrap?.featureVersion} · battle-reconstruction-v1</b><small>交战重建按需从快照内资产引用只读获取；实验结果不写回 Lab 数据库。</small></div>
        </aside>
      </main>
    </div>
  );
}
