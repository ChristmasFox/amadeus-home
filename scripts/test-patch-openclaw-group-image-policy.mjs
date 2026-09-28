#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  extendSenderPolicyForGroupImage,
  GROUP_READONLY_CAPABILITY_TOOLS,
  MARKER,
  patchConversationPolicySource,
  policyPaths,
} from './patch-openclaw-group-image-policy.mjs';

const runtimeRoot = path.resolve('node_modules/.pnpm/openclaw@2026.9.4/node_modules/openclaw/dist');
const paths = policyPaths(runtimeRoot);
assert.deepEqual(paths.map((item) => item.flavor), ['esm', 'worker']);
const patched = paths.map(({ file, flavor }) => {
  const original = fs.readFileSync(file, 'utf8');
  const result = patchConversationPolicySource(original, flavor);
  assert.notEqual(result, original, `${flavor}: unmodified pinned runtime expected in test store`);
  assert.equal(result.split(MARKER).length - 1, 1);
  assert.equal(patchConversationPolicySource(result, flavor), result, 'patch must be idempotent');
  assert.match(result, /senderPolicy:\s*mergePolicyAllowlist\(extendSenderPolicyForGroupImage\(/u);
  const senderAnchor = flavor === 'esm'
    ? 'senderPolicy: mergePolicyAllowlist(policy.senderPolicy, params.additionalPolicyAllow),'
    : 'senderPolicy:mergePolicyAllowlist(Zt.senderPolicy,Ot.additionalPolicyAllow),';
  assert.throws(() => patchConversationPolicySource(original.replace(senderAnchor, 'changedSenderPolicy:'), flavor), /anchor count=0/u);
  return { file, flavor, result };
});

const base = {
  conversation: { chatType: 'group', messageProvider: 'whatsapp', groupId: 'fixture-group',
    policySessionKey: 'agent:main:whatsapp:group:fixture-group' },
  policy: {
    delegated: false,
    trustedGroup: { groupId: 'fixture-group', dropped: false },
    groupPolicy: { allow: [...GROUP_READONLY_CAPABILITY_TOOLS, 'web_search', 'web_fetch'] },
    senderPolicy: { allow: ['web_search', 'web_fetch'] },
    globalPolicy: { deny: ['tts', 'message'] },
  },
};
const amended = extendSenderPolicyForGroupImage(base);
assert.deepEqual(amended, { allow: ['web_search', 'web_fetch', ...GROUP_READONLY_CAPABILITY_TOOLS] });
assert.deepEqual(base.policy.senderPolicy.allow, ['web_search', 'web_fetch'], 'input must not be mutated');
for (const invalid of [
  { conversation: { ...base.conversation, chatType: 'direct' } },
  { conversation: { ...base.conversation, messageProvider: 'discord' } },
  { conversation: { ...base.conversation, policySessionKey: 'agent:main:whatsapp:direct:fixture-person' } },
  { policy: { ...base.policy, trustedGroup: { groupId: 'fixture-group', dropped: true } } },
  { policy: { ...base.policy, delegated: true } },
  { policy: { ...base.policy, groupPolicy: { allow: ['web_search', 'web_fetch'] } } },
]) {
  const profile = { ...base, ...invalid };
  assert.equal(extendSenderPolicyForGroupImage(profile), profile.policy.senderPolicy, 'untrusted or unconfigured scope must not expand sender allowlist');
}
assert.deepEqual(extendSenderPolicyForGroupImage({ ...base, policy: { ...base.policy, trustedGroup: { groupId: undefined, dropped: false } } }).allow,
  amended.allow, 'caller groupId may be absent while the trusted session remains a group');
const telegram = { ...base, conversation: { ...base.conversation, messageProvider: 'telegram',
  policySessionKey: 'agent:main:telegram:group:fixture-group' } };
assert.deepEqual(extendSenderPolicyForGroupImage(telegram).allow, amended.allow);

// Load the exact patched pinned module through its native imports, not a
// hand-written imitation of the policy resolver.
const esm = patched[0];
const temporaryEsm = path.join(runtimeRoot, `conversation-tool-policy-pipeline-amadeus-test-${process.pid}.mjs`);
const temporaryWorker = path.join(os.tmpdir(), `openclaw-group-image-worker-${process.pid}.mjs`);
try {
  fs.writeFileSync(temporaryEsm, esm.result, { flag: 'wx' });
  fs.writeFileSync(temporaryWorker, patched[1].result, { flag: 'wx' });
  for (const file of [temporaryEsm, temporaryWorker]) {
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
  }
const runtime = await import(pathToFileURL(temporaryEsm).href);
  const matchModule = path.join(runtimeRoot, fs.readdirSync(runtimeRoot).find((name) => /^tool-policy-match-.*\.mjs$/.test(name) &&
    fs.readFileSync(path.join(runtimeRoot, name), 'utf8').includes('function filterToolsByPolicy(')));
  const { r: filterToolsByPolicy } = await import(pathToFileURL(matchModule).href);
  const catalog = ['image_generate', 'web_search', 'web_fetch', ...GROUP_READONLY_CAPABILITY_TOOLS.filter((name) => name !== 'image_generate'), 'amadeus_nas', 'exec', 'tts', 'message'].map((name) => ({ name }));
  const expectedGroupTools = ['image_generate', 'web_search', 'web_fetch', ...GROUP_READONLY_CAPABILITY_TOOLS.filter((name) => name !== 'image_generate')];
  const effective = (profile) => {
    const policies = runtime.r({ capabilityProfile: profile });
    return [policies.globalPolicy, policies.groupPolicy, policies.senderPolicy].reduce(
      (tools, policy) => filterToolsByPolicy(tools, policy), catalog,
    ).map((tool) => tool.name);
  };
  assert.deepEqual(effective(base), expectedGroupTools);
  assert.deepEqual(effective(telegram), expectedGroupTools);
  assert.deepEqual(effective({ ...base, conversation: { ...base.conversation, chatType: 'direct' }, policy: {
    ...base.policy, groupPolicy: undefined, trustedGroup: { groupId: undefined, dropped: false },
  } }), ['web_search', 'web_fetch'], 'non-owner DM stays web-only');
  assert.deepEqual(effective({ ...base, policy: { ...base.policy, groupPolicy: { allow: ['*'] }, senderPolicy: { allow: ['*'] } } }),
    ['image_generate', 'web_search', 'web_fetch', ...GROUP_READONLY_CAPABILITY_TOOLS.filter((name) => name !== 'image_generate'), 'amadeus_nas', 'exec'], 'owner group stays full except global deny');
  assert.deepEqual(effective({ ...base, policy: { ...base.policy, groupPolicy: { allow: ['web_search', 'web_fetch', 'image_generate'], deny: ['image_generate'] } } }),
    ['web_search', 'web_fetch'], 'group deny still wins');
  assert.deepEqual(effective({ ...base, policy: { ...base.policy, globalPolicy: { deny: ['tts', 'message', 'image_generate'] } } }),
    ['web_search', 'web_fetch', ...GROUP_READONLY_CAPABILITY_TOOLS.filter((name) => name !== 'image_generate')], 'global deny still wins');
  // Exercise the pinned requester/group resolvers with the actual source
  // config. This covers optional caller groupId and direct-chat isolation.
  const config = JSON.parse(fs.readFileSync('integrations/openclaw/openclaw.json.example', 'utf8'));
  config.tools.toolsBySender['id:fixture-owner'] = { allow: ['*'] };
  config.channels.whatsapp.groups['*'].toolsBySender = { 'id:fixture-owner': { allow: ['*'] } };
  const agentPolicyFile = fs.readdirSync(runtimeRoot).find((name) => /^agent-tools\.policy-.*\.mjs$/.test(name));
  const senderPolicyFile = fs.readdirSync(runtimeRoot).find((name) => /^sender-tool-policy-.*\.mjs$/.test(name));
  assert.ok(agentPolicyFile && senderPolicyFile);
  const { r: resolveGroupToolPolicy, o: resolveTrustedGroupId } = await import(pathToFileURL(path.join(runtimeRoot, agentPolicyFile)).href);
  const { t: resolveSenderToolPolicy } = await import(pathToFileURL(path.join(runtimeRoot, senderPolicyFile)).href);
  const profileFor = ({ channel, scope, sender, suppliedGroupId }) => {
    const sessionKey = `agent:main:${channel}:${scope}:${scope === 'group' ? 'fixture-group' : 'fixture-dm'}`;
    return {
      conversation: { chatType: scope, messageProvider: channel, policySessionKey: sessionKey },
      policy: {
        delegated: false,
        trustedGroup: resolveTrustedGroupId({ sessionKey, groupId: suppliedGroupId }),
        groupPolicy: resolveGroupToolPolicy({ config, sessionKey, messageProvider: channel,
          groupId: suppliedGroupId, accountId: channel === 'whatsapp' ? 'secondary' : undefined,
          senderId: sender, senderPolicyMode: 'always' }),
        senderPolicy: resolveSenderToolPolicy({ config, agentId: 'main', sessionKey,
          messageProvider: channel, senderId: sender }),
        globalPolicy: { deny: config.tools.deny },
      },
    };
  };
  assert.deepEqual(effective(profileFor({ channel: 'whatsapp', scope: 'group', sender: 'fixture-nonowner' })),
    expectedGroupTools, 'admitted WhatsApp group sender gets group capabilities');
  assert.deepEqual(effective(profileFor({ channel: 'telegram', scope: 'group', sender: 'fixture-nonowner' })),
    expectedGroupTools, 'admitted Telegram group sender gets group capabilities');
  assert.deepEqual(effective(profileFor({ channel: 'whatsapp', scope: 'direct', sender: 'fixture-nonowner' })),
    ['web_search', 'web_fetch'], 'WhatsApp non-owner DM does not gain image');
  assert.deepEqual(effective(profileFor({ channel: 'whatsapp', scope: 'direct', sender: 'fixture-owner' })),
    [...expectedGroupTools, 'amadeus_nas', 'exec'], 'owner DM unchanged');
  assert.deepEqual(effective(profileFor({ channel: 'whatsapp', scope: 'group', sender: 'fixture-owner' })),
    ['image_generate', 'web_search', 'web_fetch', ...GROUP_READONLY_CAPABILITY_TOOLS.filter((name) => name !== 'image_generate'), 'amadeus_nas', 'exec'], 'owner group unchanged');
  assert.deepEqual(effective(profileFor({ channel: 'whatsapp', scope: 'direct', sender: 'fixture-nonowner',
    suppliedGroupId: 'fixture-group' })), ['web_search', 'web_fetch'], 'forged direct groupId cannot grant image');
} finally {
  fs.rmSync(temporaryEsm, { force: true });
  fs.rmSync(temporaryWorker, { force: true });
}
console.log('OPENCLAW_GROUP_IMAGE_POLICY=passed');
