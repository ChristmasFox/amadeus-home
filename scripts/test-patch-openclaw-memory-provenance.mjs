#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  MARKER,
  MARK_FUNCTION,
  PIN,
  patchProvenanceModuleSource,
  patchSdkModuleSource,
} from './patch-openclaw-memory-provenance.mjs';

const runtimeRoot = path.resolve('node_modules/.pnpm/openclaw@2026.9.4/node_modules/openclaw/dist');
const provenance = fs.readFileSync(path.join(runtimeRoot, PIN.module), 'utf8');
const sdk = fs.readFileSync(path.join(runtimeRoot, PIN.sdkModule), 'utf8');
const sha = (value) => createHash('sha256').update(value).digest('hex');
assert.equal(sha(provenance), PIN.moduleSha256);
assert.equal(sha(sdk), PIN.sdkModuleSha256);

const patchedProvenance = patchProvenanceModuleSource(provenance);
const patchedSdk = patchSdkModuleSource(sdk);
assert.equal(patchedProvenance.split(MARKER).length - 1, 1);
assert.equal(patchProvenanceModuleSource(patchedProvenance), patchedProvenance, 'idempotent');
assert.equal(patchSdkModuleSource(patchedSdk), patchedSdk, 'idempotent');
assert.match(patchedProvenance, /markMemoryArtifactAgentWrite as o \};/u);
assert.match(patchedSdk, /o as markMemoryArtifactAgentWrite \} from/u);
assert.match(patchedSdk, /markMemoryArtifactAgentWrite, parseAgentSessionKey/u);
assert.throws(() => patchProvenanceModuleSource(provenance.replace('//#endregion\nexport {', '//#endregion\nexport  {')), /anchor count=0/u);
assert.throws(() => patchSdkModuleSource(sdk.replace('listMemoryCorpusSupplements, parseAgentSessionKey,', 'x')), /anchor count=0/u);

// The new function must overwrite a poisoned or stale record with a fresh agent record, and roll back.
const store = new Map();
const harness = new Function('store', 'sha256', `
  const randomUUID = () => 'r' + (++globalThis.__n);
  const resolveAddress = (p) => /^(MEMORY|USER)\\.md$/u.test(p.relativePath) ? { workspaceKey: 'w', relativePath: p.relativePath, storeKey: 'w:' + p.relativePath } : undefined;
  const openStore = () => ({
    update(key, fn) { const next = fn(store.get(key)); if (next === undefined) store.delete(key); else store.set(key, next); },
    deleteIf(key, pred) { const cur = store.get(key); if (cur && pred(cur)) store.delete(key); },
  });
  const normalizeStoredProvenance = (v) => v;
  ${MARK_FUNCTION}
  return markMemoryArtifactAgentWrite;
`);
globalThis.__n = 0;
const mark = harness.call({}, store, sha);
store.set('w:MEMORY.md', { originClass: 'untrusted', fileHash: 'stale', reservationId: 'old' });
const rollback = await mark({ relativePath: 'MEMORY.md', contentAfter: 'abc', observedAt: 1, sessionKey: 'k' });
assert.equal(store.get('w:MEMORY.md').originClass, 'agent');
assert.equal(store.get('w:MEMORY.md').fileHash, sha('abc'));
await rollback();
assert.equal(store.get('w:MEMORY.md').originClass, 'untrusted', 'rollback restores the previous record');
assert.equal(await mark({ relativePath: 'elsewhere.md', contentAfter: 'x', observedAt: 1 }), undefined);

for (const [name, source] of [['provenance', patchedProvenance], ['sdk', patchedSdk]]) {
  const temporary = path.join(os.tmpdir(), `openclaw-memory-provenance-${name}-${process.pid}.mjs`);
  try {
    fs.writeFileSync(temporary, source, { flag: 'wx' });
    const check = spawnSync(process.execPath, ['--check', temporary], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

console.log('OPENCLAW_MEMORY_PROVENANCE_PATCH=passed');
