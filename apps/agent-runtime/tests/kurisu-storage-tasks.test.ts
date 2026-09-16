import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { normalizeInbound, type InboundMessageInput } from '../src/kurisu/contracts.js';
import { ApprovalService } from '../src/kurisu/approvals.js';
import { MediaPathPolicy } from '../src/kurisu/media.js';
import { publicReadAuthorization } from '../src/kurisu/policy.js';
import { KurisuStore } from '../src/kurisu/storage.js';
import { TaskEngine, type TaskStep } from '../src/kurisu/tasks.js';

function context(runId: string, sessionKey = 'test:user:bot:private:chat:-:-') {
  return {
    runId,
    requestId: `request-${runId}`,
    identity: { platform: 'test' as const, platformUserId: 'user-1' },
    conversation: { kind: 'private' as const, chatId: 'chat-1' },
    sessionKey,
    principalKey: 'test:user-1',
    botId: 'bot-1',
    authorization: publicReadAuthorization(),
    now: '2026-09-16T00:00:00.000Z',
    source: 'test-harness' as const,
  };
}

function inbound(updateId: string, text = 'same text'): InboundMessageInput {
  return {
    updateId,
    messageId: `message-${updateId}`,
    botId: 'bot-1',
    identity: { platform: 'test', platformUserId: 'user-1' },
    conversation: { kind: 'private', chatId: 'chat-1' },
    text,
    attachments: [],
    receivedAt: '2026-09-16T00:00:00.000Z',
  };
}

test('SQLite store persists inbound idempotency, sessions, and typed run state', () => {
  const store = new KurisuStore();
  const first = normalizeInbound(inbound('u1'));
  const second = normalizeInbound(inbound('u2'));
  assert.equal(store.claimInbound(first).claimed, true);
  assert.equal(store.claimInbound(first).claimed, false);
  assert.equal(store.claimInbound(second).claimed, true);
  const run = store.createRun(first.sessionKey, 'run-1', first.receivedAt);
  assert.equal(run.status, 'queued');
  assert.equal(store.transitionRun(run.id, 'running', {}, first.receivedAt).status, 'running');
  assert.equal(store.snapshotCounts().kurisu_messages, 2);
  assert.equal(store.snapshotCounts().kurisu_inbound_dedup, 2);
  store.close();
});

test('SQLite state and WAL sidecars are owner-readable only', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kurisu-storage-permissions-'));
  const filename = join(directory, 'state.sqlite');
  const store = new KurisuStore(filename);
  try {
    store.claimInbound(normalizeInbound(inbound('permissions')));
    for (const path of [filename, `${filename}-wal`, `${filename}-shm`]) {
      if (!existsSync(path)) continue;
      assert.equal(statSync(path).mode & 0o777, 0o600, path);
    }
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('task engine writes intent before work, survives a crash point, and reconciles once', async () => {
  const store = new KurisuStore();
  const session = normalizeInbound(inbound('crash-inbound'));
  store.claimInbound(session);
  const run = store.createRun(session.sessionKey, 'run-crash', '2026-09-16T00:00:00.000Z');
  let writes = 0;
  const step: TaskStep = {
    key: 'external-write',
    action: { target: 'fixture' },
    async execute() { writes += 1; return { status: 'succeeded', result: { writes } }; },
    async reconcile(_context, previous) { return { status: 'succeeded', result: previous.result ?? { reconciled: true }, externalId: previous.externalId ?? 'external-1' }; },
  };
  const crashing = new TaskEngine(store, {
    owner: 'worker-crash',
    now: () => '2026-09-16T00:00:01.000Z',
    faultAfterIntent: () => { throw new Error('simulated process exit'); },
  });
  await assert.rejects(crashing.execute(run.id, context(run.id, session.sessionKey), [step]), /simulated process exit/u);
  assert.equal(store.getTaskStep(run.id, step.key)?.status, 'running');
  assert.equal(writes, 0);

  const recovery = new TaskEngine(store, { owner: 'worker-recovery', now: () => '2026-09-16T00:00:02.000Z' });
  const result = await recovery.recover(run.id, context(run.id, session.sessionKey), [step]);
  assert.equal(result.status, 'succeeded');
  assert.equal(writes, 0);
  assert.equal(store.getTaskStep(run.id, step.key)?.status, 'succeeded');
  store.close();
});

test('worker lease prevents concurrent duplicate execution and cancellation stops later steps', async () => {
  const store = new KurisuStore();
  const session = normalizeInbound(inbound('lease-inbound'));
  store.claimInbound(session);
  const run = store.createRun(session.sessionKey, 'run-lease', '2026-09-16T00:00:00.000Z');
  assert.ok(store.claimRun(run.id, 'worker-1', 60_000, new Date('2026-09-16T00:00:00.000Z')));
  assert.equal(store.claimRun(run.id, 'worker-2', 60_000, new Date('2026-09-16T00:00:01.000Z')), null);
  assert.equal(store.cancelRun(run.id, '2026-09-16T00:00:02.000Z').status, 'cancelled');
  store.close();
});

test('approval binds principal, conversation, action, and exact arguments, then is one-use', () => {
  const store = new KurisuStore();
  const session = normalizeInbound(inbound('approval-inbound'));
  store.claimInbound(session);
  const approval = new ApprovalService(store, () => '2026-09-16T00:00:00.000Z');
  const approvalContext = { ...context('run-approval', session.sessionKey), authorization: { role: 'ADMIN' as const, allowedActions: ['read', 'write'] as const, approvalRequiredActions: ['write'] as const } };
  store.createRun(session.sessionKey, 'run-approval', '2026-09-16T00:00:00.000Z');
  const challenge = approval.request(approvalContext, { action: 'homehub.restart', arguments: { serviceId: 'emby' } });
  assert.match(challenge.callback, /^ku1:approval:approve:/u);
  const wrongUser = approval.consumeCallback({ ...approvalContext, principalKey: 'test:other' }, challenge.callback, 'homehub.restart', { serviceId: 'emby' });
  assert.equal(wrongUser.status, 'error');
  const wrongArgs = approval.consumeCallback(approvalContext, challenge.callback, 'homehub.restart', { serviceId: 'n8n' });
  assert.equal(wrongArgs.status, 'error');
  const accepted = approval.consumeCallback(approvalContext, challenge.callback, 'homehub.restart', { serviceId: 'emby' });
  assert.equal(accepted.status, 'accepted');
  assert.equal(approval.consumeCallback(approvalContext, challenge.callback, 'homehub.restart', { serviceId: 'emby' }).status, 'error');
  store.close();
});

test('media policy rejects traversal and symlink escape before any move', () => {
  const base = mkdtempSync(join(tmpdir(), 'kurisu-media-'));
  const downloads = join(base, 'downloads');
  const movies = join(base, 'movies');
  const tv = join(base, 'tv');
  mkdirSync(downloads); mkdirSync(movies); mkdirSync(tv);
  const source = join(downloads, 'movie.mkv');
  writeFileSync(source, 'fixture');
  const policy = new MediaPathPolicy({ downloads, movies, tv });
  assert.throws(() => policy.plan(join(downloads, '..', 'outside.mkv'), join(movies, 'x.mkv'), 'bad'), /outside the allowlist/u);
  const outside = join(base, 'outside');
  mkdirSync(outside);
  symlinkSync(outside, join(downloads, 'escape'));
  assert.throws(() => policy.validateSource(join(downloads, 'escape', 'x.mkv')), /symlink escapes/u);
  const plan = policy.plan(source, join(movies, 'Movie (2020).mkv'), 'explicit target');
  assert.throws(() => policy.execute(plan, false), /server-side approval/u);
});
