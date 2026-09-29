#!/usr/bin/env node
/**
 * One-deadline TTS adapter for the logical Amadeus voice.
 *
 * The bridge receives speechText from ReplyEnvelope. It never parses or
 * rewrites a reply envelope and never returns text as a delivery fallback.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';

export const CLOUD_MODELS = Object.freeze(['qwen-audio-3.1-tts-flash', 'qwen-audio-3.0-tts-flash']);
export const CLOUD_MODEL = CLOUD_MODELS[0];
export const CLOUD_FALLBACK_MODEL = CLOUD_MODELS[1];
export const MODEL_ALIASES = new Set(['amadeus-tts', 'qwen3-tts-1.7b']);
export const VOICE_ID = 'kurisu-v1';
export const MAX_TEXT = 1200;
export const MAX_BODY = 8192;
export const MAX_AUDIO = 12 * 1024 * 1024;
export const MAX_CLOUD_RESPONSE_BODY = Math.ceil(MAX_AUDIO * 4 / 3) + 64 * 1024;
export const DEFAULT_PORT = 20130;
export const DEFAULT_DEADLINE_MS = 110_000;
export const RESERVE_MS = 5_000;
export const CLOUD_BUDGET_MS = 25_000;
export const LOCAL_BUDGET_MS = 55_000;
export const DEFAULT_CLOUD_TIMEOUT_MS = CLOUD_BUDGET_MS;
export const DEFAULT_LOCAL_TIMEOUT_MS = LOCAL_BUDGET_MS;

const EMOTIONS = new Set(['default', 'irritated', 'embarrassed', 'angry', 'sarcastic', 'soft', 'sad']);
const MIME_BY_FORMAT = { wav: 'audio/wav', mp3: 'audio/mpeg', opus: 'audio/ogg' };
const CLOUD_FORMATS = new Set(['wav', 'mp3', 'opus']);
const FALLBACK_HTTP = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_STYLE = {
  cloudPersona: '牧瀬紅莉栖のような知的な若い女性。日本語を自然なアニメ演技で話す。明瞭で芯があり、叫ばず、機械的な棒読みや過度に成熟した低い声にしない。',
  emotions: {
    default: '明るく知的で、少し素っ気なくきびきび話す。重要な言葉を明瞭に強調し、文末は軽く切る。',
    irritated: '明らかに苛立っているが理性を保つ。少し速く話し、叱責の言葉を鋭く強調する。',
    embarrassed: '強がって否定するが本当は照れている。最初は鋭く、後半は少し早口で語尾を弱くほどく。',
    angry: 'はっきり怒っている。声のエネルギーと子音の鋭さを上げ、重要語を強く発音する。',
    sarcastic: '乾いた皮肉と軽い見下しを込める。皮肉の核心語を強調し、その前後に短い間を置く。',
    soft: '本気で相手を心配している。声のエネルギーと音高を少し下げ、わずかにゆっくり柔らかく話す。',
    sad: '強がっているが寂しさを隠せない。音高と声のエネルギーを少し落とし、ゆっくり息混じりに始める。',
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

function inputBucket(text) { return text.length <= 40 ? '<=40' : text.length <= 80 ? '<=80' : text.length <= 160 ? '<=160' : text.length <= 320 ? '<=320' : '>320'; }
function byteBucket(size) { return size <= 1024 * 1024 ? '<=1MiB' : size <= 3 * 1024 * 1024 ? '1-3MiB' : size <= 6 * 1024 * 1024 ? '3-6MiB' : '>6MiB'; }

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

function remainingMs(deadlineAt) { return Math.max(0, deadlineAt - Date.now()); }

function readBounded(stream, limit, deadlineAt = Number.POSITIVE_INFINITY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const timer = Number.isFinite(deadlineAt) ? setTimeout(() => { stream.destroy(); reject(Object.assign(new Error('deadline_exceeded'), { category: 'deadline_exceeded' })); }, remainingMs(deadlineAt)) : null;
    stream.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) { stream.destroy(); reject(Object.assign(new Error('audio_invalid'), { category: 'audio_invalid' })); }
      else chunks.push(chunk);
    });
    stream.on('end', () => { if (timer) clearTimeout(timer); resolve(Buffer.concat(chunks)); });
    stream.on('error', (error) => { if (timer) clearTimeout(timer); reject(error); });
  });
}

async function fetchWithDeadline(fetchFn, url, options, deadlineAt) {
  const timeoutMs = remainingMs(deadlineAt);
  if (timeoutMs <= 0) throw Object.assign(new Error('deadline_exceeded'), { category: 'deadline_exceeded' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetchFn(url, { ...options, signal: controller.signal }); }
  catch (error) {
    if (controller.signal.aborted) throw Object.assign(new Error('provider_timeout'), { category: 'provider_timeout', cause: error });
    throw error;
  } finally { clearTimeout(timer); }
}

async function convertAudio(audio, inputFormat, outputFormat, deadlineAt, spawnFn = spawn) {
  if (inputFormat === outputFormat && validAudio(audio, outputFormat)) return audio;
  if (remainingMs(deadlineAt) <= 0) throw Object.assign(new Error('deadline_exceeded'), { category: 'deadline_exceeded' });
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', inputFormat === 'opus' ? 'ogg' : inputFormat, '-i', 'pipe:0', '-ac', '1'];
  if (outputFormat === 'wav') args.push('-ar', '24000', '-f', 'wav', 'pipe:1');
  else if (outputFormat === 'opus') args.push('-ar', '48000', '-c:a', 'libopus', '-b:a', '64k', '-f', 'ogg', 'pipe:1');
  else args.push('-c:a', 'libmp3lame', '-b:a', '96k', '-f', 'mp3', 'pipe:1');
  return await new Promise((resolve, reject) => {
    const child = spawnFn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = []; let total = 0;
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Object.assign(new Error('deadline_exceeded'), { category: 'deadline_exceeded' })); }, remainingMs(deadlineAt));
    child.stdout.on('data', (chunk) => { total += chunk.length; if (total <= MAX_AUDIO) chunks.push(chunk); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => { clearTimeout(timer); const output = Buffer.concat(chunks); if (code !== 0 || total > MAX_AUDIO || !validAudio(output, outputFormat)) reject(Object.assign(new Error('audio_invalid'), { category: 'audio_invalid' })); else resolve(output); });
    child.stdin.on('error', () => {}); child.stdin.end(audio);
  });
}

function cloudInstruction(style, emotion) {
  if (!EMOTIONS.has(emotion)) throw new Error('invalid_style');
  const persona = typeof style?.cloudPersona === 'string' && style.cloudPersona.trim() ? style.cloudPersona.trim() : DEFAULT_STYLE.cloudPersona;
  const delta = typeof style?.emotions?.[emotion]?.cloudInstruction === 'string' ? style.emotions[emotion].cloudInstruction.trim() : typeof style?.emotions?.[emotion] === 'string' ? style.emotions[emotion].trim() : DEFAULT_STYLE.emotions[emotion];
  if (!delta || delta.length > 1000 || persona.length > 1500) throw new Error('cloud_style_unavailable');
  return `${persona}${delta}`;
}

function validateCloudStyle(style) {
  if (!style || typeof style !== 'object' || typeof style.cloudPersona !== 'string' || !style.cloudPersona.trim() || style.cloudPersona.length > 1500 || !style.emotions || typeof style.emotions !== 'object') throw new Error('cloud_style_unavailable');
  for (const emotion of EMOTIONS) { const entry = style.emotions[emotion]; const instruction = typeof entry === 'string' ? entry : entry?.cloudInstruction; if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 1000) throw new Error('cloud_style_unavailable'); }
  return style;
}

async function normalizeCloudAudio(payload, format, fetchFn, deadlineAt, spawnFn) {
  const audio = payload?.output?.audio;
  if (!audio || typeof audio !== 'object') throw Object.assign(new Error('audio_invalid'), { category: 'audio_invalid' });
  if (typeof audio.data === 'string' && audio.data) {
    const decoded = Buffer.from(audio.data, 'base64');
    if (validAudio(decoded, format)) return decoded;
    const detected = detectAudioFormat(decoded);
    if (!detected) throw Object.assign(new Error('audio_invalid'), { category: 'audio_invalid' });
    return convertAudio(decoded, detected, format, deadlineAt, spawnFn);
  }
  if (typeof audio.url !== 'string' || !/^(?:https?:)\/\/[A-Za-z0-9.-]+\//.test(audio.url)) throw Object.assign(new Error('audio_invalid'), { category: 'audio_invalid' });
  const url = new URL(audio.url); const host = url.hostname.toLowerCase();
  if (!(host.endsWith('.aliyuncs.com') || host.endsWith('.alicdn.com'))) throw Object.assign(new Error('audio_invalid'), { category: 'audio_invalid' });
  if (url.protocol === 'http:') url.protocol = 'https:';
  const response = await fetchWithDeadline(fetchFn, url, { method: 'GET', redirect: 'error' }, deadlineAt);
  if (!response.ok || !response.body) throw Object.assign(new Error('audio_invalid'), { category: 'audio_invalid' });
  const raw = await readBounded(response.body && typeof response.body.getReader === 'function' ? Readable.fromWeb(response.body) : response.body, MAX_AUDIO, deadlineAt);
  if (validAudio(raw, format)) return raw;
  const detected = detectAudioFormat(raw);
  if (!detected) throw Object.assign(new Error('audio_invalid'), { category: 'audio_invalid' });
  return convertAudio(raw, detected, format, deadlineAt, spawnFn);
}

function cloudError(status) {
  if (FALLBACK_HTTP.has(status)) return { fallback: true, category: 'provider_unavailable' };
  if (status === 401 || status === 403) return { fallback: false, result: failure(502, 'provider_unavailable') };
  if (status === 400) return { fallback: false, result: failure(400, 'audio_invalid') };
  return { fallback: false, result: failure(502, 'provider_unavailable') };
}

export function buildCloudRequest({ model = CLOUD_MODEL, text, voiceId, emotion, format, style }) {
  if (!CLOUD_MODELS.includes(model)) throw new Error('unsupported_cloud_model');
  if (typeof voiceId !== 'string' || !voiceId.trim()) throw new Error('cloud_voice_id_required');
  if (!CLOUD_FORMATS.has(format)) throw new Error('unsupported_format');
  return { model, input: { text, voice: voiceId, format, sample_rate: format === 'opus' ? 48000 : 24000, language_hints: ['ja'], instruction: cloudInstruction(style, emotion) } };
}

export function classifyCloudFailure(error) {
  if (error?.category) return { fallback: true, category: error.category };
  const code = error?.code || error?.cause?.code;
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'EAI_AGAIN' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'CERT_HAS_EXPIRED') return { fallback: true, category: 'provider_timeout' };
  return { fallback: true, category: 'provider_unavailable' };
}

export function createTtsServer({ bridgeKey, cloudKey, cloudVoiceId, cloudVoiceId31, cloudVoiceId30, localKey, cloudUrl, localUrl = 'http://host.docker.internal:19871/v1/audio/speech', style = DEFAULT_STYLE, fetchFn = fetch, spawnFn = spawn, cloudTimeoutMs = CLOUD_BUDGET_MS, localTimeoutMs = LOCAL_BUDGET_MS }) {
  cloudVoiceId30 ||= cloudVoiceId; cloudVoiceId31 ||= cloudVoiceId;
  if (!bridgeKey || bridgeKey.length < 32 || !cloudKey || cloudKey.length < 20 || !cloudVoiceId31 || !cloudVoiceId30 || !localKey || localKey.length < 32) throw new Error('protected_tts_keys_required');
  validateCloudStyle(style); const endpoint = validCloudEndpoint(cloudUrl); const localEndpoint = new URL(localUrl);
  if (localEndpoint.protocol !== 'http:' || localEndpoint.pathname !== '/v1/audio/speech') throw new Error('invalid_local_tts_endpoint');
  return createServer(async (req, res) => {
    const started = Date.now();
    const runId = String(req.headers['x-amadeus-run-id'] || 'unknown').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 96) || 'unknown';
    const sendJson = (status, body) => { const payload = Buffer.from(JSON.stringify(body)); res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': payload.length }); res.end(payload); };
    const sendAudio = (audio, format, provider, fallback) => { res.writeHead(200, { 'Content-Type': MIME_BY_FORMAT[format], 'Content-Length': audio.length, 'X-Amadeus-TTS-Provider': provider, ...(fallback ? { 'X-Amadeus-TTS-Fallback': fallback } : {}) }); res.end(audio); };
    if (req.url === '/healthz' && req.method === 'GET') return sendJson(200, { status: 'ready', model: 'amadeus-tts', localModel: 'gpt-sovits-v2pro-mps', localProvider: 'gpt-sovits-mps', fallbackOrder: ['gpt-sovits-mps', ...CLOUD_MODELS], voice: VOICE_ID, deadlineMs: DEFAULT_DEADLINE_MS });
    if (req.url !== '/v1/audio/speech' || req.method !== 'POST') return sendJson(404, failure(404, 'provider_unavailable').body);
    if (!authMatches(req.headers.authorization, bridgeKey)) return sendJson(401, failure(401, 'provider_unavailable').body);
    const size = Number(req.headers['content-length'] || 0);
    if (!Number.isInteger(size) || size < 1 || size > MAX_BODY || !String(req.headers['content-type'] || '').includes('application/json')) return sendJson(413, failure(413, 'audio_invalid').body);
    let data; try { data = JSON.parse((await readBounded(req, MAX_BODY)).toString('utf8')); } catch { return sendJson(400, failure(400, 'audio_invalid').body); }
    if (!data || typeof data !== 'object' || !MODEL_ALIASES.has(data.model)) return sendJson(400, failure(400, 'audio_invalid').body);
    if (data.voice !== VOICE_ID) return sendJson(400, failure(400, 'audio_invalid').body);
    if (typeof data.input !== 'string' || !data.input.trim() || data.input.length > MAX_TEXT) return sendJson(400, failure(400, 'audio_invalid').body);
    const format = data.response_format || 'mp3'; if (!CLOUD_FORMATS.has(format)) return sendJson(400, failure(400, 'audio_invalid').body);
    const emotion = data.style === undefined || data.style === '' ? 'default' : data.style; if (typeof emotion !== 'string' || !EMOTIONS.has(emotion)) return sendJson(400, failure(400, 'audio_invalid').body);
    if (data.language !== undefined && data.language !== 'ja') return sendJson(400, failure(400, 'audio_invalid').body);
    const requested = Number(req.headers['x-amadeus-deadline-ms']); const deadlineMs = Number.isFinite(requested) && requested > 0 ? Math.min(DEFAULT_DEADLINE_MS, requested) : DEFAULT_DEADLINE_MS; const deadlineAt = started + deadlineMs;
    let lastReason = 'provider_unavailable';
    const tryLocal = emotion === 'default';
    if (tryLocal) {
      const localStarted = Date.now(); const localDeadline = Math.min(deadlineAt - RESERVE_MS, localStarted + Math.min(localTimeoutMs, LOCAL_BUDGET_MS));
      if (remainingMs(localDeadline) <= 0) lastReason = 'deadline_exceeded';
      else {
        try {
          const localResponse = await fetchWithDeadline(fetchFn, localEndpoint, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${localKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'amadeus-tts', voice: VOICE_ID, input: data.input, response_format: format, style: 'default' }) }, localDeadline);
          if (!localResponse.ok) { let localType = 'provider_unavailable'; try { const body = await localResponse.json(); if (body?.error?.type === 'tts_busy') localType = 'busy'; } catch {} lastReason = localType; }
          else {
            const audio = await readBounded(localResponse.body && typeof localResponse.body.getReader === 'function' ? Readable.fromWeb(localResponse.body) : localResponse.body, MAX_AUDIO, localDeadline); if (!validAudio(audio, format)) throw Object.assign(new Error('audio_invalid'), { category: 'audio_invalid' });
            sendAudio(audio, format, 'gpt-sovits-mps', false); console.info(JSON.stringify({ run_id: runId, delivery_id: req.headers['x-amadeus-delivery-id'] || 'unknown', origin: req.headers['x-amadeus-origin'] || 'unknown', modality: 'voice', source: 'reply_envelope', tts_requested: true, tts_provider: 'gpt-sovits-mps', deadline_ms: deadlineMs, provider_ms: Date.now() - localStarted, channel_send_ms: Date.now() - started, final_status: 'success' })); return;
          }
        } catch (error) { lastReason = error?.category || (error?.name === 'AbortError' ? 'provider_timeout' : 'provider_unavailable'); }
      }
    } else lastReason = 'style_not_supported_by_gpt_sovits';
    for (const [index, model] of CLOUD_MODELS.entries()) {
      const attemptStarted = Date.now(); const budget = Math.min(cloudTimeoutMs, CLOUD_BUDGET_MS); const providerDeadline = Math.min(deadlineAt - RESERVE_MS, attemptStarted + budget);
      if (remainingMs(providerDeadline) <= 0) { lastReason = 'deadline_exceeded'; break; }
      const voiceId = model === CLOUD_MODELS[0] ? cloudVoiceId31 : cloudVoiceId30;
      try {
        const response = await fetchWithDeadline(fetchFn, endpoint, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${cloudKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(buildCloudRequest({ model, text: data.input, voiceId, emotion, format, style })) }, providerDeadline);
        if (!response.ok) { const classified = cloudError(response.status); if (!classified.fallback) { sendJson(classified.result.status, classified.result.body); console.info(JSON.stringify({ run_id: runId, delivery_id: req.headers['x-amadeus-delivery-id'] || 'unknown', origin: req.headers['x-amadeus-origin'] || 'unknown', modality: 'voice', source: 'reply_envelope', tts_requested: true, tts_provider: model, tts_attempt: index + 1, deadline_ms: deadlineMs, provider_ms: Date.now() - attemptStarted, final_status: 'failed', fallback_reason: classified.result.body.error.type })); return; } lastReason = classified.category; continue; }
        const raw = await readBounded(response.body && typeof response.body.getReader === 'function' ? Readable.fromWeb(response.body) : response.body, MAX_CLOUD_RESPONSE_BODY, providerDeadline);
        const audio = await normalizeCloudAudio(JSON.parse(raw.toString('utf8')), format, fetchFn, providerDeadline, spawnFn);
        if (!validAudio(audio, format)) throw Object.assign(new Error('audio_invalid'), { category: 'audio_invalid' });
        sendAudio(audio, format, 'cloud', 'cloud'); console.info(JSON.stringify({ run_id: runId, delivery_id: req.headers['x-amadeus-delivery-id'] || 'unknown', origin: req.headers['x-amadeus-origin'] || 'unknown', modality: 'voice', source: 'reply_envelope', tts_requested: true, tts_provider: model, tts_attempt: index + 1, deadline_ms: deadlineMs, provider_ms: Date.now() - attemptStarted, channel_send_ms: Date.now() - started, final_status: 'success', fallback_reason: lastReason })); return;
      } catch (error) { const classified = classifyCloudFailure(error); lastReason = classified.category; }
    }
    const status = lastReason === 'deadline_exceeded' ? 504 : 503;
    sendJson(status, failure(status, lastReason).body); console.info(JSON.stringify({ run_id: runId, delivery_id: req.headers['x-amadeus-delivery-id'] || 'unknown', origin: req.headers['x-amadeus-origin'] || 'unknown', modality: 'voice', source: 'reply_envelope', tts_requested: true, deadline_ms: deadlineMs, final_status: 'failed', fallback_reason: lastReason }));
  });
}

if (process.argv[1]?.endsWith('/tts-bridge.mjs')) {
  const fs = await import('node:fs');
  const read = (key, name, options) => { const path = process.env[key]; if (!path) throw new Error(`${name}_file_required`); const stat = fs.lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error(`${name}_file_unprotected`); return readProtected(path, name, options); };
  const stylePath = process.env.AMADEUS_TTS_STYLE_FILE; const style = stylePath ? JSON.parse(fs.readFileSync(stylePath, 'utf8')) : DEFAULT_STYLE;
  const server = createTtsServer({ bridgeKey: read('AMADEUS_TTS_BRIDGE_KEY_FILE', 'tts_bridge_key', { min: 32 }), cloudKey: read('AMADEUS_TTS_CLOUD_API_KEY_FILE', 'tts_cloud_api_key', { min: 20 }), cloudVoiceId31: read('AMADEUS_TTS_CLOUD_VOICE_ID_31_FILE', 'tts_cloud_voice_id_31', { min: 8, max: 256 }), cloudVoiceId30: read('AMADEUS_TTS_CLOUD_VOICE_ID_FILE', 'tts_cloud_voice_id', { min: 8, max: 256 }), localKey: read('AMADEUS_TTS_LOCAL_KEY_FILE', 'tts_local_key', { min: 32 }), cloudUrl: process.env.AMADEUS_TTS_CLOUD_URL, localUrl: process.env.AMADEUS_TTS_LOCAL_URL || 'http://host.docker.internal:19871/v1/audio/speech', style });
  const port = Number(process.env.AMADEUS_TTS_BRIDGE_PORT || DEFAULT_PORT); server.listen(port, '127.0.0.1', () => console.info(`tts bridge listening on container loopback port=${port}`));
}
