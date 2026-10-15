#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  BASE_CHILD_ENV,
  MARKERS,
  buildMemoryCoreChildEnv,
  classifyDreamingSessionAdmission,
  normalizeWhatsAppPeer,
  patchChildEnvSource,
  patchPluginManifest,
  patchSessionAdmissionSource,
  whatsappSessionMatchesPeer,
} from './patch-openclaw-memory-core.mjs';

const armLoaderPath = '/opt/amadeus-glibc/usr/lib/aarch64-linux-gnu:/lib/aarch64-linux-gnu:/usr/lib/aarch64-linux-gnu';
const safeEnv = buildMemoryCoreChildEnv({ PATH: '/usr/bin', LD_LIBRARY_PATH: `${armLoaderPath}:/tmp/untrusted` }, 'arm64');
assert.equal(safeEnv.PATH, '/usr/bin');
assert.equal(safeEnv.LD_LIBRARY_PATH, armLoaderPath);
assert.equal(Object.keys(safeEnv).includes('/tmp/untrusted'), false);
assert.equal(buildMemoryCoreChildEnv({ LD_LIBRARY_PATH: '/tmp/untrusted' }, 'arm64').LD_LIBRARY_PATH, undefined);
assert.equal(buildMemoryCoreChildEnv({ LD_LIBRARY_PATH: armLoaderPath }, 'arm64').LD_LIBRARY_PATH, armLoaderPath);

const originalChildSource = `prefix\n${BASE_CHILD_ENV}\nsuffix`;
const patchedChildSource = patchChildEnvSource(originalChildSource);
assert.match(patchedChildSource, new RegExp(MARKERS.childEnv));
assert.equal(patchChildEnvSource(patchedChildSource), patchedChildSource);

const ownerPeer = 'whatsapp:+19995550123';
const ownerSession = 'agent:main:whatsapp:secondary:direct:+19995550123@s.whatsapp.net';
const otherSession = 'agent:main:whatsapp:secondary:direct:+19995550124@s.whatsapp.net';
assert.equal(normalizeWhatsAppPeer(ownerPeer), normalizeWhatsAppPeer('+19995550123@s.whatsapp.net'));
assert.equal(whatsappSessionMatchesPeer(ownerSession, `${ownerPeer}\n`), true);
assert.equal(whatsappSessionMatchesPeer(otherSession, ownerPeer), false);
assert.equal(whatsappSessionMatchesPeer(ownerSession, `${ownerPeer}\nother-peer`), false);

const policy = {
  hookExternalContentSources: [],
  channels: [],
  chatTypes: ['group', 'channel'],
  allowedChannels: ['whatsapp', 'telegram'],
  allowlistedDirectPeerFiles: { whatsapp: '/run/secrets/owner_whatsapp_target' },
};
const readPeerFile = () => ownerPeer;
const classify = (metadata, sessionKey, reader = readPeerFile) =>
  classifyDreamingSessionAdmission({ metadata, sessionKey, policy, readPeerFile: reader });
assert.equal(classify({ channel: 'whatsapp', chatType: 'direct' }, ownerSession), undefined);
assert.equal(classify({ channel: 'whatsapp', chatType: 'direct' }, otherSession), 'whatsapp-peer:not-allowlisted');
assert.equal(classify({ channel: 'whatsapp', chatType: 'group' }, ownerSession), 'chatType:group');
assert.equal(classify({ channel: 'whatsapp', chatType: 'channel' }, ownerSession), 'chatType:channel');
assert.equal(classify({ channel: 'telegram', chatType: 'direct' }, 'agent:main:telegram:direct:allowlisted-peer'), undefined);
assert.equal(classify({ channel: 'discord', chatType: 'direct' }, 'agent:main:discord:direct:peer'), 'channel:not-allowlisted');
assert.equal(classify(undefined, ownerSession), 'session-metadata:missing');
assert.equal(classify({ channel: 'whatsapp', chatType: 'direct' }, ownerSession, () => { throw new Error('unreadable'); }), 'whatsapp-peer:allowlist-unavailable');

const admissionFixture = `import fs from "node:fs/promises";\nfunction resolveAdmissionPolicy(pluginConfig) {\n\treturn;\n}\nfunction sessionExclusionReason(source, policy, forgottenSessionIds) {\n\treturn;\n}\nfunction sessionIngestionStateKeyFromCorpus(entry) {\n\treturn;\n}`;
const patchedAdmission = patchSessionAdmissionSource(admissionFixture);
assert.match(patchedAdmission, new RegExp(MARKERS.sessionAdmission));
assert.match(patchedAdmission, /readDreamingPeerAllowlist/u);
assert.equal(patchSessionAdmissionSource(patchedAdmission), patchedAdmission);

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
assert.equal(patchedManifest.configSchema.properties.memoryPolicy.properties.allowedChannels.items.enum.join(','), 'telegram,whatsapp');
assert.equal(patchedManifest.configSchema.properties.memoryPolicy.properties.allowlistedDirectPeerFiles.properties.whatsapp.type, 'string');

console.log('OPENCLAW_MEMORY_CORE_PATCH_TESTS=passed child_env=4 peer_match=4 admission=8 source_patch=2 schema=2');
