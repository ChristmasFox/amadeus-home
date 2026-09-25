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
let holdGate = null;
let signalEntered = null;
const logs = [];
const originalInfo = console.info;
console.info = (...args) => logs.push(args.join(' '));
const server = createAsrServer({
  bridgeKey: KEY, upstreamKey: CLOUD, upstreamUrl: URL,
  convert: async (input) => { assert.equal(input.length, original.length); return wav; },
  fetchFn: async (url, options) => {
    calls++;
    assert.equal(url.toString(), URL);
    assert.equal(options.headers.Authorization, `Bearer ${CLOUD}`);
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'qwen-audio-3.0-asr-flash');
    assert.match(body.input.messages[0].content[0].input_audio.data, /^data:audio\/wav;base64,/);
    if (timeout) throw new DOMException('fixture timeout', 'TimeoutError');
    if (holdGate) { signalEntered?.(); await holdGate; }
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
  // Concurrent same media must share one in-flight paid request, not merely a
  // cache entry populated after both provider calls already started.
  let release;
  holdGate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { signalEntered = resolve; });
  const beforeConcurrent = calls;
  const concurrentAudio = Buffer.alloc(2048, 12);
  const first = post(undefined, KEY, concurrentAudio);
  await entered;
  const second = post(undefined, KEY, concurrentAudio);
  await new Promise(resolve => setTimeout(resolve, 25));
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult[0], 200);
  assert.deepEqual(secondResult, firstResult);
  assert.equal(calls, beforeConcurrent + 1, 'concurrent retry must not start a second upstream call');
  assert(logs.some(line => line.includes('cache=coalesced')));
  holdGate = null;
  signalEntered = null;
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
  const qwen = createAsrServer({ bridgeKey: KEY, upstreamKey: CLOUD,
    upstreamUrl: 'https://maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation',
    convert: async () => wav,
    fetchFn: async () => new Response(JSON.stringify({text:'你好，世界。',output:{text:'你好，世界。'},usage:{duration:1000}}), {status:200}),
  });
  await new Promise((resolve) => qwen.listen(0, '127.0.0.1', resolve));
  try {
    const form = new FormData();form.append('model','qwen-audio-3.0-asr-flash');form.append('file',new Blob([original],{type:'audio/wav'}),'fixture.wav');
    const reply = await fetch(`http://127.0.0.1:${qwen.address().port}/v1/audio/transcriptions`,{method:'POST',headers:{Authorization:'Bearer '+KEY},body:form});
    assert.deepEqual([reply.status,await reply.json()],[200,{text:'你好，世界。'}]);
  } finally {qwen.close();}
  assert.throws(() => createAsrServer({bridgeKey:KEY,upstreamKey:CLOUD,upstreamUrl:'https://maas.qianwenaiapi.com.evil.test/api/v1/services/aigc/multimodal-generation/generation'}),/invalid_asr_endpoint/);
  assert(logs.some(line => /request=[a-f0-9]{12} size=<=1MiB duration=<=15s/.test(line)));
  assert(!logs.some(line => line.includes('你好，世界。') || line.includes(KEY) || line.includes(CLOUD)), 'logs must not contain transcript or credentials');
  console.log('ASR_BRIDGE_FIXTURE=passed');
} finally {
  console.info = originalInfo;
  server.close();
}
