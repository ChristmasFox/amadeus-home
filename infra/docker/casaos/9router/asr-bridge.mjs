#!/usr/bin/env node
/** Deterministic multipart -> DashScope multimodal ASR protocol adapter.
 * 9Router remains the model alias/provider control plane. No chat, tools or sender.
 * Official contract: https://help.aliyun.com/zh/model-studio/non-realtime-speech-recognition-user-guide
 */
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';

const MAX_BODY = 7 * 1024 * 1024;
const MAX_WAV = 6 * 1024 * 1024;
const MAX_RESPONSE = 1024 * 1024;
const TIMEOUT_MS = 80_000;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 128;
const MODEL = process.env.AMADEUS_ASR_MODEL || 'qwen-audio-3.0-asr-flash';

function failure(status, type) {
  return { status, body: { error: { type, message: type } } };
}

function readBounded(stream, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    stream.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error('size_limit'));
        stream.destroy();
      } else chunks.push(chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

export function convertToWav(audio) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', 'pipe:0', '-ac', '1', '-ar', '16000', '-f', 'wav', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = [];
    let total = 0;
    const timeout = setTimeout(() => ffmpeg.kill('SIGKILL'), 30_000);
    ffmpeg.stdout.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_WAV) ffmpeg.kill('SIGKILL');
      else chunks.push(chunk);
    });
    ffmpeg.on('error', (err) => { clearTimeout(timeout); reject(err); });
    ffmpeg.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0 || total > MAX_WAV || total < 1024) reject(new Error('unsupported_audio'));
      else resolve(Buffer.concat(chunks));
    });
    ffmpeg.stdin.on('error', () => {}); // conversion failure is reported by close
    ffmpeg.stdin.end(audio);
  });
}

function normalizeUpstream(payload) {
  const output = payload?.output?.output ?? payload?.output ?? payload;
  const text = output?.text ?? output?.sentence?.text;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

function upstreamCategory(status) {
  if (status === 401 || status === 403) return failure(502, 'auth_unavailable');
  if (status === 429 || status >= 500) return failure(503, 'provider_unavailable');
  return failure(502, 'transcription_failed');
}

function secretEquals(actual, expected) {
  const a = Buffer.from(actual || '');
  const b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

function byteBucket(size) {
  if (!Number.isFinite(size)) return 'unknown';
  if (size <= 1024 * 1024) return '<=1MiB';
  if (size <= 3 * 1024 * 1024) return '1-3MiB';
  if (size <= 6 * 1024 * 1024) return '3-6MiB';
  return '>6MiB';
}

function durationBucket(wav) {
  // Converted PCM16 mono 16 kHz: roughly 32,000 bytes per second.
  const seconds = wav.length / 32000;
  if (seconds <= 15) return '<=15s';
  if (seconds <= 60) return '15-60s';
  if (seconds <= 180) return '60-180s';
  return '>180s';
}

export function createAsrServer({ bridgeKey, upstreamKey, upstreamUrl, model = MODEL, fetchFn = fetch, convert = convertToWav }) {
  if (bridgeKey.length < 32 || upstreamKey.length < 20) throw new Error('protected_asr_keys_required');
  const endpoint = new URL(upstreamUrl);
  if (endpoint.protocol !== 'https:' ||
      !(endpoint.hostname.endsWith('.maas.aliyuncs.com') || endpoint.hostname === 'maas.qianwenaiapi.com') ||
      endpoint.pathname !== '/api/v1/services/aigc/multimodal-generation/generation') throw new Error('invalid_asr_endpoint');
  const cache = new Map();
  const inFlight = new Map();
  return createServer(async (req, res) => {
    const started = Date.now();
    let requestHash = 'none';
    let sizeBucket = 'unknown';
    let audioDuration = 'unknown';
    let cacheState = 'none';
    const send = (status, body) => {
      const bytes = Buffer.from(JSON.stringify(body));
      res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': bytes.length });
      res.end(bytes);
      if (req.url !== '/healthz') console.info(`asr direction=inbound route=amadeus-asr request=${requestHash} size=${sizeBucket} duration=${audioDuration} cache=${cacheState} outcome=${status === 200 ? 'ok' : body.error?.type} ms=${Date.now() - started}`);
    };
    if (req.url === '/healthz' && req.method === 'GET') return send(200, { status: 'ready', model });
    if (req.url !== '/v1/audio/transcriptions' || req.method !== 'POST') return send(404, failure(404, 'not_found').body);
    if (!secretEquals(req.headers.authorization, bridgeKey)) return send(401, failure(401, 'auth_unavailable').body);
    const type = req.headers['content-type'] || '';
    const length = Number(req.headers['content-length'] || 0);
    if (!type.startsWith('multipart/form-data;') || !Number.isInteger(length) || length < 1 || length > MAX_BODY)
      return send(413, failure(413, 'unsupported_audio').body);
    let file;
    try {
      const body = await readBounded(req, MAX_BODY);
      const form = await new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': type }, body }).formData();
      if (form.get('model') !== model) return send(400, failure(400, 'unknown_model').body);
      file = form.get('file');
      if (!file || typeof file.arrayBuffer !== 'function' || file.size < 1024 || file.size > MAX_BODY) return send(415, failure(415, 'unsupported_audio').body);
      if (!/^audio\/(ogg|opus|mpeg|mp3|mp4|wav|x-wav|webm|aac|flac)(?:;|$)/i.test(file.type || '')) return send(415, failure(415, 'unsupported_audio').body);
    } catch {
      return send(415, failure(415, 'unsupported_audio').body);
    }
    const audio = Buffer.from(await file.arrayBuffer());
    sizeBucket = byteBucket(audio.length);
    const id = createHash('sha256').update(model).update(audio).digest('hex');
    requestHash = id.slice(0, 12);
    const cached = cache.get(id);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      cacheState = 'hit';
      return send(200, { text: cached.text });
    }
    const pending = inFlight.get(id);
    if (pending) {
      cacheState = 'coalesced';
      const outcome = await pending;
      audioDuration = outcome.duration ?? 'unknown';
      return send(outcome.status, outcome.body);
    }
    if (inFlight.size >= 8) return send(503, failure(503, 'provider_unavailable').body);
    cacheState = 'miss';
    const task = (async () => {
      let wav;
      try { wav = await convert(audio); }
      catch { return failure(415, 'unsupported_audio'); }
      if (!Buffer.isBuffer(wav) || wav.length < 1024 || wav.length > MAX_WAV) return failure(415, 'unsupported_audio');
      const duration = durationBucket(wav);
      const requestBody = {
        model,
        input: { messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${wav.toString('base64')}` } }] }] },
        parameters: { format: 'wav', sample_rate: '16000' },
      };
      try {
        const upstream = await fetchFn(endpoint, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { Authorization: `Bearer ${upstreamKey}`, 'Content-Type': 'application/json', 'X-DashScope-SSE': 'disable' },
          body: JSON.stringify(requestBody),
        });
        if (!upstream.ok) return { ...upstreamCategory(upstream.status), duration };
        const raw = await readBounded(Readable.fromWeb(upstream.body), MAX_RESPONSE);
        const text = normalizeUpstream(JSON.parse(raw.toString('utf8')));
        if (!text) return { ...failure(502, 'transcription_failed'), duration };
        return { status: 200, body: { text }, duration };
      } catch (err) {
        const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
        return { ...failure(timedOut ? 504 : 503, timedOut ? 'timeout' : 'provider_unavailable'), duration };
      }
    })().catch(() => failure(503, 'provider_unavailable'));
    inFlight.set(id, task);
    try {
      const outcome = await task;
      audioDuration = outcome.duration ?? 'unknown';
      if (outcome.status === 200) {
        cache.set(id, { text: outcome.body.text, at: Date.now() });
        while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      }
      return send(outcome.status, outcome.body);
    } finally {
      inFlight.delete(id);
    }
  });
}

if (process.argv[1]?.endsWith('/asr-bridge.mjs')) {
  const server = createAsrServer({
    bridgeKey: readFileSync(process.env.AMADEUS_ASR_BRIDGE_KEY_FILE, 'utf8').trim(),
    upstreamKey: readFileSync(process.env.AMADEUS_ASR_UPSTREAM_KEY_FILE, 'utf8').trim(),
    upstreamUrl: process.env.AMADEUS_ASR_UPSTREAM_URL,
  });
  server.listen(20129, '127.0.0.1', () => console.info('asr bridge listening on container loopback'));
}
