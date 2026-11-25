#!/usr/bin/env node
/**
 * Keep WhatsApp account-scoped group keys out of OpenClaw's generic thread
 * suffix parser so the configured group reset policy applies to them.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MARKER = 'amadeus-whatsapp-account-session-suffix-v1';
export const PIN = Object.freeze({
  version: '2026.9.4',
  module: 'session-key-PQkfotIJ.mjs',
  moduleSha256: 'e3087bc0c612c52d1530883abc6bee9cc6dc17b8f06fd8ac139902f559fae054',
  workerModule: 'worker/worker.mjs',
  workerModuleSha256: 'a31ff458309426a6be4ba9d8a5052cbeef3e18feb0e6064fde5908e682e444cf',
});

const PARSE_THREAD_ANCHOR = [
  '\tconst markerIndex = normalizeLowercaseStringOrEmpty(raw).lastIndexOf(":thread:");',
  '\tconst baseSessionKey = markerIndex === -1 ? raw : raw.slice(0, markerIndex);',
  '\tconst threadIdRaw = markerIndex === -1 ? void 0 : raw.slice(markerIndex + 8);',
].join('\n');

const ACCOUNT_SUFFIX_PATCH = [
  '\tconst markerIndex = normalizeLowercaseStringOrEmpty(raw).lastIndexOf(":thread:");',
  '\tconst threadIdRaw = markerIndex === -1 ? void 0 : raw.slice(markerIndex + 8);',
  `\t// ${MARKER}`,
  '\tconst isWhatsAppAccountSessionSuffix = markerIndex !== -1 &&',
  '\t\t/^agent:[^:]+:whatsapp:group:[^:]+@g\\.us$/iu.test(raw.slice(0, markerIndex)) &&',
  '\t\t/^whatsapp-account-[^:]+$/iu.test(raw.slice(markerIndex + 8));',
  '\tif (isWhatsAppAccountSessionSuffix) return { baseSessionKey: raw, threadId: void 0 };',
  '\tconst baseSessionKey = markerIndex === -1 ? raw : raw.slice(0, markerIndex);',
].join('\n');

function replaceOnce(source, find, replacement, label) {
  const count = source.split(find).length - 1;
  if (count !== 1) throw new Error(`${label} anchor count=${count}; refusing to patch`);
  return source.replace(find, replacement);
}

export function patchSessionKeySource(original) {
  if (original.includes(MARKER)) {
    if (!original.includes('isWhatsAppAccountSessionSuffix') || !original.includes('/^whatsapp-account-[^:]+$/iu.test')) {
      throw new Error('incomplete WhatsApp account session suffix patch');
    }
    return original;
  }
  return replaceOnce(original, PARSE_THREAD_ANCHOR, ACCOUNT_SUFFIX_PATCH, 'thread suffix parser');
}

const WORKER_PARSE_THREAD_ANCHOR = 'function parseThreadSessionSuffix(Ot){let Zt=normalizeOptionalString(Ot);if(!Zt)return{baseSessionKey:void 0,threadId:void 0};let _n=normalizeLowercaseStringOrEmpty(Zt).lastIndexOf(`:thread:`);return{baseSessionKey:_n===-1?Zt:Zt.slice(0,_n),threadId:normalizeOptionalString(_n===-1?void 0:Zt.slice(_n+8))}}';
const WORKER_ACCOUNT_SUFFIX_PATCH = [
  '/* ' + MARKER + ' */function parseThreadSessionSuffix(Ot){let Zt=normalizeOptionalString(Ot);if(!Zt)return{baseSessionKey:void 0,threadId:void 0};let _n=normalizeLowercaseStringOrEmpty(Zt).lastIndexOf(`:thread:`);',
  'let accountSuffix=_n!==-1&&/^agent:[^:]+:whatsapp:group:[^:]+@g\\.us$/iu.test(Zt.slice(0,_n))&&/^whatsapp-account-[^:]+$/iu.test(Zt.slice(_n+8));',
  'if(accountSuffix)return{baseSessionKey:Zt,threadId:void 0};return{baseSessionKey:_n===-1?Zt:Zt.slice(0,_n),threadId:normalizeOptionalString(_n===-1?void 0:Zt.slice(_n+8))}}',
].join('');

export function patchWorkerSessionKeySource(original) {
  if (original.includes(MARKER)) {
    if (!original.includes('let accountSuffix=') || !original.includes('/^whatsapp-account-[^:]+$/iu.test')) {
      throw new Error('incomplete worker WhatsApp account session suffix patch');
    }
    return original;
  }
  return replaceOnce(original, WORKER_PARSE_THREAD_ANCHOR, WORKER_ACCOUNT_SUFFIX_PATCH, 'worker thread suffix parser');
}

function atomicWrite(target, content) {
  const mode = fs.statSync(target).mode & 0o777;
  const temporary = `${target}.whatsapp-session-tmp-${process.pid}`;
  fs.writeFileSync(temporary, content);
  fs.chmodSync(temporary, mode);
  fs.renameSync(temporary, target);
}

function main(argv = process.argv.slice(2)) {
  let coreRoot;
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--core-root') coreRoot = argv[++index];
    else if (arg === '--apply') apply = true;
    else throw new Error(`unknown option ${arg}`);
  }
  if (!coreRoot || !path.isAbsolute(coreRoot)) throw new Error('--core-root must be an absolute path');
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(coreRoot, '..', 'package.json'), 'utf8'));
  if (packageJson.version !== PIN.version) throw new Error(`openclaw_version_mismatch:${packageJson.version}`);
  const targets = [
    { relative: PIN.module, sha256: PIN.moduleSha256, patch: patchSessionKeySource },
    { relative: PIN.workerModule, sha256: PIN.workerModuleSha256, patch: patchWorkerSessionKeySource },
  ];
  for (const target of targets) {
    const file = path.join(coreRoot, target.relative);
    const original = fs.readFileSync(file, 'utf8');
    const digest = createHash('sha256').update(original).digest('hex');
    if (digest !== target.sha256 && !original.includes(MARKER)) throw new Error(`pinned module digest mismatch: ${target.relative}`);
    const patched = target.patch(original);
    if (apply && patched !== original) atomicWrite(file, patched);
  }
  console.log(`OPENCLAW_WHATSAPP_ACCOUNT_SESSION=${apply ? 'applied' : 'patchable'} modules=${targets.length}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    main();
  } catch (error) {
    console.error(`OPENCLAW_WHATSAPP_ACCOUNT_SESSION=failed ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
