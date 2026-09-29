#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const skill = await readFile(new URL('../plugins/amadeus/skills/voice-reply/SKILL.md', import.meta.url), 'utf8');
assert.match(skill, /^description: REQUIRED for a verified inbound voice note, or when a typed user explicitly asks for this reply to be sent as voice\/audio\./mu);
assert.match(skill, /typed output\s+intent semantically/u);
assert.match(skill, /A typed request never impersonates the\s+verified inbound WhatsApp voice lease/u);
assert.match(skill, /ReplyEnvelope delivery path owns the sole TTS/u);
assert.match(skill, /visibleText/u);
assert.match(skill, /speechText/u);
assert.match(skill, /spoken audio MUST be\s+Japanese/u);
assert.match(skill, /even if the user asks\s+for Chinese speech/u);
assert.match(skill, /For typed input that does not explicitly request voice output, return/u);
assert.doesNotMatch(skill, /\[\[|tts\.auto|legacy/iu);

const voice = {
  visibleText: '中文：稍等，我会先说结论。\n\n日本語：少し待って。結論を先に言うわ。',
  speechText: '少し待って。結論を先に言うわ。',
  modality: 'voice',
  emotion: 'default',
};
assert.equal(voice.visibleText.split('\n')[0].startsWith('中文：'), true);
assert.equal(voice.visibleText.includes(`日本語：${voice.speechText}`), true);
assert.match(voice.speechText, /[\u3040-\u30ff]/u);
assert.equal(JSON.stringify(voice).includes('silent'), false);
const text = { visibleText: '好的，我用中文回答。', modality: 'text', emotion: 'default' };
assert.equal('speechText' in text, false);
console.log('OPENCLAW_BILINGUAL_REPLY_ENVELOPE=passed');
