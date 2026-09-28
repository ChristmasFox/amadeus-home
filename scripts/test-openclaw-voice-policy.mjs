#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveAmadeusJapaneseSpeechText, isAmadeusBilingualVoiceContract, ensureAmadeusJapaneseVoiceText, parseAmadeusReplyModalityMarker, resolveAmadeusReplyModalityForTts } from './openclaw-voice-policy.mjs';
import { resolveVoiceFollowup, whatsappHelpers, whatsappIngressQueueHelpers } from './openclaw-voice-lease.mjs';
import { WHATSAPP_MARKER, WHATSAPP_INGRESS_QUEUE_MARKER } from './openclaw-voice-markers.mjs';

const japanese = '少し待って。結論を先に言うわ。';
const chinese = '中文：先说结论。';
assert.equal(resolveAmadeusJapaneseSpeechText(`${chinese}\n日本語：古い文です。\n日本語：${japanese}`), japanese);
assert.equal(resolveAmadeusJapaneseSpeechText(chinese, chinese), '', 'Chinese-only audio fails closed');
assert.equal(resolveAmadeusJapaneseSpeechText('', japanese), japanese, 'Japanese-only directive is usable');
assert.equal(resolveAmadeusJapaneseSpeechText('', `日本語：${japanese}`), '', 'structured fallback is not speech');
assert.equal(isAmadeusBilingualVoiceContract(`${chinese}\n\n日本語：${japanese}`), true, 'the exact bilingual voice contract is recoverable when the marker is missing');
assert.equal(isAmadeusBilingualVoiceContract('只用中文回答。'), false, 'ordinary Chinese text stays text-only');
assert.equal(isAmadeusBilingualVoiceContract(`${chinese}\n日本語：`), false, 'an empty Japanese line is not a voice contract');
assert.deepEqual(parseAmadeusReplyModalityMarker(`[[amadeus:reply-modality=voice]]\n${chinese}`), {
  modality: 'voice',
  text: chinese,
  present: true,
}, 'model voice metadata is parsed and stripped from the delivered payload');
assert.equal(parseAmadeusReplyModalityMarker(`${chinese}`).present, false, 'ordinary bilingual text has no implicit modality');
assert.equal(parseAmadeusReplyModalityMarker(`回答内容\n[[amadeus:reply-modality=default]]`).text, '回答内容\n', 'mid-payload metadata is stripped before delivery');
assert.equal(ensureAmadeusJapaneseVoiceText({ text: '[[amadeus:reply-modality=default]]\nNO_REPLY' }, false).text, undefined, 'a marked silent reply is suppressed before WhatsApp delivery');
const modalityGlobal = '__amadeusReplyModalityRuns20260928';
const previousModalityRegistry = globalThis[modalityGlobal];
globalThis[modalityGlobal] = new Map([
  ['run:typed-voice', { modality: 'voice', expiresAt: Date.now() + 60_000 }],
  ['run:expired', { modality: 'voice', expiresAt: Date.now() - 1 }],
]);
assert.equal(resolveAmadeusReplyModalityForTts({ runId: 'typed-voice' }), 'voice', 'only the current typed voice turn enables recovery');
assert.equal(resolveAmadeusReplyModalityForTts({ runId: 'ordinary-translation' }), 'default', 'ordinary turns keep default modality');
assert.equal(resolveAmadeusReplyModalityForTts({ runId: 'expired' }), 'default', 'expired turn state is discarded');
if (previousModalityRegistry === undefined) delete globalThis[modalityGlobal];
else globalThis[modalityGlobal] = previousModalityRegistry;
const typed = { text: chinese, mediaUrl: 'file://audio.mp3', audioAsVoice: true, spokenText: japanese };
assert.equal(ensureAmadeusJapaneseVoiceText(typed, false).text, `${chinese}\n\n日本語：${japanese}`, 'typed audio preserves visible text even without supplement metadata');
assert.equal(ensureAmadeusJapaneseVoiceText({ text: `[[amadeus:reply-modality=default]]\n${chinese}` }, false).text, chinese, 'modality metadata never reaches WhatsApp text delivery');
const taggedTyped = { ...typed, ttsSupplement: { spokenText: japanese } };
assert.equal(ensureAmadeusJapaneseVoiceText(taggedTyped, false).text, `${chinese}\n\n日本語：${japanese}`, 'tagged typed voice uses the same visible Japanese rule');
assert.equal(ensureAmadeusJapaneseVoiceText({ ...taggedTyped, ttsSupplement: { spokenText: chinese } }, false).mediaUrl, undefined, 'tagged typed Chinese audio fails closed');
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
