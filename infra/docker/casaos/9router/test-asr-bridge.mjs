import assert from 'node:assert/strict';
import { createAsrServer } from './asr-bridge.mjs';

const KEY = 'bridge-fixture-only-' + 'x'.repeat(32);
const CLOUD = 'dashscope-fixture-only-' + 'y'.repeat(32);
const URL = 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const original = Buffer.alloc(2048, 7);
const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(2048, 1)]);
let calls = 0;
let upstreamStatus = 200;
let empty = false;
let timeout = false;
const server = createAsrServer({
  bridgeKey: KEY, dashscopeKey: CLOUD, upstreamUrl: URL,
  convert: async (input) => { assert.equal(input.length, original.length); return wav; },
  fetchFn: async (url, options) => {
    calls++;
    assert.equal(url.toString(), URL);
    assert.equal(options.headers.Authorization, `Bearer ${CLOUD}`);
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'qwen-audio-3.0-asr-flash');
    assert.match(body.input.messages[0].content[0].input_audio.data, /^data:audio\/wav;base64,/);
    if (timeout) throw new DOMException('fixture timeout', 'TimeoutError');
    return new Response(JSON.stringify(empty ? { output: { output: {} } } : { output: { output: { text: '你好，世界。' } } }), { status: upstreamStatus });
  },
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
async function post(model = 'qwen-audio-3.0-asr-flash', auth = KEY, bytes = original, mime = 'audio/ogg') {
  const form = new FormData();
  form.append('model', model);
  form.append('file', new Blob([bytes], { type: mime }), 'voice.ogg');
  const res = await fetch(base + '/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${auth}` }, body: form });
  return [res.status, await res.json()];
}
try {
  assert.equal((await fetch(base + '/healthz')).status, 200);
  assert.equal((await post(undefined, 'wrong'))[0], 401);
  assert.equal((await post('wrong'))[1].error.type, 'unknown_model');
  assert.equal((await post(undefined, KEY, Buffer.alloc(4)))[1].error.type, 'unsupported_audio');
  assert.equal((await post(undefined, KEY, original, 'application/octet-stream'))[1].error.type, 'unsupported_audio');
  let result = await post();
  assert.deepEqual(result, [200, { text: '你好，世界。' }]);
  assert.equal((await post())[0], 200);
  assert.equal(calls, 1, 'success retry should reuse bounded transcription cache');
  // A different input avoids the success cache for error-contract cases.
  upstreamStatus = 401;
  result = await post(undefined, KEY, Buffer.alloc(2048, 8));
  assert.equal(result[1].error.type, 'auth_unavailable');
  upstreamStatus = 503;
  result = await post(undefined, KEY, Buffer.alloc(2048, 9));
  assert.equal(result[1].error.type, 'provider_unavailable');
  upstreamStatus = 200; empty = true;
  result = await post(undefined, KEY, Buffer.alloc(2048, 10));
  assert.equal(result[1].error.type, 'transcription_failed');
  empty = false; timeout = true;
  result = await post(undefined, KEY, Buffer.alloc(2048, 11));
  assert.equal(result[1].error.type, 'timeout');
  assert.equal(result[0], 504);
  console.log('ASR_BRIDGE_FIXTURE=passed');
} finally {
  server.close();
}
