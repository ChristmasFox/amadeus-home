import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import {
  argumentsHash,
  makeCallback,
  normalizeInbound,
  parseCallback,
  type InboundMessageInput,
} from '../src/kurisu/contracts.js';
import { resolveReference } from '../src/kurisu/context.js';
import { registerDomainTools } from '../src/kurisu/domain-tools.js';
import { KurisuGateway, RolloutRegistry } from '../src/kurisu/gateway.js';
import { authorizeTool, publicReadAuthorization } from '../src/kurisu/policy.js';
import { homeHubToolCall, pubgToolCall, radarToolCall } from '../src/kurisu/structured-entry.js';
import { ToolRegistry } from '../src/kurisu/tools.js';

function inbound(overrides: Partial<InboundMessageInput> = {}): InboundMessageInput {
  return {
    updateId: 'update-1',
    messageId: 'message-1',
    botId: 'telegram-bot',
    identity: { platform: 'telegram', platformUserId: 'user-1', displayName: 'same name' },
    conversation: { kind: 'private', chatId: 'chat-1' },
    text: 'status',
    attachments: [],
    receivedAt: '2026-09-16T00:00:00.000Z',
    ...overrides,
  };
}

test('normalization keys identity and conversation by stable IDs, not display names', () => {
  const left = normalizeInbound(inbound());
  const right = normalizeInbound(inbound({ updateId: 'update-2', messageId: 'message-2', identity: { platform: 'telegram', platformUserId: 'user-2', displayName: 'same name' } }));

  assert.notEqual(left.principalKey, right.principalKey);
  assert.notEqual(left.idempotencyKey, right.idempotencyKey);
  assert.notEqual(left.sessionKey, right.sessionKey);
  assert.equal(argumentsHash({ b: 2, a: 1 }), argumentsHash({ a: 1, b: 2 }));
});

test('callback namespace is bounded and parseable without reusing HomeHub namespace', () => {
  const value = makeCallback({ kind: 'approval', action: 'approve', id: 'approval_1' });
  assert.match(value, /^ku1:approval:approve:approval_1$/u);
  assert.deepEqual(parseCallback(value), {
    namespace: 'ku1',
    kind: 'approval',
    action: 'approve',
    id: 'approval_1',
  });
  assert.equal(parseCallback('hh1:confirm:action_1'), null);
  assert.ok(Buffer.byteLength(value, 'utf8') <= 64);
});

test('context reference priority prefers reply, explicit IDs, then task and recent candidates', () => {
  assert.deepEqual(resolveReference({ replyTaskId: 'reply', explicitEntityRef: 'entity', activeTaskId: 'task' }), { kind: 'reply', value: 'reply' });
  assert.deepEqual(resolveReference({ explicitEntityRef: 'entity', explicitTaskId: 'explicit-task', activeTaskId: 'task' }), { kind: 'explicit', value: 'entity' });
  assert.deepEqual(resolveReference({ activeTaskId: 'task', recentEntityRef: 'entity' }), { kind: 'task', value: 'task' });
  assert.deepEqual(resolveReference({ recentEntityRef: 'entity' }), { kind: 'candidate', value: 'entity' });
});

test('domain tools expose structured schemas and a dummy tool needs only registration', async () => {
  const registry = new ToolRegistry({ authorize: authorizeTool });
  registerDomainTools(registry, {
    pubg: {
      async query(input) { return { domain: 'pubg', operation: input.operation }; },
      async list() { return { matches: [] }; },
      async review(input) { return { matchId: input.matchId }; },
    },
  });
  registry.register({
    name: 'kurisu.dummy.capability',
    version: '1.0.0',
    description: 'A register-only capability for acceptance tests.',
    risk: 'read',
    timeoutMs: 1000,
    idempotency: 'none',
    reconciliation: 'not_applicable',
    inputSchema: z.object({ value: z.string() }).strict(),
    jsonSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false },
    async handler(input) { return { contractVersion: 'kurisu.v1', status: 'ok', data: input, evidence: [], entityRefs: [] }; },
  });

  const catalog = registry.catalog();
  assert.ok(catalog.some((entry) => entry.name === 'kurisu.pubg.query'));
  assert.ok(catalog.some((entry) => entry.name === 'kurisu.dummy.capability'));
  const query = catalog.find((entry) => entry.name === 'kurisu.pubg.query');
  assert.equal(query?.inputSchema.additionalProperties, false);
  const response = await registry.execute(
    { id: 'call-1', name: 'kurisu.dummy.capability', arguments: { value: 'ok' } },
    {
      runId: 'run-1', requestId: 'request-1', identity: { platform: 'test', platformUserId: 'u' },
      conversation: { kind: 'private', chatId: 'c' }, sessionKey: 'test:bot:private:c:-:-', principalKey: 'test:u',
      botId: 'bot', authorization: publicReadAuthorization(), now: '2026-09-16T00:00:00.000Z', source: 'test-harness',
    },
  );
  assert.equal(response.status, 'ok');
  assert.equal(registry.catalog().length, 13);
});

test('registry rejects model-supplied trusted fields and missing capabilities', async () => {
  const registry = new ToolRegistry({ authorize: authorizeTool });
  registry.register({
    name: 'kurisu.test.read', version: '1.0.0', description: 'test', risk: 'read', timeoutMs: 1000,
    idempotency: 'none', reconciliation: 'not_applicable', inputSchema: z.object({ value: z.string() }).strict(),
    jsonSchema: { type: 'object' }, async handler() { return { contractVersion: 'kurisu.v1', status: 'ok', evidence: [], entityRefs: [] }; },
  });
  const context = {
    runId: 'run-1', requestId: 'request-1', identity: { platform: 'test' as const, platformUserId: 'u' },
    conversation: { kind: 'private' as const, chatId: 'c' }, sessionKey: 's', principalKey: 'test:u', botId: 'b',
    authorization: publicReadAuthorization(), now: '2026-09-16T00:00:00.000Z', source: 'test-harness' as const,
  };
  assert.equal((await registry.execute({ id: 'call-1', name: 'kurisu.test.read', arguments: { value: 'x', admin: true } }, context)).status, 'error');
  assert.equal((await registry.execute({ id: 'call-2', name: 'kurisu.missing', arguments: {} }, context)).status, 'error');
});

test('structured domain adapters preserve canonical PUBG semantics and never carry raw text', () => {
  const query = {
    version: 3 as const,
    queryId: 'query-structured',
    domain: 'pubg' as const,
    subject: { type: 'team' as const, ids: ['default_team'] },
    operation: 'rank' as const,
    selector: { type: 'relative_period' as const, value: 'today' },
    matchSelector: null,
    segments: [],
    groupBy: 'player' as const,
    metrics: ['kills' as const, 'damage' as const],
    filters: {},
    orderBy: { metric: 'kills' as const, direction: 'desc' as const },
    limit: 1,
    reference: { selectorExplicit: true, subjectExplicit: false, useResultSet: false, inheritedFromContext: false, planner: 'provided' as const },
    presentation: { compact: false },
  };
  const call = pubgToolCall(query, 'call-structured');
  assert.equal(call.name, 'kurisu.pubg.query');
  assert.deepEqual(call.arguments, {
    operation: 'rank',
    subject: { type: 'team', ids: ['default_team'] },
    timeRange: { kind: 'today', timezone: 'Asia/Shanghai' },
    metrics: ['kills', 'damage'],
  });
  assert.equal('text' in (call.arguments as Record<string, unknown>), false);
  assert.equal(homeHubToolCall({ domain: 'homehub', operation: 'status', serviceIds: ['emby'] }).name, 'kurisu.homehub.status');
  assert.equal(radarToolCall({ domain: 'radar', operation: 'stats', watchId: 'watch-1' }).name, 'kurisu.radar.stats');
});

test('gateway keeps legacy default, supports session rollout, and deduplicates update IDs only', async () => {
  const registry = new ToolRegistry({ authorize: authorizeTool });
  registerDomainTools(registry, {
    pubg: {
      async query(input) { return { operation: input.operation, source: 'fixture' }; },
      async list() { return []; },
      async review(input) { return input.matchId; },
    },
  });
  const rollout = new RolloutRegistry();
  const gateway = new KurisuGateway({ registry, rollout });
  const first = await gateway.receive(inbound());
  assert.equal(first.mode, 'legacy');
  const normalized = normalizeInbound(inbound());
  rollout.enable(normalized.sessionKey, 'p1-test');
  const migrated = await gateway.receive(inbound({ updateId: 'update-2', messageId: 'message-2' }), {
    toolCalls: [{ id: 'call-1', name: 'kurisu.pubg.query', arguments: { operation: 'report', subject: { type: 'team', ids: [] }, metrics: [] } }],
    finalText: 'structured result',
  });
  assert.equal(migrated.mode, 'kurisu');
  assert.equal(migrated.status, 'completed');
  assert.equal(migrated.toolResults[0]?.response.status, 'ok');
  const duplicate = await gateway.receive(inbound({ updateId: 'update-2', messageId: 'message-2' }), { toolCalls: [], finalText: 'different' });
  assert.equal(duplicate.status, 'duplicate');
  const independent = await gateway.receive(inbound({ updateId: 'update-3', messageId: 'message-3' }), { toolCalls: [], finalText: 'same text is independent' });
  assert.equal(independent.status, 'completed');
});

test('gateway accepts only server-bound callbacks and consumes each binding once', async () => {
  const registry = new ToolRegistry({ authorize: authorizeTool });
  const rollout = new RolloutRegistry();
  const gateway = new KurisuGateway({ registry, rollout });
  const owner = normalizeInbound(inbound());
  rollout.enable(owner.sessionKey, 'p1-callback');
  const callback = makeCallback({ kind: 'task', action: 'choose', id: 'task-1' });
  gateway.registerCallback(callback, { principalKey: owner.principalKey, sessionKey: owner.sessionKey, runId: 'run-callback' });
  const otherInbound = normalizeInbound(inbound({
    updateId: 'callback-1',
    messageId: 'callback-message-1',
    identity: { platform: 'telegram', platformUserId: 'other-user' },
    callbackData: callback,
  }));
  rollout.enable(otherInbound.sessionKey, 'p1-callback');

  const other = await gateway.handleCallback(otherInbound);
  assert.equal(other.status, 'error');
  assert.equal(other.trace.at(-1)?.details.reason, 'binding_mismatch');

  const accepted = await gateway.handleCallback(inbound({ updateId: 'callback-2', messageId: 'callback-message-2', callbackData: callback }));
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.runId, 'run-callback');

  const replay = await gateway.handleCallback(inbound({ updateId: 'callback-3', messageId: 'callback-message-3', callbackData: callback }));
  assert.equal(replay.status, 'error');
  assert.equal(replay.trace.at(-1)?.details.reason, 'binding_missing');

  const unbound = await gateway.handleCallback(inbound({ updateId: 'callback-4', messageId: 'callback-message-4', callbackData: 'ku1:task:choose:task-2' }));
  assert.equal(unbound.status, 'error');
  assert.equal(unbound.trace.at(-1)?.details.reason, 'binding_missing');
});
