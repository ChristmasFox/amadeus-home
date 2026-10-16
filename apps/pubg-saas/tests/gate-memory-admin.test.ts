import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGateMemoryAdminArgs } from '../src/gate-memory-admin.js';

test('Gate memory admin requires explicit environment and bot scope', () => {
  assert.throws(() => parseGateMemoryAdminArgs(['status']), /gate_memory_admin_arguments_invalid/u);
  assert.throws(() => parseGateMemoryAdminArgs(['status', '--target', 'gate-local']),
    /gate_memory_admin_arguments_invalid/u);
  assert.deepEqual(parseGateMemoryAdminArgs([
    'status', '--target', 'gate-local', '--bot-id', 'fixture-bot',
  ]), {
    command: 'status', target: 'gate-local', botId: 'fixture-bot', apply: false,
    allowProviderRequests: false, maxJobs: 20, scanLimit: 50,
  });
});

test('Gate memory admin bounds scan and provider job batches', () => {
  assert.equal(parseGateMemoryAdminArgs([
    'scan', '--target', 'gate-local', '--bot-id', 'fixture-bot', '--scan-limit', '100', '--apply',
  ]).scanLimit, 100);
  assert.equal(parseGateMemoryAdminArgs([
    'work', '--target', 'gate-prod', '--bot-id', 'fixture-bot', '--max-jobs', '12',
    '--apply', '--allow-provider-requests',
  ]).maxJobs, 12);
  assert.throws(() => parseGateMemoryAdminArgs([
    'work', '--target', 'gate-prod', '--bot-id', 'fixture-bot', '--max-jobs', '101',
  ]), /gate_memory_admin_arguments_invalid/u);
  assert.throws(() => parseGateMemoryAdminArgs([
    'scan', '--target', 'gate-local', '--bot-id', 'fixture-bot', '--scan-limit', '0',
  ]), /gate_memory_admin_arguments_invalid/u);
});
