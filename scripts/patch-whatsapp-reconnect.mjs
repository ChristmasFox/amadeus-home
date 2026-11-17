#!/usr/bin/env node
// Keep transient WhatsApp reconnects alive after a long network outage.
import { readdir, readFile, stat, writeFile, chmod, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const marker = 'amadeus-whatsapp-transient-reconnect-v1';
export function patch(source) {
  if (source.includes(marker)) return source;
  const anchor = '\t\t...DEFAULT_RECONNECT_POLICY,\n\t\t...overrideConfig';
  if (source.split(anchor).length !== 2 || !source.includes('if (normalized.isLoggedOut) return {') || !source.includes('if (this.isNonRetryableStatus(normalized.statusCode)) return {') || !source.includes('this.reconnectPolicy.maxAttempts > 0 && this.reconnectAttempts >= this.reconnectPolicy.maxAttempts')) throw new Error('unsupported WhatsApp reconnect controller');
  return source.replace(anchor, `\t\t...DEFAULT_RECONNECT_POLICY,\n\t\tmaxAttempts: 0, // ${marker}: zero means unlimited transient retries\n\t\t...overrideConfig`);
}

async function find(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) found.push(...await find(path));
    else if (entry.isFile() && /^connection-controller-.*\.js$/.test(entry.name) && path.includes('/@openclaw/whatsapp/dist/') && (await readFile(path, 'utf8')).includes('function resolveReconnectPolicy(')) found.push(path);
  }
  return found;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = await find(process.argv[2]);
  if (files.length !== 1) throw new Error(`WhatsApp reconnect controller count: ${files.length}`);
  const file = files[0];
  const original = await readFile(file, 'utf8');
  const updated = patch(original);
  if (updated !== original) {
    const temp = `${file}.amadeus-${process.pid}`;
    await writeFile(temp, updated);
    await chmod(temp, (await stat(file)).mode & 0o777);
    await rename(temp, file);
  }
  console.log('WHATSAPP_TRANSIENT_RECONNECT=enabled');
}
