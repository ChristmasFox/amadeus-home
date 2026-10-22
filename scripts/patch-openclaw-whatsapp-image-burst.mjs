#!/usr/bin/env node
// Pinned @openclaw/whatsapp 2026.9.4: a multi-image send arrives as one parent
// `albumMessage {expectedImageCount}` plus one image message per picture, each
// tagged `messageContextInfo.messageAssociation {MEDIA_ALBUM, parentMessageKey}`.
// Every image used to start its own turn (the phone also uploads them seconds
// apart). Hold only album children, keyed by their parent, until the expected
// count has arrived (short timeout as a fallback) and dispatch ONE turn with
// all images. Single images carry no association and are never delayed.
import { chmod, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER = 'amadeus-whatsapp-image-album-v3';
// Fallback only: the parent normally announces how many images to wait for.
export const ALBUM_QUIET_MS = 8000;
export const ALBUM_MAX_MS = 20_000;

const helpers = `// ${MARKER}
const AMADEUS_ALBUM_QUIET_MS = ${ALBUM_QUIET_MS};
const AMADEUS_ALBUM_MAX_MS = ${ALBUM_MAX_MS};
const amadeusAlbumParents = new Map();
function amadeusUnwrapMessage(message) {
	return message?.ephemeralMessage?.message ?? message?.viewOnceMessage?.message ?? message;
}
// Child images name their album; the parent message announces the expected count.
function amadeusAlbumIdOf(raw) {
	const association = amadeusUnwrapMessage(raw?.message)?.messageContextInfo?.messageAssociation;
	if (!association) return void 0;
	const type = association.associationType;
	if (type !== 1 && type !== "MEDIA_ALBUM") return void 0;
	const parentId = association.parentMessageKey?.id;
	return parentId ? \`\${raw.key?.remoteJid ?? ""}:\${parentId}\` : void 0;
}
function amadeusRememberAlbumParent(raw) {
	const album = amadeusUnwrapMessage(raw?.message)?.albumMessage;
	const id = raw?.key?.id;
	if (!album || !id) return;
	const expected = Number(album.expectedImageCount ?? 0) + Number(album.expectedVideoCount ?? 0);
	if (!(expected > 0)) return;
	const now = Date.now();
	for (const [key, value] of amadeusAlbumParents) if (now - value.at > 600000) amadeusAlbumParents.delete(key);
	amadeusAlbumParents.set(\`\${raw.key?.remoteJid ?? ""}:\${id}\`, { expected, at: now });
}
function amadeusIsAlbumChild(msg) {
	return Boolean(msg?.payload?.albumId) && Boolean(msg?.payload?.media);
}
function amadeusAlbumWindowMs(configured, startedAt, now) {
	return Math.max(configured, Math.max(1, Math.min(AMADEUS_ALBUM_QUIET_MS, startedAt + AMADEUS_ALBUM_MAX_MS - now)));
}
function amadeusPayloadMediaList(payload) {
	if (Array.isArray(payload?.mediaList) && payload.mediaList.length > 0) return payload.mediaList;
	return payload?.media ? [payload.media] : void 0;
}
`;

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label} anchor count=${count}`);
  return source.replace(before, after);
}

export function patchWhatsAppMonitorSource(original) {
  if (original.includes(MARKER)) return original;
  let result = replaceOnce(original, 'function createWhatsAppInboundMessageDebouncer(options) {', `${helpers}function createWhatsAppInboundMessageDebouncer(options) {`, 'debouncer helper insertion');
  result = replaceOnce(result, 'const pendingKeys = /* @__PURE__ */ new Map();', 'const pendingKeys = /* @__PURE__ */ new Map();\n\tconst amadeusAlbumState = /* @__PURE__ */ new Map();', 'album state');
  result = replaceOnce(result, '\t\tconst message = {\n\t\t\t...input,\n\t\t\tdebounceMs: options.resolveDebounceMs()\n\t\t};\n\t\tconst key = buildKey(message);', '\t\tconst configuredDebounceMs = options.resolveDebounceMs();\n\t\tconst message = {\n\t\t\t...input,\n\t\t\tdebounceMs: configuredDebounceMs\n\t\t};\n\t\tconst baseKey = buildKey(message);\n\t\tconst albumChild = Boolean(baseKey) && amadeusIsAlbumChild(input);\n\t\tconst key = albumChild ? `${baseKey}\\u0000album:${input.payload.albumId}` : baseKey;\n\t\tlet albumComplete = false;\n\t\tif (albumChild) {\n\t\t\tconst state = amadeusAlbumState.get(key) ?? { startedAt: Date.now(), count: 0 };\n\t\t\tstate.count++;\n\t\t\tamadeusAlbumState.set(key, state);\n\t\t\tconst expected = amadeusAlbumParents.get(input.payload.albumId)?.expected;\n\t\t\talbumComplete = expected !== void 0 && state.count >= expected;\n\t\t\tmessage.debounceMs = amadeusAlbumWindowMs(configuredDebounceMs, state.startedAt, Date.now());\n\t\t}', 'album child key and window');
  result = replaceOnce(result, '\t\tawait debouncer.enqueue(message);\n\t};', '\t\tawait debouncer.enqueue(message);\n\t\tif (albumComplete) {\n\t\t\tamadeusAlbumState.delete(key);\n\t\t\tawait debouncer.flushKey(key);\n\t\t}\n\t};', 'album complete flush');
  result = replaceOnce(result, 'for (const entry of entries) releaseKey(entry);', 'for (const entry of entries) {\n\t\t\t\treleaseKey(entry);\n\t\t\t\tif (entry.debounceKey) amadeusAlbumState.delete(entry.debounceKey);\n\t\t\t}', 'album state release');
  result = replaceOnce(result, '\t\t\t\t\t\t\t\t...last.payload,\n\t\t\t\t\t\t\t\tbody: combinedBody,', '\t\t\t\t\t\t\t\t...last.payload,\n\t\t\t\t\t\t\t\tmediaList: orderedEntries.flatMap((entry) => amadeusPayloadMediaList(entry.payload) ?? []),\n\t\t\t\t\t\t\t\tbody: combinedBody,', 'merged album media list');
  result = replaceOnce(result, 'const shouldDebounce = (msg) => shouldDebounceTextInbound({', 'const shouldDebounce = (msg) => amadeusIsAlbumChild(msg) || shouldDebounceTextInbound({', 'album debounce gate');
  result = replaceOnce(result, '\t\t\t\tchannelStructuredContext: channelStructuredContext.length > 0 ? channelStructuredContext : void 0,\n\t\t\t\tmedia\n\t\t\t},', '\t\t\t\tchannelStructuredContext: channelStructuredContext.length > 0 ? channelStructuredContext : void 0,\n\t\t\t\tmedia,\n\t\t\t\talbumId: media ? amadeusAlbumIdOf(msg) : void 0\n\t\t\t},', 'album id on inbound payload');
  result = replaceOnce(result, '\t\tfor (const msg of upsert.messages ?? []) {\n\t\t\trememberBaileysMessage(msg.key?.remoteJid, msg.key?.id, msg.message);', '\t\tfor (const msg of upsert.messages ?? []) {\n\t\t\tamadeusRememberAlbumParent(msg);\n\t\t\trememberBaileysMessage(msg.key?.remoteJid, msg.key?.id, msg.message);', 'album parent announcement');
  result = replaceOnce(result, 'const media = await toInboundMediaFactsWithMetadata(params.msg.payload.media ? [{\n\t\tpath: params.msg.payload.media?.path,\n\t\turl: params.msg.payload.media?.url ?? params.msg.payload.media?.path,\n\t\tcontentType: params.msg.payload.media?.type,\n\t\tkind: params.msg.payload.media?.kind\n\t}] : void 0,', 'const media = await toInboundMediaFactsWithMetadata(amadeusPayloadMediaList(params.msg.payload)?.map((item) => ({\n\t\tpath: item.path,\n\t\turl: item.url ?? item.path,\n\t\tcontentType: item.type,\n\t\tkind: item.kind\n\t})),', 'inbound media facts');
  return result;
}

async function findMonitorModules(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isFile() && /^monitor-.*\.js$/u.test(entry.name)) {
      const text = await readFile(path, 'utf8');
      if (text.includes('function createWhatsAppInboundMessageDebouncer(')) found.push(path);
    } else if (entry.isDirectory() && !entry.isSymbolicLink()) {
      found.push(...await findMonitorModules(path));
    }
  }
  return found;
}

async function main(argv) {
  if (argv.length !== 1) throw new Error('usage: patch-openclaw-whatsapp-image-burst.mjs <whatsapp-projects-root>');
  const paths = await findMonitorModules(argv[0]);
  if (paths.length === 0) throw new Error('pinned WhatsApp monitor module missing');
  let applied = 0;
  for (const path of paths) {
    const original = await readFile(path, 'utf8');
    const patched = patchWhatsAppMonitorSource(original);
    if (patched === original) continue;
    const temporary = `${path}.image-burst-${process.pid}`;
    const mode = (await stat(path)).mode & 0o777;
    await writeFile(temporary, patched);
    await chmod(temporary, mode);
    await rename(temporary, path);
    applied++;
  }
  console.log(`WHATSAPP_IMAGE_BURST_PATCH=${applied > 0 ? 'applied' : 'already-applied'}`);
}

// Deployment pipes this file to `node -`, where argv[1] is "-" and there is no file URL.
function isEntrypoint() {
  if (process.argv[1] === '-') return true;
  try { return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === process.argv[1]; } catch { return false; }
}

if (isEntrypoint()) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`WHATSAPP_IMAGE_BURST_PATCH=failed ${error.message}`);
    process.exitCode = 1;
  });
}
