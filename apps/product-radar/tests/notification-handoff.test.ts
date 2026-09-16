import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NotificationDispatcher } from '../src/core/notification/dispatcher.js';
import { KurisuNotificationChannel } from '../src/integrations/notifications/kurisu.js';
import { SqliteRadarStore } from '../src/storage/sqlite.js';

test('central Product Radar handoff sends one structured event without a platform recipient', async () => {
  let request: Request | undefined;
  const channel = new KurisuNotificationChannel({
    endpoint: 'http://agent-runtime.test/kurisu/notifications/events',
    secret: 'secret-fixture-not-logged',
    principalKey: 'telegram:admin',
    fetchImpl: async (input, init) => {
      request = new Request(input, init);
      return new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { 'content-type': 'application/json' } });
    },
  });
  await channel.send({
    event: {
      id: 'radar-event-1',
      eventKey: 'radar-event-key-1',
      watchId: 'watch-1',
      source: 'bunjang',
      type: 'ListingMatchedEvent',
      occurredAt: '2026-09-16T00:00:00.000Z',
      before: null,
      after: null,
      payload: { matchedKeywords: ['coat'], reason: 'fixture' },
    },
    text: 'radar notification text',
    recipient: 'local-recipient-is-not-forwarded',
  });
  assert.ok(request);
  assert.equal(request.headers.get('x-kurisu-notification-secret'), 'secret-fixture-not-logged');
  const body = await request.json() as Record<string, unknown>;
  assert.equal(body.eventKey, 'radar-event-key-1');
  assert.equal(body.source, 'bunjang');
  assert.equal(body.resultType, 'info');
  assert.equal('recipient' in body, false);
  assert.equal('principalKey' in body, false);
  assert.deepEqual(body.payload, {
    summary: 'radar notification text',
    radarEventId: 'radar-event-1',
    watchId: 'watch-1',
    radarEventType: 'ListingMatchedEvent',
  });
});

test('central owner drains a legacy local outbox row through the central channel', async () => {
  const store = new SqliteRadarStore(':memory:');
  const requests: string[] = [];
  const central = new KurisuNotificationChannel({
    endpoint: 'http://agent-runtime.test/kurisu/notifications/events',
    secret: 'secret-fixture-not-logged',
    principalKey: 'telegram:admin',
    fetchImpl: async (_input, init) => {
      requests.push(String(init?.body));
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    },
  });
  const event = {
    id: 'radar-event-legacy',
    eventKey: 'radar-event-legacy-key',
    watchId: 'watch-legacy',
    source: 'bunjang',
    type: 'ListingMatchedEvent' as const,
    occurredAt: '2026-09-16T00:00:00.000Z',
    before: null,
    after: null,
    payload: { matchedKeywords: ['coat'], reason: 'fixture' },
  };
  try {
    store.insertEvent(event);
    store.enqueueNotification(event, { id: 'telegram', recipient: 'old-recipient', async send() {} }, { event, text: 'legacy pending event', recipient: 'old-recipient' }, '2026-09-16T00:00:00.000Z');
    const dispatcher = new NotificationDispatcher(store, [central], { displayName: () => 'Bunjang' });
    await dispatcher.deliverPending();
    assert.equal(requests.length, 1);
    assert.equal(store.listPendingNotifications().length, 0);
  } finally {
    store.close();
  }
});
