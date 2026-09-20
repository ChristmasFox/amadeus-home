import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { OpenClawPluginApi, OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import type { OwnerNotificationPresentation } from '@agent/presentation';
import { enqueueOwnerEvent, isTrustedOwnerContext, notificationParts, OwnerNotifier, ownerEvent, ownerEventForContext } from '../src/owner.js';

function notification(overrides: Partial<OwnerNotificationPresentation> = {}): OwnerNotificationPresentation {
  return {
    type: 'owner_notification',
    eventType: 'test',
    severity: 'info',
    significance: 'notable',
    theme: 'worldline_observation',
    eventKey: 'test:event',
    source: 'test',
    headline: 'Test',
    facts: [],
    summary: 'hello',
    occurredAt: '2026-09-20T00:00:00.000Z',
    ...overrides,
  };
}

test('owner context trusts only owner senders or OpenClaw cron sessions', () => {
  const base = {} as OpenClawPluginToolContext;
  assert.equal(isTrustedOwnerContext({ ...base, senderIsOwner: true }), true);
  assert.equal(isTrustedOwnerContext({ ...base, sessionKey: 'cron:job:run:id' }), true);
  assert.equal(isTrustedOwnerContext({ ...base, sessionKey: 'agent:main:cron:job:run:id' }), true);
  assert.equal(isTrustedOwnerContext({ ...base, sessionKey: 'agent:main:chat' }), false);
  assert.equal(isTrustedOwnerContext({ ...base, senderIsOwner: false, sessionKey: 'agent:main:cronical:chat' }), false);
});

test('manual VPS cron runs cannot consume the scheduled report event key', () => {
  const input = notification({
    eventKey: 'vps-report:2026-09-18:evening',
    source: 'vps-report',
    headline: 'VPS 晚间状态',
    summary: 'ok',
    occurredAt: '2026-09-18T20:26:17.000Z',
  });
  const manual = ownerEventForContext(input, { sessionKey: 'agent:main:cron:job:run:manual:job:1789734377892:1' } as OpenClawPluginToolContext);
  assert.equal(manual.eventKey, 'vps-report:manual:2026-09-18T20:26:17.000Z:evening');
  const scheduled = ownerEventForContext(input, { sessionKey: 'agent:main:cron:job:run:scheduled-run-id' } as OpenClawPluginToolContext);
  assert.equal(scheduled.eventKey, input.eventKey);
});

test('manual market cron runs cannot consume the scheduled observation event key', () => {
  const input = notification({
    eventKey: 'market-indices:2026-09-18:close',
    source: 'market-indices',
    headline: 'Amadeus • 世界线观测 · 美股收盘',
    summary: 'ok',
    occurredAt: '2026-09-18T20:26:17.000Z',
  });
  const manual = ownerEventForContext(input, { sessionKey: 'agent:main:cron:job:run:manual:job:1789734377892:1' } as OpenClawPluginToolContext);
  assert.equal(manual.eventKey, 'market-indices:manual:2026-09-18T20:26:17.000Z:close');
});

test('owner outbox is channel-free, atomic, and idempotent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'amadeus-owner-'));
  try {
    const event = ownerEvent(notification({ dataUpdatedAt: '2026-09-19T23:00:00.000Z' }));
    assert.equal(await enqueueOwnerEvent(event, directory), 'queued');
    assert.equal(await enqueueOwnerEvent(event, directory), 'already-pending');
    const files = await readdir(directory);
    assert.equal(files.length, 1);
    assert.match(files[0]!, /\.pending\.json$/u);
    const stored = JSON.parse(await readFile(join(directory, files[0]!), 'utf8')) as Record<string, unknown>;
    assert.equal(stored.version, 1);
    assert.equal(stored.type, 'owner_notification');
    assert.equal(stored.eventKey, event.eventKey);
    assert.equal(stored.headline, event.headline);
    assert.equal(stored.summary, event.summary);
    assert.equal(stored.dataUpdatedAt, event.dataUpdatedAt);
    assert.equal('message' in stored, false);
    assert.equal('channel' in stored, false);
    assert.equal('recipient' in stored, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('legacy title/message payloads are readable only from pending files, not accepted by new enqueue writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'amadeus-owner-legacy-'));
  try {
    await assert.rejects(
      () => enqueueOwnerEvent({ eventKey: 'legacy:event', source: 'legacy', title: 'Legacy', message: 'old' } as never, directory),
      /structured presentation required/u,
    );
    const targetFile = join(directory, 'owner-target');
    await writeFile(targetFile, 'whatsapp:+8613800138000\n');
    await writeFile(join(directory, 'legacy.pending.json'), JSON.stringify({
      eventKey: 'legacy:event',
      source: 'legacy',
      title: 'Legacy',
      message: 'old message',
      occurredAt: '2026-09-20T00:00:00.000Z',
    }));
    const sent: Array<Record<string, unknown>> = [];
    const api = {
      runtime: { gateway: { request: async (_method: string, params: Record<string, unknown>) => { sent.push(params); return {}; } } },
      logger: { warn() {} },
    } as unknown as OpenClawPluginApi;
    const notifier = new OwnerNotifier(api, { ownerTargetFile: targetFile, ownerWhatsappAccountId: 'secondary', notificationOutboxDir: directory } as never);
    assert.equal(await notifier.drain(), 1);
    assert.match(String(sent[0]?.message), /old message/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('long owner notifications split without losing facts, update time, closing, or idempotency keys', () => {
  const event = ownerEvent(notification({
    eventKey: 'long:event',
    dataUpdatedAt: '2026-09-19T23:00:00.000Z',
    summary: Array.from({ length: 400 }, (_, index) => `summary-${index}`).join(' '),
    facts: Array.from({ length: 12 }, (_, index) => ({ label: `fact-${index}`, value: index, evidenceRefs: [`evidence-${index}`] })),
    worldLineClosing: true,
  }));
  const parts = notificationParts(event);
  assert.ok(parts.length > 1);
  assert.deepEqual(parts.flatMap((part) => part.facts), event.facts);
  assert.ok(parts.every((part) => part.dataUpdatedAt === event.dataUpdatedAt));
  assert.equal(parts.filter((part) => part.worldLineClosing === true).length, 1);
  assert.equal(parts.at(-1)?.worldLineClosing, true);
  assert.equal(new Set(parts.map((part) => part.eventKey)).size, parts.length);
  assert.ok(parts.every((part) => part.eventKey.startsWith('long:event:part:')));
});
