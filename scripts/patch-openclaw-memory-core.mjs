#!/usr/bin/env node
/**
 * Narrow OpenClaw 2026.9.4 Memory Core compatibility patch.
 *
 * Keep sqlite-vec's worker on the image-managed glibc search path, expose
 * keyword-only degradation when Embeddings are unavailable, and apply the
 * configured Dreaming peer policy before reading a session transcript. Owner
 * peers come from protected runtime files, never the image or logs.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MARKERS = Object.freeze({
  childEnv: 'amadeus-memory-knn-loader-path-v1',
  sessionAdmission: 'amadeus-memory-dreaming-peer-admission-v2',
  sessionBackfill: 'amadeus-memory-backfill-peer-admission-v1',
  manifest: 'amadeus-memory-dreaming-peer-admission-v2',
  searchFtsStatus: 'amadeus-memory-search-fts-status-v1',
});

export const PIN = Object.freeze({
  version: '2026.9.4',
  childEnvSha256: 'a3d7355f2615621421f078b8870923ae89af6f2bf2d18a4aab648c1953261fa9',
  sessionAdmissionSha256: 'c8df902d4f91a9069b4372409e700e8c43c48308e4dc0c052bab86ff812399c4',
  dreamingPhasesSha256: '07644badc9be12fd6e83ad30f39760fa92299263fd5691d1f14101010705560a',
  sessionBackfillSha256: '32aa04a5ff5439d902615ccda1dab774197752fa65d9c1ee9258d3ed529466ff',
  manifestSha256: 'a22bebfcec65c37b41a4d05de40f95d4da6e7501c081cc434d006f77fdb47e66',
  searchToolsBundleSha256: '2042127708bad9c7c419f51aa0073e4290ee16190fdea9b00bf4de6c59949a36',
});

export const BASE_CHILD_ENV = `function buildChildEnv(env = process.env) {
	const childEnv = {};
	for (const name of [
		"PATH",
		"SystemRoot",
		"SYSTEMROOT",
		"WINDIR",
		"TEMP",
		"TMP",
		"TMPDIR"
	]) if (env[name]) childEnv[name] = env[name];
	return childEnv;
}`;

export function buildMemoryCoreChildEnv(env = {}, arch = process.arch) {
  const childEnv = {};
  for (const name of ['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) {
    if (env[name]) childEnv[name] = env[name];
  }
  const libDir = arch === 'arm64' ? 'aarch64-linux-gnu' : arch === 'x64' ? 'x86_64-linux-gnu' : undefined;
  if (libDir) {
    const expected = `/opt/amadeus-glibc/usr/lib/${libDir}:/lib/${libDir}:/usr/lib/${libDir}`;
    const inherited = typeof env.LD_LIBRARY_PATH === 'string' ? env.LD_LIBRARY_PATH.split(':').slice(0, 3).join(':') : '';
    // Preserve only the three image-owned directories. Never forward arbitrary
    // LD_LIBRARY_PATH entries into a subprocess.
    if (inherited === expected) childEnv.LD_LIBRARY_PATH = expected;
  }
  return childEnv;
}

export function resolveVisibleMemorySearchMode(status, effectiveMode, latestDebug) {
  const explicitMode = effectiveMode ?? latestDebug?.effectiveMode;
  if (explicitMode !== undefined) return explicitMode;
  if (status?.custom?.searchMode === 'fts-only') {
    return status?.fts?.enabled === true && status?.fts?.available === true
      ? 'fts-only'
      : 'unavailable';
  }
  return undefined;
}

export function normalizeWhatsAppPeer(value) {
  if (typeof value !== 'string') return '';
  const peer = value.trim().toLowerCase()
    .replace(/^(?:whatsapp|user|jid):/u, '')
    .replace(/@(?:s\.whatsapp\.net|c\.us|lid)$/u, '');
  if (!peer) return '';
  if (/^[+\d\s().-]+$/u.test(peer)) {
    const digits = peer.replace(/\D/gu, '');
    return digits.length >= 7 ? `phone:${digits}` : '';
  }
  return `peer:${peer}`;
}

export function normalizeDreamingPeer(channel, value) {
  if (channel === 'whatsapp') return normalizeWhatsAppPeer(value);
  if (channel !== 'telegram' || typeof value !== 'string') return '';
  const peer = value.trim().toLowerCase().replace(/^(?:telegram|tg|user|id):/u, '');
  return /^[1-9][0-9]{0,19}$/u.test(peer) ? `telegram:${peer}` : '';
}

export function sessionDirectPeer(sessionKey, channel) {
  if (typeof sessionKey !== 'string' || !['whatsapp', 'telegram'].includes(channel)) return '';
  const parts = sessionKey.split(':');
  const directIndex = parts.indexOf('direct');
  if (directIndex < 0) return '';
  const channelIndex = parts.lastIndexOf(channel, directIndex - 1);
  if (channelIndex < 0) return '';
  let peerIndex = directIndex + 1;
  if (['whatsapp', 'telegram', 'tg', 'user', 'peer', 'jid', 'id'].includes(parts[peerIndex])) peerIndex += 1;
  return parts[peerIndex] ?? '';
}

export function directSessionMatchesPeer(channel, sessionKey, allowlistContent) {
  if (typeof sessionKey !== 'string' || typeof allowlistContent !== 'string') return false;
  const entries = allowlistContent.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0 || (channel === 'whatsapp' && entries.length !== 1)) return false;
  const expected = entries.map((entry) => normalizeDreamingPeer(channel, entry));
  if (expected.some((peer) => !peer)) return false;
  return expected.includes(normalizeDreamingPeer(channel, sessionDirectPeer(sessionKey, channel)));
}

export function whatsappSessionMatchesPeer(sessionKey, allowlistContent) {
  return directSessionMatchesPeer('whatsapp', sessionKey, allowlistContent);
}

export function classifyDreamingSessionAdmission({ metadata, sessionKey, policy, readPeerFile }) {
  if (!metadata) return 'session-metadata:missing';
  if (!policy) return 'admission-policy:missing';
  if (
    !Array.isArray(policy.hookExternalContentSources) ||
    !Array.isArray(policy.channels) ||
    !Array.isArray(policy.chatTypes) ||
    !Array.isArray(policy.allowedChannels) ||
    !policy.allowlistedDirectPeerFiles || typeof policy.allowlistedDirectPeerFiles !== 'object'
  ) return 'admission-policy:invalid';
  if (metadata.hookExternalContentSource) {
    return `hookExternalContentSource:${metadata.hookExternalContentSource}`;
  }
  if (metadata.channel && policy.channels.includes(metadata.channel)) return `channel:${metadata.channel}`;
  if (metadata.chatType && policy.chatTypes.includes(metadata.chatType)) {
    return `chatType:${metadata.chatType}`;
  }
  if (policy.allowedChannels.length > 0) {
    if (!metadata.channel || !policy.allowedChannels.includes(metadata.channel)) return 'channel:not-allowlisted';
    if (metadata.chatType !== 'direct') return 'chatType:not-direct';
    const allowlistFile = policy.allowlistedDirectPeerFiles[metadata.channel];
    const reasonPrefix = `${metadata.channel}-peer`;
    if (!allowlistFile) return `${reasonPrefix}:allowlist-missing`;
    if (typeof sessionKey !== 'string' || !sessionKey) return `${reasonPrefix}:session-key-missing`;
    let allowlistContent;
    try {
      allowlistContent = readPeerFile(allowlistFile);
    } catch {
      return `${reasonPrefix}:allowlist-unavailable`;
    }
    if (!directSessionMatchesPeer(metadata.channel, sessionKey, allowlistContent)) return `${reasonPrefix}:not-allowlisted`;
    return undefined;
  }
  return 'channel:not-allowlisted';
}

function replaceOnce(source, find, replacement, label) {
  const count = source.split(find).length - 1;
  if (count !== 1) throw new Error(`pinned ${label} anchor count=${count}; refusing to patch`);
  return source.replace(find, replacement);
}

function hash(source) {
  return createHash('sha256').update(source).digest('hex');
}

export function patchChildEnvSource(source) {
  if (source.includes(MARKERS.childEnv)) {
    if (!source.includes('const childEnv = buildMemoryCoreChildEnv(env, process.arch);')) {
      throw new Error('incomplete memory KNN child environment patch');
    }
    return source;
  }
  const helper = buildMemoryCoreChildEnv.toString().replace(/^function buildMemoryCoreChildEnv/u, 'function buildMemoryCoreChildEnv');
  const replacement = `// ${MARKERS.childEnv}\n${helper}\nfunction buildChildEnv(env = process.env) {\n\tconst childEnv = buildMemoryCoreChildEnv(env, process.arch);\n\treturn childEnv;\n}`;
  return replaceOnce(source, BASE_CHILD_ENV, replacement, 'KNN child environment');
}

export function patchSessionAdmissionSource(source) {
  if (source.includes(MARKERS.sessionAdmission)) {
    if (!source.includes('const reasonPrefix = `${metadata.channel}-peer`;') || !source.includes('session-origin:missing') || !source.includes('admission-policy:invalid')) {
      throw new Error('incomplete Dreaming peer admission patch');
    }
    return source;
  }
  const importAnchor = 'import fs from "node:fs/promises";';
  let result = replaceOnce(
    source,
    importAnchor,
    `${importAnchor}\nimport { readFileSync as readDreamingPeerAllowlist } from "node:fs";`,
    'Dreaming peer allowlist import',
  );
  const start = 'function resolveAdmissionPolicy(pluginConfig) {';
  const end = '\nfunction sessionIngestionStateKeyFromCorpus(entry) {';
  const startIndex = result.indexOf(start);
  const endIndex = result.indexOf(end, startIndex);
  if (startIndex < 0 || endIndex < 0 || result.indexOf(start, startIndex + 1) >= 0) {
    throw new Error('pinned Dreaming admission functions not found exactly once');
  }
  const injected = `// ${MARKERS.sessionAdmission}\n${normalizeWhatsAppPeer.toString()}\n${normalizeDreamingPeer.toString()}\n${sessionDirectPeer.toString()}\n${directSessionMatchesPeer.toString()}\n${whatsappSessionMatchesPeer.toString()}\n${classifyDreamingSessionAdmission.toString()}\nfunction resolveAdmissionPolicy(pluginConfig) {\n\tconst memoryPolicy = asNullableRecord(pluginConfig?.memoryPolicy);\n\tconst exclusions = asNullableRecord(memoryPolicy?.excludeSessions);\n\tconst values = (record, key) => Array.isArray(record?.[key]) ? normalizeStringEntries(record[key].filter((value) => typeof value === "string")) : [];\n\tconst peerFiles = asNullableRecord(memoryPolicy?.allowlistedDirectPeerFiles);\n\tconst allowlistedDirectPeerFiles = Object.fromEntries(Object.entries(peerFiles ?? {}).filter(([, value]) => typeof value === "string" && value.trim().length > 0));\n\treturn {\n\t\thookExternalContentSources: values(exclusions, "hookExternalContentSources"),\n\t\tchannels: values(exclusions, "channels"),\n\t\tchatTypes: values(exclusions, "chatTypes"),\n\t\tallowedChannels: values(memoryPolicy, "allowedChannels"),\n\t\tallowlistedDirectPeerFiles\n\t};\n}\nfunction sessionExclusionReason(source, policy, forgottenSessionIds) {\n\tif (!source.sessionOrigin) return "session-origin:missing";\n\tconst { agentId, sessionId } = source.sessionOrigin;\n\tif (forgottenSessionIds ? forgottenSessionIds.has(sessionId) : listMemorySessionTombstones({ agentId, sessionIds: [sessionId] }).length > 0) return "forgotten";\n\tconst metadata = loadMemorySessionMetadata({ ...source.sessionOrigin, storePath: source.buildOptions.storePath });\n\treturn classifyDreamingSessionAdmission({\n\t\tmetadata,\n\t\tsessionKey: source.sessionOrigin.sessionKey,\n\t\tpolicy,\n\t\treadPeerFile: (filePath) => readDreamingPeerAllowlist(filePath, "utf8")\n\t});\n}`;
  return result.slice(0, startIndex) + injected + result.slice(endIndex);
}

export function patchSessionBackfillSource(source) {
  if (source.includes(MARKERS.sessionBackfill)) {
    if (!source.includes('!sessionExclusionReason(source, params.admissionPolicy, forgottenSessionIds)')) {
      throw new Error('incomplete session-backfill admission patch');
    }
    verifySessionBackfillAdmissionBeforeScan(source, false);
    return source;
  }
  const archiveAnchor = `if (!canonicalPaths.has(source.absolutePath)) {
\t\t\tsources.push(source);
\t\t\tcanonicalPaths.add(source.absolutePath);
\t\t}`;
  const protectedArchive = `// ${MARKERS.sessionBackfill}
\t\tif (!canonicalPaths.has(source.absolutePath) && !sessionExclusionReason(source, params.admissionPolicy, forgottenSessionIds)) {
\t\t\tsources.push(source);
\t\t\tcanonicalPaths.add(source.absolutePath);
\t\t}`;
  const patched = replaceOnce(source, archiveAnchor, protectedArchive, 'session-backfill archive admission');
  verifySessionBackfillAdmissionBeforeScan(patched, false);
  return patched;
}

export function patchMemorySearchFtsStatusSource(source, verifyPinnedDigest = true) {
  if (source.includes(MARKERS.searchFtsStatus)) {
    if (
      !source.includes('resolveVisibleMemorySearchMode(status, params.effectiveMode, latestDebug)') ||
      !source.includes('searchMode: effectiveSearchMode,') ||
      !source.includes('effectiveMode: effectiveSearchMode ?? "n/a",')
    ) {
      throw new Error('incomplete memory search FTS status patch');
    }
    return source;
  }
  if (verifyPinnedDigest && hash(source) !== PIN.searchToolsBundleSha256) {
    throw new Error('pinned memory search tools bundle digest mismatch');
  }
  const helperAnchor = 'async function executeMemorySearchToolQuery(params) {';
  let result = replaceOnce(
    source,
    helperAnchor,
    `// ${MARKERS.searchFtsStatus}\n${resolveVisibleMemorySearchMode.toString()}\n${helperAnchor}`,
    'memory search mode helper',
  );
  result = replaceOnce(
    result,
    '\tconst latestDebug = runtimeDebug.at(-1);\n\treturn {',
    '\tconst latestDebug = runtimeDebug.at(-1);\n\tconst effectiveSearchMode = resolveVisibleMemorySearchMode(status, params.effectiveMode, latestDebug);\n\treturn {',
    'memory search effective mode',
  );
  result = replaceOnce(
    result,
    'searchMode: params.effectiveMode ?? latestDebug?.effectiveMode,',
    'searchMode: effectiveSearchMode,',
    'memory search mode result',
  );
  result = replaceOnce(
    result,
    'effectiveMode: params.effectiveMode ?? "n/a",',
    'effectiveMode: effectiveSearchMode ?? "n/a",',
    'memory search mode diagnostics',
  );
  return result;
}

export function verifyDreamingAdmissionBeforeScan(source, verifyPinnedDigest = true) {
  if (verifyPinnedDigest && hash(source) !== PIN.dreamingPhasesSha256) {
    throw new Error('pinned Dreaming phase bundle digest mismatch');
  }
  const admission = 'const excludedReason = sessionExclusionReason(source, params.admissionPolicy, forgottenSessionIds);';
  const continueAnchor = 'continue;';
  const enqueue = 'sources.push(source);';
  const scan = 'await scanSessionIngestionSource({';
  const admissionIndex = source.indexOf(admission);
  const guardIndex = source.indexOf('if (excludedReason) {', admissionIndex + admission.length);
  const continueIndex = source.indexOf(continueAnchor, admissionIndex + admission.length);
  const enqueueIndex = source.indexOf(enqueue, admissionIndex + admission.length);
  const scanIndex = source.indexOf(scan);
  if (
    admissionIndex < 0 || source.indexOf(admission, admissionIndex + admission.length) >= 0 ||
    guardIndex < 0 || source.indexOf('if (excludedReason) {', guardIndex + 1) >= 0 ||
    continueIndex < 0 || enqueueIndex < 0 || source.indexOf(enqueue, enqueueIndex + enqueue.length) >= 0 ||
    scanIndex < 0 || source.indexOf(scan, scanIndex + scan.length) >= 0
  ) {
    throw new Error('Dreaming admission-before-scan anchors are missing or ambiguous');
  }
  if (!(admissionIndex < guardIndex && guardIndex < continueIndex && continueIndex < enqueueIndex && enqueueIndex < scanIndex)) {
    throw new Error('Dreaming transcript scan is not gated by session admission');
  }
  return true;
}

export function verifySessionBackfillAdmissionBeforeScan(source, verifyPinnedDigest = true) {
  if (verifyPinnedDigest && hash(source) !== PIN.sessionBackfillSha256) {
    throw new Error('pinned session-backfill bundle digest mismatch');
  }
  const corpusAdmission = '!sessionExclusionReason(entry, params.admissionPolicy, forgottenSessionIds)';
  const archiveSource = 'const source = foreignSessionIngestionSource(params.agentId, archiveFile);';
  const archiveAdmission = '!sessionExclusionReason(source, params.admissionPolicy, forgottenSessionIds)';
  const archiveEnqueue = 'sources.push(source);';
  const scan = 'await scanSessionIngestionSource({';
  const indexes = [corpusAdmission, archiveSource, scan].map((anchor) => source.indexOf(anchor));
  if (indexes.some((index) => index < 0)) throw new Error('session-backfill admission-before-scan anchors are missing');
  const [corpusAdmissionIndex, archiveSourceIndex, scanIndex] = indexes;
  if (!(corpusAdmissionIndex < archiveSourceIndex && archiveSourceIndex < scanIndex)) {
    throw new Error('session-backfill transcript scan is not gated by session admission');
  }
  if (source.includes(MARKERS.sessionBackfill)) {
    const archiveAdmissionIndex = source.indexOf(archiveAdmission, archiveSourceIndex + archiveSource.length);
    const archiveEnqueueIndex = source.indexOf(archiveEnqueue, archiveAdmissionIndex + archiveAdmission.length);
    if (
      archiveAdmissionIndex < 0 || archiveEnqueueIndex < 0 || source.indexOf(archiveAdmission, archiveAdmissionIndex + archiveAdmission.length) >= 0 ||
      !(archiveSourceIndex < archiveAdmissionIndex && archiveAdmissionIndex < archiveEnqueueIndex && archiveEnqueueIndex < scanIndex)
    ) throw new Error('session-backfill archive source is not gated by session admission');
  }
  return true;
}

export function patchPluginManifest(source, verifyPinnedDigest = true) {
  const manifest = JSON.parse(source);
  const memoryPolicy = manifest?.configSchema?.properties?.memoryPolicy;
  if (!memoryPolicy || memoryPolicy.type !== 'object' || !memoryPolicy.properties) {
    throw new Error('pinned memory-core manifest schema shape mismatch');
  }
  if (memoryPolicy.$comment === MARKERS.manifest) {
    if (!memoryPolicy.properties.allowedChannels || !memoryPolicy.properties.allowlistedDirectPeerFiles) {
      throw new Error('incomplete memory-core admission schema patch');
    }
    return source;
  }
  if (verifyPinnedDigest && hash(source) !== PIN.manifestSha256) throw new Error('pinned memory-core manifest digest mismatch');
  memoryPolicy.$comment = MARKERS.manifest;
  memoryPolicy.properties.allowedChannels = {
    type: 'array',
    items: { type: 'string', enum: ['telegram', 'whatsapp'] },
  };
  memoryPolicy.properties.allowlistedDirectPeerFiles = {
    type: 'object',
    additionalProperties: false,
    properties: { whatsapp: { type: 'string' }, telegram: { type: 'string' } },
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function patchFile(filePath, expectedHash, marker, transform, label, apply) {
  const original = fs.readFileSync(filePath, 'utf8');
  if (!original.includes(marker) && hash(original) !== expectedHash) {
    throw new Error(`pinned ${label} digest mismatch`);
  }
  const patched = transform(original);
  if (apply && patched !== original) {
    const mode = fs.statSync(filePath).mode & 0o777;
    const temporary = `${filePath}.memory-core-tmp-${process.pid}`;
    fs.writeFileSync(temporary, patched);
    fs.chmodSync(temporary, mode);
    fs.renameSync(temporary, filePath);
  }
  return patched !== original;
}

function main(argv = process.argv.slice(2)) {
  let coreRoot;
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--core-root') coreRoot = argv[++index];
    else if (argv[index] === '--apply') apply = true;
    else throw new Error(`unknown option ${argv[index]}`);
  }
  if (!coreRoot || !path.isAbsolute(coreRoot)) throw new Error('--core-root must be an absolute path');
  const runtimeFile = path.join(coreRoot, 'extensions/memory-core/manager-runtime.js');
  const manifestFile = path.join(coreRoot, 'extensions/memory-core/openclaw.plugin.json');
  const files = fs.readdirSync(coreRoot);
  const sessionFiles = files.filter((name) => /^session-ingestion-[^/]+\.mjs$/u.test(name));
  if (sessionFiles.length !== 1) throw new Error(`expected one pinned session-ingestion bundle; found ${sessionFiles.length}`);
  const sessionFile = path.join(coreRoot, sessionFiles[0]);
  const searchToolsFiles = files
    .filter((name) => /^tools-[^/]+\.mjs$/u.test(name))
    .map((name) => path.join(coreRoot, name))
    .filter((filePath) => {
      const source = fs.readFileSync(filePath, 'utf8');
      return source.includes('searchMode: params.effectiveMode ?? latestDebug?.effectiveMode,') ||
        source.includes(MARKERS.searchFtsStatus);
    });
  if (searchToolsFiles.length !== 1) {
    throw new Error(`expected one pinned memory search tools bundle; found ${searchToolsFiles.length}`);
  }
  const dreamingFiles = files.filter((name) => /^dreaming-phases-[^/]+\.mjs$/u.test(name))
    .map((name) => path.join(coreRoot, name))
    .filter((filePath) => fs.readFileSync(filePath, 'utf8').includes('await scanSessionIngestionSource({'));
  if (dreamingFiles.length !== 1) throw new Error(`expected one pinned Dreaming phase bundle; found ${dreamingFiles.length}`);
  verifyDreamingAdmissionBeforeScan(fs.readFileSync(dreamingFiles[0], 'utf8'));
  const backfillFiles = files.filter((name) => /^session-backfill-[^/]+\.mjs$/u.test(name))
    .map((name) => path.join(coreRoot, name))
    .filter((filePath) => fs.readFileSync(filePath, 'utf8').includes('await scanSessionIngestionSource({'));
  if (backfillFiles.length !== 1) throw new Error(`expected one pinned session-backfill bundle; found ${backfillFiles.length}`);
  const backfillFile = backfillFiles[0];
  const backfillSource = fs.readFileSync(backfillFile, 'utf8');
  verifySessionBackfillAdmissionBeforeScan(backfillSource, !backfillSource.includes(MARKERS.sessionBackfill));
  patchFile(runtimeFile, PIN.childEnvSha256, MARKERS.childEnv, patchChildEnvSource, 'KNN child environment', apply);
  patchFile(sessionFile, PIN.sessionAdmissionSha256, MARKERS.sessionAdmission, patchSessionAdmissionSource, 'Dreaming session admission', apply);
  patchFile(backfillFile, PIN.sessionBackfillSha256, MARKERS.sessionBackfill, patchSessionBackfillSource, 'session-backfill peer admission', apply);
  patchFile(manifestFile, PIN.manifestSha256, MARKERS.manifest, patchPluginManifest, 'memory-core manifest', apply);
  patchFile(searchToolsFiles[0], PIN.searchToolsBundleSha256, MARKERS.searchFtsStatus, patchMemorySearchFtsStatusSource, 'memory search FTS status', apply);
  console.log(`OPENCLAW_MEMORY_CORE_PATCH=${apply ? 'applied' : 'patchable'} version=${PIN.version} child_env=ready dreaming_peer_filter=ready backfill_peer_filter=ready search_fts_status=ready`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    main();
  } catch (error) {
    console.error(`OPENCLAW_MEMORY_CORE_PATCH=failed ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
