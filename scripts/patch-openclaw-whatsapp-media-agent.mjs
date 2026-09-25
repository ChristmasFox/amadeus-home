#!/usr/bin/env node
// Pinned @openclaw/whatsapp 2026.9.4: Baileys Node media upload calls
// https.request({agent}), not undici fetch({dispatcher}). Keep WebSocket agent
// and all other channel behavior unchanged.
import { chmod, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const MARKER = 'amadeus-whatsapp-http1-media-agent-v1';
const ROOT = process.argv[2];
if (!ROOT || process.argv.length !== 3) throw new Error('usage: patch-openclaw-whatsapp-media-agent.mjs <whatsapp-projects-root>');

async function findSocketModule(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isFile() && /^socket-close-.*\.js$/u.test(entry.name)) {
      const text = await readFile(path, 'utf8');
      if (text.includes('async function resolveEnvFetchDispatcher')) return path;
    }
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      const found = await findSocketModule(path);
      if (found) return found;
    }
  }
  return null;
}

const path = await findSocketModule(ROOT);
if (!path) throw new Error('pinned WhatsApp socket module missing');
const original = await readFile(path, 'utf8');
if (original.includes(MARKER)) {
  console.log('WHATSAPP_MEDIA_AGENT_PATCH=already-applied');
  process.exit(0);
}
const before = 'return proxyUrl ? createHttp1ProxyAgent({ uri: proxyUrl }) : createHttp1EnvHttpProxyAgent();';
if (original.split(before).length !== 2 || !original.includes('createNodeProxyAgent'))
  throw new Error('pinned WhatsApp media-agent anchor changed');
const after = `// ${MARKER}: Baileys Node upload uses https.request, requiring addRequest().\n\t\treturn createNodeProxyAgent({ mode: "explicit", proxyUrl: proxyUrl ?? envProxyUrl, protocol: "https" });`;
const temporary = `${path}.voice-media-agent-${process.pid}`;
const mode = (await stat(path)).mode & 0o777;
await writeFile(temporary, original.replace(before, after));
await chmod(temporary, mode);
await rename(temporary, path);
console.log('WHATSAPP_MEDIA_AGENT_PATCH=applied');
