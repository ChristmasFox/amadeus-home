#!/usr/bin/env node
/**
 * Version-pinned OpenClaw 2026.9.4 memory-artifact provenance export.
 *
 * The plugin SDK exposes only read/list for memory-artifact provenance, but
 * the host records provenance solely from its own edit/write tools. A
 * verified-owner plugin write to MEMORY.md/USER.md would therefore leave the
 * recorded file hash stale, and the next host edit would classify the file as
 * `untrusted` forever (never auto-injected). This adds one narrow function that
 * records an `agent` write for a given content, and re-exports it from the
 * `memory-core-host-runtime-core` plugin-SDK subpath next to the readers.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MARKER = 'amadeus-memory-artifact-agent-write-v1';
export const PIN = Object.freeze({
  version: '2026.9.4',
  module: 'memory-artifact-provenance-DfnnFfMY.mjs',
  moduleSha256: '6b2f2a81f1eb0f5b524d5b61e57c56564ca8f8bbd3cb2056cb197a2f8a50046a',
  sdkModule: 'plugin-sdk/memory-core-host-runtime-core.js',
  sdkModuleSha256: 'a1f73364bffe3733312444352af51648791bf44edd276f745942ffd81e1c4ad4',
});

export const MARK_FUNCTION = `// ${MARKER}
async function markMemoryArtifactAgentWrite(params) {
	const address = resolveAddress(params);
	if (!address) return;
	const store = openStore();
	const reservationId = randomUUID();
	let previous;
	store.update(address.storeKey, (current) => {
		previous = normalizeStoredProvenance(current, address);
		return {
			version: 1,
			workspaceKey: address.workspaceKey,
			relativePath: address.relativePath,
			fileHash: sha256(params.contentAfter),
			originClass: "agent",
			observedAt: params.observedAt,
			...params.sessionId ? { sessionId: params.sessionId } : {},
			...params.sessionKey ? { sessionKey: params.sessionKey } : {},
			reservationId
		};
	});
	return async () => {
		const rollbackStore = openStore();
		if (previous) {
			rollbackStore.update(address.storeKey, (current) => current?.reservationId === reservationId ? previous : void 0);
			return;
		}
		rollbackStore.deleteIf(address.storeKey, (current) => current.reservationId === reservationId);
	};
}
`;

function replaceOnce(source, find, replacement, label) {
  const count = source.split(find).length - 1;
  if (count !== 1) throw new Error(`pinned ${label} anchor count=${count}; refusing to patch`);
  return source.replace(find, replacement);
}

export function patchProvenanceModuleSource(original) {
  if (original.includes(MARKER)) {
    if (!original.includes('markMemoryArtifactAgentWrite as o')) throw new Error('incomplete memory provenance patch');
    return original;
  }
  let result = replaceOnce(original, '//#endregion\nexport { ', `${MARK_FUNCTION}//#endregion\nexport { `, 'provenance region end');
  result = replaceOnce(result, 'clearMemoryArtifactProvenance as t };', 'clearMemoryArtifactProvenance as t, markMemoryArtifactAgentWrite as o };', 'provenance export list');
  return result;
}

export function patchSdkModuleSource(original) {
  if (original.includes('markMemoryArtifactAgentWrite')) return original;
  let result = replaceOnce(
    original,
    'import { i as readMemoryArtifactProvenance, n as listMemoryArtifactProvenance } from "../memory-artifact-provenance-DfnnFfMY.mjs";',
    'import { i as readMemoryArtifactProvenance, n as listMemoryArtifactProvenance, o as markMemoryArtifactAgentWrite } from "../memory-artifact-provenance-DfnnFfMY.mjs";',
    'sdk provenance import',
  );
  result = replaceOnce(result, 'listMemoryCorpusSupplements, parseAgentSessionKey,', 'listMemoryCorpusSupplements, markMemoryArtifactAgentWrite, parseAgentSessionKey,', 'sdk export list');
  return result;
}

function atomicWrite(target, content) {
  const mode = fs.statSync(target).mode & 0o777;
  const temporary = `${target}.provenance-tmp-${process.pid}`;
  fs.writeFileSync(temporary, content);
  fs.chmodSync(temporary, mode);
  fs.renameSync(temporary, target);
}

function readPinned(root, relative, sha256, markerCheck) {
  const file = path.join(root, relative);
  if (!fs.statSync(file).isFile()) throw new Error(`pinned module missing: ${relative}`);
  const original = fs.readFileSync(file, 'utf8');
  const digest = createHash('sha256').update(original).digest('hex');
  if (digest !== sha256 && !markerCheck(original)) throw new Error(`pinned module digest mismatch: ${relative}`);
  return { file, original };
}

function main(argv = process.argv.slice(2)) {
  let coreRoot;
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--core-root') coreRoot = argv[++index];
    else if (arg === '--apply') apply = true;
    else throw new Error(`unknown option ${arg}`);
  }
  if (!coreRoot || !path.isAbsolute(coreRoot)) throw new Error('--core-root must be an absolute path');
  const provenance = readPinned(coreRoot, PIN.module, PIN.moduleSha256, (source) => source.includes(MARKER));
  const sdk = readPinned(coreRoot, PIN.sdkModule, PIN.sdkModuleSha256, (source) => source.includes('markMemoryArtifactAgentWrite'));
  const patchedProvenance = patchProvenanceModuleSource(provenance.original);
  const patchedSdk = patchSdkModuleSource(sdk.original);
  if (apply) {
    if (patchedProvenance !== provenance.original) atomicWrite(provenance.file, patchedProvenance);
    if (patchedSdk !== sdk.original) atomicWrite(sdk.file, patchedSdk);
  }
  console.log(`OPENCLAW_MEMORY_PROVENANCE=${apply ? 'applied' : 'patchable'} module=${PIN.module}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    main();
  } catch (error) {
    console.error(`OPENCLAW_MEMORY_PROVENANCE=failed ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
