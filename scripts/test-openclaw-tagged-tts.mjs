#!/usr/bin/env node
// The pinned 2026.9.4 TTS pipeline, with a loopback-only mock provider.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { patchTtsSource } from './patch-openclaw-whatsapp-voice-lifecycle.mjs';

const isolated = mkdtempSync(join(tmpdir(), 'amadeus-tagged-tts-'));
process.env.OPENCLAW_TTS_PREFS = join(isolated, 'prefs.json');
process.env.OPENCLAW_STATE_DIR = isolated;
const calls = [];
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  calls.push({ path: req.url, data: JSON.parse(body) });
  res.writeHead(200, { 'content-type': 'audio/mpeg' });
  // No real voice sample or generated media leaves this private test process.
  res.end(Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00fixture'));
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
let runtimeFixturePath;
try {
  const port = server.address().port;
  const canonical = JSON.parse(readFileSync(resolve('integrations/openclaw/openclaw.json.example'), 'utf8'));
  const cfg = { tts: structuredClone(canonical.tts) };
  assert.equal(cfg.tts.auto, 'tagged');
  assert.equal(cfg.tts.mode, 'final');
  cfg.tts.providers.openai.baseUrl = `http://127.0.0.1:${port}/v1`;
  cfg.tts.providers.openai.apiKey = 'fixture-only';
  const runtimeDist = resolve('node_modules/.pnpm/openclaw@2026.9.4/node_modules/openclaw/dist');
  const runtimeSourcePath = join(runtimeDist, 'runtime-api-zquJnB-O.mjs');
  runtimeFixturePath = join(runtimeDist, `runtime-api-amadeus-tagged-test-${process.pid}.mjs`);
  const runtimeSource = readFileSync(runtimeSourcePath, 'utf8');
  const patchedRuntimeSource = patchTtsSource(runtimeSource);
  writeFileSync(runtimeFixturePath, patchedRuntimeSource, { flag: 'wx' });
  const runtime = await import(pathToFileURL(runtimeFixturePath).href);
  const persist = async ({ audioBuffer, fileExtension }) => {
    assert.ok(audioBuffer.length > 0);
    assert.equal(fileExtension, '.mp3');
    return 'file:///tmp/amadeus-test-only.mp3';
  };
  const run = (text, inboundAudio) => runtime.u({
    cfg, payload: { text }, channel: 'whatsapp', kind: 'final', inboundAudio,
  }, persist);

  const ordinary = '你的语音是怎么实现的？我只是询问原理。';
  const ordinaryOutput = await run(ordinary, false);
  assert.equal(ordinaryOutput.text, ordinary);
  assert.equal(ordinaryOutput.mediaUrl, undefined);
  assert.equal(calls.length, 0, 'ordinary typed text must not call the speech provider');

  const recovered = await run('中文：我马上回答你的问题。\n\n日本語：少し待って。結論を先に言うわ。', false);
  assert.equal(recovered.text, '中文：我马上回答你的问题。\n\n日本語：少し待って。結論を先に言うわ。', 'bilingual voice output survives a missing TTS marker');
  assert.equal(recovered.spokenText, '少し待って。結論を先に言うわ。');
  assert.equal(recovered.mediaUrl, 'file:///tmp/amadeus-test-only.mp3');
  assert.equal(recovered.ttsSupplement, undefined, 'typed recovery keeps visible text as a normal payload');

  const cases = [
    { label: 'typed explicit voice', inboundAudio: false, japanese: 'はい、答えるわ。', chinese: '好，我来回答。' },
    { label: 'verified inbound voice', inboundAudio: true, japanese: '聞こえたわ。', chinese: '听到了。' },
  ];
  for (const { label, inboundAudio, japanese, chinese } of cases) {
    const text = `中文：${chinese}\n\n日本語：${japanese}\n[[tts:text]]${japanese}[[/tts:text]]`;
    const output = await run(text, inboundAudio);
    assert.equal(output.text, `中文：${chinese}\n\n日本語：${japanese}`, `${label}: directive must not leak`);
    assert.equal(output.spokenText, japanese, `${label}: spoken and visible Japanese must match`);
    assert.equal(output.mediaUrl, 'file:///tmp/amadeus-test-only.mp3', `${label}: one attachment`);
    assert.equal(output.mediaUrls, undefined, `${label}: no duplicate attachment list`);
    if (inboundAudio) assert.equal(output.ttsSupplement?.spokenText, japanese);
    else assert.equal(output.ttsSupplement, undefined, `${label}: typed reply must keep visible text as a normal payload`);
  }
  assert.equal(calls.length, 3, 'explicit tagged replies and one recovered bilingual reply reach the speech provider');
  const expectedInputs = ['少し待って。結論を先に言うわ。', 'はい、答えるわ。', '聞こえたわ。'];
  for (const [index, { path, data }] of calls.entries()) {
    assert.equal(path, '/v1/audio/speech');
    assert.equal(data.model, 'amadeus-tts');
    assert.equal(data.voice, 'kurisu-v1');
    assert.equal(data.response_format, 'mp3');
    assert.equal(data.input, expectedInputs[index]);
    assert.doesNotMatch(data.input, /中文|好，我来回答|听到了/u, 'Chinese must not be synthesized');
  }
  console.log('OPENCLAW_TAGGED_TTS_THREE_WAY=passed');
} finally {
  await new Promise((done) => server.close(done));
  rmSync(isolated, { recursive: true, force: true });
  try { rmSync(runtimeFixturePath, { force: true }); } catch {}
}
