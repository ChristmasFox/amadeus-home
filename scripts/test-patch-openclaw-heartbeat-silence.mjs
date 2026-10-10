#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  MARKER,
  PIN,
  patchHeartbeatRunnerSource,
  prepareHeartbeatDeliveryPayload,
} from './patch-openclaw-heartbeat-silence.mjs';

const runtimeRoot = path.resolve('node_modules/.pnpm/openclaw@2026.9.4/node_modules/openclaw/dist');
const modulePath = path.join(runtimeRoot, PIN.module);
const original = fs.readFileSync(modulePath, 'utf8');
const patched = patchHeartbeatRunnerSource(original);

assert.notEqual(patched, original);
assert.equal(patched.split(MARKER).length - 1, 1);
assert.equal(patchHeartbeatRunnerSource(patched), patched);
assert.match(patched, /const safePayload = prepareHeartbeatDeliveryPayload\(payload\);/u);
assert.throws(() => patchHeartbeatRunnerSource(original.replace('async function deliverHeartbeatDispatch(policy, payload, signal) {', 'async function changedHeartbeatDelivery(policy, payload, signal) {')), /anchor count=0/u);

assert.equal(prepareHeartbeatDeliveryPayload({ text: 'NO_REPLY' }), null);
assert.equal(prepareHeartbeatDeliveryPayload({ text: '[[amadeus:reply-modality=default]]\nNO_REPLY' }), null);
assert.deepEqual(
  prepareHeartbeatDeliveryPayload({ text: '[[amadeus:reply-modality=default]]\n需要关注。' }),
  { text: '需要关注。' },
);
const mediaPayload = { text: '[[amadeus:reply-modality=default]]\nNO_REPLY', mediaUrls: ['https://example.invalid/image.png'] };
assert.deepEqual(prepareHeartbeatDeliveryPayload(mediaPayload), { ...mediaPayload, text: 'NO_REPLY' }, 'media remains deliverable while its control prefix is removed');
const normal = { text: '正常提醒。' };
assert.equal(prepareHeartbeatDeliveryPayload(normal), normal);

const temporary = path.join(os.tmpdir(), `openclaw-heartbeat-silence-${process.pid}.mjs`);
try {
  fs.writeFileSync(temporary, patched, { flag: 'wx' });
  const check = spawnSync(process.execPath, ['--check', temporary], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
} finally {
  fs.rmSync(temporary, { force: true });
}

console.log('OPENCLAW_HEARTBEAT_SILENCE_PATCH=passed');
