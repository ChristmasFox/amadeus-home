#!/usr/bin/env node
/**
 * Version-pinned OpenClaw 2026.9.4 policy bridge for native group capabilities.
 *
 * Group tools and global toolsBySender are intersecting filters in 2026.9.4.
 * The non-owner global sender allowlist must remain web-only for WhatsApp DMs.
 * Add only the explicit read-only group capabilities to that sender layer when
 * a trusted WhatsApp or Telegram group turn has the matching allowlist. The group layer,
 * global deny, and all unrelated sender restrictions still apply. Patch both
 * the normal ESM module and its independently bundled worker copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER = 'AMADEUS_GROUP_IMAGE_POLICY_2026_09';
export const GROUP_READONLY_CAPABILITY_TOOLS = [
  'image_generate',
  'pubg_resolve_players',
  'pubg_search_matches',
  'pubg_query_stats',
  'pubg_compare_stats',
  'pubg_get_match',
  'pubg_get_review_facts',
  'pubg_get_period_review',
  'pubg_query_team_damage',
  'pubg_prefetch_telemetry',
  'pubg_telemetry_sync_report',
  'amadeus_macos_host_status',
  'amadeus_macos_host_processes',
];

export function extendSenderPolicyForGroupImage(capabilityProfile) {
  const policy = capabilityProfile?.policy;
  const senderPolicy = policy?.senderPolicy;
  const groupPolicy = policy?.groupPolicy;
  const context = capabilityProfile?.conversation;
  const trustedGroup = policy?.trustedGroup;
  if (!senderPolicy || !Array.isArray(senderPolicy.allow) || senderPolicy.allow.length === 0 ||
      senderPolicy.allow.includes('*')) return senderPolicy;
  if (policy.delegated !== false || trustedGroup?.dropped === true ||
      context?.chatType !== 'group') return senderPolicy;
  const channel = String(context.messageProvider || context.messageChannel || '').trim().toLowerCase();
  if (channel !== 'whatsapp' && channel !== 'telegram') return senderPolicy;
  // A caller groupId is optional. Trust the server-derived policy session key,
  // not an arbitrary groupId supplied alongside a direct-chat turn.
  const sessionParts = String(context.policySessionKey || context.sessionKey || '').trim().toLowerCase().split(':');
  const offset = sessionParts[0] === 'agent' ? 2 : 0;
  if (sessionParts[offset] !== channel || sessionParts[offset + 1] !== 'group' ||
      !sessionParts[offset + 2]) return senderPolicy;
  const groupCapabilityTools = ['image_generate', 'pubg_resolve_players', 'pubg_search_matches', 'pubg_query_stats', 'pubg_compare_stats', 'pubg_get_match', 'pubg_get_review_facts', 'pubg_get_period_review', 'pubg_query_team_damage', 'pubg_prefetch_telemetry', 'pubg_telemetry_sync_report', 'amadeus_macos_host_status', 'amadeus_macos_host_processes'];
  if (!Array.isArray(groupPolicy?.allow) || !groupPolicy.allow.some((tool) => groupCapabilityTools.includes(tool))) return senderPolicy;
  // Do not remove any deny: the native matcher still gives deny precedence.
  const groupCapabilities = groupPolicy.allow.filter((tool) => groupCapabilityTools.includes(tool));
  return { ...senderPolicy, allow: [...new Set([...senderPolicy.allow, ...groupCapabilities])] };
}

function replaceOnce(source, find, replacement, label) {
  const count = source.split(find).length - 1;
  if (count !== 1) throw new Error(`pinned ${label} anchor count=${count}; refusing to patch`);
  return source.replace(find, replacement);
}

export function patchConversationPolicySource(original, flavor) {
  if (flavor !== 'esm' && flavor !== 'worker') throw new Error('invalid policy bundle flavor');
  const helper = `\n// ${MARKER}\n${extendSenderPolicyForGroupImage.toString()}\n`;
  const anchor = flavor === 'esm'
    ? 'function resolveConversationToolPolicies(params) {'
    : 'function resolveConversationToolPolicies(Ot){';
  const current = flavor === 'esm'
    ? 'senderPolicy: mergePolicyAllowlist(policy.senderPolicy, params.additionalPolicyAllow),'
    : 'senderPolicy:mergePolicyAllowlist(Zt.senderPolicy,Ot.additionalPolicyAllow),';
  const replacement = flavor === 'esm'
    ? 'senderPolicy: mergePolicyAllowlist(extendSenderPolicyForGroupImage(params.capabilityProfile), params.additionalPolicyAllow),'
    : 'senderPolicy:mergePolicyAllowlist(extendSenderPolicyForGroupImage(Ot.capabilityProfile),Ot.additionalPolicyAllow),';
  if (original.includes(MARKER)) {
    if (!original.includes(replacement) || original.split(MARKER).length !== 2) {
      throw new Error('incomplete or duplicate group image policy patch');
    }
    return original;
  }
  let result = replaceOnce(original, anchor, helper + anchor, `${flavor} function`);
  result = replaceOnce(result, current, replacement, `${flavor} sender layer`);
  return result;
}

export function policyPaths(coreRoot) {
  const modules = fs.readdirSync(coreRoot).filter((name) => /^conversation-tool-policy-pipeline-[A-Za-z0-9_-]+\.mjs$/.test(name));
  if (modules.length !== 1) throw new Error(`expected exactly one pinned conversation policy module; found ${modules.length}`);
  const worker = path.join(coreRoot, 'worker', 'worker.mjs');
  if (!fs.statSync(worker).isFile()) throw new Error('pinned worker policy bundle missing');
  return [
    { file: path.join(coreRoot, modules[0]), flavor: 'esm' },
    { file: worker, flavor: 'worker' },
  ];
}

function main(argv) {
  let coreRoot;
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--core-root') coreRoot = argv[++i];
    else if (argv[i] === '--apply') apply = true;
    else throw new Error(`unknown option ${argv[i]}`);
  }
  if (!coreRoot || !path.isAbsolute(coreRoot)) throw new Error('--core-root must be an absolute path');
  const changes = policyPaths(coreRoot).map(({ file, flavor }) => {
    const original = fs.readFileSync(file, 'utf8');
    const patched = patchConversationPolicySource(original, flavor);
    return { file, flavor, original, patched };
  });
  if (apply) {
    for (const { file, original, patched } of changes) {
      if (patched !== original) fs.writeFileSync(file, patched);
    }
  }
  console.log(`OPENCLAW_GROUP_IMAGE_POLICY=${apply ? 'applied' : 'patchable'} bundles=${changes.length}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`OPENCLAW_GROUP_IMAGE_POLICY=failed ${error.message}`);
    process.exitCode = 1;
  }
}
