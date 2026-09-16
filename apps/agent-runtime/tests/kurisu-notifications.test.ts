import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { userAuthorization } from '../src/kurisu/policy.js';
import { adminAuthorization } from '../src/kurisu/policy.js';
import { normalizeInbound } from '../src/kurisu/contracts.js';
import { homehubActionInputSchema, WriteCoordinator } from '../src/kurisu/write-tools.js';
import {
  NotificationPreferenceStore,
  NotificationWorker,
  LangBotNotificationChannel,
  renderNotification,
  type NotificationChannel,
  type NotificationEventInput,
  type NotificationSendResult,
  type NotificationTarget,
} from '../src/kurisu/notifications.js';
import { KurisuService } from '../src/kurisu/service.js';
import { KurisuStore } from '../src/kurisu/storage.js';

const T0 = '2026-09-16T00:00:00.000Z';
const T1 = '2026-09-16T00:00:01.000Z';
const T2 = '2026-09-16T00:00:02.000Z';
const TELEGRAM: NotificationTarget = { channel: 'telegram', recipient: 'user-1' };
const KOOK: NotificationTarget = { channel: 'kook', recipient: 'user-1' };

function event(overrides: Partial<NotificationEventInput> = {}): NotificationEventInput {
  return {
    eventType: 'radar.match.created',
    eventKey: 'radar:event-1',
    principalKey: 'telegram:user-1',
    source: 'radar',
    resultType: 'info',
    payload: { summary: 'new listing', itemId: 'item-1' },
    ...overrides,
  };
}

function fakeChannel(
  channel: NotificationTarget['channel'],
  recipient: string,
  outcomes: NotificationSendResult[],
): NotificationChannel & { calls: string[] } {
  const calls: string[] = [];
  return {
    channel,
    recipient,
    calls,
    async send(context) {
      calls.push(`${context.event.eventKey}:${context.delivery.attempts}`);
      return outcomes.shift() ?? { status: 'sent' };
    },
  };
}

test('notification event and delivery enqueue are idempotent across repeated producer calls', () => {
  const store = new KurisuStore();
  const worker = new NotificationWorker(store, { now: () => T0 });
  try {
    const first = worker.ingest(event(), [TELEGRAM, KOOK], T0);
    const second = worker.ingest(event(), [TELEGRAM, KOOK], T1);
    assert.equal(first.inserted, true);
    assert.equal(second.inserted, false);
    assert.equal(store.listEvents().length, 1);
    assert.equal(store.listDeliveries().length, 2);
    assert.deepEqual(second.deliveries.map((delivery) => delivery.inserted), [false, false]);
  } finally {
    store.close();
  }
});

test('channel delivery retries independently and leases prevent duplicate sends', async () => {
  const store = new KurisuStore();
  const telegram = fakeChannel('telegram', 'user-1', [{ status: 'retryable_failed', reason: 'temporary gateway', retryAfterMs: 100 }, { status: 'sent', platformMessageId: 'tg-1' }]);
  const kook = fakeChannel('kook', 'user-1', [{ status: 'sent', platformMessageId: 'kook-1' }]);
  const worker = new NotificationWorker(store, { channels: [telegram, kook], retryBaseMs: 100, owner: 'worker-a', now: () => T0 });
  try {
    const queued = worker.ingest(event({ eventKey: 'retry:event-1' }), [TELEGRAM, KOOK], T0);
    const first = await worker.deliverDue(T0);
    assert.deepEqual(first, { scanned: 2, sent: 1, retryableFailed: 1, unknown: 0, dead: 0 });
    assert.equal(telegram.calls.length, 1);
    assert.equal(kook.calls.length, 1);
    assert.equal(store.claimDelivery(queued.deliveries[0]!.id, 'worker-b', new Date(T0), 1_000), null);

    const beforeRetry = await worker.deliverDue('2026-09-16T00:00:00.099Z');
    assert.equal(beforeRetry.scanned, 0);
    const second = await worker.deliverDue('2026-09-16T00:00:00.100Z');
    assert.deepEqual(second, { scanned: 1, sent: 1, retryableFailed: 0, unknown: 0, dead: 0 });
    assert.equal(telegram.calls.length, 2);
    assert.equal(kook.calls.length, 1);
    const deliveries = store.listDeliveries(queued.eventId);
    assert.deepEqual(deliveries.map((delivery) => delivery.status).sort(), ['sent', 'sent']);
    assert.deepEqual(deliveries.map((delivery) => delivery.platformMessageId).sort(), ['kook-1', 'tg-1']);
  } finally {
    store.close();
  }
});

test('pending notification outbox survives a worker/store restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'kurisu-notifications-'));
  const database = join(directory, 'kurisu.sqlite');
  const firstStore = new KurisuStore(database);
  const firstWorker = new NotificationWorker(firstStore, { now: () => T0 });
  const queued = firstWorker.ingest(event({ eventKey: 'restart:event-1' }), [TELEGRAM], T0);
  firstStore.close();

  const calls: string[] = [];
  const secondStore = new KurisuStore(database);
  const secondWorker = new NotificationWorker(secondStore, {
    now: () => T1,
    channels: [{
      channel: 'telegram',
      recipient: 'user-1',
      async send() { calls.push('sent-after-restart'); return { status: 'sent', platformMessageId: 'restart-1' }; },
    }],
  });
  try {
    assert.equal(secondStore.getNotificationEvent(queued.eventId)?.deliveries[0]?.status, 'pending');
    const drained = await secondWorker.deliverDue(T1);
    assert.equal(drained.sent, 1);
    assert.deepEqual(calls, ['sent-after-restart']);
    assert.equal(secondStore.getDelivery(queued.deliveries[0]!.id)?.status, 'sent');
  } finally {
    secondStore.close();
  }
});

test('unknown platform outcome is persisted separately from the source event result', async () => {
  const store = new KurisuStore();
  const worker = new NotificationWorker(store, {
    channels: [fakeChannel('telegram', 'user-1', [{ status: 'unknown', reason: 'response lost after acceptance' }])],
    now: () => T0,
  });
  try {
    const queued = worker.ingest(event({ eventKey: 'unknown:event-1', resultType: 'success', payload: { summary: 'restart requested' } }), [TELEGRAM], T0);
    const drained = await worker.deliverDue(T0);
    assert.equal(drained.unknown, 1);
    assert.equal(store.getDelivery(queued.deliveries[0]!.id)?.status, 'unknown');
    const saved = store.getNotificationEvent(queued.eventId)!;
    assert.match(renderNotification(saved), /✅/u, 'the source result and platform delivery evidence remain separate');
    assert.equal(saved.deliveries[0]?.status, 'unknown');
  } finally {
    store.close();
  }
});

test('event owner can explicitly requeue a dead delivery without crossing principal scope', async () => {
  const store = new KurisuStore();
  const telegram = fakeChannel('telegram', 'user-1', [{ status: 'dead', reason: 'permanent rejection' }, { status: 'sent', platformMessageId: 'retried-1' }]);
  const worker = new NotificationWorker(store, { channels: [telegram], maxAttempts: 1, now: () => T0 });
  try {
    const queued = worker.ingest(event({ eventKey: 'retry-manual:event-1' }), [TELEGRAM], T0);
    await worker.deliverDue(T0);
    assert.equal(store.getDelivery(queued.deliveries[0]!.id)?.status, 'dead');
    assert.equal(worker.retryDelivery(queued.deliveries[0]!.id, 'telegram:other', T1), null);
    assert.equal(worker.retryDelivery(queued.deliveries[0]!.id, 'telegram:user-1', T1)?.status, 'pending');
    await worker.deliverDue(T1);
    assert.equal(store.getDelivery(queued.deliveries[0]!.id)?.status, 'sent');
    assert.equal(telegram.calls.length, 2);
  } finally {
    store.close();
  }
});

test('notification preferences are principal-scoped, specific rules win, and expiry restores delivery', () => {
  const store = new KurisuStore();
  const preferences = new NotificationPreferenceStore(store, () => T0);
  try {
    preferences.setRule('telegram:user-1', { source: 'all', resultType: 'all', channel: 'all', action: 'mute', until: '2026-09-16T01:00:00.000Z', timezone: 'Asia/Shanghai' }, T0);
    const specific = preferences.setRule('telegram:user-1', { source: 'codex', resultType: 'failure', channel: 'telegram', action: 'allow', until: null, timezone: 'Asia/Shanghai', reference: 'user-request-1' }, T0);
    assert.equal(specific.provenance.principalKey, 'telegram:user-1');
    assert.equal(preferences.shouldDeliver('telegram:user-1', 'codex', 'success', 'telegram', T0), false);
    assert.equal(preferences.shouldDeliver('telegram:user-1', 'codex', 'failure', 'telegram', T0), true);
    assert.equal(preferences.shouldDeliver('telegram:user-1', 'radar', 'info', 'telegram', T0), false);
    assert.equal(preferences.shouldDeliver('telegram:other', 'radar', 'info', 'telegram', T0), true);
    assert.equal(preferences.shouldDeliver('telegram:user-1', 'radar', 'info', 'telegram', '2026-09-16T01:00:00.000Z'), true);
    assert.equal(preferences.forget('telegram:user-1', { source: 'codex' }, T1), 1);
    assert.equal(preferences.list('telegram:user-1', T1).length, 1);
  } finally {
    store.close();
  }
});

test('preference tools require server authorization and preserve the authenticated principal', async () => {
  const service = new KurisuService({ authorization: () => userAuthorization(), now: () => T0 });
  try {
    const hostContext = {
      platform: 'telegram' as const,
      platformUserId: 'user-1',
      conversation: { kind: 'private' as const, chatId: 'chat-1' },
      botId: 'telegram-bot',
      queryId: 'preference-query',
    };
    const set = await service.executeHostTool({
      toolName: 'kurisu.notifications.preference.set',
      callId: 'preference-set',
      input: { source: 'radar', resultType: 'failure', channel: 'telegram', action: 'mute', until: null, timezone: 'Asia/Shanghai' },
      hostContext,
    });
    assert.equal(set.status, 'ok');
    const get = await service.executeHostTool({
      toolName: 'kurisu.notifications.preference.get',
      callId: 'preference-get',
      input: {},
      hostContext: { ...hostContext, queryId: 'preference-query-get' },
    });
    assert.equal(get.status, 'ok');
    const rules = (get.data as { rules: Array<{ provenance: { principalKey: string } }> }).rules;
    assert.equal(rules[0]?.provenance.principalKey, 'telegram:user-1');
  } finally {
    service.close();
  }
});

test('legacy Codex completion is accepted as an evidence-limited unknown event', () => {
  const store = new KurisuStore();
  const worker = new NotificationWorker(store, { now: () => T0 });
  try {
    const result = worker.ingestLegacyCodex({ threadId: 'thread-1', turnId: 'turn-1', cwd: '/workspace/example', lastAssistantMessage: 'completed without durable job evidence' }, [TELEGRAM], 'codex:external', T0);
    const saved = store.getNotificationEvent(result.eventId)!;
    assert.equal((saved.payload as Record<string, unknown>).resultType, 'unknown');
    assert.equal((saved.payload as Record<string, unknown>).evidenceState, 'no_durable_task_evidence');
    assert.match(renderNotification(saved), /结果待核实/u);
    assert.doesNotMatch(renderNotification(saved), /✅/u);
  } finally {
    store.close();
  }
});

test('expired sending lease can be claimed by a recovery worker', () => {
  const store = new KurisuStore();
  const worker = new NotificationWorker(store, { now: () => T0 });
  try {
    const queued = worker.ingest(event({ eventKey: 'lease:event-1' }), [TELEGRAM], T0);
    assert.ok(store.claimDelivery(queued.deliveries[0]!.id, 'worker-a', new Date(T0), 1_000));
    assert.equal(store.claimDelivery(queued.deliveries[0]!.id, 'worker-b', new Date(T0), 1_000), null);
    const recovered = store.claimDelivery(queued.deliveries[0]!.id, 'worker-b', new Date(T2), 1_000);
    assert.equal(recovered?.leaseOwner, 'worker-b');
    assert.equal(recovered?.status, 'sending');
  } finally {
    store.close();
  }
});

test('serious failure rendering remains plain and actionable', () => {
  const store = new KurisuStore();
  const worker = new NotificationWorker(store, { now: () => T0 });
  try {
    const result = worker.ingest(event({
      eventKey: 'serious:event-1',
      resultType: 'failure',
      payload: { summary: 'disk write failed', serious: true },
    }), [], T0);
    const saved = store.getNotificationEvent(result.eventId)!;
    assert.equal(renderNotification(saved), '严重告警：disk write failed');
    assert.doesNotMatch(renderNotification(saved), /玩笑|成功|✅/u);
  } finally {
    store.close();
  }
});

test('structured HomeHub writes emit a durable central event with task linkage', async () => {
  const store = new KurisuStore();
  const notifications = new NotificationWorker(store, { now: () => T0 });
  const coordinator = new WriteCoordinator(store, {
    now: () => T0,
    notificationWorker: notifications,
    notificationTargets: [TELEGRAM],
  });
  coordinator.register({
    name: 'kurisu.homehub.action',
    description: 'fixture HomeHub action',
    inputSchema: homehubActionInputSchema,
    handler: {
      async execute() { return { status: 'succeeded', result: { verified: true } }; },
    },
  });
  const inbound = normalizeInbound({
    updateId: 'homehub-notification-update',
    messageId: 'homehub-notification-message',
    botId: 'telegram-bot',
    identity: { platform: 'telegram', platformUserId: 'user-1' },
    conversation: { kind: 'private', chatId: 'chat-1' },
    text: 'fixture',
    attachments: [],
    receivedAt: T0,
  }, T0);
  store.claimInbound(inbound);
  store.createRun(inbound.sessionKey, 'run-homehub-notification', T0);
  const response = await coordinator.request('kurisu.homehub.action', { serviceId: 'aria2', action: 'restart', reason: 'fixture' }, {
    runId: 'run-homehub-notification',
    requestId: 'request-homehub-notification',
    identity: { platform: 'telegram', platformUserId: 'user-1' },
    conversation: { kind: 'private', chatId: 'chat-1' },
    sessionKey: inbound.sessionKey,
    principalKey: 'telegram:user-1',
    botId: 'telegram-bot',
    authorization: adminAuthorization(['kurisu.homehub.action']),
    now: T0,
    source: 'test-harness',
  });
  try {
    assert.equal(response.status, 'ok');
    const events = store.listNotificationEvents('homehub.task.success', 'all', 'telegram:user-1');
    assert.equal(events.length, 1);
    assert.equal((events[0]?.payload as Record<string, unknown>).taskId, 'run-homehub-notification');
    assert.equal(events[0]?.deliveries[0]?.status, 'pending');
  } finally {
    store.close();
  }
});

test('LangBot notification channel preserves the configured group target type', async () => {
  const bodies: unknown[] = [];
  const channel = new LangBotNotificationChannel({
    channel: 'kook', baseUrl: 'http://langbot:5300', botId: 'bot-1', recipient: 'group-1', targetType: 'group', apiToken: 'token',
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({ success: true, data: { messageId: 'message-1' } }), { status: 200 });
    },
  });
  const store = new KurisuStore();
  try {
    const worker = new NotificationWorker(store, { channels: [channel], now: () => T0 });
    worker.ingest(event({ eventKey: 'group:event-1' }), [{ channel: 'kook', recipient: 'group-1' }], T0);
    assert.equal((await worker.deliverDue(T0)).sent, 1);
    assert.deepEqual(bodies, [{ target_type: 'group', target_id: 'group-1', message_chain: [{ type: 'Plain', text: 'new listing' }] }]);
  } finally {
    store.close();
  }
});
