#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  BASE_CHILD_ENV,
  MARKERS,
  buildMemoryCoreChildEnv,
  classifyDreamingSessionAdmission,
  directSessionMatchesPeer,
  normalizeDreamingPeer,
  normalizeWhatsAppPeer,
  patchChildEnvSource,
  patchDreamingIndexResultSource,
  patchDreamingNoCorpusSource,
  patchMemorySearchFtsStatusSource,
  patchPluginManifest,
  patchSessionAdmissionSource,
  patchSessionBackfillSource,
  sessionDirectPeer,
  resolveVisibleMemorySearchMode,
  verifyDreamingAdmissionBeforeScan,
  verifySessionBackfillAdmissionBeforeScan,
  whatsappSessionMatchesPeer,
} from './patch-openclaw-memory-core.mjs';

const armLoaderPath = '/opt/amadeus-glibc/usr/lib/aarch64-linux-gnu:/lib/aarch64-linux-gnu:/usr/lib/aarch64-linux-gnu';
const x64LoaderPath = '/opt/amadeus-glibc/usr/lib/x86_64-linux-gnu:/lib/x86_64-linux-gnu:/usr/lib/x86_64-linux-gnu';
const safeEnv = buildMemoryCoreChildEnv({ PATH: '/usr/bin', LD_LIBRARY_PATH: `${armLoaderPath}:/tmp/untrusted` }, 'arm64');
assert.equal(safeEnv.PATH, '/usr/bin');
assert.equal(safeEnv.LD_LIBRARY_PATH, armLoaderPath);
assert.equal(Object.keys(safeEnv).includes('/tmp/untrusted'), false);
assert.equal(buildMemoryCoreChildEnv({ LD_LIBRARY_PATH: '/tmp/untrusted' }, 'arm64').LD_LIBRARY_PATH, undefined);
assert.equal(buildMemoryCoreChildEnv({ LD_LIBRARY_PATH: armLoaderPath }, 'arm64').LD_LIBRARY_PATH, armLoaderPath);
assert.equal(buildMemoryCoreChildEnv({ LD_LIBRARY_PATH: `${x64LoaderPath}:/tmp/untrusted` }, 'x64').LD_LIBRARY_PATH, x64LoaderPath);
assert.equal(buildMemoryCoreChildEnv({ LD_LIBRARY_PATH: x64LoaderPath }, 'x64').LD_LIBRARY_PATH, x64LoaderPath);
assert.equal(buildMemoryCoreChildEnv({ LD_LIBRARY_PATH: x64LoaderPath }, 'unknown').LD_LIBRARY_PATH, undefined);

const originalChildSource = `prefix\n${BASE_CHILD_ENV}\nsuffix`;
const patchedChildSource = patchChildEnvSource(originalChildSource);
assert.match(patchedChildSource, new RegExp(MARKERS.childEnv));
assert.equal(patchChildEnvSource(patchedChildSource), patchedChildSource);

const searchToolsFixture = `async function executeMemorySearchToolQuery(params) {
\tconst latestDebug = runtimeDebug.at(-1);
\treturn {
\t\tsearchMode: params.effectiveMode ?? latestDebug?.effectiveMode,
\t\tdebug: {
\t\t\teffectiveMode: params.effectiveMode ?? "n/a",
\t\t}
\t};
}`;
const patchedSearchTools = patchMemorySearchFtsStatusSource(searchToolsFixture, false);
assert.match(patchedSearchTools, new RegExp(MARKERS.searchFtsStatus));
assert.match(patchedSearchTools, /searchMode: effectiveSearchMode,/u);
assert.match(patchedSearchTools, /effectiveMode: effectiveSearchMode \?\? "n\/a",/u);
assert.equal(patchMemorySearchFtsStatusSource(patchedSearchTools), patchedSearchTools);
assert.equal(resolveVisibleMemorySearchMode({ custom: { searchMode: 'fts-only' }, fts: { enabled: true, available: true } }), 'fts-only');
assert.equal(resolveVisibleMemorySearchMode({ custom: { searchMode: 'fts-only' }, fts: { enabled: true, available: false } }), 'unavailable');
assert.equal(resolveVisibleMemorySearchMode({ custom: { searchMode: 'fts-only' }, fts: { enabled: false, available: true } }), 'unavailable');
assert.equal(resolveVisibleMemorySearchMode({ custom: { searchMode: 'hybrid' } }), undefined);
assert.equal(resolveVisibleMemorySearchMode({ custom: { searchMode: 'fts-only' }, fts: { enabled: false, available: false } }, undefined, { effectiveMode: 'hybrid' }), 'hybrid');
assert.equal(resolveVisibleMemorySearchMode({ custom: { searchMode: 'hybrid' } }, 'keyword-only', { effectiveMode: 'hybrid' }), 'keyword-only');
assert.throws(() => patchMemorySearchFtsStatusSource(searchToolsFixture), /digest mismatch/u);
assert.throws(() => patchMemorySearchFtsStatusSource(patchedSearchTools.replace('effectiveMode: effectiveSearchMode ?? "n/a",', 'effectiveMode: "n/a",')), /incomplete/u);

const ownerPeer = 'whatsapp:+19995550123';
const ownerSession = 'agent:main:whatsapp:secondary:direct:+19995550123@s.whatsapp.net';
const ownerSessionWithChannelPeer = 'agent:main:whatsapp:secondary:direct:whatsapp:+19995550123@s.whatsapp.net';
const otherSession = 'agent:main:whatsapp:secondary:direct:+19995550124@s.whatsapp.net';
assert.equal(normalizeWhatsAppPeer(ownerPeer), normalizeWhatsAppPeer('+19995550123@s.whatsapp.net'));
assert.equal(whatsappSessionMatchesPeer(ownerSession, `${ownerPeer}\n`), true);
assert.equal(whatsappSessionMatchesPeer(ownerSessionWithChannelPeer, `${ownerPeer}\n`), true);
assert.equal(whatsappSessionMatchesPeer(otherSession, ownerPeer), false);
assert.equal(whatsappSessionMatchesPeer(ownerSession, `${ownerPeer}\nother-peer`), false);

const telegramOwnerSession = 'agent:main:telegram:direct:123456789';
const telegramRevokedSession = 'agent:main:telegram:default:direct:111222333';
const telegramOtherSession = 'agent:main:telegram:direct:987654321';
const telegramAllowlist = 'telegram:123456789\ntelegram:111222333\n';
assert.equal(normalizeDreamingPeer('telegram', '123456789'), 'telegram:123456789');
assert.equal(normalizeDreamingPeer('telegram', 'telegram:123456789'), 'telegram:123456789');
assert.equal(normalizeDreamingPeer('telegram', '0'), '');
assert.equal(normalizeDreamingPeer('telegram', '*'), '');
assert.equal(sessionDirectPeer('agent:main:whatsapp:direct:peer:19995550123', 'whatsapp'), '19995550123');
assert.equal(sessionDirectPeer(ownerSessionWithChannelPeer, 'whatsapp'), '+19995550123@s.whatsapp.net');
assert.equal(directSessionMatchesPeer('telegram', telegramOwnerSession, telegramAllowlist), true);
assert.equal(directSessionMatchesPeer('telegram', telegramRevokedSession, telegramAllowlist), true);
assert.equal(directSessionMatchesPeer('telegram', telegramRevokedSession, 'telegram:123456789\n'), false);
assert.equal(directSessionMatchesPeer('telegram', telegramOtherSession, telegramAllowlist), false);
assert.equal(directSessionMatchesPeer('telegram', ownerSession, telegramAllowlist), false);
assert.equal(directSessionMatchesPeer('telegram', `${telegramOtherSession}:123456789`, telegramAllowlist), false);
assert.equal(directSessionMatchesPeer('telegram', telegramOwnerSession, 'telegram:123456789\nnot-a-user'), false);
assert.equal(directSessionMatchesPeer('telegram', telegramOwnerSession, ''), false);
assert.equal(directSessionMatchesPeer('whatsapp', ownerSession, `${ownerPeer}\nother-peer`), false);

const policy = {
  hookExternalContentSources: [],
  channels: [],
  chatTypes: ['group', 'channel'],
  allowedChannels: ['whatsapp', 'telegram'],
  allowlistedDirectPeerFiles: {
    whatsapp: '/run/secrets/owner_whatsapp_target',
    telegram: '/home/node/.openclaw/dreaming-telegram-peer',
  },
};
const classify = (metadata, sessionKey, reader = (filePath) =>
  filePath.includes('telegram') ? telegramAllowlist : ownerPeer) =>
  classifyDreamingSessionAdmission({ metadata, sessionKey, policy, readPeerFile: reader });
assert.equal(classify({ channel: 'whatsapp', chatType: 'direct' }, ownerSession), undefined);
assert.equal(classify({ channel: 'whatsapp', chatType: 'direct' }, otherSession), 'whatsapp-peer:not-allowlisted');
assert.equal(classify({ channel: 'whatsapp', chatType: 'group' }, ownerSession), 'chatType:group');
assert.equal(classify({ channel: 'whatsapp', chatType: 'channel' }, ownerSession), 'chatType:channel');
assert.equal(classify({ channel: 'telegram', chatType: 'direct' }, telegramOwnerSession), undefined);
assert.equal(classify({ channel: 'telegram', chatType: 'direct' }, telegramRevokedSession, () => 'telegram:123456789\n'), 'telegram-peer:not-allowlisted');
assert.equal(classify({ channel: 'telegram', chatType: 'direct' }, telegramOtherSession), 'telegram-peer:not-allowlisted');
assert.equal(classify({ channel: 'discord', chatType: 'direct' }, 'agent:main:discord:direct:peer'), 'channel:not-allowlisted');
assert.equal(classify({ channel: 'telegram', chatType: 'direct' }, telegramOwnerSession, () => { throw new Error('unreadable'); }), 'telegram-peer:allowlist-unavailable');
assert.equal(classify({ channel: 'whatsapp', chatType: 'direct' }, ownerSession, () => ''), 'whatsapp-peer:not-allowlisted');
assert.equal(classify({ channel: 'whatsapp', chatType: 'direct' }, ownerSession, () => `${ownerPeer}\nother-peer`), 'whatsapp-peer:not-allowlisted');
assert.equal(classify({ channel: 'telegram', chatType: 'direct' }, telegramOwnerSession, () => 'telegram:123456789\nnot-a-user'), 'telegram-peer:not-allowlisted');
assert.equal(classify({ channel: 'telegram', chatType: 'group' }, telegramOwnerSession), 'chatType:group');
assert.equal(classify({ channel: 'telegram', chatType: 'direct', hookExternalContentSource: 'external' }, telegramOwnerSession), 'hookExternalContentSource:external');
assert.equal(classify({ channel: 'telegram', chatType: 'direct' }, telegramOwnerSession, () => telegramAllowlist), undefined);
assert.equal(classify(undefined, ownerSession), 'session-metadata:missing');
assert.equal(classify({ channel: 'whatsapp', chatType: 'direct' }, undefined, () => { throw new Error('unreadable'); }), 'whatsapp-peer:session-key-missing');
assert.equal(classifyDreamingSessionAdmission({ metadata: { channel: 'telegram', chatType: 'direct' }, sessionKey: telegramOwnerSession, policy: undefined, readPeerFile: () => telegramAllowlist }), 'admission-policy:missing');
assert.equal(classifyDreamingSessionAdmission({ metadata: { channel: 'telegram', chatType: 'direct' }, sessionKey: telegramOwnerSession, policy: {}, readPeerFile: () => telegramAllowlist }), 'admission-policy:invalid');

const admissionFixture = `import fs from "node:fs/promises";\nfunction resolveAdmissionPolicy(pluginConfig) {\n\treturn;\n}\nfunction sessionExclusionReason(source, policy, forgottenSessionIds) {\n\treturn;\n}\nfunction sessionIngestionStateKeyFromCorpus(entry) {\n\treturn;\n}`;
const patchedAdmission = patchSessionAdmissionSource(admissionFixture);
assert.match(patchedAdmission, new RegExp(MARKERS.sessionAdmission));
assert.match(patchedAdmission, /readDreamingPeerAllowlist/u);
assert.equal(patchSessionAdmissionSource(patchedAdmission), patchedAdmission);

const dreamingOrder = `const excludedReason = sessionExclusionReason(source, params.admissionPolicy, forgottenSessionIds);\nif (excludedReason) {\n\tcontinue;\n}\nsources.push(source);\nawait scanSessionIngestionSource({`;
assert.equal(verifyDreamingAdmissionBeforeScan(dreamingOrder, false), true);
assert.throws(() => verifyDreamingAdmissionBeforeScan(dreamingOrder), /digest mismatch/u);
assert.throws(() => verifyDreamingAdmissionBeforeScan(dreamingOrder.replace('sources.push(source);\nawait scanSessionIngestionSource({', 'await scanSessionIngestionSource({\nsources.push(source);'), false), /not gated/u);

const dreamingNoCorpusFixture = `async function runLightDreaming(params) {
	const { capped, recentDiaryEntries } = await withMemoryWorkspaceLock(params.workspaceDir, async () => {
		const capped = entries.slice(0, params.config.limit);
		const bodyLines = buildLightDreamingBody(capped);
		await writeDailyDreamingPhaseBlock({
			phase: "light"
		});
		return {
			capped,
			recentDiaryEntries
		};
	});
	if (params.subagent && capped.length > 0) {
		return await runDreamNarrative({});
	}
	return { status: "skipped" };
}
async function runRemDreaming(params) {
	const { entries, preview } = await withMemoryWorkspaceLock(params.workspaceDir, async () => {
		const entries = stagedEntries.length > 0 ? stagedEntries : allEntries;
		const preview = previewRemDreaming({
			entries
		});
		await writeDailyDreamingPhaseBlock({
			phase: "rem"
		});
		return {
			entries,
			preview
		};
	});
	if (params.subagent && entries.length > 0) {
		return await runDreamNarrative({});
	}
	return { status: "skipped" };
}
async function runDreamingSweepPhases(params) {
	let degradedPhases = 0;
	let pendingNarratives = 0;
	async function runPhase(phase, config, run) {
		if (!config.enabled || config.limit <= 0) return;
		try {
			const outcome = await run({});
			if (outcome.status === "degraded") degradedPhases += 1;
			else if (outcome.status === "pending") pendingNarratives += 1;
		} catch (err) {
			throw err;
		}
	}
	await runPhase("light", lightConfig, runLightDreaming);
	await runPhase("rem", remConfig, runRemDreaming);
	return {
		degradedPhases,
		pendingNarratives
	};
}
//#endregion
`;
const patchedDreamingNoCorpus = patchDreamingNoCorpusSource(dreamingNoCorpusFixture, false);
assert.match(patchedDreamingNoCorpus, new RegExp(MARKERS.dreamingNoCorpus));
assert.match(patchedDreamingNoCorpus, /capped\.length === 0\) return \{ capped, recentDiaryEntries/u);
assert.match(patchedDreamingNoCorpus, /entries\.length === 0\) return \{ entries, skippedNoEligibleCorpus: true \}/u);
assert.match(patchedDreamingNoCorpus, /reason: "SKIPPED_NO_ELIGIBLE_CORPUS"/u);
assert.match(patchedDreamingNoCorpus, /noEligibleCorpusPhases === enabledPhases/u);
assert.ok(patchedDreamingNoCorpus.indexOf('capped.length === 0) return') < patchedDreamingNoCorpus.indexOf('await writeDailyDreamingPhaseBlock'));
assert.ok(patchedDreamingNoCorpus.indexOf('entries.length === 0) return') < patchedDreamingNoCorpus.indexOf('await writeDailyDreamingPhaseBlock', patchedDreamingNoCorpus.indexOf('async function runRemDreaming')));
assert.equal(patchDreamingNoCorpusSource(patchedDreamingNoCorpus), patchedDreamingNoCorpus);
assert.throws(() => patchDreamingNoCorpusSource(dreamingNoCorpusFixture), /digest mismatch/u);

const dreamingIndexFixture = `//#region extensions/memory-core/src/dreaming.ts
	let degradedNarratives = 0;
	let pendingNarratives = 0;
	const pluginConfig = {};
			degradedNarratives += phaseResult?.degradedPhases ?? 0;
			pendingNarratives += phaseResult?.pendingNarratives ?? 0;
			const repair = await repairShortTermPromotionArtifacts({ workspaceDir });
	const summary = \`memory-core: dreaming promotion complete (workspaces=\${workspaces.length}, candidates=\${totalCandidates}, applied=\${totalApplied}, failed=\${failedWorkspaces}, degraded=\${degradedNarratives}, narrativesPending=\${pendingNarratives}).\`;
	return {
		handled: true,
		reason: degradedNarratives > 0 ? "memory-core: short-term dreaming degraded" : "memory-core: short-term dreaming processed"
	};
}`;
const patchedDreamingIndex = patchDreamingIndexResultSource(dreamingIndexFixture, false);
assert.match(patchedDreamingIndex, new RegExp(MARKERS.dreamingNoCorpus));
assert.match(patchedDreamingIndex, /phaseResult\?\.reason === "SKIPPED_NO_ELIGIBLE_CORPUS"/u);
assert.match(patchedDreamingIndex, /DREAMING_RESULT=SKIPPED_NO_ELIGIBLE_CORPUS/u);
assert.match(patchedDreamingIndex, /workspaces\.length > 0 && failedWorkspaces === 0/u);
assert.match(patchedDreamingIndex, /reason: noCorpusResult \? "memory-core: SKIPPED_NO_ELIGIBLE_CORPUS"/u);
assert.ok(patchedDreamingIndex.indexOf('continue;') < patchedDreamingIndex.indexOf('repairShortTermPromotionArtifacts'));
assert.equal(patchDreamingIndexResultSource(patchedDreamingIndex), patchedDreamingIndex);
assert.throws(() => patchDreamingIndexResultSource(dreamingIndexFixture), /digest mismatch/u);

const backfillFixture = `const sources = corpus.filter((entry) => !sessionExclusionReason(entry, params.admissionPolicy, forgottenSessionIds));\nfor (const archiveFile of params.archiveFiles) {\n\tconst source = foreignSessionIngestionSource(params.agentId, archiveFile);\n\t\tif (!canonicalPaths.has(source.absolutePath)) {\n\t\t\tsources.push(source);\n\t\t\tcanonicalPaths.add(source.absolutePath);\n\t\t}\n}\nawait scanSessionIngestionSource({`;
assert.equal(verifySessionBackfillAdmissionBeforeScan(backfillFixture, false), true);
assert.throws(() => verifySessionBackfillAdmissionBeforeScan(backfillFixture), /digest mismatch/u);
const patchedBackfill = patchSessionBackfillSource(backfillFixture);
assert.match(patchedBackfill, new RegExp(MARKERS.sessionBackfill));
assert.match(patchedBackfill, /!sessionExclusionReason\(source, params\.admissionPolicy, forgottenSessionIds\)/u);
assert.equal(patchSessionBackfillSource(patchedBackfill), patchedBackfill);
assert.equal(verifySessionBackfillAdmissionBeforeScan(patchedBackfill, false), true);
assert.throws(() => verifySessionBackfillAdmissionBeforeScan(patchedBackfill.replace(' && !sessionExclusionReason(source, params.admissionPolicy, forgottenSessionIds)', ''), false), /not gated/u);

const manifestFixture = JSON.stringify({
  configSchema: {
    properties: {
      memoryPolicy: {
        type: 'object',
        additionalProperties: false,
        properties: { excludeSessions: { type: 'object' } },
      },
    },
  },
});
const patchedManifest = JSON.parse(patchPluginManifest(manifestFixture, false));
assert.throws(() => patchPluginManifest(manifestFixture), /digest mismatch/u);
assert.equal(patchedManifest.configSchema.properties.memoryPolicy.properties.allowedChannels.items.enum.join(','), 'telegram,whatsapp');
assert.equal(patchedManifest.configSchema.properties.memoryPolicy.properties.allowlistedDirectPeerFiles.properties.whatsapp.type, 'string');
assert.equal(patchedManifest.configSchema.properties.memoryPolicy.properties.allowlistedDirectPeerFiles.properties.telegram.type, 'string');

console.log('OPENCLAW_MEMORY_CORE_PATCH_TESTS=passed child_env=7 peer_match=15 admission=18 before_read=10 search_fts_status=12 source_patch=4 dreaming_skip=4 schema=4');
