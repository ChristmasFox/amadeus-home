#!/usr/bin/env node
// Pinned @openclaw/whatsapp 2026.9.4: an album / rapid burst of images arrives as
// one inbound event per image, and media events are never debounced, so each
// image starts its own turn and the model answers the first one alone. Debounce
// image events per sender (text is untouched) and carry every image of the
// merged burst into the single dispatched turn, not just the last one.
import { chmod, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER = 'amadeus-whatsapp-image-burst-v2';
// Sliding quiet window: phones upload images one by one (observed gaps ~7s), so
// every new image restarts the wait; a hard cap bounds the total delay.
export const IMAGE_BURST_QUIET_MS = 10_000;
export const IMAGE_BURST_MAX_MS = 30_000;
export const IMAGE_BURST_TEXT_JOIN_MS = 1500;

const helpers = `// ${MARKER}
const AMADEUS_IMAGE_BURST_QUIET_MS = ${IMAGE_BURST_QUIET_MS};
const AMADEUS_IMAGE_BURST_MAX_MS = ${IMAGE_BURST_MAX_MS};
const AMADEUS_IMAGE_BURST_TEXT_JOIN_MS = ${IMAGE_BURST_TEXT_JOIN_MS};
function amadeusIsImageBurstCandidate(msg) {
	const media = msg?.payload?.media;
	if (!media || !String(media.type ?? "").toLowerCase().startsWith("image/")) return false;
	return !(msg.payload.location || msg.quote?.id || msg.quote?.body);
}
function amadeusIsPlainText(msg) {
	const payload = msg?.payload;
	if (!payload || payload.media || payload.location || msg.quote?.id || msg.quote?.body) return false;
	const text = String(payload.commandBody ?? payload.body ?? "").trim();
	return text.length > 0 && !text.startsWith("/");
}
// Wait for \`wanted\` ms of quiet, never beyond the burst's hard cap (min 1ms so the buffer still flushes together).
function amadeusBurstWindowMs(configured, wanted, startedAt, now) {
	return Math.max(configured, Math.max(1, Math.min(wanted, startedAt + AMADEUS_IMAGE_BURST_MAX_MS - now)));
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
  result = replaceOnce(result, 'const pendingKeys = /* @__PURE__ */ new Map();', 'const pendingKeys = /* @__PURE__ */ new Map();\n\tconst amadeusBurstStarts = /* @__PURE__ */ new Map();', 'burst start tracking');
  result = replaceOnce(result, '\t\tconst message = {\n\t\t\t...input,\n\t\t\tdebounceMs: options.resolveDebounceMs()\n\t\t};\n\t\tconst key = buildKey(message);', '\t\tconst configuredDebounceMs = options.resolveDebounceMs();\n\t\tconst message = {\n\t\t\t...input,\n\t\t\tdebounceMs: configuredDebounceMs\n\t\t};\n\t\tconst key = buildKey(message);\n\t\tif (key) {\n\t\t\tconst burstStart = amadeusBurstStarts.get(key);\n\t\t\tconst now = Date.now();\n\t\t\tif (amadeusIsImageBurstCandidate(input)) {\n\t\t\t\tamadeusBurstStarts.set(key, burstStart ?? now);\n\t\t\t\tmessage.debounceMs = amadeusBurstWindowMs(configuredDebounceMs, AMADEUS_IMAGE_BURST_QUIET_MS, burstStart ?? now, now);\n\t\t\t} else if (burstStart !== void 0 && amadeusIsPlainText(input)) {\n\t\t\t\tmessage.debounceMs = amadeusBurstWindowMs(configuredDebounceMs, AMADEUS_IMAGE_BURST_TEXT_JOIN_MS, burstStart, now);\n\t\t\t}\n\t\t}', 'image burst sliding window');
  result = replaceOnce(result, 'const shouldDebounce = (msg) => options.shouldDebounce?.(msg) ?? true;', 'const shouldDebounce = (msg) => (msg.debounceKey !== void 0 && amadeusBurstStarts.has(msg.debounceKey) && amadeusIsPlainText(msg)) || (options.shouldDebounce?.(msg) ?? true);', 'text joins pending image burst');
  result = replaceOnce(result, 'for (const entry of entries) releaseKey(entry);', 'for (const entry of entries) {\n\t\t\t\treleaseKey(entry);\n\t\t\t\tif (entry.debounceKey) amadeusBurstStarts.delete(entry.debounceKey);\n\t\t\t}', 'burst start release');
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
