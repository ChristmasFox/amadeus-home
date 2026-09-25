#!/usr/bin/env node
// Pinned OpenClaw 2026.9.4 contract: Chinese summary + Japanese kanji/kana text + matching Japanese speech.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = join(process.cwd(), 'node_modules/.pnpm/openclaw@2026.9.4/node_modules/openclaw/dist');
const file = (await readdir(dist)).find((name) => /^directives-.*\.mjs$/u.test(name));
assert.ok(file, 'pinned OpenClaw directive parser missing');
const skill = await readFile(join(process.cwd(), 'plugins/amadeus/skills/voice-reply/SKILL.md'), 'utf8');
assert.match(skill, /^description: REQUIRED for every inbound voice note: answer with one Japanese voice reply, one visible Japanese kanji-kana line, and one visible Chinese text summary\.$/mu);
assert.match(skill, /around 100 words as a soft upper guideline, not a target or a requirement/u);
assert.match(skill, /existing 120-second WhatsApp voice\/TTS window/u);
assert.match(skill, /under about 150 Japanese characters; this is guidance, not a hard cap/u);
assert.match(skill, /中文：<one faithful, concise Chinese sentence summarizing the answer>\n\n日本語：/u);
assert.match(skill, /never omit a safety-critical warning/iu);
assert.match(skill, /spoken audio MUST be\s+Japanese/u);
assert.match(skill, /even if the user explicitly asks for a Chinese\s+spoken reply/u);
assert.match(skill, /preserve the\s+existing ordinary text-message behavior, including the user's explicit\s+language request/u);
const module = await import(pathToFileURL(join(dist, file)));
const parse = module.n ?? module.parseTtsDirectives;
assert.equal(typeof parse, 'function');
const config = { enabled: true, allowText: true, allowProvider: false,
  allowVoice: false, allowModelId: false, allowVoiceSettings: false,
  allowNormalization: false, allowSeed: false };
const japanese = '少し待って。結論を先に言うわ。';
const chinese = '中文：稍等，我会先说结论。';
const japaneseLine = `日本語：${japanese}`;
assert.match(japaneseLine, /[\u4e00-\u9fff]/u, 'visible Japanese uses kanji');
assert.match(japaneseLine, /[\u3040-\u30ff]/u, 'visible Japanese uses kana');
const parsed = parse(`${chinese}\n\n${japaneseLine}\n[[tts:text]]${japanese}[[/tts:text]]`, config, { cfg: {} });
assert.equal(parsed.cleanedText.trim(), `${chinese}\n\n${japaneseLine}`);
assert.equal(parsed.ttsText, japanese);
assert.equal(parsed.ttsText, japaneseLine.slice('日本語：'.length), 'speech exactly matches visible Japanese text');
assert.equal(parsed.hasDirective, true);
const ordinaryTyped = parse('好的，我用中文回答。', config, { cfg: {} });
assert.equal(ordinaryTyped.cleanedText, '好的，我用中文回答。');
assert.equal(ordinaryTyped.ttsText, undefined);
console.log('OPENCLAW_BILINGUAL_KANJI_KANA_TTS_DIRECTIVE=passed');
