#!/usr/bin/env node
import assert from 'node:assert/strict';
import { patchProviderSource, patchSettingsSource, MARKER } from './patch-openclaw-tts-emotion.mjs';

const provider = `function readSpeechOverrides(overrides) {\n\tif (!overrides) return {};\n\treturn {\n\t\tmodel: normalizeOptionalString(overrides.model ?? overrides.modelId),\n\t\tvoice: normalizeOptionalString(overrides.voice ?? overrides.voiceId),\n\t\tspeed: asFiniteNumber(overrides.speed)\n\t};\n}\nfunction parseDirectiveToken(ctx, providerConfigKey) {\n\tconst compactProviderKey = providerConfigKey.replace(/[^a-z0-9]+/giu, '').toLowerCase();\n\tswitch (ctx.key) {\n\t\tcase "model":\n\t\tcase "model_id": return { handled: true };\n\t}\n}\n\t\t\tconst speed = overrides.speed ?? config.speed;\nbody = { response_format: responseFormat,\n\t\t\t\t\t...speed == null ? {} : { speed },\n};`;
const patched = patchProviderSource(provider);
assert.match(patched, new RegExp(MARKER));
assert.match(patched, /case "emotion"/);
assert.match(patched, /case "mood"/);
assert.match(patched, /invalid_emotion/);
assert.match(patched, /\.\.\.style == null \? \{\} : \{ style \}/);
assert.equal(patchProviderSource(patched), patched);

const settings = 'function resolveModelOverridePolicy(Ot){if(!(Ot?.enabled??!0))return{enabled:!1,allowText:!1,allowProvider:!1,allowVoice:!1,allowModelId:!1,allowSeed:!1};return{enabled:!0,allowText:!0,allowProvider:!1,allowVoice:!0,allowModelId:!0,allowSeed:allow(Ot?.allowSeed)}}';
const patchedSettings = patchSettingsSource(settings);
assert.match(patchedSettings, /allowEmotion/);
assert.equal(patchSettingsSource(patchedSettings), patchedSettings);
console.log('OPENCLAW_TTS_EMOTION_TEST=passed');
