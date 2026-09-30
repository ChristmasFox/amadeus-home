#!/usr/bin/env node
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const MARKER = 'amadeus-media-json-cleanup-v1';
const ROOT = process.argv[2];
if (!ROOT || process.argv.length !== 3) throw new Error('usage: patch-openclaw-media-json-cleanup.mjs <core-root>');

async function findParseBundle(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isFile() && /^parse-.*\.mjs$/u.test(entry.name)) {
      const text = await readFile(path, 'utf8');
      if (text.includes('function splitMediaFromOutput(raw, options = {})') && text.includes('const visibleText = keptLines.join')) return path;
    }
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      const found = await findParseBundle(path);
      if (found) return found;
    }
  }
  return null;
}

const path = await findParseBundle(ROOT);
if (!path) throw new Error('pinned media parse bundle missing');
const original = await readFile(path, 'utf8');
if (original.includes(MARKER)) {
  console.log('MEDIA_JSON_CLEANUP=already-applied');
  process.exit(0);
}
const before = 'const visibleText = keptLines.join("\\n").replace(/^(?:[ \\t]*\\n)+/, "");';
if (original.split(before).length !== 2) throw new Error(`media parse anchor changed in ${path}`);
const after = 'const visibleText = keptLines.join("\\n").replace(/^(?:[ \\t]*\\n)+/, "");\n\tconst visibleTextWithoutStructuredTail = foundMediaToken ? visibleText.replace(/\\n\\s*\\{\\s*"(?:visibleText|modality)"\\s*:[\\s\\S]*\\}\\s*$/u, "") : visibleText;';
const replacement = original.replace(before, `${after}\n// ${MARKER}`)
  .replace('const audioTagResult = options.extractAudioDirectives === false ? {\n\t\ttext: visibleText,', 'const audioTagResult = options.extractAudioDirectives === false ? {\n\t\ttext: visibleTextWithoutStructuredTail,')
  .replace(': parseAudioTag(visibleText);', ': parseAudioTag(visibleTextWithoutStructuredTail);');
if (replacement === original) throw new Error(`media parse replacement failed in ${path}`);
await writeFile(path, replacement);
console.log('MEDIA_JSON_CLEANUP=applied');
