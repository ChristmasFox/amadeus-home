#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  MARKER,
  PIN,
  patchSessionKeySource,
  patchWorkerSessionKeySource,
} from './patch-openclaw-whatsapp-account-session.mjs';

const runtimeRoot = path.resolve('node_modules/.pnpm/openclaw@2026.9.4/node_modules/openclaw/dist');
const original = fs.readFileSync(path.join(runtimeRoot, PIN.module), 'utf8');
const workerOriginal = fs.readFileSync(path.join(runtimeRoot, PIN.workerModule), 'utf8');
const sha = (value) => createHash('sha256').update(value).digest('hex');
assert.equal(sha(original), PIN.moduleSha256);
assert.equal(sha(workerOriginal), PIN.workerModuleSha256);

const patched = patchSessionKeySource(original);
const patchedWorker = patchWorkerSessionKeySource(workerOriginal);
for (const [source, transform] of [[patched, patchSessionKeySource], [patchedWorker, patchWorkerSessionKeySource]]) {
  assert.equal(source.split(MARKER).length - 1, 1, 'patch marker is unique');
  assert.equal(transform(source), source, 'patch is idempotent');
}

const sourceParserStart = original.indexOf('function parseThreadSessionSuffix(sessionKey) {');
const sourceParserEnd = original.indexOf('\nconst SESSION_DELIVERY_PEER_KINDS', sourceParserStart);
const sourceParser = original.slice(sourceParserStart, sourceParserEnd);
const driftedParser = sourceParser.replace('lastIndexOf(":thread:")', 'lastIndexOf(":topic:")');
assert.notEqual(driftedParser, sourceParser, 'drift fixture changes the pinned anchor');
assert.throws(() => patchSessionKeySource(original.replace(sourceParser, driftedParser)), /anchor count=0/u);
assert.throws(() => patchSessionKeySource(patched.replace('/^whatsapp-account-[^:]+$/iu.test', '/^account-[^:]+$/iu.test')), /incomplete/u);

const workerParserStart = workerOriginal.indexOf('function parseThreadSessionSuffix(Ot){');
const workerParserEnd = workerOriginal.indexOf('function parseSessionDeliveryRoute(', workerParserStart);
const workerSourceParser = workerOriginal.slice(workerParserStart, workerParserEnd);
const driftedWorkerParser = workerSourceParser.replace('lastIndexOf(`:thread:`)', 'lastIndexOf(`:topic:`)');
assert.notEqual(driftedWorkerParser, workerSourceParser, 'worker drift fixture changes the pinned anchor');
assert.throws(() => patchWorkerSessionKeySource(workerOriginal.replace(workerSourceParser, driftedWorkerParser)), /anchor count=0/u);
assert.throws(() => patchWorkerSessionKeySource(patchedWorker.replace('/^whatsapp-account-[^:]+$/iu.test', '/^account-[^:]+$/iu.test')), /incomplete/u);

function classifyWith(source, parserStartText, parserEndText, classifierSource, classifierStartText, classifierEndText) {
  const parserStart = source.indexOf(parserStartText);
  const parserEnd = source.indexOf(parserEndText, parserStart);
  assert.ok(parserStart >= 0 && parserEnd > parserStart, 'thread parser is present');
  const parserSource = source.slice(parserStart, parserEnd);
  const classifierStart = classifierSource.indexOf(classifierStartText);
  const classifierEnd = classifierSource.indexOf(classifierEndText, classifierStart);
  assert.ok(classifierStart >= 0 && classifierEnd > classifierStart, 'reset classifiers are present');
  const resetFunctions = classifierSource.slice(classifierStart, classifierEnd);
  const makeHarness = new Function('normalizeOptionalString', 'normalizeLowercaseStringOrEmpty', `
    const GROUP_SESSION_MARKERS = [":group:", ":channel:"];
    ${parserSource}
    const resolveLoadedSessionThreadInfo = (sessionKey) => parseThreadSessionSuffix(sessionKey);
    ${resetFunctions}
    return { parseThreadSessionSuffix, isThreadSessionKey, resolveSessionResetType };
  `);
  return makeHarness(
    (value) => typeof value === 'string' && value.trim() ? value.trim() : undefined,
    (value) => typeof value === 'string' ? value.trim().toLowerCase() : '',
  );
}

const resetSource = fs.readFileSync(path.join(runtimeRoot, 'reset-u-o80dxT.mjs'), 'utf8');
const harness = classifyWith(
  patched,
  'function parseThreadSessionSuffix(sessionKey) {',
  '\nconst SESSION_DELIVERY_PEER_KINDS',
  resetSource,
  'function isThreadSessionKey(sessionKey) {',
  '\nfunction resolveThreadFlag',
);
const workerHarness = classifyWith(
  patchedWorker,
  'function parseThreadSessionSuffix(Ot){',
  'function parseSessionDeliveryRoute(',
  patchedWorker,
  'function isThreadSessionKey(Ot){',
  'function resolveThreadFlag(',
);

function assertClassification(runtime, label) {
  const accountScopedGroup = 'agent:main:whatsapp:group:EXAMPLE_ADDRESS@g.us:thread:whatsapp-account-example';
  assert.deepEqual(runtime.parseThreadSessionSuffix(accountScopedGroup), { baseSessionKey: accountScopedGroup, threadId: undefined }, label);
  assert.equal(runtime.isThreadSessionKey(accountScopedGroup), false, label);
  assert.equal(runtime.resolveSessionResetType({ sessionKey: accountScopedGroup }), 'group', label);

  const actualTopicThread = 'agent:main:whatsapp:group:EXAMPLE_ADDRESS@g.us:thread:EXAMPLE_TOPIC';
  assert.deepEqual(runtime.parseThreadSessionSuffix(actualTopicThread), {
    baseSessionKey: 'agent:main:whatsapp:group:EXAMPLE_ADDRESS@g.us',
    threadId: 'EXAMPLE_TOPIC',
  }, label);
  assert.equal(runtime.isThreadSessionKey(actualTopicThread), true, label);
  assert.equal(runtime.resolveSessionResetType({ sessionKey: actualTopicThread }), 'thread', label);

  const directSession = 'agent:main:whatsapp:direct:EXAMPLE_ADDRESS';
  assert.equal(runtime.isThreadSessionKey(directSession), false, label);
  assert.equal(runtime.resolveSessionResetType({ sessionKey: directSession }), 'direct', label);
}

assertClassification(harness, 'main bundle');
assertClassification(workerHarness, 'worker bundle');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-whatsapp-session-'));
try {
  const coreRoot = path.join(temporaryRoot, 'dist');
  const workerRoot = path.join(coreRoot, 'worker');
  fs.mkdirSync(workerRoot, { recursive: true });
  fs.writeFileSync(path.join(temporaryRoot, 'package.json'), JSON.stringify({ version: PIN.version }));
  fs.writeFileSync(path.join(coreRoot, PIN.module), original);
  fs.writeFileSync(path.join(coreRoot, PIN.workerModule), workerOriginal);
  const runPatch = () => spawnSync(process.execPath, [
    path.resolve('scripts/patch-openclaw-whatsapp-account-session.mjs'), '--core-root', coreRoot, '--apply',
  ], { encoding: 'utf8' });
  const first = runPatch();
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /OPENCLAW_WHATSAPP_ACCOUNT_SESSION=applied modules=2/u);
  assert.equal(fs.readFileSync(path.join(coreRoot, PIN.module), 'utf8'), patched);
  assert.equal(fs.readFileSync(path.join(coreRoot, PIN.workerModule), 'utf8'), patchedWorker);
  const second = runPatch();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(fs.readFileSync(path.join(coreRoot, PIN.module), 'utf8'), patched, 'module CLI rerun is idempotent');
  assert.equal(fs.readFileSync(path.join(coreRoot, PIN.workerModule), 'utf8'), patchedWorker, 'worker CLI rerun is idempotent');
  for (const relative of [PIN.module, PIN.workerModule]) {
    const syntax = spawnSync(process.execPath, ['--check', path.join(coreRoot, relative)], { encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
  }
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log('OPENCLAW_WHATSAPP_ACCOUNT_SESSION_PATCH_TEST=passed');
