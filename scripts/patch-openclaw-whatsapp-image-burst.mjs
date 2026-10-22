#!/usr/bin/env node
// Pinned @openclaw/whatsapp 2026.9.4: an album / rapid burst of images arrives as
// one inbound event per image, and media events are never debounced, so each
// image starts its own turn and the model answers the first one alone. Debounce
// image events per sender (text is untouched) and carry every image of the
// merged burst into the single dispatched turn, not just the last one.
import { chmod, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER = 'amadeus-whatsapp-image-burst-v1';
export const IMAGE_BURST_DEBOUNCE_MS = 2500;

const helpers = `// ${MARKER}
const AMADEUS_IMAGE_BURST_DEBOUNCE_MS = ${IMAGE_BURST_DEBOUNCE_MS};
function amadeusIsImageBurstCandidate(msg) {
	const media = msg?.payload?.media;
	if (!media || !String(media.type ?? "").toLowerCase().startsWith("image/")) return false;
	return !(msg.payload.location || msg.quote?.id || msg.quote?.body);
}
function amadeusImageBurstDebounceMs(msg, configured) {
	return amadeusIsImageBurstCandidate(msg) ? Math.max(configured, AMADEUS_IMAGE_BURST_DEBOUNCE_MS) : configured;
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
  result = replaceOnce(result, '\t\t\tdebounceMs: options.resolveDebounceMs()\n\t\t};\n\t\tconst key = buildKey(message);', '\t\t\tdebounceMs: amadeusImageBurstDebounceMs(input, options.resolveDebounceMs())\n\t\t};\n\t\tconst key = buildKey(message);', 'image burst debounce window');
  result = replaceOnce(result, '\t\t\t\t\t\t\t\t...last.payload,\n\t\t\t\t\t\t\t\tbody: combinedBody,', '\t\t\t\t\t\t\t\t...last.payload,\n\t\t\t\t\t\t\t\tmediaList: orderedEntries.flatMap((entry) => amadeusPayloadMediaList(entry.payload) ?? []),\n\t\t\t\t\t\t\t\tbody: combinedBody,', 'merged burst media list');
  result = replaceOnce(result, 'const shouldDebounce = (msg) => shouldDebounceTextInbound({', 'const shouldDebounce = (msg) => amadeusIsImageBurstCandidate(msg) || shouldDebounceTextInbound({', 'image burst debounce gate');
  result = replaceOnce(
    result,
    `const media = await toInboundMediaFactsWithMetadata(params.msg.payload.media ? [{
		path: params.msg.payload.media?.path,
		url: params.msg.payload.media?.url ?? params.msg.payload.media?.path,
		contentType: params.msg.payload.media?.type,
		kind: params.msg.payload.media?.kind
	}] : void 0,`,
    `const media = await toInboundMediaFactsWithMetadata(amadeusPayloadMediaList(params.msg.payload)?.map((item) => ({
		path: item.path,
		url: item.url ?? item.path,
		contentType: item.type,
		kind: item.kind
	})),`,
    'inbound media facts',
  );
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`WHATSAPP_IMAGE_BURST_PATCH=failed ${error.message}`);
    process.exitCode = 1;
  });
}
