#!/usr/bin/env node
// Keep provider safety refusals terminal in the pinned 9Router image Combo.
// Sending the same prompt to another provider would be an unsafe moderation
// bypass. This patch is shape guarded and deliberately logs only the status.
import { chmod, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MARKER = 'amadeus-image-combo-safety-terminal-0.5.91';
const VERSION = '0.5.91';
const ANCHOR = 'let{shouldFallback:i,cooldownMs:j}=(0,d.hk)(b.status,f);';
const SAFETY_PATTERN = String.raw`(?:safety|moderation|content\s+policy|policy\s+(?:violation|refusal)|prompt\s+(?:blocked|rejected)|unsafe|disallowed|prohibited|responsible\s+ai|violat\w*\s+(?:guideline|policy)|copyright\s+restriction)`;

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

export function isImageSafetyFailure(status, message) {
  return new RegExp(SAFETY_PATTERN, 'iu').test(`${status ?? ''} ${message ?? ''}`);
}

export function patchImageComboSource(source) {
  if (source.includes(MARKER)) return source;
  if (source.split(ANCHOR).length - 1 !== 1) throw new Error('image_combo_safety_anchor_drift');
  const guard = `/* ${MARKER} */const amadeusSafetyRefusal=/${SAFETY_PATTERN}/iu.test(f);if(amadeusSafetyRefusal){g.warn("COMBO",\`Model \${e} failed (safety refusal; no fallback)\`,{status:b.status});return b;}`;
  return source.replace(ANCHOR, `${guard}${ANCHOR}`);
}

async function findCandidate(root) {
  const candidates = [];
  for (const path of await filesUnder(root)) {
    const source = await readFile(path, 'utf8');
    if (source.includes(MARKER) || source.includes(ANCHOR)) candidates.push({ path, source });
  }
  if (candidates.length !== 1) throw new Error(`image_combo_safety_bundle_count:${candidates.length}`);
  return candidates[0];
}

export async function install(root, mode = 'verify') {
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (packageJson.version !== VERSION) throw new Error(`9router_version_mismatch:${packageJson.version}`);
  const candidate = await findCandidate(root);
  const output = patchImageComboSource(candidate.source);
  if (mode === 'verify') {
    if (output !== candidate.source || !candidate.source.includes(MARKER)) throw new Error('image_combo_safety_not_installed');
    return candidate.path;
  }
  const permissions = (await stat(candidate.path)).mode & 0o777;
  await writeFile(candidate.path, output);
  await chmod(candidate.path, permissions);
  if (patchImageComboSource(await readFile(candidate.path, 'utf8')) !== output) throw new Error('image_combo_safety_verify_failed');
  return candidate.path;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[process.argv.indexOf('--root') + 1];
  if (!root) throw new Error('usage: patch-image-combo-safety.mjs --root PATH [--apply]');
  const path = await install(root, process.argv.includes('--apply') ? 'apply' : 'verify');
  console.log(`9ROUTER_IMAGE_COMBO_SAFETY=${process.argv.includes('--apply') ? 'installed' : 'verified'}:${path}`);
}
