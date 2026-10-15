#!/usr/bin/env node
/**
 * Narrow OpenClaw 2026.9.4 Memory Core compatibility patch.
 *
 * Keep sqlite-vec's worker on the image-managed glibc search path, and apply
 * the configured Dreaming channel/peer admission policy before reading a
 * session transcript. The owner peer is read from a protected runtime file;
 * it is never embedded in this image or emitted to logs.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MARKERS = Object.freeze({
  childEnv: 'amadeus-memory-knn-loader-path-v1',
  sessionAdmission: 'amadeus-memory-dreaming-peer-admission-v1',
  manifest: 'amadeus-memory-dreaming-peer-admission-v1',
});

export const PIN = Object.freeze({
  version: '2026.9.4',
  childEnvSha256: 'a3d7355f2615621421f078b8870923ae89af6f2bf2d18a4aab648c1953261fa9',
  sessionAdmissionSha256: 'c8df902d4f91a9069b4372409e700e8c43c48308e4dc0c052bab86ff812399c4',
  manifestSha256: 'a22bebfcec65c37b41a4d05de40f95d4da6e7501c081cc434d006f77fdb47e66',
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

export function whatsappSessionMatchesPeer(sessionKey, allowlistContent) {
  if (typeof sessionKey !== 'string' || typeof allowlistContent !== 'string') return false;
  const entries = allowlistContent.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean);
  if (entries.length !== 1) return false;
  const expected = normalizeWhatsAppPeer(entries[0]);
  if (!expected) return false;
  return sessionKey.split(':').some((part) => normalizeWhatsAppPeer(part) === expected);
}

export function classifyDreamingSessionAdmission({ metadata, sessionKey, policy, readPeerFile }) {
  if (!metadata) return policy.allowedChannels.length > 0 ? 'session-metadata:missing' : undefined;
  if (
    metadata.hookExternalContentSource &&
    policy.hookExternalContentSources.includes(metadata.hookExternalContentSource)
  ) {
    return `hookExternalContentSource:${metadata.hookExternalContentSource}`;
  }
  if (metadata.chatType && policy.chatTypes.includes(metadata.chatType)) {
    return `chatType:${metadata.chatType}`;
  }
  if (policy.allowedChannels.length > 0) {
    if (!metadata.channel || !policy.allowedChannels.includes(metadata.channel)) return 'channel:not-allowlisted';
    if (metadata.chatType !== 'direct') return 'chatType:not-direct';
    if (metadata.channel === 'whatsapp') {
      const allowlistFile = policy.allowlistedDirectPeerFiles.whatsapp;
      if (!allowlistFile) return 'whatsapp-peer:allowlist-missing';
      let allowlistContent;
      try {
        allowlistContent = readPeerFile(allowlistFile);
      } catch {
        return 'whatsapp-peer:allowlist-unavailable';
      }
      if (!whatsappSessionMatchesPeer(sessionKey, allowlistContent)) return 'whatsapp-peer:not-allowlisted';
    }
    return undefined;
  }
  if (metadata.channel && policy.channels.includes(metadata.channel)) return `channel:${metadata.channel}`;
  return metadata.chatType && policy.chatTypes.includes(metadata.chatType)
    ? `chatType:${metadata.chatType}`
    : undefined;
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
    if (!source.includes('whatsapp-peer:not-allowlisted')) throw new Error('incomplete Dreaming peer admission patch');
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
  const injected = `// ${MARKERS.sessionAdmission}\n${normalizeWhatsAppPeer.toString()}\n${whatsappSessionMatchesPeer.toString()}\n${classifyDreamingSessionAdmission.toString()}\nfunction resolveAdmissionPolicy(pluginConfig) {\n\tconst memoryPolicy = asNullableRecord(pluginConfig?.memoryPolicy);\n\tconst exclusions = asNullableRecord(memoryPolicy?.excludeSessions);\n\tif (!exclusions && !memoryPolicy) return;\n\tconst values = (record, key) => Array.isArray(record?.[key]) ? normalizeStringEntries(record[key].filter((value) => typeof value === "string")) : [];\n\tconst peerFiles = asNullableRecord(memoryPolicy?.allowlistedDirectPeerFiles);\n\tconst allowlistedDirectPeerFiles = Object.fromEntries(Object.entries(peerFiles ?? {}).filter(([, value]) => typeof value === "string" && value.trim().length > 0));\n\tconst policy = {\n\t\thookExternalContentSources: values(exclusions, "hookExternalContentSources"),\n\t\tchannels: values(exclusions, "channels"),\n\t\tchatTypes: values(exclusions, "chatTypes"),\n\t\tallowedChannels: values(memoryPolicy, "allowedChannels"),\n\t\tallowlistedDirectPeerFiles\n\t};\n\treturn Object.values(policy).some((entries) => Array.isArray(entries) ? entries.length > 0 : Object.keys(entries).length > 0) ? policy : void 0;\n}\nfunction sessionExclusionReason(source, policy, forgottenSessionIds) {\n\tif (!source.sessionOrigin) return;\n\tconst { agentId, sessionId } = source.sessionOrigin;\n\tif (forgottenSessionIds ? forgottenSessionIds.has(sessionId) : listMemorySessionTombstones({ agentId, sessionIds: [sessionId] }).length > 0) return "forgotten";\n\tif (!policy) return;\n\tconst metadata = loadMemorySessionMetadata({ ...source.sessionOrigin, storePath: source.buildOptions.storePath });\n\tif (!metadata && policy.allowedChannels.length === 0) return;\n\treturn classifyDreamingSessionAdmission({\n\t\tmetadata,\n\t\tsessionKey: source.sessionOrigin.sessionKey,\n\t\tpolicy,\n\t\treadPeerFile: (filePath) => readDreamingPeerAllowlist(filePath, "utf8")\n\t});\n}`;
  return result.slice(0, startIndex) + injected + result.slice(endIndex);
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
    properties: { whatsapp: { type: 'string' } },
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
  const sessionFiles = fs.readdirSync(coreRoot).filter((name) => /^session-ingestion-[^/]+\.mjs$/u.test(name));
  if (sessionFiles.length !== 1) throw new Error(`expected one pinned session-ingestion bundle; found ${sessionFiles.length}`);
  const sessionFile = path.join(coreRoot, sessionFiles[0]);
  patchFile(runtimeFile, PIN.childEnvSha256, MARKERS.childEnv, patchChildEnvSource, 'KNN child environment', apply);
  patchFile(sessionFile, PIN.sessionAdmissionSha256, MARKERS.sessionAdmission, patchSessionAdmissionSource, 'Dreaming session admission', apply);
  patchFile(manifestFile, PIN.manifestSha256, MARKERS.manifest, patchPluginManifest, 'memory-core manifest', apply);
  console.log(`OPENCLAW_MEMORY_CORE_PATCH=${apply ? 'applied' : 'patchable'} version=${PIN.version} child_env=ready dreaming_peer_filter=ready`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    main();
  } catch (error) {
    console.error(`OPENCLAW_MEMORY_CORE_PATCH=failed ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
