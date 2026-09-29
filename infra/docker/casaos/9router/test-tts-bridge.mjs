#!/usr/bin/env node
import assert from 'node:assert/strict';
import http from 'node:http';
import { createTtsServer, buildCloudRequest, classifyCloudFailure } from './tts-bridge.mjs';

const BRIDGE = 'bridge-' + 'b'.repeat(48);
const CLOUD = 'cloud-' + 'c'.repeat(48);
const LOCAL = 'local-' + 'l'.repeat(48);
const VOICE = 'qwen-audio-3.0-tts-flash-kurisu-opaque';
const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(80)]);
const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(72)]);
const opus = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(80)]);
const largerMp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(24 * 1024)]);

function response(status, body, headers = {}) {
  return new Response(body, { status, headers });
}

function cloudPayload(audio) {
  return JSON.stringify({ request_id: 'request-id-is-not-logged', output: { finish_reason: 'stop', audio: { data: audio.toString('base64') } } });
}

function cloudUrlPayload(url) {
  return JSON.stringify({ request_id: 'request-id-is-not-logged', output: { finish_reason: 'stop', audio: { url } } });
}

async function request(server, body, token = BRIDGE) {
  const address = server.address();
  return await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: address.port, path: '/v1/audio/speech', method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

async function running(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

const base = { model: 'amadeus-tts', voice: 'kurisu-v1', input: '短いテストです。', response_format: 'mp3', style: 'default' };
const instruction = buildCloudRequest({ text: base.input, voiceId: VOICE, emotion: 'angry', format: 'wav', style: { cloudPersona: 'persona:', emotions: { angry: { cloudInstruction: 'anger' } } } });
assert.equal(instruction.model, 'qwen-audio-3.0-tts-flash');
assert.equal(instruction.input.voice, VOICE);
assert.equal(instruction.input.format, 'wav');
assert.equal(instruction.input.language_hints[0], 'ja');
assert.equal(instruction.input.instruction, 'persona:anger');
assert.equal(JSON.stringify(instruction).includes('local OminiX'), false);
assert.equal(classifyCloudFailure({ name: 'TypeError', message: 'fetch failed', cause: { code: 'ENOTFOUND' } }).fallback, true);

let calls = [];
const success = createTtsServer({ bridgeKey: BRIDGE, cloudKey: CLOUD, cloudVoiceId: VOICE, localKey: LOCAL,
  cloudUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
  fetchFn: async (url, options) => { calls.push({ url: String(url), body: JSON.parse(options.body), auth: options.headers.Authorization }); return response(200, cloudPayload(mp3)); } });
await running(success);
let result = await request(success, base);
assert.equal(result.status, 200);
assert.equal(result.headers['x-amadeus-tts-provider'], 'cloud');
assert.equal(result.body.subarray(0, 3).toString(), 'ID3');
assert.equal(calls.length, 1);
assert.equal(calls[0].body.model, 'qwen-audio-3.0-tts-flash');
assert.equal(calls[0].body.input.voice, VOICE);
assert.equal(calls[0].body.input.text, base.input);
assert.equal(calls[0].auth, `Bearer ${CLOUD}`);
assert.equal(JSON.stringify(calls[0].body).includes(CLOUD), false);
assert.equal(JSON.stringify(calls[0].body).includes(VOICE), true); // payload is sent, never logged
assert.equal((await request(success, base, 'bad')).status, 401);
await close(success);

// A realistic inline base64 response is larger than the request body limit.
// It must still reach the cloud success path instead of being misclassified
// as a transient failure and sent to the local provider.
calls = [];
const largeSuccess = createTtsServer({ bridgeKey: BRIDGE, cloudKey: CLOUD, cloudVoiceId: VOICE, localKey: LOCAL,
  cloudUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
  fetchFn: async (url, options) => { calls.push(String(url)); return response(200, cloudPayload(largerMp3)); } });
await running(largeSuccess);
result = await request(largeSuccess, base);
assert.equal(result.status, 200);
assert.equal(result.headers['x-amadeus-tts-provider'], 'cloud');
assert.equal(result.body.length, largerMp3.length);
assert.equal(calls.length, 1);
await close(largeSuccess);

// DashScope can return an HTTP OSS URL; the bridge must upgrade it to HTTPS
// before fetching the allowlisted provider object.
calls = [];
const httpUrlSuccess = createTtsServer({ bridgeKey: BRIDGE, cloudKey: CLOUD, cloudVoiceId: VOICE, localKey: LOCAL,
  cloudUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
  fetchFn: async (url) => {
    calls.push(String(url));
    return calls.length === 1
      ? response(200, cloudUrlPayload('http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/prod/audio'))
      : response(200, mp3, { 'Content-Type': 'audio/mpeg' });
  } });
await running(httpUrlSuccess);
result = await request(httpUrlSuccess, base);
assert.equal(result.status, 200);
assert.equal(result.headers['x-amadeus-tts-provider'], 'cloud');
assert.equal(calls[1].startsWith('https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/'), true);
await close(httpUrlSuccess);

for (const cloudStatus of [408, 429, 500, 502, 503, 504]) {
  calls = [];
  const fallback = createTtsServer({ bridgeKey: BRIDGE, cloudKey: CLOUD, cloudVoiceId: VOICE, localKey: LOCAL,
    cloudUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
    fetchFn: async (url, options) => {
      calls.push({ url: String(url), body: JSON.parse(options.body) });
      return calls.length === 1 ? response(cloudStatus, '{}') : response(200, mp3, { 'Content-Type': 'audio/mpeg' });
    } });
  await running(fallback);
  result = await request(fallback, { ...base, style: 'soft' });
  assert.equal(result.status, 200, `fallback ${cloudStatus}`);
  assert.equal(result.headers['x-amadeus-tts-provider'], 'local');
  assert.equal(result.headers['x-amadeus-tts-fallback'], 'local');
  assert.equal(calls.length, 2, `one cloud and one local for ${cloudStatus}`);
  assert.equal(calls[1].body.model, 'qwen3-tts-1.7b');
  assert.equal(calls[1].body.style, 'soft');
  await close(fallback);
}

for (const cloudStatus of [400, 401, 403]) {
  calls = [];
  const noFallback = createTtsServer({ bridgeKey: BRIDGE, cloudKey: CLOUD, cloudVoiceId: VOICE, localKey: LOCAL,
    cloudUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
    fetchFn: async () => { calls.push(1); return response(cloudStatus, '{}'); } });
  await running(noFallback);
  result = await request(noFallback, base);
  assert.equal(result.status, cloudStatus === 400 ? 400 : 502);
  assert.equal(calls.length, 1, `no fallback for ${cloudStatus}`);
  await close(noFallback);
}

calls = [];
const empty = createTtsServer({ bridgeKey: BRIDGE, cloudKey: CLOUD, cloudVoiceId: VOICE, localKey: LOCAL,
  cloudUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
  fetchFn: async () => { calls.push(1); return response(200, JSON.stringify({ output: { audio: { data: '' } } })); } });
await running(empty);
result = await request(empty, { ...base, response_format: 'wav' });
assert.equal(result.status, 503); // local request is intentionally absent in this fixture
assert.equal(calls.length, 2); // cloud + one local attempt
await close(empty);

const invalid = { ...base, style: 'arbitrary prompt' };
const invalidServer = createTtsServer({ bridgeKey: BRIDGE, cloudKey: CLOUD, cloudVoiceId: VOICE, localKey: LOCAL,
  cloudUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer', fetchFn: async () => { throw new Error('must_not_call'); } });
await running(invalidServer);
assert.equal((await request(invalidServer, invalid)).status, 400);
await close(invalidServer);

console.log('TTS_BRIDGE_TEST=passed');
