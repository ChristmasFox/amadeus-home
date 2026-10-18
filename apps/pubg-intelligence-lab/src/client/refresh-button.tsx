import { useCallback, useEffect, useRef, useState } from 'react';

interface RefreshStatus {
  state: 'idle' | 'running' | 'done';
  requestedAt: string | null;
  fetch: string | null;
  changed: boolean | null;
  matches: number | null;
  previousMatches: number | null;
  cooldownSeconds: number;
}

const POLL_MS = 3000;

async function readStatus(): Promise<RefreshStatus | null> {
  try {
    const response = await fetch('/api/refresh');
    return response.ok ? await response.json() as RefreshStatus : null;
  } catch {
    // The page restarts itself when new data arrives; a failed poll just means "not back yet".
    return null;
  }
}

/** Fetches the newest matches from the Lab and reloads the page once the new snapshot is in place. */
export function RefreshButton() {
  const [phase, setPhase] = useState<'idle' | 'running' | 'reloading'>('idle');
  const [note, setNote] = useState('');
  const requestedAt = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const finish = useCallback((status: RefreshStatus) => {
    if (status.changed) {
      const added = status.matches !== null && status.previousMatches !== null ? status.matches - status.previousMatches : null;
      setNote(added !== null ? `新增 ${added} 场，正在载入…` : '数据已更新，正在载入…');
      setPhase('reloading');
      // Give the restarted server a moment, then reload so every panel reads the new snapshot.
      timer.current = window.setTimeout(function reload() {
        void readStatus().then((ready) => { if (ready) window.location.reload(); else timer.current = window.setTimeout(reload, POLL_MS); });
      }, POLL_MS);
      return;
    }
    setNote(status.fetch && status.fetch !== 'ok' ? '拉取比赛失败，已是库内最新' : '已是最新');
    setPhase('idle');
  }, []);

  const poll = useCallback(() => {
    timer.current = window.setTimeout(async () => {
      const status = await readStatus();
      if (status?.state === 'done' && status.requestedAt === requestedAt.current) finish(status);
      else if (status?.state === 'idle' && status.requestedAt === null) { setNote('刷新没有完成，请稍后再试'); setPhase('idle'); }
      else poll();
    }, POLL_MS);
  }, [finish]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const start = async () => {
    setNote('');
    try {
      const response = await fetch('/api/refresh', { method: 'POST' });
      const body = await response.json() as { started: boolean; reason?: string; status: RefreshStatus };
      if (!body.started && body.reason === 'cooldown') { setNote(`刚刚刷新过，请 ${body.status.cooldownSeconds} 秒后再试`); return; }
      requestedAt.current = body.status.requestedAt;
      setPhase('running');
      poll();
    } catch {
      setNote('无法启动刷新');
    }
  };

  const busy = phase !== 'idle';
  return (
    <div className="refresh-control">
      <button type="button" className="refresh-button" disabled={busy} onClick={() => void start()} title="从 Lab 拉取最新对局并更新页面数据（约半分钟）">
        <span className={busy ? 'spin' : ''}>↻</span>{phase === 'running' ? '拉取中…' : phase === 'reloading' ? '载入中…' : '刷新数据'}
      </button>
      {note && <small role="status">{note}</small>}
    </div>
  );
}
