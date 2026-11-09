#!/usr/bin/env node
import assert from 'node:assert/strict';
import { MARKER, patchSttMultipartSource } from './patch-stt-multipart-body.mjs';

const R_ORIGINAL = 'async function R(a,b,c,d,e){let f=new FormData;for(let a of(f.append("file",b,b.name||"audio.wav"),f.append("model",c),["language","prompt","response_format","temperature"])){let b=e.get(a);null!=b&&""!==b&&f.append(a,b)}let g=await fetch(a.baseUrl,{method:"POST",headers:H(a,d),body:f});if(!g.ok)return J(g);let h=g.headers.get("content-type")||"application/json";return{success:!0,response:new Response(await g.text(),{status:200,headers:{"Content-Type":h}})}}function S(a){return a}';
const patched = patchSttMultipartSource(R_ORIGINAL);
assert.match(patched, new RegExp(MARKER));
assert.doesNotMatch(patched, /new FormData/u);
assert.equal(patchSttMultipartSource(patched), patched);
assert.throws(() => patchSttMultipartSource('async function R(){}'), /stt_multipart_anchor_drift/u);

// Run the patched function: the request must carry real multipart bytes that a standard parser reads back.
let sent;
const run = new Function('H', 'J', 'fetch', `${patched};return R;`)(
  (provider, key) => ({ Authorization: `Bearer ${key}` }),
  async () => ({ success: false }),
  async (url, options) => { sent = { url, options }; return new Response('{"text":"ok"}', { headers: { 'content-type': 'application/json' } }); },
);
const audio = new Uint8Array(3000).map((_, i) => i % 251);
const file = new File([audio], 'voice "1".wav', { type: 'audio/wav' });
const form = new Map([['language', 'zh'], ['prompt', ''], ['response_format', 'json']]);
const out = await run({ baseUrl: 'http://127.0.0.1:20129/v1/audio/transcriptions' }, file, 'qwen-audio-3.0-asr-flash', 'secret-key', { get: (name) => form.get(name) ?? null });
assert.equal(out.success, true);
assert.equal(sent.url, 'http://127.0.0.1:20129/v1/audio/transcriptions');
assert.equal(sent.options.headers.Authorization, 'Bearer secret-key');
assert.match(sent.options.headers['Content-Type'], /^multipart\/form-data; boundary=----amadeus[0-9a-f]{32}$/u);
assert.ok(sent.options.body instanceof Uint8Array, 'bytes, not a FormData object');
const parsed = await new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': sent.options.headers['Content-Type'] }, body: sent.options.body }).formData();
assert.equal(parsed.get('model'), 'qwen-audio-3.0-asr-flash');
assert.equal(parsed.get('language'), 'zh');
assert.equal(parsed.get('response_format'), 'json');
assert.equal(parsed.has('prompt'), false, 'empty optional fields are not sent');
const uploaded = parsed.get('file');
assert.equal(uploaded.type, 'audio/wav');
assert.equal(uploaded.name, 'voice _1_.wav', 'quotes in the file name cannot break the header');
assert.deepEqual(new Uint8Array(await uploaded.arrayBuffer()), audio);
console.log('STT_MULTIPART_PATCH_0_5_116=passed');
