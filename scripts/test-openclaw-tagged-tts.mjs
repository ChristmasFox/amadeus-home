#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { patchTtsSource, REPLY_ENVELOPE_TTS_MARKER } from './patch-openclaw-whatsapp-voice-lifecycle.mjs';

const fixture = `async function maybeApplyTtsToPayloadCore(params, persistTtsAudio) {
\tif (!isSpeechRuntimeAvailable()) return applyExplicitSpeechVisibleFallback(params.payload, params.channel);
\tif (params.payload.isCompactionNotice) return params.payload;
\tconst cfg = resolveTtsRuntimeConfig(params.cfg);
\tconst { autoMode, config, prefsPath } = resolveTtsSettingsSnapshot({ cfg });
\tconst ttsMetadata = getReplyPayloadMetadata(params.payload);
\tif (isVerbose()) { logVerbose("tts"); }
\tconst trimmedCleaned = directives.cleanedText.trim();
\tconst visibleText = trimmedCleaned.length > 0 ? trimmedCleaned : "";
\tconst explicitTtsText = directives.ttsText?.trim() || "";
\tconst ttsText = explicitTtsText || visibleText;
\tconst nextPayload = { ...params.payload };
\tif (!explicitTts && autoMode === "tagged" && !directives.hasDirective) return nextPayload;
\tif (reply.hasMedia || hasLegacyFinalMediaDirective(text)) return nextPayload;
\tconst maxLength = getTtsMaxLength(prefsPath);
\tlet textForAudio = ttsText;
\tconst ttsStart = Date.now();
\tif (result.success && result.audioPath) {
\t\tconst payloadWithAudio = { ...nextPayload, mediaUrl: result.audioPath };
\t\treturn nextPayload.text?.trim() ? markReplyPayloadAsTtsSupplement(payloadWithAudio) : payloadWithAudio;
\t}
\treturn applyExplicitSpeechVisibleFallback(nextPayload, params.channel, explicitTtsText);
}`;
const patched = patchTtsSource(fixture);
assert.match(patched, new RegExp(REPLY_ENVELOPE_TTS_MARKER));
assert.match(patched, /resolveAmadeusReplyEnvelope\(params\)/u);
assert.match(patched, /const ttsText = envelope\.speechText\?\.trim\(\) \|\| ""/u);
assert.doesNotMatch(patched, /trimmedCleaned|parseTtsDirectives|resolveTtsDirectiveFacts|normalizeSpeechText|getTtsMaxLength|summarizeText|hasLegacyFinalMediaDirective|markReplyPayloadAsTtsSupplement|applyExplicitSpeechVisibleFallback/iu);
assert.doesNotMatch(patched, /\[\[|legacy|recover/iu);
assert.equal(patchTtsSource(patched), patched);

const runtimeDist = join(process.cwd(), 'node_modules/.pnpm/openclaw@2026.9.4/node_modules/openclaw/dist');
if (existsSync(runtimeDist)) {
  const runtimeName = readdirSync(runtimeDist).find((name) => /^runtime-api-.*\.mjs$/u.test(name)
    && readFileSync(join(runtimeDist, name), 'utf8').includes('async function maybeApplyTtsToPayloadCore'));
  if (runtimeName) {
    const runtime = patchTtsSource(readFileSync(join(runtimeDist, runtimeName), 'utf8'));
    const start = runtime.indexOf('async function maybeApplyTtsToPayloadCore');
    const end = runtime.indexOf('//#endregion', start);
    assert.ok(start >= 0 && end > start, 'pinned runtime TTS function must remain patchable');
    const core = runtime.slice(start, end);
    for (const token of ['trimmedCleaned', 'parseTtsDirectives', 'resolveTtsDirectiveFacts', 'normalizeSpeechText', 'getTtsMaxLength', 'summarizeText', 'hasLegacyFinalMediaDirective', 'ttsSupplement', 'audioAsVoice']) {
      assert.equal(core.includes(token), false, `ReplyEnvelope TTS patch retained legacy token: ${token}`);
    }
    assert.match(core, /resolveAmadeusReplyEnvelope\(params\)/u);
  }
}
console.log('OPENCLAW_REPLY_ENVELOPE_TTS=passed');
