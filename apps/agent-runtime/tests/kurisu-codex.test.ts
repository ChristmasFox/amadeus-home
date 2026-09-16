import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CodexAppServerExecutor,
  CodexProjectRegistry,
  type CodexAppServerClient,
  type CodexAppServerMessage,
} from '../src/kurisu/codex.js';
import { adminAuthorization, userAuthorization } from '../src/kurisu/policy.js';
import { normalizeInbound, type InboundMessageInput, type TrustedExecutionContext } from '../src/kurisu/contracts.js';
import { KurisuStore } from '../src/kurisu/storage.js';
import { KurisuService } from '../src/kurisu/service.js';

const NOW = '2026-09-16T00:00:00.000Z';

function makeInbound(updateId: string): InboundMessageInput {
  return {
    updateId,
    messageId: `message-${updateId}`,
    botId: 'test-bot',
    identity: { platform: 'test', platformUserId: 'user-1' },
    conversation: { kind: 'private', chatId: 'chat-1' },
    text: '',
    attachments: [],
    receivedAt: NOW,
  };
}

function makeContext(runId: string, sessionKey: string, idempotencyKey = 'inbound:codex-1'): TrustedExecutionContext {
  return {
    runId,
    requestId: `request-${runId}`,
    identity: { platform: 'test', platformUserId: 'user-1' },
    conversation: { kind: 'private', chatId: 'chat-1' },
    sessionKey,
    principalKey: 'test:user-1',
    botId: 'test-bot',
    authorization: adminAuthorization(['kurisu.codex.start', 'kurisu.codex.resume', 'kurisu.codex.cancel']),
    now: NOW,
    idempotencyKey,
    source: 'test-harness',
  };
}

function makeGitRepo(): string {
  const directory = mkdtempSync(join(tmpdir(), 'kurisu-codex-repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: directory });
  execFileSync('git', ['config', 'user.email', 'kurisu@example.invalid'], { cwd: directory });
  execFileSync('git', ['config', 'user.name', 'Kurisu Test'], { cwd: directory });
  writeFileSync(join(directory, 'README.md'), '# isolated\n');
  execFileSync('git', ['add', 'README.md'], { cwd: directory });
  execFileSync('git', ['commit', '-qm', 'initial'], { cwd: directory });
  return directory;
}

class FakeCodexClient implements CodexAppServerClient {
  readonly requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  readonly responses: Array<{ id: string | number; result: unknown }> = [];
  private readonly listeners = new Set<(message: CodexAppServerMessage) => void | Promise<void>>();
  private readonly mode: 'approval' | 'running';

  constructor(mode: 'approval' | 'running') {
    this.mode = mode;
  }

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    this.requests.push({ method, params });
    if (method === 'thread/start') return { thread: { id: 'thread-fixed-1' } };
    if (method === 'turn/start') {
      setTimeout(() => {
        if (this.mode === 'approval') {
          void this.emit({
            kind: 'request',
            id: 'server-request-1',
            method: 'item/fileChange/requestApproval',
            params: { threadId: 'thread-fixed-1', turnId: 'turn-fixed-1', itemId: 'item-1', reason: 'test file change' },
          });
        }
      }, 0);
      return { turn: { id: 'turn-fixed-1', status: 'inProgress' } };
    }
    if (method === 'thread/resume') return { thread: { turns: [{ id: 'turn-fixed-1', status: 'inProgress' }] } };
    if (method === 'turn/interrupt') return { turn: { id: 'turn-fixed-1', status: 'interrupted' } };
    throw new Error(`unexpected fake method: ${method}`);
  }

  respond(id: string | number, result: unknown): void {
    this.responses.push({ id, result });
    if (result && typeof result === 'object' && (result as Record<string, unknown>).decision === 'accept') {
      queueMicrotask(() => void this.emit({
        kind: 'notification',
        method: 'turn/completed',
        params: { threadId: 'thread-fixed-1', turnId: 'turn-fixed-1', turn: { id: 'turn-fixed-1', status: 'completed' } },
      }));
    }
  }

  subscribe(listener: (message: CodexAppServerMessage) => void | Promise<void>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {}

  private async emit(message: CodexAppServerMessage): Promise<void> {
    for (const listener of this.listeners) await listener(message);
  }
}

async function eventually(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(check(), true);
}

test('project registry rejects dirty roots and keeps executor paths server-owned', async () => {
  const repo = makeGitRepo();
  const worktrees = mkdtempSync(join(tmpdir(), 'kurisu-codex-worktrees-'));
  try {
    const registry = new CodexProjectRegistry([{ projectId: 'isolated', root: repo, workspaceMode: 'worktree' }], { worktreeParent: worktrees });
    const workspace = await registry.prepare('isolated');
    assert.equal(workspace.root, realpathSync(repo));
    assert.equal(workspace.mode, 'worktree');
    assert.notEqual(workspace.workspaceRef, repo);
    assert.match(workspace.workspaceRef, new RegExp(`^${worktrees}`));
    const restored = await registry.restore('isolated', workspace.workspaceRef);
    assert.equal(restored.workspaceRef, realpathSync(workspace.workspaceRef));
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }), '');

    writeFileSync(join(repo, 'dirty.txt'), 'do not touch\n');
    await assert.rejects(registry.prepare('isolated'), (error: unknown) => error instanceof Error && error.message.includes('uncommitted changes'));
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).includes('dirty.txt'), true);

    assert.equal(registry.has('arbitrary-cwd'), false);
    await assert.rejects(registry.prepare('arbitrary-cwd'), /not registered/u);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(worktrees, { recursive: true, force: true });
  }
});

test('Codex start is idempotent, records waiting approval, and completes only after a terminal turn status', async () => {
  const repo = makeGitRepo();
  const worktrees = mkdtempSync(join(tmpdir(), 'kurisu-codex-worktrees-'));
  const store = new KurisuStore();
  const inbound = normalizeInbound(makeInbound('codex-start'));
  store.claimInbound(inbound);
  const run = store.createRun(inbound.sessionKey, 'run-codex-start', NOW);
  const fake = new FakeCodexClient('approval');
  const executor = new CodexAppServerExecutor(store, new CodexProjectRegistry([{ projectId: 'isolated', root: repo, workspaceMode: 'worktree' }], { worktreeParent: worktrees }), {
    now: () => NOW,
    clientFactory: () => fake,
  });
  try {
    const trusted = makeContext(run.id, inbound.sessionKey);
    const input = { projectId: 'isolated', goal: 'make one small isolated change', constraints: ['do not touch the source repository'] };
    const first = await executor.requestStart(input, trusted);
    assert.equal(first.status, 'accepted');
    const jobId = first.jobId ?? '';
    assert.match(jobId, /^job_/u);
    const duplicate = await executor.requestStart(input, trusted);
    assert.equal(duplicate.jobId, jobId);
    assert.equal(fake.requests.filter((request) => request.method === 'thread/start').length, 1);
    assert.equal(fake.requests.filter((request) => request.method === 'turn/start').length, 1);

    await eventually(() => store.getCodexJob(jobId)?.status === 'waiting_approval');
    const waiting = await executor.status({ jobId }, trusted);
    assert.equal(waiting.status, 'needs_input');
    const pending = store.getCodexJob(jobId)?.pendingRequest;
    assert.equal(pending?.method, 'item/fileChange/requestApproval');
    assert.equal(typeof pending?.callback, 'string');
    assert.equal(store.listEvents('codex.job.waiting_approval').length, 1);

    const approved = await executor.approveServerRequest(jobId, pending!.requestId, trusted);
    assert.equal(approved.status, 'accepted');
    await eventually(() => store.getCodexJob(jobId)?.status === 'succeeded');
    const completed = await executor.status({ jobId }, trusted);
    assert.equal(completed.status, 'ok');
    assert.equal(fake.responses.length, 1);
    assert.deepEqual(fake.responses[0]?.result, { decision: 'accept' });
    assert.equal(store.getRun(run.id)?.status, 'succeeded');
  } finally {
    await executor.close();
    store.close();
    rmSync(repo, { recursive: true, force: true });
    rmSync(worktrees, { recursive: true, force: true });
  }
});

test('resume reattaches the same thread and does not issue a second start after executor replacement', async () => {
  const repo = makeGitRepo();
  const worktrees = mkdtempSync(join(tmpdir(), 'kurisu-codex-worktrees-'));
  const store = new KurisuStore();
  const inbound = normalizeInbound(makeInbound('codex-resume'));
  store.claimInbound(inbound);
  const run = store.createRun(inbound.sessionKey, 'run-codex-resume', NOW);
  const firstFake = new FakeCodexClient('running');
  const first = new CodexAppServerExecutor(store, new CodexProjectRegistry([{ projectId: 'isolated', root: repo, workspaceMode: 'worktree' }], { worktreeParent: worktrees }), {
    now: () => NOW,
    clientFactory: () => firstFake,
  });
  try {
    const trusted = makeContext(run.id, inbound.sessionKey, 'resume-key');
    const started = await first.requestStart({ projectId: 'isolated', goal: 'continue the isolated task', constraints: [] }, trusted);
    const jobId = started.jobId!;
    await eventually(() => store.getCodexJob(jobId)?.status === 'running');
    await first.close();

    const secondFake = new FakeCodexClient('running');
    const second = new CodexAppServerExecutor(store, new CodexProjectRegistry([{ projectId: 'isolated', root: repo, workspaceMode: 'worktree' }], { worktreeParent: worktrees }), {
      now: () => NOW,
      clientFactory: () => secondFake,
    });
    try {
      const resumed = await second.requestResume({ jobId }, trusted);
      assert.equal(resumed.status, 'accepted');
      assert.equal(secondFake.requests.filter((request) => request.method === 'thread/resume').length, 1);
      assert.equal(secondFake.requests.some((request) => request.method === 'thread/start'), false);
      assert.equal(secondFake.requests.some((request) => request.method === 'turn/start'), false);
      assert.equal(store.getCodexJob(jobId)?.threadId, 'thread-fixed-1');
      assert.equal(store.getCodexJob(jobId)?.turnId, 'turn-fixed-1');
    } finally {
      await second.close();
    }
  } finally {
    await first.close();
    store.close();
    rmSync(repo, { recursive: true, force: true });
    rmSync(worktrees, { recursive: true, force: true });
  }
});

test('service routes a Codex start approval callback to the same run without trusting callback arguments', async () => {
  const repo = makeGitRepo();
  const worktrees = mkdtempSync(join(tmpdir(), 'kurisu-codex-worktrees-'));
  const fake = new FakeCodexClient('running');
  const service = new KurisuService({
    now: () => NOW,
    authorization: () => userAuthorization(),
    codexProjects: new CodexProjectRegistry([{ projectId: 'isolated', root: repo, workspaceMode: 'worktree' }], { worktreeParent: worktrees }),
    codexOptions: { now: () => NOW, clientFactory: () => fake },
  });
  try {
    const source = makeInbound('codex-service-start');
    const normalized = normalizeInbound(source);
    service.rollout.enable(normalized.sessionKey, 'p4-service');
    const pending = await service.receiveInbound(source, {
      toolCalls: [{
        id: 'codex-service-call',
        name: 'kurisu.codex.start',
        arguments: { projectId: 'isolated', goal: 'run a bounded test task', constraints: [] },
      }],
    });
    assert.equal(pending.status, 'needs_input');
    assert.equal(pending.toolResults[0]?.response.status, 'needs_input');
    const callback = String((pending.toolResults[0]?.response.data as Record<string, unknown>).callback);
    assert.equal(fake.requests.some((request) => request.method === 'thread/start'), false);

    const resumed = await service.receiveCallback({ ...makeInbound('codex-service-approval'), callbackData: callback });
    assert.equal(resumed.status, 'accepted');
    assert.equal(resumed.approvalResponse?.status, 'accepted');
    assert.equal(fake.requests.filter((request) => request.method === 'thread/start').length, 1);
    assert.equal(fake.requests.filter((request) => request.method === 'turn/start').length, 1);
    assert.equal(service.store.getRun(pending.runId ?? '')?.status, 'waiting_job');
  } finally {
    service.close();
    rmSync(repo, { recursive: true, force: true });
    rmSync(worktrees, { recursive: true, force: true });
  }
});
