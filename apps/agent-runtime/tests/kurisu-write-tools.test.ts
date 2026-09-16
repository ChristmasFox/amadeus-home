import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import {
  adminAuthorization,
  publicReadAuthorization,
  userAuthorization,
} from '../src/kurisu/policy.js';
import {
  normalizeInbound,
  parseCallback,
  type InboundMessageInput,
  type TrustedExecutionContext,
} from '../src/kurisu/contracts.js';
import { KurisuService } from '../src/kurisu/service.js';
import { KurisuStore } from '../src/kurisu/storage.js';
import { MediaPathPolicy } from '../src/kurisu/media.js';
import {
  mediaMoveHandler,
  radarWriteHandlers,
  registerWriteTools,
  WriteCoordinator,
  type StructuredWriteHandler,
} from '../src/kurisu/write-tools.js';
import { TaskEngine, type TaskStep, type TaskStepOutcome } from '../src/kurisu/tasks.js';
import { ToolRegistry, ok } from '../src/kurisu/tools.js';
import { authorizeTool } from '../src/kurisu/policy.js';

const FIXED_NOW = '2026-09-16T00:00:00.000Z';

function inbound(updateId: string, overrides: Partial<InboundMessageInput> = {}): InboundMessageInput {
  return {
    updateId,
    messageId: `message-${updateId}`,
    botId: 'test-bot',
    identity: { platform: 'test', platformUserId: 'user-1' },
    conversation: { kind: 'private', chatId: 'chat-1' },
    text: '',
    attachments: [],
    receivedAt: FIXED_NOW,
    ...overrides,
  };
}

function hostCall(queryId: string, callId: string, input: Record<string, unknown>, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    callId,
    toolName: 'kurisu.radar.mutate',
    input,
    hostContext: {
      platform: 'test',
      platformUserId: 'user-1',
      conversation: { kind: 'private', chatId: 'chat-1' },
      botId: 'test-bot',
      queryId,
    },
    ...overrides,
  };
}

function callbackInbound(callback: string, updateId: string, overrides: Partial<InboundMessageInput> = {}): InboundMessageInput {
  return inbound(updateId, { callbackData: callback, ...overrides });
}

function writeInput(): Record<string, unknown> {
  return { watchId: 'watch-1', action: 'pause', reason: 'fixture approval test' };
}

function context(runId: string, sessionKey = 'test:user-1:test-bot:private:chat-1:-:-', overrides: Partial<TrustedExecutionContext> = {}): TrustedExecutionContext {
  return {
    runId,
    requestId: `request-${runId}`,
    identity: { platform: 'test', platformUserId: 'user-1' },
    conversation: { kind: 'private', chatId: 'chat-1' },
    sessionKey,
    principalKey: 'test:user-1',
    botId: 'test-bot',
    authorization: publicReadAuthorization(),
    now: FIXED_NOW,
    source: 'test-harness',
    ...overrides,
  };
}

function successfulWrite(calls: { input: unknown; runId: string }[]): StructuredWriteHandler {
  return {
    async execute(input, trusted) {
      calls.push({ input, runId: trusted.runId });
      return { status: 'succeeded', result: { accepted: true, input }, externalId: 'external-write-1' };
    },
  };
}

test('public write request is approval-only, callback is principal/chat bound, and replay never writes twice', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'kurisu-write-approval-'));
  const calls: Array<{ input: unknown; runId: string }> = [];
  const service = new KurisuService({
    stateFile: join(directory, 'state.sqlite'),
    now: () => FIXED_NOW,
    authorization: () => userAuthorization(),
    writeHandlers: { radarMutation: successfulWrite(calls) },
  });
  try {
    const pending = await service.executeHostTool(hostCall('write-query-1', 'write-call-1', writeInput()));
    assert.equal(pending.status, 'needs_input');
    assert.equal(calls.length, 0);
    const data = pending.data as Record<string, unknown>;
    assert.equal(typeof data.runId, 'string');
    assert.equal(typeof data.approvalId, 'string');
    assert.equal(typeof data.callback, 'string');
    const callback = String(data.callback);
    const binding = service.store.getCallbackBinding(callback);
    assert.equal(binding?.runId, data.runId);
    assert.equal(service.store.getRun(String(data.runId))?.status, 'waiting_approval');

    const wrongUser = await service.receiveCallback(callbackInbound(callback, 'wrong-user', {
      identity: { platform: 'test', platformUserId: 'user-2' },
    }));
    assert.equal(wrongUser.status, 'error');
    assert.equal(wrongUser.trace.at(-1)?.details.reason, 'binding_mismatch');
    assert.equal(calls.length, 0);

    const wrongChat = await service.receiveCallback(callbackInbound(callback, 'wrong-chat', {
      conversation: { kind: 'private', chatId: 'chat-2' },
    }));
    assert.equal(wrongChat.status, 'error');
    assert.equal(wrongChat.trace.at(-1)?.details.reason, 'binding_mismatch');
    assert.equal(calls.length, 0);

    const accepted = await service.receiveCallback(callbackInbound(callback, 'approval-1'));
    assert.equal(accepted.status, 'accepted');
    assert.equal(accepted.approvalResponse?.status, 'ok');
    assert.equal(calls.length, 1);
    assert.equal(service.store.getApproval(String(data.approvalId))?.status, 'used');
    assert.equal(service.store.getRun(String(data.runId))?.status, 'succeeded');

    const replay = await service.receiveCallback(callbackInbound(callback, 'approval-replay'));
    assert.equal(replay.status, 'error');
    assert.equal(replay.trace.at(-1)?.details.reason, 'binding_missing');
    assert.equal(calls.length, 1);
    assert.equal(service.store.snapshotCounts().kurisu_message_task_links, 5);
    assert.deepEqual(
      service.store.listRunsForMessage(
        'test:user-1:test-bot:private:chat-1:-:-',
        'write-query-1:write-call-1',
      ).map((item) => item.id),
      [String(data.runId)],
    );
  } finally {
    service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('approval binding and exact arguments survive a service restart without becoming default approval', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'kurisu-write-restart-'));
  const stateFile = join(directory, 'state.sqlite');
  let callback = '';
  let runId = '';
  try {
    const firstCalls: unknown[] = [];
    const first = new KurisuService({
      stateFile,
      now: () => FIXED_NOW,
      authorization: () => userAuthorization(),
      writeHandlers: { radarMutation: { async execute(input) { firstCalls.push(input); return { status: 'succeeded', result: { first: true } }; } } },
    });
    const pending = await first.executeHostTool(hostCall('restart-query', 'restart-call', writeInput()));
    const data = pending.data as Record<string, unknown>;
    callback = String(data.callback);
    runId = String(data.runId);
    assert.equal(pending.status, 'needs_input');
    assert.equal(firstCalls.length, 0);
    first.close();

    const secondCalls: unknown[] = [];
    const second = new KurisuService({
      stateFile,
      now: () => FIXED_NOW,
      authorization: () => userAuthorization(),
      writeHandlers: { radarMutation: { async execute(input) { secondCalls.push(input); return { status: 'succeeded', result: { second: true } }; } } },
    });
    try {
      const resumed = await second.receiveCallback(callbackInbound(callback, 'restart-approval'));
      assert.equal(resumed.status, 'accepted');
      assert.equal(resumed.approvalResponse?.status, 'ok');
      assert.equal(secondCalls.length, 1);
      assert.deepEqual(secondCalls[0], writeInput());
      assert.equal(second.store.getApproval(String(data.approvalId))?.status, 'used');
      assert.equal(second.store.getRun(runId)?.status, 'succeeded');
      assert.equal(second.store.getCallbackBinding(callback)?.consumedAt !== null, true);
    } finally {
      second.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('default public authorization rejects writes before approval and never invokes the handler', async () => {
  const calls: unknown[] = [];
  const service = new KurisuService({
    authorization: () => publicReadAuthorization(),
    writeHandlers: { radarMutation: { async execute(input) { calls.push(input); return { status: 'succeeded', result: {} }; } } },
  });
  try {
    const response = await service.executeHostTool(hostCall('public-write-query', 'public-write-call', writeInput()));
    assert.equal(response.status, 'denied');
    assert.equal(response.error?.code, 'TOOL_POLICY_DENIED');
    assert.equal(calls.length, 0);
  } finally {
    service.close();
  }
});

test('write coordinator records an unknown external result and recovery reconciles without repeating the mutation', async () => {
  const store = new KurisuStore();
  const session = normalizeInbound(inbound('coordinator-inbound'));
  store.claimInbound(session);
  const run = store.createRun(session.sessionKey, 'run-write-reconcile', FIXED_NOW);
  let executeCalls = 0;
  let reconcileCalls = 0;
  const coordinator = new WriteCoordinator(store, { owner: 'write-coordinator-test', now: () => FIXED_NOW });
  registerWriteTools(new ToolRegistry({ authorize: authorizeTool }), coordinator, {
    radarMutation: {
      async execute() {
        executeCalls += 1;
        return { status: 'unknown', result: { code: 'DOWNSTREAM_TIMEOUT' }, externalId: 'external-1' };
      },
      async reconcile(_input, _trusted, previous) {
        reconcileCalls += 1;
        return { status: 'succeeded', result: { reconciled: true, previous: previous.result }, externalId: previous.externalId ?? 'external-1' };
      },
    },
  });
  try {
    const trusted = context(run.id, session.sessionKey, { authorization: adminAuthorization(['kurisu.radar.mutate']) });
    const first = await coordinator.request('kurisu.radar.mutate', writeInput(), trusted);
    assert.equal(first.status, 'unknown');
    assert.equal(first.error?.code, 'TASK_RECONCILING');
    assert.equal(executeCalls, 1);
    assert.equal(reconcileCalls, 0);
    assert.equal(store.getRun(run.id)?.status, 'reconciling');
    assert.equal(store.getTaskStep(run.id, 'write:kurisu.radar.mutate')?.status, 'unknown');

    const recovered = await coordinator.recover(run.id, trusted);
    assert.equal(recovered.status, 'ok');
    assert.equal(executeCalls, 1);
    assert.equal(reconcileCalls, 1);
    assert.equal(store.getRun(run.id)?.status, 'succeeded');
    assert.equal(store.getTaskStep(run.id, 'write:kurisu.radar.mutate')?.status, 'succeeded');
  } finally {
    store.close();
  }
});

test('task engine preserves intent at the crash point, prevents concurrent duplicate execution, and stops after cancellation', async () => {
  const store = new KurisuStore();
  const session = normalizeInbound(inbound('task-concurrency'));
  store.claimInbound(session);
  const run = store.createRun(session.sessionKey, 'run-task-concurrency', FIXED_NOW);
  let writes = 0;
  let releaseFirst: () => void = () => undefined;
  let signalStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  const step: TaskStep = {
    key: 'write-once',
    action: { entity: 'watch-1' },
    async execute() {
      writes += 1;
      signalStarted();
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      return { status: 'succeeded', result: { writes } };
    },
  };
  const first = new TaskEngine(store, { owner: 'worker-one', now: () => FIXED_NOW });
  const second = new TaskEngine(store, { owner: 'worker-two', now: () => FIXED_NOW });
  const firstRun = first.execute(run.id, context(run.id, session.sessionKey), [step]);
  await started;
  await assert.rejects(second.execute(run.id, context(run.id, session.sessionKey), [step]), /not claimable/u);
  releaseFirst();
  assert.equal((await firstRun).status, 'succeeded');
  assert.equal(writes, 1);

  const cancelledRun = store.createRun(session.sessionKey, 'run-task-cancelled', FIXED_NOW);
  let releaseCancelled: () => void = () => undefined;
  let signalCancelled: () => void = () => undefined;
  const cancelledStarted = new Promise<void>((resolve) => { signalCancelled = resolve; });
  let laterSteps = 0;
  const cancellationSteps: TaskStep[] = [
    {
      key: 'partial-write',
      action: { entity: 'watch-2' },
      async execute() {
        signalCancelled();
        await new Promise<void>((resolve) => { releaseCancelled = resolve; });
        return { status: 'succeeded', result: { externalPartial: true } };
      },
    },
    {
      key: 'must-not-run',
      action: { entity: 'watch-2' },
      async execute() {
        laterSteps += 1;
        return { status: 'succeeded', result: {} };
      },
    },
  ];
  const cancellationRun = new TaskEngine(store, { owner: 'worker-cancel', now: () => FIXED_NOW }).execute(
    cancelledRun.id,
    context(cancelledRun.id, session.sessionKey),
    cancellationSteps,
  );
  await cancelledStarted;
  assert.equal(store.cancelRun(cancelledRun.id, FIXED_NOW).status, 'cancelled');
  releaseCancelled();
  assert.equal((await cancellationRun).status, 'cancelled');
  assert.equal(laterSteps, 0);
  store.close();
});

test('three write crash points recover by stable intent, reconcile, and persisted result without a blind repeat', async () => {
  const store = new KurisuStore();
  const session = normalizeInbound(inbound('three-crash-points'));
  store.claimInbound(session);

  const beforeSendRun = store.createRun(session.sessionKey, 'run-before-send', FIXED_NOW);
  let beforeSendCalls = 0;
  let beforeSendKey = '';
  const beforeSendStep: TaskStep = {
    key: 'before-send',
    action: { idempotencyKey: 'stable-before-send-key', entity: 'watch-1' },
    async execute(trusted) {
      beforeSendCalls += 1;
      beforeSendKey = trusted.idempotencyKey ?? '';
      return { status: 'succeeded', result: { sent: true } };
    },
    async reconcile() {
      return { status: 'retry', result: { externalRequestSent: false } };
    },
  };
  await assert.rejects(
    new TaskEngine(store, {
      owner: 'crash-before-send',
      now: () => FIXED_NOW,
      faultAfterIntent: () => { throw new Error('crash-before-send'); },
    }).execute(beforeSendRun.id, context(beforeSendRun.id, session.sessionKey), [beforeSendStep]),
    /crash-before-send/u,
  );
  assert.equal(store.getTaskStep(beforeSendRun.id, beforeSendStep.key)?.status, 'running');
  assert.equal((await new TaskEngine(store, { owner: 'recover-before-send', now: () => FIXED_NOW }).recover(beforeSendRun.id, context(beforeSendRun.id, session.sessionKey), [beforeSendStep])).status, 'succeeded');
  assert.equal(beforeSendCalls, 1);
  assert.equal(beforeSendKey, 'stable-before-send-key');

  const afterExternalRun = store.createRun(session.sessionKey, 'run-after-external', FIXED_NOW);
  let externalCalls = 0;
  let externalState = false;
  const afterExternalStep: TaskStep = {
    key: 'after-external',
    action: { idempotencyKey: 'stable-after-external-key', entity: 'watch-2' },
    async execute() {
      externalCalls += 1;
      externalState = true;
      return { status: 'succeeded', result: { remoteAccepted: true } };
    },
    async reconcile() {
      return externalState
        ? { status: 'succeeded', result: { reconciled: true } }
        : { status: 'retry', result: { externalRequestSent: false } };
    },
  };
  await assert.rejects(
    new TaskEngine(store, {
      owner: 'crash-after-external',
      now: () => FIXED_NOW,
      faultBeforeOutcomePersist: () => { throw new Error('crash-after-external'); },
    }).execute(afterExternalRun.id, context(afterExternalRun.id, session.sessionKey), [afterExternalStep]),
    /crash-after-external/u,
  );
  assert.equal(externalCalls, 1);
  assert.equal(store.getTaskStep(afterExternalRun.id, afterExternalStep.key)?.status, 'running');
  assert.equal((await new TaskEngine(store, { owner: 'recover-after-external', now: () => FIXED_NOW }).recover(afterExternalRun.id, context(afterExternalRun.id, session.sessionKey), [afterExternalStep])).status, 'succeeded');
  assert.equal(externalCalls, 1);

  const persistedRun = store.createRun(session.sessionKey, 'run-result-persisted', FIXED_NOW);
  const coordinator = new WriteCoordinator(store, { owner: 'persisted-result', now: () => FIXED_NOW });
  registerWriteTools(new ToolRegistry({ authorize: authorizeTool }), coordinator, {
    radarMutation: {
      async execute() {
        externalCalls += 1;
        return { status: 'succeeded', result: { persisted: true } };
      },
    },
  });
  const trusted = context(persistedRun.id, session.sessionKey, { authorization: adminAuthorization(['kurisu.radar.mutate']) });
  const completed = await coordinator.request('kurisu.radar.mutate', writeInput(), trusted);
  assert.equal(completed.status, 'ok');
  const repeatedResponse = await coordinator.request('kurisu.radar.mutate', writeInput(), trusted);
  assert.equal(repeatedResponse.status, 'ok');
  assert.equal(externalCalls, 2);
  assert.equal(store.getRun(persistedRun.id)?.status, 'succeeded');
  store.close();
});

test('tool timeout is unknown and nested model-owned trusted fields are rejected before handler execution', async () => {
  const registry = new ToolRegistry({ authorize: authorizeTool });
  let calls = 0;
  registry.register({
    name: 'kurisu.test.slow',
    version: '1.0.0',
    description: 'bounded timeout fixture',
    risk: 'read',
    timeoutMs: 10,
    idempotency: 'none',
    reconciliation: 'not_applicable',
    inputSchema: z.object({ value: z.string() }).passthrough(),
    jsonSchema: { type: 'object' },
    async handler() {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return ok({ done: true });
    },
  });
  const timedOut = await registry.execute({ id: 'slow-call', name: 'kurisu.test.slow', arguments: { value: 'x' } }, context('run-timeout'));
  assert.equal(timedOut.status, 'unknown');
  assert.equal(timedOut.error?.code, 'TOOL_TIMEOUT');
  assert.equal(calls, 1);

  const rejected = await registry.execute({
    id: 'nested-forbidden',
    name: 'kurisu.test.slow',
    arguments: { value: 'x', nested: [{ metadata: { authorization: 'ADMIN' } }] },
  }, context('run-nested-forbidden'));
  assert.equal(rejected.status, 'error');
  assert.equal(rejected.error?.code, 'MODEL_CONTEXT_FORBIDDEN');
});

test('Radar write adapter distinguishes success from uncertainty and reconciles pause through a read probe', async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const handlers = radarWriteHandlers({
    baseUrl: 'http://radar.test',
    apiKey: 'fixture-key',
    fetchImpl: async (url, init) => {
      const method = String(init?.method ?? 'GET');
      requests.push({ url: String(url), method });
      if (method === 'POST') return new Response(JSON.stringify({ id: 'watch-1', enabled: false }), { status: 200 });
      return new Response(JSON.stringify({ watch: { id: 'watch-1', enabled: false } }), { status: 200 });
    },
  });
  const trusted = context('run-radar-write', 'test:user-1:test-bot:private:chat-1:-:-', { authorization: adminAuthorization(['kurisu.radar.mutate']) });
  const outcome = await handlers.radarMutation!.execute(writeInput(), trusted);
  assert.equal(outcome.status, 'succeeded');
  assert.equal(outcome.externalId, 'watch-1');
  const reconciled = await handlers.radarMutation!.reconcile!(writeInput(), trusted, {
    runId: trusted.runId,
    stepKey: 'write:kurisu.radar.mutate',
    status: 'unknown',
    intent: {},
    result: outcome.result,
    externalId: outcome.externalId ?? null,
    attempts: 1,
    updatedAt: FIXED_NOW,
  });
  assert.equal(reconciled.status, 'succeeded');
  assert.deepEqual(requests.map((request) => request.method), ['POST', 'GET']);
  assert.match(requests[1]?.url ?? '', /watch-1\/status/u);
});

test('approved media move reuses the allowlist and refuses an existing target', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'kurisu-media-write-'));
  const downloads = join(directory, 'downloads');
  const movies = join(directory, 'movies');
  const tv = join(directory, 'tv');
  mkdirSync(downloads); mkdirSync(movies); mkdirSync(tv);
  const source = join(downloads, 'movie.mkv');
  const target = join(movies, 'Movie (2020).mkv');
  writeFileSync(source, 'fixture');
  const policy = new MediaPathPolicy({ downloads, movies, tv });
  const store = new KurisuStore();
  const session = normalizeInbound(inbound('media-write'));
  store.claimInbound(session);
  const run = store.createRun(session.sessionKey, 'run-media-write', FIXED_NOW);
  const coordinator = new WriteCoordinator(store, { owner: 'media-write-test', now: () => FIXED_NOW });
  const registry = new ToolRegistry({ authorize: authorizeTool });
  registerWriteTools(registry, coordinator, { mediaMove: mediaMoveHandler(policy) });
  try {
    const trusted = context(run.id, session.sessionKey);
    const pending = await coordinator.request('kurisu.media.move', { source, target, reason: 'explicit media organization' }, trusted);
    assert.equal(pending.status, 'needs_input');
    assert.equal(existsSync(source), true);
    const callback = String((pending.data as Record<string, unknown>).callback);
    const parsed = parseCallback(callback);
    assert.ok(parsed);
    const result = await coordinator.approveCallback(trusted, parsed!);
    assert.equal(result.status, 'ok');
    assert.equal(existsSync(source), false);
    assert.equal(existsSync(target), true);
    assert.equal(existsSync(`${source}.kurisu-backup`), true);

    const existingTarget = join(movies, 'existing.mkv');
    writeFileSync(existingTarget, 'existing');
    const secondSource = join(downloads, 'second.mkv');
    writeFileSync(secondSource, 'second');
    assert.throws(() => policy.plan(secondSource, existingTarget, 'should reject'), /target already exists/u);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
