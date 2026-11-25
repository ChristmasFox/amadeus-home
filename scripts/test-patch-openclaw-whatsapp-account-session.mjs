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
  WORKER_PARSE_THREAD_ANCHOR,
  patchSessionKeySource,
  patchWorkerSessionKeySource,
} from './patch-openclaw-whatsapp-account-session.mjs';

const runtimeRoot = path.resolve('node_modules/.pnpm/openclaw@2026.9.4/node_modules/openclaw/dist');
const packageRoot = path.dirname(runtimeRoot);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
assert.equal(packageJson.version, PIN.version, 'installed OpenClaw version matches the patch pin');
const sessionKeyOriginal = fs.readFileSync(path.join(runtimeRoot, PIN.module), 'utf8');
assert.equal(sha(sessionKeyOriginal), PIN.moduleSha256, 'session-key pin matches the package module');

const dockerfile = fs.readFileSync('infra/docker/casaos/openclaw/Dockerfile', 'utf8');
const patchCommands = [...dockerfile.matchAll(/node \/tmp\/(patch-openclaw-[\w-]+\.mjs) --core-root \/app\/dist( --apply)?/gu)]
  .map((match) => ({ script: match[1], apply: Boolean(match[2]) }));
const expectedPatchOrder = [
  'patch-openclaw-channel-identity.mjs',
  'patch-openclaw-whatsapp-voice-lifecycle.mjs',
  'patch-openclaw-group-image-policy.mjs',
  'patch-openclaw-heartbeat-silence.mjs',
  'patch-openclaw-memory-core.mjs',
  'patch-openclaw-memory-provenance.mjs',
  'patch-openclaw-memory-corpus.mjs',
  'patch-openclaw-session-history-projection.mjs',
  'patch-openclaw-whatsapp-account-session.mjs',
];
assert.deepEqual(patchCommands.map(({ script }) => script), expectedPatchOrder, 'Dockerfile patch order is covered');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-whatsapp-session-'));
try {
  const stagedPackageRoot = path.join(temporaryRoot, 'openclaw');
  const coreRoot = path.join(stagedPackageRoot, 'dist');
  fs.mkdirSync(coreRoot, { recursive: true });
  fs.copyFileSync(path.join(packageRoot, 'package.json'), path.join(stagedPackageRoot, 'package.json'));

  const rootFilePatterns = [
    /^bot-message-nRw-6GtF\.mjs$/u,
    /^agent-runner\.runtime-.*\.mjs$/u,
    /^conversation-tool-policy-pipeline-[A-Za-z0-9_-]+\.mjs$/u,
    /^heartbeat-runner-CPy-qxAy\.mjs$/u,
    /^memory-tool-contract-Bockpo-h\.mjs$/u,
    /^memory-artifact-provenance-DfnnFfMY\.mjs$/u,
    /^session-transcript-readers-BZjuw2hz\.mjs$/u,
    /^builtin-openclaw-B-H-7lKk\.mjs$/u,
    /^session-key-PQkfotIJ\.mjs$/u,
    /^reset-u-o80dxT\.mjs$/u,
    /^session-ingestion-[^/]+\.mjs$/u,
    /^tools-[^/]+\.mjs$/u,
    /^dreaming-phases-[^/]+\.mjs$/u,
    /^session-backfill-[^/]+\.mjs$/u,
  ];
  for (const entry of fs.readdirSync(runtimeRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !rootFilePatterns.some((pattern) => pattern.test(entry.name))) continue;
    fs.copyFileSync(path.join(runtimeRoot, entry.name), path.join(coreRoot, entry.name));
  }

  const copyRuntimeFile = (relative) => {
    const target = path.join(coreRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(runtimeRoot, relative), target);
  };
  for (const relative of [
    'worker/worker.mjs',
    'extensions/memory-core/manager-runtime.js',
    'extensions/memory-core/openclaw.plugin.json',
    'extensions/memory-core/index.js',
    'plugin-sdk/memory-core-host-runtime-core.js',
  ]) copyRuntimeFile(relative);

  for (const command of patchCommands.slice(0, -1)) {
    const args = [path.resolve('scripts', command.script), '--core-root', coreRoot];
    if (command.apply) args.push('--apply');
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(result.status, 0, `${command.script} failed before account-session patch: ${result.stderr || result.stdout}`);
  }

  const workerBeforeAccountPatch = fs.readFileSync(path.join(coreRoot, PIN.workerModule), 'utf8');
  assert.equal(sha(workerBeforeAccountPatch), PIN.workerModuleSha256, 'worker pin matches after all preceding Dockerfile patches');
  assert.equal(workerBeforeAccountPatch.split(WORKER_PARSE_THREAD_ANCHOR).length - 1, 1, 'compressed worker anchor matches exactly once after preceding patches');

  const patchedSessionKey = patchSessionKeySource(sessionKeyOriginal);
  const patchedWorker = patchWorkerSessionKeySource(workerBeforeAccountPatch);
  for (const [source, transform] of [[patchedSessionKey, patchSessionKeySource], [patchedWorker, patchWorkerSessionKeySource]]) {
    assert.equal(source.split(MARKER).length - 1, 1, 'patch marker is unique');
    assert.equal(transform(source), source, 'patch is idempotent');
  }

  const sourceParserStart = sessionKeyOriginal.indexOf('function parseThreadSessionSuffix(sessionKey) {');
  const sourceParserEnd = sessionKeyOriginal.indexOf('\nconst SESSION_DELIVERY_PEER_KINDS', sourceParserStart);
  const sourceParser = sessionKeyOriginal.slice(sourceParserStart, sourceParserEnd);
  const driftedParser = sourceParser.replace('lastIndexOf(":thread:")', 'lastIndexOf(":topic:")');
  assert.notEqual(driftedParser, sourceParser, 'drift fixture changes the pinned anchor');
  assert.throws(() => patchSessionKeySource(sessionKeyOriginal.replace(sourceParser, driftedParser)), /anchor count=0/u);
  assert.throws(() => patchSessionKeySource(patchedSessionKey.replace('/^whatsapp-account-[^:]+$/iu.test', '/^account-[^:]+$/iu.test')), /incomplete/u);

  const workerParserStart = workerBeforeAccountPatch.indexOf('function parseThreadSessionSuffix(Ot){');
  const workerParserEnd = workerBeforeAccountPatch.indexOf('function parseSessionDeliveryRoute(', workerParserStart);
  const workerSourceParser = workerBeforeAccountPatch.slice(workerParserStart, workerParserEnd);
  const driftedWorkerParser = workerSourceParser.replace('lastIndexOf(`:thread:`)', 'lastIndexOf(`:topic:`)');
  assert.notEqual(driftedWorkerParser, workerSourceParser, 'worker drift fixture changes the compressed anchor');
  assert.throws(() => patchWorkerSessionKeySource(workerBeforeAccountPatch.replace(workerSourceParser, driftedWorkerParser)), /anchor count=0/u);
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
    patchedSessionKey,
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

  const runAccountPatch = () => spawnSync(process.execPath, [
    path.resolve('scripts/patch-openclaw-whatsapp-account-session.mjs'), '--core-root', coreRoot, '--apply',
  ], { encoding: 'utf8' });
  const first = runAccountPatch();
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /OPENCLAW_WHATSAPP_ACCOUNT_SESSION=applied modules=2/u);
  assert.equal(fs.readFileSync(path.join(coreRoot, PIN.module), 'utf8'), patchedSessionKey);
  assert.equal(fs.readFileSync(path.join(coreRoot, PIN.workerModule), 'utf8'), patchedWorker);
  const second = runAccountPatch();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(fs.readFileSync(path.join(coreRoot, PIN.module), 'utf8'), patchedSessionKey, 'module CLI rerun is idempotent');
  assert.equal(fs.readFileSync(path.join(coreRoot, PIN.workerModule), 'utf8'), patchedWorker, 'worker CLI rerun is idempotent');
  for (const relative of [PIN.module, PIN.workerModule]) {
    const syntax = spawnSync(process.execPath, ['--check', path.join(coreRoot, relative)], { encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
  }
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log('OPENCLAW_WHATSAPP_ACCOUNT_SESSION_PATCH_TEST=passed');
