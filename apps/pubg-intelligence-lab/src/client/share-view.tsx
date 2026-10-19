import { useEffect, useState } from 'react';
import { MatchStoryView, type MatchStoryData } from './match-story.js';

// Mirrors GET /api/share/view: the review exactly as delivered to the group, and the matches it covers.
interface ShareReview {
  startAt: string;
  endAt: string;
  timezone: string;
  matchCount: number;
  maps: Array<{ mapName: string; count: number }>;
  headline: string;
  placements: Array<number | null>;
  summary: { avgPlacement: number | null; baselineAvgPlacement: number | null; wins: number; top10: number; teamKnocks: number; avgTeamDamage: number };
  findings: Array<{ metric: string; tone: 'good' | 'bad' | 'neutral'; confidence: 'clear' | 'observation'; text: string }>;
  members: Array<{ name: string; matches: number; kills: number; knocks: number; damagePerMatch: number; earlyOuts: number; revives: number; tags: string[] }>;
  suggestion?: string;
  coverage: { telemetry: number; total: number };
}

interface ShareMatch {
  matchId: string;
  available: boolean;
  createdAt?: string | null;
  mapLabel?: string;
  durationSeconds?: number;
  placement?: number | null;
  kills?: number;
  knocks?: number;
  damage?: number;
}

interface ShareView {
  kind: 'session' | 'match';
  expiresAt: string;
  review: ShareReview;
  matches: ShareMatch[];
}

const MAP_NAMES: Record<string, string> = {
  Baltic_Main: '艾伦格', Erangel_Main: '艾伦格', Desert_Main: '米拉玛', Tiger_Main: '泰戈', Neon_Main: '荣都', Kiki_Main: '帝斯顿',
  Savage_Main: '萨诺', DihorOtok_Main: '维寒迪', Chimera_Main: '帕拉莫', Summerland_Main: '卡拉金', Heaven_Main: '哈文',
};

function clock(value: string, timezone: string, withDate = true): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone, ...(withDate ? { month: 'numeric', day: 'numeric' } : {}), hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value));
}

function rankText(rank: number | null | undefined): string {
  if (rank === null || rank === undefined) return '#?';
  return rank === 1 ? '🏆' : `#${rank}`;
}

const TAGS: Record<string, string> = { top_damage: '输出最高', early_outs: '早出局多', medic: '救援最多' };

function ReviewCard({ view }: { view: ShareView }) {
  const { review } = view;
  const single = view.kind === 'match';
  const sameDay = clock(review.startAt, review.timezone).split(' ')[0] === clock(review.endAt, review.timezone).split(' ')[0];
  const window = `${clock(review.startAt, review.timezone)}–${clock(review.endAt, review.timezone, !sameDay)}`;
  const maps = review.maps.map((map) => `${MAP_NAMES[map.mapName] ?? map.mapName.replace(/_Main$/u, '')}${map.count > 1 ? `×${map.count}` : ''}`).join(' · ');
  return (
    <section className="share-card">
      <div className="share-kicker">{single ? '单局复盘' : '时段复盘'} · {window}</div>
      <div className="share-maps">{review.matchCount} 场排位 · {maps}</div>
      <h1 className="share-headline">{review.headline}</h1>
      {!single && <div className="share-strip">{review.placements.map((rank, index) => <span key={index} className={rank !== null && rank <= 10 ? 'top' : ''}>{rankText(rank)}</span>)}</div>}
      <div className="share-stats">
        <div><b>{review.summary.avgPlacement?.toFixed(1) ?? '?'}</b><span>场均名次{review.summary.baselineAvgPlacement !== null ? ` · 平时 ${review.summary.baselineAvgPlacement.toFixed(1)}` : ''}</span></div>
        <div><b>{review.summary.teamKnocks}</b><span>击倒</span></div>
        <div><b>{review.summary.avgTeamDamage}</b><span>场均团队伤害</span></div>
        <div><b>{review.summary.wins} / {review.summary.top10}</b><span>吃鸡 / 前十</span></div>
      </div>
      {review.findings.length > 0 ? (
        <ul className="share-findings">
          {review.findings.map((finding) => (
            <li key={finding.metric} className={finding.tone}>
              <i />{finding.text}{finding.confidence === 'clear' && <em>有把握</em>}
            </li>
          ))}
        </ul>
      ) : <p className="share-plain">各项都在平时的正常波动范围内。</p>}
      {!single && review.members.length > 0 && (
        <div className="share-members">
          {review.members.map((member) => (
            <div key={member.name}>
              <b>{member.name}</b>
              <span>击倒 {member.knocks} · 淘汰 {member.kills} · {member.damagePerMatch}/场{member.matches !== review.matchCount ? ` · ${member.matches} 场` : ''}</span>
              {member.tags.map((tag) => <em key={tag}>{TAGS[tag] ?? tag}</em>)}
            </div>
          ))}
        </div>
      )}
      {review.suggestion && <p className="share-suggestion"><b>下次试试</b>{review.suggestion}</p>}
    </section>
  );
}

/** The read-only page a review link opens: this review, its matches and each match's story, nothing more. */
export function ShareApp() {
  const [view, setView] = useState<ShareView | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [story, setStory] = useState<MatchStoryData | null>(null);
  const [storyLoading, setStoryLoading] = useState(false);

  useEffect(() => {
    // The token only travels once, in the link; keep it out of history and anything copied from the address bar.
    if (window.location.pathname.startsWith('/s/')) window.history.replaceState(null, '', '/share');
    void fetch('/api/share/view', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json() as ShareView;
        setView(data);
        const first = data.matches.find((match) => match.available);
        if (data.kind === 'match' && first) setSelected(first.matchId);
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setStoryLoading(true);
    setStory(null);
    void fetch(`/api/share/matches/${encodeURIComponent(selected)}/story`, { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => (response.ok ? setStory(await response.json() as MatchStoryData) : setStory(null)))
      .finally(() => setStoryLoading(false));
  }, [selected]);

  if (failed) {
    return <div className="share-shell"><div className="share-empty"><h1>链接无效或已过期</h1><p>分享链接 7 天内有效。需要的话请让队友重新发一份。</p></div></div>;
  }
  if (!view) return <div className="boot-screen"><div className="boot-mark">P</div><span>正在载入复盘</span></div>;
  const selectedMatch = view.matches.find((match) => match.matchId === selected);
  return (
    <div className="share-shell">
      <header className="share-top"><div className="brand-mark">P</div><div><strong>PUBG 小队复盘</strong><small>只读分享</small></div></header>
      <ReviewCard view={view} />
      {view.kind === 'session' && (
        <section className="share-list">
          <h2>这几场 <small>点开看每一局的过程</small></h2>
          {view.matches.map((match, index) => (
            <button type="button" key={match.matchId} disabled={!match.available} className={`share-match ${selected === match.matchId ? 'active' : ''}`} onClick={() => setSelected(selected === match.matchId ? null : match.matchId)}>
              <span className="share-match-index">{index + 1}</span>
              <span className="share-match-main"><b>{match.mapLabel ?? '数据同步中'}</b><small>{match.createdAt ? clock(match.createdAt, view.review.timezone, false) : ''}</small></span>
              <span className="share-match-rank">{rankText(match.placement)}</span>
              <span className="share-match-meta">{match.available ? `击倒 ${match.knocks} · 伤害 ${match.damage}` : ''}</span>
            </button>
          ))}
        </section>
      )}
      {selectedMatch && (
        <section className="share-story">
          <MatchStoryView data={story} loading={storyLoading} placement={selectedMatch.placement ?? null} kills={selectedMatch.kills ?? 0} damage={selectedMatch.damage ?? 0} />
        </section>
      )}
      <footer className="share-foot">只读分享 · 仅包含本次复盘的 {view.matches.length} 场 · {clock(view.expiresAt, view.review.timezone)} 前有效 · 敌方队伍已匿名</footer>
    </div>
  );
}
