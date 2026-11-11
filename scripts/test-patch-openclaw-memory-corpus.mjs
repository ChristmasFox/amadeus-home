#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MARKER, PIN, patchMemoryContractSource } from './patch-openclaw-memory-corpus.mjs';

const runtimeRoot = path.resolve('node_modules/.pnpm/openclaw@2026.9.4/node_modules/openclaw/dist');
const original = fs.readFileSync(path.join(runtimeRoot, PIN.module), 'utf8');
assert.equal(createHash('sha256').update(original).digest('hex'), PIN.moduleSha256);

const patched = patchMemoryContractSource(original);
assert.equal(patched.split(MARKER).length - 1, 1);
assert.equal(patchMemoryContractSource(patched), patched, 'idempotent');
// Unregistered corpora are gone from the schema and from both descriptions.
assert.doesNotMatch(patched, /"wiki"|corpus=(wiki|all|sessions)|compiled-wiki/u);
assert.doesNotMatch(patched.slice(0, patched.indexOf("function resolveMemorySourceContract")), /"sessions"/u, "schema no longer lists sessions");
assert.equal(patched.split('enum: ["memory"]').length - 1, 2, 'search and get both offer only memory');
assert.match(patched, /corpus=memory/u);
assert.match(patched, /retry with different keywords/u);
// The real tool contract objects carry the narrowed schema (evaluate the patched module body).
const body = patched.replace(/^import .*$/gmu, '').replace(/export \{[^}]*\};?/u, '')
  + '\nreturn { MemorySearchSchema, MemoryGetSchema, MEMORY_SEARCH_TOOL_CONTRACT, MEMORY_GET_TOOL_CONTRACT };';
const contract = new Function('resolveSessionAgentIdStrict', 'resolveMemorySearchIndexConfig', body)(() => 'main', () => undefined);
assert.deepEqual(contract.MemorySearchSchema.properties.corpus.enum, ['memory']);
assert.deepEqual(contract.MemoryGetSchema.properties.corpus.enum, ['memory']);
assert.doesNotMatch(contract.MEMORY_SEARCH_TOOL_CONTRACT.describe({ search: 'memory files' }), /wiki|sessions/u);
assert.doesNotMatch(contract.MEMORY_GET_TOOL_CONTRACT.describe({ files: 'memory files' }), /wiki/u);
// Drift fails closed.
assert.throws(() => patchMemoryContractSource(original.replace('"wiki",\n\t\t\t\t"all",', '"wiki",\n\t\t\t\t"everything",')), /anchor count=0/u);
assert.throws(() => patchMemoryContractSource(patched.replace('enum: ["memory"]', 'enum: ["memory", "wiki"]')), /incomplete|anchor/u);
console.log('OPENCLAW_MEMORY_CORPUS_PATCH_TEST=passed');
