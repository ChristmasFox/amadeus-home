#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'voice-failure-patch-'));
const dist = join(root, 'project/node_modules/@openclaw/whatsapp/dist');
await mkdir(dist, { recursive: true });
const file = join(dist, 'monitor-fixture.js');
const original = 'function prepareWhatsAppInboundContext() {}\n' +
  'async function processMessage(params, hasAudioBody, audioTranscript, conversationKind, admission) {\n' +
  '\tconst msgForAgent = audioTranscript !== void 0 ? {body: audioTranscript} : params.msg;\n' +
  '\treturn msgForAgent;\n}\n';
await writeFile(file, original);
const patch = () => spawnSync(process.execPath, ['scripts/patch-openclaw-voice-failure.mjs', root], { encoding: 'utf8' });
const first = patch();
assert.equal(first.status, 0, first.stderr);
assert.match(first.stdout, /VOICE_FAILURE_PATCH=applied/);
const second = patch();
assert.equal(second.status, 0, second.stderr);
assert.match(second.stdout, /VOICE_FAILURE_PATCH=already-applied/);
const source = await readFile(file, 'utf8');
assert.equal(source.split('amadeus-voice-asr-failure-v1').length - 1, 1);
// Execute only the pinned, patched function with a fake transport. No live channel.
const make = new Function(source + '; return processMessage;');
const processMessage = make();
const sent = [];
const params = { msg: { platform: { reply: async (text) => { sent.push(text); } } } };
assert.equal(await processMessage(params, true, null, 'direct', { ingress: { admission: 'dispatch' } }), true);
assert.equal(sent.length, 1);
assert.match(sent[0], /语音/);
assert.deepEqual(await processMessage(params, true, '你好', 'direct', { ingress: { admission: 'dispatch' } }), { body: '你好' });
assert.equal(sent.length, 1);
assert.deepEqual(await processMessage(params, true, null, 'group', { ingress: { admission: 'dispatch' } }), { body: null });
assert.equal(sent.length, 1);
assert.deepEqual(await processMessage(params, false, null, 'direct', { ingress: { admission: 'dispatch' } }), { body: null });
assert.equal(sent.length, 1);
console.log('VOICE_FAILURE_PATCH_FIXTURE=passed');
