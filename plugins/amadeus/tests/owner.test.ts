import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { enqueueOwnerEvent } from '../src/owner.js';

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
    assert.equal(stored.eventKey, event.eventKey);
    assert.equal(stored.message, event.message);
    assert.equal('channel' in stored, false);
    assert.equal('recipient' in stored, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
