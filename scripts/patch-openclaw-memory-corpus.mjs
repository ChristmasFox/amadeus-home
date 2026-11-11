#!/usr/bin/env node
/**
 * Version-pinned OpenClaw 2026.9.4 memory tool schema narrowing.
 *
 * The built-in memory_search / memory_get tools advertise corpus=wiki|all|sessions, and their descriptions invite
 * `corpus=wiki`. This deployment registers only the `memory` corpus (memory.search.sources=["memory"], no
 * memory-wiki plugin), so a model that picks `wiki` gets an empty `not-registered` result. The schema and the
 * description now offer only `memory`, so the model cannot select an unregistered corpus. A run-time fallback in the
 * amadeus plugin (plugins/amadeus/src/memory-corpus.ts) maps any other value to `memory` for a model that still sends one.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MARKER = 'amadeus-memory-corpus-memory-only-v1';
export const PIN = Object.freeze({
  version: '2026.9.4',
  module: 'memory-tool-contract-Bockpo-h.mjs',
  moduleSha256: '46d7eb57aea23332ef78cc66b5c0299457e129e14caa9bd09f4e10896a64b2d4',
});

const SEARCH_ENUM = 'enum: [\n\t\t\t\t"memory",\n\t\t\t\t"wiki",\n\t\t\t\t"all",\n\t\t\t\t"sessions"\n\t\t\t]';
const GET_ENUM = 'enum: [\n\t\t\t\t"memory",\n\t\t\t\t"wiki",\n\t\t\t\t"all"\n\t\t\t]';
const SEARCH_DESCRIBE_OLD = ' Optional \\`corpus=wiki\\` or \\`corpus=all\\` also searches registered compiled-wiki supplements. \\`corpus=memory\\` restricts hits to indexed memory files (excludes session transcript chunks from ranking). \\`corpus=sessions\\` restricts hits to the session corpus under the same visibility rules as session history tools.';
const SEARCH_DESCRIBE_NEW = ' Only the memory corpus is registered here: omit \\`corpus\\` or use \\`corpus=memory\\`. It works the same in group and direct chats. An empty result or a corpus warning does not mean nothing is remembered: retry with different keywords before concluding that.';
const GET_DESCRIBE_OLD = ' \\`corpus=wiki\\` reads registered compiled-wiki supplements.';
const GET_DESCRIBE_NEW = ' Only the memory corpus is registered here: omit \\`corpus\\` or use \\`corpus=memory\\`.';

function replaceOnce(source, find, replacement, label) {
  const count = source.split(find).length - 1;
  if (count !== 1) throw new Error(`pinned ${label} anchor count=${count}; refusing to patch`);
  return source.replace(find, replacement);
}

export function patchMemoryContractSource(original) {
  if (original.includes(MARKER)) {
    if (original.includes('"wiki"')) throw new Error('incomplete memory corpus patch');
    return original;
  }
  let result = replaceOnce(original, SEARCH_ENUM, 'enum: ["memory"]', 'search corpus enum');
  result = replaceOnce(result, GET_ENUM, 'enum: ["memory"]', 'get corpus enum');
  result = replaceOnce(result, SEARCH_DESCRIBE_OLD, SEARCH_DESCRIBE_NEW, 'search description');
  result = replaceOnce(result, GET_DESCRIBE_OLD, GET_DESCRIBE_NEW, 'get description');
  return replaceOnce(result, '//#region extensions/memory-core/src/memory-tool-contract.ts\n', `//#region extensions/memory-core/src/memory-tool-contract.ts\n// ${MARKER}\n`, 'region start');
}

function atomicWrite(target, content) {
  const mode = fs.statSync(target).mode & 0o777;
  const temporary = `${target}.corpus-tmp-${process.pid}`;
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
  const file = path.join(coreRoot, PIN.module);
  const original = fs.readFileSync(file, 'utf8');
  const digest = createHash('sha256').update(original).digest('hex');
  if (digest !== PIN.moduleSha256 && !original.includes(MARKER)) throw new Error(`pinned module digest mismatch: ${PIN.module}`);
  const patched = patchMemoryContractSource(original);
  if (apply && patched !== original) atomicWrite(file, patched);
  console.log(`OPENCLAW_MEMORY_CORPUS=${apply ? 'applied' : 'patchable'} module=${PIN.module}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    main();
  } catch (error) {
    console.error(`OPENCLAW_MEMORY_CORPUS=failed ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
