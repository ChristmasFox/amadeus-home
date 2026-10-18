import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { REFRESH_COOLDOWN_MS, REFRESH_STALE_MS, refreshStatus, startRefresh } from '../src/server/refresh.js';

function withDirectories(run: (state: string, snapshot: string) => void): void {
  const state = mkdtempSync(join(tmpdir(), 'refresh-state-'));
  const snapshot = mkdtempSync(join(tmpdir(), 'refresh-snapshot-'));
  const previous = [process.env.PUBG_INTELLIGENCE_STATE_DIR, process.env.INTELLIGENCE_LAB_STATE_DIR];
  process.env.PUBG_INTELLIGENCE_STATE_DIR = state;
  process.env.INTELLIGENCE_LAB_STATE_DIR = snapshot;
  try { run(state, snapshot); } finally {
    if (previous[0] === undefined) delete process.env.PUBG_INTELLIGENCE_STATE_DIR; else process.env.PUBG_INTELLIGENCE_STATE_DIR = previous[0];
    if (previous[1] === undefined) delete process.env.INTELLIGENCE_LAB_STATE_DIR; else process.env.INTELLIGENCE_LAB_STATE_DIR = previous[1];
    rmSync(state, { recursive: true, force: true });
    rmSync(snapshot, { recursive: true, force: true });
  }
}

test('a refresh runs once, reports running, and honours the cooldown', () => {
  withDirectories(() => {
    const launched: string[] = [];
    const now = Date.parse('2026-10-18T10:00:00Z');
    assert.equal(refreshStatus(now).state, 'idle');
    const first = startRefresh(now, (path) => launched.push(path));
    assert.equal(first.started, true);
    assert.equal(launched.length, 1);
    const second = startRefresh(now + 5_000, (path) => launched.push(path));
    assert.deepEqual([second.started, !second.started && second.reason], [false, 'running']);
    assert.equal(launched.length, 1);
  });
});

test('a finished refresh reports the new match count, then the cooldown expires', () => {
  withDirectories((_state, snapshot) => {
    const now = Date.parse('2026-10-18T10:00:00Z');
    startRefresh(now, () => undefined);
    writeFileSync(join(snapshot, 'refresh.json'), JSON.stringify({
      at: '2026-10-18T10:00:20Z', changed: true, summary: { matches: 590, latestMatchMs: 5 }, previous: { matches: 581 },
    }));
    const done = refreshStatus(now + 30_000);
    assert.deepEqual([done.state, done.changed, done.matches, done.previousMatches], ['done', true, 590, 581]);
    const blocked = startRefresh(now + 30_000, () => undefined);
    assert.deepEqual([blocked.started, !blocked.started && blocked.reason], [false, 'cooldown']);
    assert.equal(startRefresh(now + REFRESH_COOLDOWN_MS + 1_000, () => undefined).started, true);
  });
});

test('an old result from before the request does not count as finished, and a lost run is released', () => {
  withDirectories((_state, snapshot) => {
    writeFileSync(join(snapshot, 'refresh.json'), JSON.stringify({ at: '2026-10-18T09:00:00Z', changed: false, summary: { matches: 1 } }));
    const now = Date.parse('2026-10-18T10:00:00Z');
    startRefresh(now, () => undefined);
    assert.equal(refreshStatus(now + 10_000).state, 'running');
    assert.equal(refreshStatus(now + REFRESH_STALE_MS + 1_000).state, 'idle');
  });
});
