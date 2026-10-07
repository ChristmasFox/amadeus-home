#!/usr/bin/env node
// 9Router 0.5.95 has the stable selfhosted-TTS options hook, but drops
// options.style before calling the OpenAI-compatible endpoint. Keep this
// narrow patch pinned to that compiled bundle shape and fail closed on drift.
import { chmod, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MARKER = 'amadeus-9router-selfhosted-tts-style-v1';
const VERSION = '0.5.95';
const SIGNATURE = '"selfhosted-tts"';

async function filesUnder(root) {
  const output = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && path.endsWith('.js')) output.push(path);
    }
  }
  await walk(root);
  return output;
}

export function patchSource(source) {
  if (source.includes(MARKER)) return source;
  if (!source.includes(SIGNATURE)) throw new Error('selfhosted_tts_provider_anchor_missing');
  const before = 'async synthesize(a,b,c,e="mp3"){';
  const after = 'async synthesize(a,b,c,e="mp3",k={}){';
  if (source.split(before).length - 1 !== 1) throw new Error('selfhosted_tts_signature_drift');
  let result = source.replace(before, after);
  const bodyBefore = 'input:a,response_format:e})';
  const bodyAfter = 'input:a,response_format:e,...k?.style?{style:k.style}:{} })';
  if (result.split(bodyBefore).length - 1 !== 1) throw new Error('selfhosted_tts_body_anchor_drift');
  result = result.replace(bodyBefore, bodyAfter);
  return `/* ${MARKER} package=${VERSION} */\n${result}`;
}

async function main() {
  const root = process.argv[process.argv.indexOf('--root') + 1];
  if (!root) throw new Error('usage: patch-selfhosted-tts-style.mjs --root PATH');
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (packageJson.version !== VERSION) throw new Error(`9router_version_mismatch:${packageJson.version}`);
  const candidates = [];
  for (const path of await filesUnder(root)) {
    const source = await readFile(path, 'utf8');
    if (source.includes(MARKER)) { console.log(`9ROUTER_TTS_STYLE=already-patched:${path}`); return; }
    if (source.includes(SIGNATURE) && source.includes('input:a,response_format:e})')) candidates.push({ path, source });
  }
  if (candidates.length !== 1) throw new Error(`selfhosted_tts_bundle_count:${candidates.length}`);
  const { path, source } = candidates[0];
  const patched = patchSource(source);
  const mode = (await stat(path)).mode & 0o777;
  await writeFile(path, patched);
  await chmod(path, mode);
  console.log(`9ROUTER_TTS_STYLE=patched:${path}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
