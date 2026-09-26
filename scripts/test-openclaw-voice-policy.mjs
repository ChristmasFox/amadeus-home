#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveAmadeusJapaneseSpeechText, ensureAmadeusJapaneseVoiceText } from './openclaw-voice-policy.mjs';
import { resolveVoiceFollowup, whatsappHelpers, whatsappIngressQueueHelpers } from './openclaw-voice-lease.mjs';
import { WHATSAPP_MARKER, WHATSAPP_INGRESS_QUEUE_MARKER } from './openclaw-voice-markers.mjs';

const japanese = '少し待って。結論を先に言うわ。';
const chinese = '中文：先说结论。';
assert.equal(resolveAmadeusJapaneseSpeechText(`${chinese}\n日本語：古い文です。\n日本語：${japanese}`), japanese);
assert.equal(resolveAmadeusJapaneseSpeechText(chinese, chinese), '', 'Chinese-only audio fails closed');
assert.equal(resolveAmadeusJapaneseSpeechText('', japanese), japanese, 'Japanese-only directive is usable');
assert.equal(resolveAmadeusJapaneseSpeechText('', `日本語：${japanese}`), '', 'structured fallback is not speech');
const typed = { text: chinese, mediaUrl: 'file://audio.mp3', audioAsVoice: true, spokenText: japanese };
assert.equal(ensureAmadeusJapaneseVoiceText(typed, false), typed, 'typed session remains untouched');
const voice = ensureAmadeusJapaneseVoiceText(typed, true);
assert.equal(voice.text, `${chinese}\n\n日本語：${japanese}`);
const rejected = ensureAmadeusJapaneseVoiceText({ ...typed, spokenText: chinese }, true);
assert.equal(rejected.mediaUrl, undefined, 'Chinese PTT removed');
assert.match(rejected.text, /日语语音暂时无法生成/u);
assert.equal(resolveVoiceFollowup(null, 'typed'), false);
assert.equal(resolveVoiceFollowup({ messageId: 'voice' }, 'voice'), false);
assert.equal(resolveVoiceFollowup({ messageId: 'voice' }, 'typed'), true);
assert.match(whatsappHelpers, new RegExp(WHATSAPP_MARKER));
assert.match(whatsappHelpers, /TIMEOUT_MS = 120000/u, 'timeout was not raised');
assert.match(whatsappIngressQueueHelpers, new RegExp(WHATSAPP_INGRESS_QUEUE_MARKER));
console.log('OPENCLAW_VOICE_PURE_POLICY=passed');
