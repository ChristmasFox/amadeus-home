import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { AnalysisCache, analysisVersion } from '../src/server/analysis-cache.js';
import { WorkerPool } from '../src/server/analysis-pool.js';

test('cached analyses round-trip, stay separate per version and squad, and reject unsafe keys', () => {
  const root = mkdtempSync(join(tmpdir(), 'pubg-cache-'));
  try {
    const v1 = new AnalysisCache(root, 'v1');
    assert.equal(v1.read('squad', 'match-1'), null);
    v1.write('squad', 'match-1', { a: 1, nested: { b: [2, 3] } });
    assert.deepEqual(v1.read('squad', 'match-1'), { a: 1, nested: { b: [2, 3] } });
    assert.equal(v1.count('squad'), 1);
    assert.equal(v1.read('other', 'match-1'), null, 'another squad does not see it');
    assert.equal(new AnalysisCache(root, 'v2').read('squad', 'match-1'), null, 'a new analysis version starts empty');
    assert.deepEqual(v1.read('squad', 'match-1'), { a: 1, nested: { b: [2, 3] } }, 'the old version is left in place');
    v1.write('../escape', 'match-1', { bad: true });
    v1.write('squad', '../escape', { bad: true });
    assert.equal(v1.read('../escape', 'match-1'), null);
    assert.equal(v1.count('squad'), 1, 'path-like keys are never written');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the analysis version follows the built code', () => {
  const root = mkdtempSync(join(tmpdir(), 'pubg-version-'));
  try {
    const dist = join(root, 'dist');
    mkdirSync(join(dist, 'sub'), { recursive: true });
    writeFileSync(join(dist, 'a.js'), 'export const a = 1;');
    writeFileSync(join(dist, 'sub', 'b.js'), 'export const b = 2;');
    const first = analysisVersion([dist]);
    assert.equal(analysisVersion([dist]), first, 'stable for unchanged code');
    writeFileSync(join(dist, 'sub', 'b.js'), 'export const b = 3;');
    assert.notEqual(analysisVersion([dist]), first, 'a changed file changes the version');
    assert.notEqual(analysisVersion([dist], ['extra']), analysisVersion([dist]), 'extra source text is part of it');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the worker pool runs tasks in parallel threads, reports failures and keeps working', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pubg-pool-'));
  const script = join(root, 'worker.mjs');
  writeFileSync(script, `import { parentPort, threadId } from 'node:worker_threads';
parentPort.on('message', (task) => {
  if (task.fail) { parentPort.postMessage({ ok: false, error: 'boom' }); return; }
  if (task.crash) { process.exit(3); }
  parentPort.postMessage({ ok: true, result: { value: task.value * 2, threadId } });
});`);
  const pool = new WorkerPool(pathToFileURL(script), 2);
  try {
    const results = await Promise.all([1, 2, 3, 4].map((value) => pool.run<{ value: number; threadId: number }>({ value })));
    assert.deepEqual(results.map((item) => item.value), [2, 4, 6, 8]);
    assert.ok(new Set(results.map((item) => item.threadId)).size <= 2, 'never more threads than the pool size');
    await assert.rejects(pool.run({ fail: true }), /boom/u);
    await assert.rejects(pool.run({ crash: true }));
    assert.equal((await pool.run<{ value: number }>({ value: 21 })).value, 42, 'the pool recovers after a crashed worker');
  } finally {
    await pool.close();
    rmSync(root, { recursive: true, force: true });
  }
  await assert.rejects(pool.run({ value: 1 }), /worker_pool_closed/u);
});
