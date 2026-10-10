#!/usr/bin/env node
// Version/shape-guarded patch for 9Router's published Next standalone build.
// No global account priority, authentication or request-level preferred ID can
// enforce a model whitelist: filter at the shared native credential selector.
import { readFile, writeFile, readdir, chmod, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MARKER = 'amadeus-image-account-policy-0.5.95';
export const NO_LOCK_MARKER = 'amadeus-image-request-scoped-no-lock-0.5.95';
const ACCOUNT_ANCHOR = 'let k=await (0,d.getProviderConnections)({provider:g,isActive:!0});';
const MARK_ACCOUNT_ANCHOR = 'async function m(a,b,c,e=null,i=null,k=null){';
const CONFIG_ANCHOR = 'const nextConfig = ';
const CONFIG_END = '\n\nprocess.env.__NEXT_PRIVATE_STANDALONE_CONFIG';

function one(source, anchor, name) {
  if (source.split(anchor).length !== 2) throw Error(`${name}_anchor_drift`);
}

export function validatePolicy(policy) {
  if (!policy || policy.packageVersion !== '0.5.95' ||
      !(policy.imageAccount === null || (
        policy.imageAccount?.provider === 'codex' &&
        JSON.stringify(policy.imageAccount?.models) === JSON.stringify(['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2.5']) &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(policy.imageAccount.email)
      )) ||
      policy.serverActions?.bodySizeLimit !== '20mb' ||
      Object.keys(policy).sort().join(',') !== 'imageAccount,packageVersion,serverActions') {
    throw Error('invalid_runtime_policy');
  }
  return policy;
}

export function patchAccountSource(source, policy) {
  validatePolicy(policy);
  if (!policy.imageAccount && source.includes(MARKER)) throw Error('community_account_policy_must_be_unrestricted');
  if (source.includes(NO_LOCK_MARKER) && (!policy.imageAccount || source.includes(MARKER))) return source;
  one(source, ACCOUNT_ANCHOR, 'account_selector');
  // Run before preferredConnectionId, rotation, model locks and retry exclusion.
  // With zero allowed active accounts, fail closed; Combo may still use its
  // different next model, never a different account for this model.
  const condition = policy.imageAccount ? JSON.stringify(policy.imageAccount.provider) + '===g&&' +
    JSON.stringify(policy.imageAccount.models) + '.includes(c)' : null;
  const email = policy.imageAccount ? JSON.stringify(policy.imageAccount.email.toLowerCase()) : null;
  let output = source;
  if (policy.imageAccount && !output.includes(MARKER)) {
    output = output.replace(ACCOUNT_ANCHOR, ACCOUNT_ANCHOR +
      `/* ${MARKER} */if(${condition})k=k.filter(a=>String(a.email||"").trim().toLowerCase()===${email});`);
  }
  if (!output.includes(NO_LOCK_MARKER)) {
    one(output, MARK_ACCOUNT_ANCHOR, 'account_failure_handler');
    const noLock = `/* ${NO_LOCK_MARKER} */const amadeusImageRequestScopedFailure="codex"===(0,h.rs)(e)&&typeof i==="string"&&/^gpt-image-/u.test(i)&&typeof c==="string"&&/amadeus_image_(?:image_result_missing|sse_incomplete|transport_interrupted|upstream_failed)/u.test(c);if(amadeusImageRequestScopedFailure)return{shouldFallback:!0,cooldownMs:0};`;
    output = output.replace(MARK_ACCOUNT_ANCHOR, `${MARK_ACCOUNT_ANCHOR}${noLock}`);
  }
  return output;
}

export function patchStandaloneConfig(source, policy) {
  validatePolicy(policy);
  if (source.includes(`/* ${MARKER}-actions */`)) return source;
  one(source, CONFIG_ANCHOR, 'standalone_config');
  one(source, CONFIG_END, 'standalone_config_end');
  const start = source.indexOf(CONFIG_ANCHOR) + CONFIG_ANCHOR.length;
  const end = source.indexOf(CONFIG_END, start);
  const config = JSON.parse(source.slice(start, end));
  if (!config.experimental || config.distDir !== './.next-cli-build') throw Error('standalone_config_shape_drift');
  config.experimental.serverActions = {
    ...config.experimental.serverActions, bodySizeLimit: policy.serverActions.bodySizeLimit,
  };
  return `${source.slice(0, start)}${JSON.stringify(config)}\n/* ${MARKER}-actions */${source.slice(end)}`;
}

export function patchRequiredConfig(source, policy) {
  validatePolicy(policy);
  const json = JSON.parse(source);
  if (!json.config?.experimental || !['.next-cli-build', './.next-cli-build'].includes(json.config.distDir)) {
    throw Error('required_config_shape_drift');
  }
  json.config.experimental.serverActions = {
    ...json.config.experimental.serverActions, bodySizeLimit: policy.serverActions.bodySizeLimit,
  };
  return JSON.stringify(json);
}

export async function plan(root, policy) {
  validatePolicy(policy);
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (pkg.version !== policy.packageVersion) throw Error(`9router_version_mismatch:${pkg.version}`);
  const app = join(root, 'app');
  const chunks = join(app, '.next-cli-build/server/chunks');
  const candidates = [];
  for (const name of await readdir(chunks)) {
    if (!name.endsWith('.js')) continue;
    const path = join(chunks, name);
    const source = await readFile(path, 'utf8');
    if (source.includes(ACCOUNT_ANCHOR) || source.includes(MARKER)) candidates.push({ path, source });
  }
  if (candidates.length !== 1) throw Error(`account_selector_bundle_count:${candidates.length}`);
  const account = candidates[0];
  const standalone = join(app, 'server.js');
  const required = join(app, '.next-cli-build/required-server-files.json');
  const files = [
    { path: account.path, before: account.source, after: patchAccountSource(account.source, policy) },
    { path: standalone, before: await readFile(standalone, 'utf8') },
    { path: required, before: await readFile(required, 'utf8') },
  ];
  files[1].after = patchStandaloneConfig(files[1].before, policy);
  files[2].after = patchRequiredConfig(files[2].before, policy);
  return files;
}

export async function verifyInstallation(root, policy) {
  const changes = await plan(root, policy);
  if (changes.some(({ before, after }) => before !== after)) throw Error('runtime_policy_not_installed');
  if ((policy.imageAccount && !changes[0].before.includes(MARKER)) ||
      (!policy.imageAccount && changes[0].before.includes(MARKER)) ||
      !changes[0].before.includes(NO_LOCK_MARKER) || !changes[1].before.includes(`${MARKER}-actions`)) {
    throw Error('runtime_policy_marker_missing');
  }
  return true;
}

async function main() {
  const root = process.argv[process.argv.indexOf('--root') + 1];
  const file = process.argv[process.argv.indexOf('--policy') + 1];
  const mode = process.argv.includes('--apply') ? 'apply' : 'verify';
  if (!root || !file) throw Error('usage: patch-runtime-policy.mjs --root PACKAGE --policy JSON [--apply]');
  const policy = validatePolicy(JSON.parse(await readFile(file, 'utf8')));
  if (mode === 'verify') { await verifyInstallation(root, policy); console.log('9ROUTER_POLICY=verified'); return; }
  const files = await plan(root, policy); // all anchors validated before writing
  for (const { path, before, after } of files) {
    if (before === after) continue;
    const perms = (await stat(path)).mode & 0o777;
    await writeFile(path, after);
    await chmod(path, perms);
  }
  await verifyInstallation(root, policy);
  console.log('9ROUTER_POLICY=installed');
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
