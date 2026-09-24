#!/usr/bin/env node
// Pinned @openclaw/whatsapp 2026.9.4: fail closed on an untranscribed direct voice note.
// The channel's existing platform.reply remains the only sender; no Agent turn is created.
import { readdir, readFile, rename, stat, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';

const MARKER = 'amadeus-voice-asr-failure-v1';
const ROOT = process.argv[2];
if (!ROOT || process.argv.length !== 3) throw new Error('usage: patch-openclaw-voice-failure.mjs <whatsapp-projects-root>');

async function findMonitor(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isFile() && /^monitor-.*\.js$/u.test(entry.name)) {
      const text = await readFile(path, 'utf8');
      if (text.includes('function prepareWhatsAppInboundContext')) return path;
    }
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      const child = await findMonitor(path);
      if (child) return child;
    }
  }
  return null;
}

const path = await findMonitor(ROOT);
if (!path) throw new Error('pinned WhatsApp monitor missing');
const original = await readFile(path, 'utf8');
if (original.includes(MARKER)) {
  console.log('VOICE_FAILURE_PATCH=already-applied');
  process.exit(0);
}
const anchor = '\tconst msgForAgent = audioTranscript !== void 0 ? {';
if (original.split(anchor).length !== 2) throw new Error('pinned WhatsApp audio preflight anchor changed');
const inserted = `\t// ${MARKER}: do not pass null/failed transcripts to the Agent as user speech.
\t// Only an admitted direct voice-note uses this short transport-level reply.
\tif (hasAudioBody && (!audioTranscript || typeof audioTranscript !== "string" || !audioTranscript.trim()) && conversationKind !== "group" && admission.ingress.admission === "dispatch") {
\t\tawait params.msg.platform.reply("抱歉，这条语音暂时没能识别。请重新发送，或直接发文字。", void 0);
\t\treturn true;
\t}
`;
const mode = (await stat(path)).mode & 0o777;
const temporary = `${path}.voice-patch-${process.pid}`;
await writeFile(temporary, original.replace(anchor, inserted + anchor));
await chmod(temporary, mode);
await rename(temporary, path);
console.log('VOICE_FAILURE_PATCH=applied');
