#!/usr/bin/env node
import assert from 'node:assert/strict';
import http from 'node:http';
import { createTtsServer, buildCloudRequest, classifyCloudFailure, classifyLocalFailure, LOCAL_MODEL, LOCAL_PROVIDER, CLOUD_MODELS } from './tts-bridge.mjs';

const BRIDGE = 'bridge-' + 'b'.repeat(48);
const CLOUD = 'cloud-' + 'c'.repeat(48);
const LOCAL = 'local-' + 'l'.repeat(48);
const VOICE31 = 'qwen-audio-3.1-tts-flash-kurisu-opaque';
const VOICE30 = 'qwen-audio-3.0-tts-flash-kurisu-opaque';
const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(80)]);
const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(72)]);

function response(status, body, headers = {}) {
  return new Response(body, { status, headers });
}

function cloudPayload(audio) {
  return JSON.stringify({ request_id: 'request-id-is-not-logged', output: { finish_reason: 'stop', audio: { data: audio.toString('base64') } } });
}

async function request(server, body, token = BRIDGE, extraHeaders = {}) {
  const address = server.address();
  return await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: address.port, path: '/v1/audio/speech', method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extraHeaders } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

async function get(server, path) {
  const address = server.address();
  return await new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: address.port, path }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

async function running(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

const base = { model: 'amadeus-tts', voice: 'kurisu-v1', input: '短いテストです。', response_format: 'mp3', style: 'default' };
const cloudRequest = buildCloudRequest({ text: base.input, voiceId: VOICE31, emotion: 'default', format: 'mp3' });
assert.equal(cloudRequest.model, 'qwen-audio-3.1-tts-flash');
assert.equal(cloudRequest.input.voice, VOICE31);
assert.equal(cloudRequest.input.language_hints[0], 'ja');
assert.equal(typeof cloudRequest.input.instruction, 'string');
assert.equal(JSON.stringify(cloudRequest).includes('persona'), false);
const angry = buildCloudRequest({ text: base.input, voiceId: VOICE31, emotion: 'angry', format: 'wav', style: { cloudPersona: 'persona:', emotions: { angry: { cloudInstruction: 'anger' } } } });
assert.equal(angry.input.instruction, 'persona:anger');
assert.equal(classifyCloudFailure({ name: 'TypeError', message: 'fetch failed', cause: { code: 'ENOTFOUND' } }).fallback, true);
assert.equal(classifyLocalFailure({ name: 'TypeError', message: 'fetch failed', cause: { code: 'ECONNREFUSED' } }).fallback, true);
assert.equal(classifyLocalFailure(Object.assign(new Error('audio_invalid'), { category: 'audio_invalid' })).fallback, true);
assert.equal(classifyLocalFailure(new Error('unexpected_local_contract_error')).fallback, false);
assert.throws(() => createTtsServer({ bridgeKey: BRIDGE, cloudKey: CLOUD, cloudVoiceId31: VOICE31, cloudVoiceId30: VOICE30,
  localKey: LOCAL, cloudUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
  localUrl: 'http://127.0.0.1:19871/v1/audio/speech' }), /invalid_local_tts_endpoint/);

let calls = [];
const localSuccess = createTtsServer({ bridgeKey: BRIDGE, cloudKey: CLOUD, cloudVoiceId31: VOICE31, cloudVoiceId30: VOICE30, localKey: LOCAL,
  cloudUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
  localUrl: 'http://127.0.0.1:18794/v1/audio/speech',
  fetchFn: async (url, options) => { calls.push({ url: String(url), body: JSON.parse(options.body), auth: options.headers.Authorization }); return response(200, mp3); } });
await running(localSuccess);
let result = await request(localSuccess, base);
assert.equal(result.status, 200);
assert.equal(result.headers['x-amadeus-tts-provider'], LOCAL_PROVIDER);
assert.equal(result.body.subarray(0, 3).toString(), 'ID3');
assert.equal(calls.length, 1);
assert.equal(calls[0].url, 'http://127.0.0.1:18794/v1/audio/speech');
assert.equal(calls[0].body.model, 'amadeus-tts');
assert.equal(calls[0].body.style, 'default');
assert.equal(calls[0].auth, `Bearer ${LOCAL}`);
calls = [];
result = await request(localSuccess, { ...base, style: 'angry' });
assert.equal(result.status, 200);
assert.equal(result.headers['x-amadeus-tts-provider'], LOCAL_PROVIDER);
assert.equal(calls.length, 1, 'disabled emotion controls must still use the local-first default voice');
assert.equal(calls[0].body.style, 'default');
assert.equal((await request(localSuccess, base, 'bad')).status, 401);
const health = await get(localSuccess, '/healthz');
const healthBody = JSON.parse(health.body.toString());
assert.equal(health.status, 200);
assert.equal(healthBody.localProvider, LOCAL_PROVIDER);
assert.equal(healthBody.localModel, LOCAL_MODEL);
assert.deepEqual(healthBody.fallbackOrder, [LOCAL_PROVIDER, ...CLOUD_MODELS]);
assert.equal(healthBody.emotionControlsEnabled, false);
await close(localSuccess);

for (const status of [400, 401, 403]) {
  calls = [];
  const localConfigurationFailure = createTtsServer({ bridgeKey: BRIDGE, cloudKey: CLOUD, cloudVoiceId31: VOICE31, cloudVoiceId30: VOICE30, localKey: LOCAL,
    cloudUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
    fetchFn: async (url) => { calls.push(String(url)); return response(status, JSON.stringify({ error: { type: 'configuration_error' } })); } });
  await running(localConfigurationFailure);
  result = await request(localConfigurationFailure, base);
  assert.notEqual(result.status, 200);
  assert.equal(calls.length, 1, `local ${status} must fail closed without cloud fallback`);
  await close(localConfigurationFailure);
}

calls = [];
const qwen31Fallback = createTtsServer({ bridgeKey: BRIDGE, cloudKey: CLOUD, cloudVoiceId31: VOICE31, cloudVoiceId30: VOICE30, localKey: LOCAL,
  cloudUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
  fetchFn: async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body), auth: options.headers.Authorization });
    if (String(url).includes('18794')) return response(503, JSON.stringify({ error: { type: 'provider_unavailable' } }));
    return response(200, cloudPayload(mp3));
  } });
await running(qwen31Fallback);
result = await request(qwen31Fallback, base);
assert.equal(result.status, 200);
assert.equal(result.headers['x-amadeus-tts-provider'], 'cloud');
assert.equal(result.headers['x-amadeus-tts-fallback'], 'cloud');
assert.equal(calls.length, 2);
assert.match(calls[0].url, /18794/);
assert.equal(calls[1].body.model, 'qwen-audio-3.1-tts-flash');
assert.equal(calls[1].body.input.voice, VOICE31);
assert.equal(calls[1].auth, `Bearer ${CLOUD}`);
await close(qwen31Fallback);

calls = [];
const qwen30Fallback = createTtsServer({ bridgeKey: BRIDGE, cloudKey: CLOUD, cloudVoiceId31: VOICE31, cloudVoiceId30: VOICE30, localKey: LOCAL,
  cloudUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
  fetchFn: async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    if (String(url).includes('18794')) return response(503, JSON.stringify({ error: { type: 'provider_unavailable' } }));
    if (calls.length === 2) return response(503, 'upstream unavailable');
    return response(200, cloudPayload(wav));
  } });
await running(qwen30Fallback);
result = await request(qwen30Fallback, { ...base, response_format: 'wav' });
assert.equal(result.status, 200);
assert.equal(result.headers['x-amadeus-tts-provider'], 'cloud');
assert.equal(result.body.subarray(0, 4).toString(), 'RIFF');
assert.equal(calls.length, 3);
assert.equal(calls[1].body.model, 'qwen-audio-3.1-tts-flash');
assert.equal(calls[2].body.model, 'qwen-audio-3.0-tts-flash');
assert.equal(calls[2].body.input.voice, VOICE30);
await close(qwen30Fallback);

const futureEmotions = ['default', 'irritated', 'embarrassed', 'angry', 'sarcastic', 'soft', 'sad'];
const futureStyle = { cloudPersona: 'persona:', emotions: Object.fromEntries(futureEmotions.map(name => [name, { cloudInstruction: `${name}-instruction` }])) };
calls = [];
const futureEmotionOptIn = createTtsServer({ bridgeKey: BRIDGE, cloudKey: CLOUD, cloudVoiceId31: VOICE31, cloudVoiceId30: VOICE30, localKey: LOCAL,
  cloudUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
  style: futureStyle, emotionsEnabled: true,
  fetchFn: async (url, options) => { calls.push({ url: String(url), body: JSON.parse(options.body) }); return response(200, cloudPayload(mp3)); } });
await running(futureEmotionOptIn);
result = await request(futureEmotionOptIn, { ...base, style: 'angry' });
assert.equal(result.status, 200);
assert.equal(result.headers['x-amadeus-tts-provider'], 'cloud');
assert.equal(calls.length, 1);
assert.match(calls[0].url, /SpeechSynthesizer/);
assert.equal(calls[0].body.input.instruction, 'persona:angry-instruction');
const futureHealth = JSON.parse((await get(futureEmotionOptIn, '/healthz')).body.toString());
assert.equal(futureHealth.emotionControlsEnabled, true);
await close(futureEmotionOptIn);

const invalid = createTtsServer({ bridgeKey: BRIDGE, cloudKey: CLOUD, cloudVoiceId31: VOICE31, cloudVoiceId30: VOICE30, localKey: LOCAL,
  cloudUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer', fetchFn: async () => { throw new Error('must_not_call'); } });
await running(invalid);
assert.equal((await request(invalid, { ...base, response_format: 'flac' })).status, 400);
await close(invalid);

console.log('TTS_BRIDGE_TEST=passed');
