import test from 'node:test';
import assert from 'node:assert/strict';

import { makeCallback, normalizeInbound, type InboundMessageInput } from '../src/kurisu/contracts.js';
import { KurisuService } from '../src/kurisu/service.js';

function inbound(updateId = 'service-1'): InboundMessageInput {
  return {
    updateId,
    messageId: `message-${updateId}`,
    botId: 'telegram-bot',
    identity: { platform: 'telegram', platformUserId: 'user-1' },
    conversation: { kind: 'private', chatId: 'chat-1' },
    text: 'structured request',
    attachments: [],
    receivedAt: '2026-09-16T00:00:00.000Z',
  };
}

test('service persists a migrated structured inbound and restores it as a duplicate', async () => {
  const service = new KurisuService({
    now: () => '2026-09-16T00:00:01.000Z',
    backends: {
      pubg: {
        async query(input) { return { source: 'fixture', operation: input.operation }; },
        async list() { return { matches: [] }; },
        async review(input) { return { matchId: input.matchId }; },
      },
    },
  });
  try {
    const normalized = normalizeInbound(inbound());
    service.rollout.enable(normalized.sessionKey, 'p1-service');
    const decision = {
      toolCalls: [{
        id: 'call-service-1',
        name: 'kurisu.pubg.query',
        arguments: { operation: 'report', subject: { type: 'team', ids: [] }, metrics: [] },
      }],
      finalText: 'fixture result',
    };
    const first = await service.receiveInbound(inbound(), decision);
    assert.equal(first.status, 'completed');
    assert.equal(first.toolResults[0]?.response.status, 'ok');
    assert.equal(service.store.getRun(first.runId ?? '')?.status, 'succeeded');
    const duplicate = await service.receiveInbound(inbound(), decision);
    assert.equal(duplicate.status, 'duplicate');
    assert.equal(duplicate.trace.at(-1)?.event, 'duplicate_inbound_persistent');
  } finally {
    service.close();
  }
});

test('host tool endpoint accepts only structured input and keeps policy server-side', async () => {
  const service = new KurisuService();
  try {
    const base = {
      callId: 'call-host-1',
      toolName: 'kurisu.homehub.status',
      input: { serviceIds: [], includeMetrics: false },
      hostContext: {
        platform: 'telegram',
        platformUserId: 'user-1',
        conversation: { kind: 'private', chatId: 'chat-1' },
        botId: 'telegram-bot',
        queryId: 'query-1',
      },
    };
    const unavailable = await service.executeHostTool(base);
    assert.equal(unavailable.status, 'error');
    assert.equal(unavailable.error?.code, 'CAPABILITY_UNAVAILABLE');
    assert.equal(service.store.snapshotCounts().kurisu_tool_executions, 1);

    const forbidden = await service.executeHostTool({ ...base, callId: 'call-host-2', input: { serviceIds: [], admin: true } });
    assert.equal(forbidden.error?.code, 'MODEL_CONTEXT_FORBIDDEN');
    await assert.rejects(
      service.executeHostTool({ ...base, callId: 'call-host-3', role: 'ADMIN' }),
      /role/u,
    );
  } finally {
    service.close();
  }
});

test('service callback endpoint requires a gateway binding before accepting a callback', async () => {
  const service = new KurisuService();
  try {
    const owner = normalizeInbound(inbound('callback-owner'));
    service.rollout.enable(owner.sessionKey, 'p1-service');
    const callback = makeCallback({ kind: 'task', action: 'choose', id: 'task-1' });
    service.gateway.registerCallback(callback, { principalKey: owner.principalKey, sessionKey: owner.sessionKey, runId: 'run-callback' });
    const result = await service.receiveCallback({ ...inbound('callback-update'), callbackData: callback });
    assert.equal(result.status, 'accepted');
    assert.equal(result.runId, 'run-callback');
  } finally {
    service.close();
  }
});
