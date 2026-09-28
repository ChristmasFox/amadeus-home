#!/usr/bin/env node
// OpenClaw 2026.9.4 bounded Kurisu emotion transport patch.
// It is deliberately limited to the pinned provider/runtime bundle shapes.
import { chmod, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MARKER = 'amadeus-openclaw-bounded-emotion-style-v1';
const EMOTIONS = 'default|irritated|embarrassed|angry|sarcastic|soft|sad';

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label} anchor count=${count}`);
  return source.replace(before, after);
}

export function patchProviderSource(original) {
  if (original.includes(MARKER)) return original;
  let result = original;
  result = replaceOnce(result,
    'speed: asFiniteNumber(overrides.speed)\n\t};',
    `speed: asFiniteNumber(overrides.speed),\n\t\tstyle: normalizeOptionalLowercaseString(overrides.style ?? overrides.emotion)\n\t};`,
    'speech override style');
  result = replaceOnce(result,
    '\t\tcase "model":\n\t\tcase "model_id":',
    `\t\tcase "emotion":\n\t\t\tif (!ctx.policy.allowEmotion) return { handled: true };\n\t\t\tif (!new Set([${EMOTIONS.split('|').map((v) => JSON.stringify(v)).join(', ')}]).has(ctx.value)) return { handled: true, warnings: ["invalid_emotion"] };\n\t\t\treturn { handled: true, overrides: { style: ctx.value } };\n\t\tcase "model":\n\t\tcase "model_id":`,
    'speech emotion directive');
  result = replaceOnce(result,
    '\t\t\tconst speed = overrides.speed ?? config.speed;\n',
    '\t\t\tconst speed = overrides.speed ?? config.speed;\n\t\t\tconst style = overrides.style;\n',
    'speech style local');
  result = replaceOnce(result,
    '\t\t\t\t\t...speed == null ? {} : { speed },\n',
    '\t\t\t\t\t...speed == null ? {} : { speed },\n\t\t\t\t\t...style == null ? {} : { style },\n',
    'speech style body');
  return `// ${MARKER} provider-emotions=${EMOTIONS}\n${result}`;
}

export function patchSettingsSource(original) {
  if (original.includes(MARKER)) return original;
  let result = original;
  if (result.includes('allowSeed:!1')) {
    result = replaceOnce(result, 'allowSeed:!1', 'allowSeed:!1,allowEmotion:!1', 'disabled emotion policy');
  } else {
    result = replaceOnce(result, 'allowSeed: false', 'allowSeed: false,\n\t\tallowEmotion: false', 'disabled emotion policy');
  }
  if (result.includes('allowSeed:allow(Ot?.allowSeed)')) {
    result = replaceOnce(result, 'allowSeed:allow(Ot?.allowSeed)', 'allowSeed:allow(Ot?.allowSeed),allowEmotion:!0', 'enabled emotion policy');
  } else {
    result = replaceOnce(result, 'allowSeed: allow(overrides?.allowSeed)', 'allowSeed: allow(overrides?.allowSeed),\n\t\tallowEmotion: true', 'enabled emotion policy');
  }
  return `// ${MARKER} settings-emotions=${EMOTIONS}\n${result}`;
}

async function findFiles(root, pattern) {
  const out = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && pattern.test(entry.name)) out.push(path);
    }
  }
  await walk(root);
  return out;
}

async function patchFile(path, fn) {
  const source = await readFile(path, 'utf8');
  const patched = fn(source);
  if (patched === source) return false;
  await writeFile(path, patched);
  await chmod(path, (await stat(path)).mode & 0o777);
  return true;
}

async function main() {
  const index = process.argv.indexOf('--core-root');
  const root = index >= 0 ? process.argv[index + 1] : undefined;
  if (!root) throw new Error('usage: patch-openclaw-tts-emotion.mjs --core-root PATH');
  const providers = (await findFiles(root, /^openai-compatible-speech-provider-.*\.mjs$/u)).filter((p) => !p.includes('/worker/'));
  if (providers.length !== 1) throw new Error(`openai_compatible_provider_count:${providers.length}`);
  const settings = (await findFiles(root, /^tts-settings-.*\.mjs$/u)).filter((p) => !p.includes('/worker/'));
  if (settings.length !== 1) throw new Error(`tts_settings_count:${settings.length}`);
  const providerChanged = await patchFile(providers[0], patchProviderSource);
  const settingsChanged = await patchFile(settings[0], patchSettingsSource);
  console.log(`OPENCLAW_TTS_EMOTION=${providerChanged || settingsChanged ? 'patched' : 'already-patched'}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
