#!/usr/bin/env node
import assert from 'node:assert/strict';
import { patchSource, MARKER } from './patch-selfhosted-tts-style.mjs';

const fixture = 'const U={"selfhosted-tts":{async synthesize(a,b,c,e="mp3"){return JSON.stringify({model:a,input:a,response_format:e})}}};';
const patched = patchSource(fixture);
assert.match(patched, new RegExp(MARKER));
assert.match(patched, /e="mp3",k=\{\}/);
assert.match(patched, /\.\.\.k\?\.style\?\{style:k\.style\}:\{\}/);
assert.equal(patchSource(patched), patched);
assert.throws(() => patchSource(fixture.replace('response_format:e', 'format:e')), /selfhosted_tts_body_anchor_drift/);
console.log('9ROUTER_TTS_STYLE_TEST=passed');
