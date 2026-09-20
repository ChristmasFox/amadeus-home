import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import { enqueueOwnerEvent, isTrustedOwnerContext, ownerEventForContext } from '../src/owner.js';

test('owner context trusts only owner senders or OpenClaw cron sessions', () => {
  const base = {} as OpenClawPluginToolContext;
  assert.equal(isTrustedOwnerContext({ ...base, senderIsOwner: true }), true);
  assert.equal(isTrustedOwnerContext({ ...base, sessionKey: 'cron:job:run:id' }), true);
  assert.equal(isTrustedOwnerContext({ ...base, sessionKey: 'agent:main:cron:job:run:id' }), true);
  assert.equal(isTrustedOwnerContext({ ...base, sessionKey: 'agent:main:chat' }), false);
  assert.equal(isTrustedOwnerContext({ ...base, senderIsOwner: false, sessionKey: 'agent:main:cronical:chat' }), false);
});

test('manual VPS cron runs cannot consume the scheduled report event key', () => {
  const input = {
    eventKey: 'vps-report:2026-09-18:evening',
    source: 'vps-report',
    title: 'VPS 晚间状态',
    message: 'ok',
    occurredAt: '2026-09-18T20:26:17.000Z',
  };
  const manual = ownerEventForContext(input, { sessionKey: 'agent:main:cron:job:run:manual:job:1789734377892:1' } as OpenClawPluginToolContext);
  assert.equal(manual.eventKey, 'vps-report:manual:2026-09-18T20:26:17.000Z:evening');
  const scheduled = ownerEventForContext(input, { sessionKey: 'agent:main:cron:job:run:scheduled-run-id' } as OpenClawPluginToolContext);
  assert.equal(scheduled.eventKey, input.eventKey);
});

test('manual market cron runs cannot consume the scheduled observation event key', () => {
  const input = {
    eventKey: 'market-indices:2026-09-18:close',
    source: 'market-indices',
    title: 'Amadeus • 世界线观测 · 美股收盘',
    message: 'ok',
    occurredAt: '2026-09-18T20:26:17.000Z',
  };
  const manual = ownerEventForContext(input, { sessionKey: 'agent:main:cron:job:run:manual:job:1789734377892:1' } as OpenClawPluginToolContext);
  assert.equal(manual.eventKey, 'market-indices:manual:2026-09-18T20:26:17.000Z:close');
});

test('owner outbox is channel-free, atomic, and idempotent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'amadeus-owner-'));
  try {
    const event = { version: 1 as const, eventKey: 'test:event', source: 'test', title: 'Test', message: 'hello', occurredAt: new Date().toISOString() };
    assert.equal(await enqueueOwnerEvent(event, directory), 'queued');
    assert.equal(await enqueueOwnerEvent(event, directory), 'already-pending');
    const files = await readdir(directory);
    assert.equal(files.length, 1);
    assert.match(files[0]!, /\.pending\.json$/u);
    const stored = JSON.parse(await readFile(join(directory, files[0]!), 'utf8')) as Record<string, unknown>;
    assert.equal(stored.version, 1);
    assert.equal(stored.type, 'owner_notification');
    assert.equal(stored.eventKey, event.eventKey);
    assert.equal(stored.headline, event.title);
    assert.equal(stored.summary, event.message);
    assert.equal('message' in stored, false);
    assert.equal('channel' in stored, false);
    assert.equal('recipient' in stored, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
