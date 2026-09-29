#!/usr/bin/env node
/**
 * OpenAI-compatible TTS transport adapter for the Amadeus logical voice.
 *
 * 9Router remains the provider/control plane.  This process owns only the
 * protocol boundary: Qwen-Audio-TTS Flash is attempted once, then the
 * already-installed M204 OminiX service is attempted once for transient cloud
 * failures.  No text, audio, token or cloud voice id is written to logs.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';

export const CLOUD_MODEL = 'qwen-audio-3.0-tts-flash';
export const MODEL_ALIASES = new Set(['amadeus-tts', 'qwen3-tts-1.7b']);
export const VOICE_ID = 'kurisu-v1';
export const MAX_TEXT = 1200;
export const MAX_BODY = 8192;
export const MAX_AUDIO = 12 * 1024 * 1024;
// Base64 expands the largest accepted audio by roughly 4/3; leave room for
// the surrounding provider JSON without imposing a tiny response limit.
export const MAX_CLOUD_RESPONSE_BODY = Math.ceil(MAX_AUDIO * 4 / 3) + 64 * 1024;
export const DEFAULT_PORT = 20130;
export const DEFAULT_CLOUD_TIMEOUT_MS = 80_000;
export const DEFAULT_LOCAL_TIMEOUT_MS = 115_000;

const EMOTIONS = new Set(['default', 'irritated', 'embarrassed', 'angry', 'sarcastic', 'soft', 'sad']);
const MIME_BY_FORMAT = { wav: 'audio/wav', mp3: 'audio/mpeg', opus: 'audio/ogg' };
const CLOUD_FORMATS = new Set(['wav', 'mp3', 'opus']);
const FALLBACK_HTTP = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_STYLE = {
  cloudPersona: '牧瀬紅莉栖のような知的な若い女性。日本語を自然なアニメ演技で話す。明瞭で芯があり、叫ばず、機械的な棒読みや過度に成熟した低い声にしない。',
  emotions: {
    default: '明るく知的で、少し素っ気なくきびきび話す。重要な言葉を明瞭に強調し、文末は軽く切る。',
    irritated: '明らかに苛立っているが理性を保つ。少し速く話し、叱責の言葉を鋭く強調する。短い間を置き、文末を硬く切る。怒鳴らない。',
    embarrassed: '強がって否定するが本当は照れている。最初は鋭く、照れに関係する言葉の前で短く詰まり、後半は少し早口で語尾を弱くほどく。過度に甘くしない。',
    angry: 'はっきり怒っている。声のエネルギーと子音の鋭さを上げ、重要語を強く発音する。短いフレーズで区切り、硬く断定する。叫ばない。',
    sarcastic: '乾いた皮肉と軽い見下しを込める。皮肉の核心語を強調し、その前後に短い間を置く。語尾を少し引き伸ばして知的にからかう。',
    soft: '本気で相手を心配している。声のエネルギーと音高を少し下げ、わずかにゆっくり柔らかく話す。最後は優しく丸めるが、照れを隠す理性を残す。',
    sad: '強がっているが寂しさを隠せない。音高と声のエネルギーを少し落とし、ゆっくり息混じりに始める。重要語の前に長めの間を置き、文末に弱い余韻を残す。',
  },
};

function readProtected(path, name, { min = 1, max = 4096 } = {}) {
  if (!path) throw new Error(`${name}_file_required`);
  const value = readFileSync(path, 'utf8').trim();
  if (!value || value.length < min || value.length > max) throw new Error(`${name}_invalid`);
  return value;
}

function failure(status, type, extra = {}) {
  return { status, body: { error: { type, message: type, ...extra } } };
}

function authMatches(actual, expected) {
  const a = Buffer.from(actual || '');
  const b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

function inputBucket(text) {
  return text.length <= 40 ? '<=40' : text.length <= 80 ? '<=80' : text.length <= 160 ? '<=160' : text.length <= 320 ? '<=320' : '>320';
}

function byteBucket(size) {
  return size <= 1024 * 1024 ? '<=1MiB' : size <= 3 * 1024 * 1024 ? '1-3MiB' : size <= 6 * 1024 * 1024 ? '3-6MiB' : '>6MiB';
}

function validCloudEndpoint(raw) {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  const allowedHost = host === 'dashscope.aliyuncs.com' || host === 'maas.qianwenaiapi.com' || host.endsWith('.maas.aliyuncs.com');
  if (url.protocol !== 'https:' || !allowedHost || url.pathname !== '/api/v1/services/audio/tts/SpeechSynthesizer') throw new Error('invalid_cloud_endpoint');
  return url;
}

function validAudio(audio, format) {
  if (!Buffer.isBuffer(audio) || audio.length < 64 || audio.length > MAX_AUDIO) return false;
  if (format === 'wav') return audio.subarray(0, 4).toString() === 'RIFF' && audio.subarray(8, 12).toString() === 'WAVE';
  if (format === 'opus') return audio.subarray(0, 4).toString() === 'OggS';
  return audio.subarray(0, 3).toString() === 'ID3' || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0);
}

function detectAudioFormat(audio) {
  if (!Buffer.isBuffer(audio)) return null;
  if (audio.subarray(0, 4).toString() === 'RIFF' && audio.subarray(8, 12).toString() === 'WAVE') return 'wav';
  if (audio.subarray(0, 4).toString() === 'OggS') return 'opus';
  if (audio.subarray(0, 3).toString() === 'ID3' || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0)) return 'mp3';
  return null;
}

function readBounded(stream, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    stream.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error('audio_size_limit'));
        stream.destroy();
      } else chunks.push(chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function fetchWithTimeout(fetchFn, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function convertAudio(audio, inputFormat, outputFormat, spawnFn = spawn) {
  if (inputFormat === outputFormat && validAudio(audio, outputFormat)) return audio;
  const inputMime = MIME_BY_FORMAT[inputFormat] || 'application/octet-stream';
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', inputFormat === 'opus' ? 'ogg' : inputFormat, '-i', 'pipe:0', '-ac', '1'];
  if (outputFormat === 'wav') args.push('-ar', '24000', '-f', 'wav', 'pipe:1');
  else if (outputFormat === 'opus') args.push('-ar', '48000', '-c:a', 'libopus', '-b:a', '64k', '-f', 'ogg', 'pipe:1');
  else args.push('-c:a', 'libmp3lame', '-b:a', '96k', '-f', 'mp3', 'pipe:1');
  return await new Promise((resolve, reject) => {
    const child = spawnFn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = [];
    let total = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.stdout.on('data', (chunk) => { total += chunk.length; if (total <= MAX_AUDIO) chunks.push(chunk); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks);
      if (code !== 0 || total > MAX_AUDIO || !validAudio(output, outputFormat)) reject(new Error(`audio_conversion_failed:${inputMime}`));
      else resolve(output);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(audio);
  });
}

function cloudInstruction(style, emotion) {
  if (!EMOTIONS.has(emotion)) throw new Error('invalid_style');
  const persona = typeof style?.cloudPersona === 'string' && style.cloudPersona.trim() ? style.cloudPersona.trim() : DEFAULT_STYLE.cloudPersona;
  const delta = typeof style?.emotions?.[emotion]?.cloudInstruction === 'string' ? style.emotions[emotion].cloudInstruction.trim() : DEFAULT_STYLE.emotions[emotion];
  if (!delta || delta.length > 1000 || persona.length > 1500) throw new Error('cloud_style_unavailable');
  return `${persona}${delta}`;
}

function validateCloudStyle(style) {
  if (!style || typeof style !== 'object' || typeof style.cloudPersona !== 'string' || !style.cloudPersona.trim() || style.cloudPersona.length > 1500 || !style.emotions || typeof style.emotions !== 'object') throw new Error('cloud_style_unavailable');
  for (const emotion of EMOTIONS) {
    const entry = style.emotions[emotion];
    const instruction = typeof entry === 'string' ? entry : entry?.cloudInstruction;
    if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 1000) throw new Error('cloud_style_unavailable');
  }
  return style;
}

function normalizeCloudAudio(payload, format, fetchFn, spawnFn) {
  const audio = payload?.output?.audio;
  if (!audio || typeof audio !== 'object') throw new Error('cloud_audio_empty');
  if (typeof audio.data === 'string' && audio.data) {
    const decoded = Buffer.from(audio.data, 'base64');
    if (validAudio(decoded, format)) return Promise.resolve(decoded);
    const detected = detectAudioFormat(decoded);
    if (!detected) throw new Error('cloud_audio_invalid');
    return convertAudio(decoded, detected, format, spawnFn);
  }
  if (typeof audio.url !== 'string' || !/^(?:https?:)\/\/[A-Za-z0-9.-]+\//.test(audio.url)) throw new Error('cloud_audio_empty');
  const url = new URL(audio.url);
  const host = url.hostname.toLowerCase();
  if (!(host.endsWith('.aliyuncs.com') || host.endsWith('.alicdn.com'))) throw new Error('cloud_audio_url_invalid');
  // DashScope may return an HTTP OSS URL even though the signed object is
  // available over HTTPS. Upgrade only allowlisted provider hosts before
  // fetching so the bridge never follows an insecure external URL.
  if (url.protocol === 'http:') url.protocol = 'https:';
  return fetchWithTimeout(fetchFn, url, { method: 'GET', redirect: 'error' }, DEFAULT_CLOUD_TIMEOUT_MS).then(async (response) => {
    if (!response.ok || !response.body) throw new Error('cloud_audio_fetch_failed');
    const raw = await readBounded((response.body && typeof response.body.getReader === 'function') ? Readable.fromWeb(response.body) : response.body, MAX_AUDIO);
    if (validAudio(raw, format)) return raw;
    const detected = detectAudioFormat(raw);
    if (!detected) throw new Error('cloud_audio_invalid');
    return convertAudio(raw, detected, format, spawnFn);
  });
}

function cloudError(status) {
  if (FALLBACK_HTTP.has(status)) return { fallback: true, category: 'provider_unavailable' };
  if (status === 401 || status === 403) return { fallback: false, result: failure(502, 'auth_unavailable') };
  if (status === 400) return { fallback: false, result: failure(400, 'invalid_request') };
  return { fallback: false, result: failure(502, 'provider_unavailable') };
}

export function buildCloudRequest({ text, voiceId, emotion, format, style }) {
  if (!MODEL_ALIASES.has('amadeus-tts')) throw new Error('adapter_model_contract');
  if (typeof voiceId !== 'string' || !voiceId.trim()) throw new Error('cloud_voice_id_required');
  if (!CLOUD_FORMATS.has(format)) throw new Error('unsupported_format');
  return {
    model: CLOUD_MODEL,
    input: {
      text,
      voice: voiceId,
      format,
      sample_rate: format === 'opus' ? 48000 : 24000,
      language_hints: ['ja'],
      instruction: cloudInstruction(style, emotion),
    },
  };
}

export function classifyCloudFailure(error) {
  if (error?.fallback) return error;
  const code = error?.code || error?.cause?.code;
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError' || (error?.name === 'TypeError' && error?.message === 'fetch failed') || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'EAI_AGAIN' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'CERT_HAS_EXPIRED') return { fallback: true, category: 'timeout_or_network' };
  if (error?.message === 'cloud_audio_empty' || error?.message === 'cloud_audio_invalid' || error?.message === 'cloud_audio_fetch_failed' || error?.message === 'cloud_audio_url_invalid' || error?.message?.startsWith('audio_conversion_failed')) return { fallback: true, category: 'invalid_audio' };
  return { fallback: false, result: failure(502, 'provider_unavailable') };
}

export function createTtsServer({
  bridgeKey,
  cloudKey,
  cloudVoiceId,
  localKey,
  cloudUrl,
  localUrl = 'http://host.docker.internal:18792/v1/audio/speech',
  style = DEFAULT_STYLE,
  fetchFn = fetch,
  spawnFn = spawn,
  cloudTimeoutMs = DEFAULT_CLOUD_TIMEOUT_MS,
  localTimeoutMs = DEFAULT_LOCAL_TIMEOUT_MS,
}) {
  if (!bridgeKey || bridgeKey.length < 32 || !cloudKey || cloudKey.length < 20 || !cloudVoiceId || !localKey || localKey.length < 32) throw new Error('protected_tts_keys_required');
  validateCloudStyle(style);
  const endpoint = validCloudEndpoint(cloudUrl);
  const localEndpoint = new URL(localUrl);
  if (localEndpoint.protocol !== 'http:' || localEndpoint.pathname !== '/v1/audio/speech') throw new Error('invalid_local_tts_endpoint');
  return createServer(async (req, res) => {
    const started = Date.now();
    const sendJson = (status, body) => {
      const payload = Buffer.from(JSON.stringify(body));
      res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': payload.length });
      res.end(payload);
    };
    const sendAudio = (audio, format, provider, fallback) => {
      res.writeHead(200, {
        'Content-Type': MIME_BY_FORMAT[format],
        'Content-Length': audio.length,
        'X-Amadeus-TTS-Provider': provider,
        ...(fallback ? { 'X-Amadeus-TTS-Fallback': 'local' } : {}),
      });
      res.end(audio);
    };
    if (req.url === '/healthz' && req.method === 'GET') return sendJson(200, { status: 'ready', model: 'amadeus-tts', voice: VOICE_ID });
    if (req.url !== '/v1/audio/speech' || req.method !== 'POST') return sendJson(404, failure(404, 'not_found').body);
    if (!authMatches(req.headers.authorization, bridgeKey)) return sendJson(401, failure(401, 'auth_unavailable').body);
    const size = Number(req.headers['content-length'] || 0);
    if (!Number.isInteger(size) || size < 1 || size > MAX_BODY || !String(req.headers['content-type'] || '').includes('application/json')) return sendJson(413, failure(413, 'invalid_request').body);
    let data;
    try { data = JSON.parse((await readBounded(req, MAX_BODY)).toString('utf8')); } catch { return sendJson(400, failure(400, 'invalid_request').body); }
    if (!data || typeof data !== 'object' || !MODEL_ALIASES.has(data.model)) return sendJson(400, failure(400, 'unknown_model').body);
    if (data.voice !== VOICE_ID) return sendJson(400, failure(400, 'unknown_voice').body);
    if (typeof data.input !== 'string' || !data.input.trim() || data.input.length > MAX_TEXT) return sendJson(400, failure(400, 'invalid_input').body);
    const format = data.response_format || 'mp3';
    if (!CLOUD_FORMATS.has(format)) return sendJson(400, failure(400, 'unsupported_format').body);
    const emotion = data.style === undefined || data.style === '' ? 'default' : data.style;
    if (typeof emotion !== 'string' || !EMOTIONS.has(emotion)) return sendJson(400, failure(400, 'invalid_style').body);
    if (data.language !== undefined && data.language !== 'ja') return sendJson(400, failure(400, 'invalid_language').body);

    const common = { text: data.input, voiceId: cloudVoiceId, emotion, format, style };
    let cloudFailure = null;
    try {
      const body = buildCloudRequest(common);
      const response = await fetchWithTimeout(fetchFn, endpoint, {
        method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${cloudKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }, cloudTimeoutMs);
      if (!response.ok) {
        const classified = cloudError(response.status);
        if (!classified.fallback) { sendJson(classified.result.status, classified.result.body); console.info(`tts provider=cloud category=${classified.result.body.error.type} outcome=error format=${format} input=${inputBucket(data.input)} ms=${Date.now() - started}`); return; }
        cloudFailure = classified.category;
      } else {
        const raw = await readBounded((response.body && typeof response.body.getReader === 'function') ? Readable.fromWeb(response.body) : response.body, MAX_CLOUD_RESPONSE_BODY);
        const payload = JSON.parse(raw.toString('utf8'));
        const audio = await normalizeCloudAudio(payload, format, fetchFn, spawnFn);
        if (!validAudio(audio, format)) throw new Error('cloud_audio_invalid');
        sendAudio(audio, format, 'cloud', false);
        console.info(`tts provider=cloud category=ok outcome=success format=${format} bytes=${byteBucket(audio.length)} input=${inputBucket(data.input)} ms=${Date.now() - started}`);
        return;
      }
    } catch (error) {
      const classified = classifyCloudFailure(error);
      if (!classified.fallback) {
        const result = classified.result || failure(502, 'provider_unavailable');
        sendJson(result.status, result.body);
        console.info(`tts provider=cloud category=${result.body.error.type} outcome=error format=${format} input=${inputBucket(data.input)} ms=${Date.now() - started}`);
        return;
      }
      cloudFailure = classified.category;
    }

    try {
      const localResponse = await fetchWithTimeout(fetchFn, localEndpoint, {
        method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${localKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'qwen3-tts-1.7b', voice: VOICE_ID, input: data.input, response_format: format, style: emotion }),
      }, localTimeoutMs);
      if (!localResponse.ok) {
        let localType = 'provider_unavailable';
        try { const body = await localResponse.json(); if (body?.error?.type === 'tts_busy') localType = 'tts_busy'; } catch {}
        sendJson(503, failure(503, localType).body);
        console.info(`tts provider=local category=${localType} outcome=error cloud=${cloudFailure || 'unknown'} format=${format} input=${inputBucket(data.input)} ms=${Date.now() - started}`);
        return;
      }
      const audio = await readBounded((localResponse.body && typeof localResponse.body.getReader === 'function') ? Readable.fromWeb(localResponse.body) : localResponse.body, MAX_AUDIO);
      if (!validAudio(audio, format)) throw new Error('local_audio_invalid');
      sendAudio(audio, format, 'local', true);
      console.info(`tts provider=local category=${cloudFailure || 'cloud_unavailable'} outcome=success format=${format} bytes=${byteBucket(audio.length)} input=${inputBucket(data.input)} ms=${Date.now() - started}`);
    } catch (error) {
      const category = error?.name === 'AbortError' || error?.name === 'TimeoutError' ? 'timeout' : 'provider_unavailable';
      sendJson(503, failure(503, category === 'timeout' ? 'provider_unavailable' : category).body);
      console.info(`tts provider=local category=${category} outcome=error cloud=${cloudFailure || 'unknown'} format=${format} input=${inputBucket(data.input)} ms=${Date.now() - started}`);
    }
  });
}

if (process.argv[1]?.endsWith('/tts-bridge.mjs')) {
  const fs = await import('node:fs');
  const read = (key, name, options) => {
    const path = process.env[key];
    if (!path) throw new Error(`${name}_file_required`);
    const stat = fs.lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error(`${name}_file_unprotected`);
    return readProtected(path, name, options);
  };
  const stylePath = process.env.AMADEUS_TTS_STYLE_FILE;
  const style = stylePath ? JSON.parse(fs.readFileSync(stylePath, 'utf8')) : DEFAULT_STYLE;
  const server = createTtsServer({
    bridgeKey: read('AMADEUS_TTS_BRIDGE_KEY_FILE', 'tts_bridge_key', { min: 32 }),
    cloudKey: read('AMADEUS_TTS_CLOUD_API_KEY_FILE', 'tts_cloud_api_key', { min: 20 }),
    cloudVoiceId: read('AMADEUS_TTS_CLOUD_VOICE_ID_FILE', 'tts_cloud_voice_id', { min: 8, max: 256 }),
    localKey: read('AMADEUS_TTS_LOCAL_KEY_FILE', 'tts_local_key', { min: 32 }),
    cloudUrl: process.env.AMADEUS_TTS_CLOUD_URL,
    localUrl: process.env.AMADEUS_TTS_LOCAL_URL || 'http://host.docker.internal:18792/v1/audio/speech',
    style,
  });
  const port = Number(process.env.AMADEUS_TTS_BRIDGE_PORT || DEFAULT_PORT);
  server.listen(port, '127.0.0.1', () => console.info(`tts bridge listening on container loopback port=${port}`));
}
