import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CodexAppServerExecutor, CodexProjectRegistry } from '../apps/agent-runtime/src/kurisu/codex.ts';
import { adminAuthorization } from '../apps/agent-runtime/src/kurisu/policy.ts';
import { normalizeInbound } from '../apps/agent-runtime/src/kurisu/contracts.ts';
import { KurisuStore } from '../apps/agent-runtime/src/kurisu/storage.ts';

const now = new Date().toISOString();
const repo = mkdtempSync(join(tmpdir(), 'kurisu-codex-real-repo-'));
const worktrees = mkdtempSync(join(tmpdir(), 'kurisu-codex-real-worktrees-'));
const state = new KurisuStore();
const inbound = {
  updateId: `codex-real-${Date.now()}`,
  messageId: 'codex-real-message',
  botId: 'codex-real-test-bot',
  identity: { platform: 'test', platformUserId: 'codex-real-user' },
  conversation: { kind: 'private', chatId: 'codex-real-chat' },
  text: '',
  attachments: [],
  receivedAt: now,
};
const normalized = normalizeInbound(inbound, now);
state.claimInbound(normalized);
const run = state.createRun(normalized.sessionKey, `run_codex_real_${Date.now()}`, now);
const context = {
  runId: run.id,
  requestId: 'codex-real-request',
  identity: normalized.identity,
  conversation: normalized.conversation,
  sessionKey: normalized.sessionKey,
  principalKey: normalized.principalKey,
  botId: normalized.botId,
  authorization: adminAuthorization(['kurisu.codex.start', 'kurisu.codex.resume', 'kurisu.codex.cancel']),
  now,
  idempotencyKey: normalized.idempotencyKey,
  source: 'test-harness',
};

function git(args, cwd = repo) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function main() {
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'kurisu@example.invalid']);
  git(['config', 'user.name', 'Kurisu Real Test']);
  writeFileSync(join(repo, 'README.md'), '# Codex P4 isolated task\n');
  git(['add', 'README.md']);
  git(['commit', '-qm', 'initial']);

  const executor = new CodexAppServerExecutor(
    state,
    new CodexProjectRegistry([{ projectId: 'isolated', root: repo, workspaceMode: 'worktree' }], { worktreeParent: worktrees }),
    process.env.KURISU_CODEX_MODEL?.trim() ? { model: process.env.KURISU_CODEX_MODEL.trim() } : {},
  );
  try {
    const started = await executor.requestStart({
      projectId: 'isolated',
      goal: 'Append exactly one line KURISU_P4_REAL_OK to README.md, then run git diff --check. Do not change any other file.',
      constraints: ['Do not use network access.', 'Keep the source repository untouched.', 'Report only actual file and verification results.'],
    }, context);
    if (!started.jobId) throw new Error('real Codex start did not return a job id');
    const jobId = started.jobId;
    let approvalCount = 0;
    let final = await executor.status({ jobId }, context);
    for (let attempt = 0; attempt < 480; attempt += 1) {
      const job = state.getCodexJob(jobId);
      if (!job) throw new Error('real Codex job disappeared');
      if (job.status === 'waiting_approval' && job.pendingRequest) {
        const response = await executor.approveServerRequest(jobId, job.pendingRequest.requestId, context);
        if (response.status === 'unknown' || response.status === 'error') throw new Error(`Codex approval failed: ${response.error?.code ?? 'unknown'}`);
        approvalCount += 1;
      } else if (job.status === 'waiting_input') {
        throw new Error('Codex requested user input; this bounded verification does not invent an answer');
      }
      final = await executor.status({ jobId }, context);
      const current = state.getCodexJob(jobId);
      if (['succeeded', 'failed', 'cancelled', 'unknown'].includes(current.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const job = state.getCodexJob(jobId);
    if (job.status !== 'succeeded') throw new Error(`real Codex task ended as ${job.status}`);
    const workspaceReadme = readFileSync(join(job.workspaceRef, 'README.md'), 'utf8');
    const status = git(['status', '--porcelain'], job.workspaceRef);
    const diffCheck = execFileSync('git', ['diff', '--check'], { cwd: job.workspaceRef, encoding: 'utf8' });
    const changedFiles = status.split('\n').filter(Boolean).map((line) => line.slice(2).trim()).filter(Boolean);
    if (!workspaceReadme.includes('KURISU_P4_REAL_OK')) throw new Error('real Codex task did not produce the requested marker');
    if (changedFiles.length !== 1 || changedFiles[0] !== 'README.md') throw new Error(`unexpected changed files: ${changedFiles.join(',')}`);
    console.log(JSON.stringify({
      status: 'REAL_TASK_VERIFIED',
      cli: 'codex app-server --stdio',
      jobId,
      threadId: job.threadId,
      turnId: job.turnId,
      projectId: job.projectId,
      workspaceMode: 'worktree',
      sourceRepositoryClean: git(['status', '--porcelain']) === '',
      changedFiles,
      diffCheck: diffCheck === '',
      approvalCount,
      eventTypes: state.listEvents().filter((event) => event.eventType.startsWith('codex.job.')).map((event) => event.eventType),
      goalDigest: digest(job.goal),
      finalResponseStatus: final.status,
    }));
  } finally {
    await executor.close();
    state.close();
    rmSync(repo, { recursive: true, force: true });
    rmSync(worktrees, { recursive: true, force: true });
  }
}

await main();
