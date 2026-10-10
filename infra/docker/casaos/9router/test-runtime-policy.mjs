#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import {
  MARKER, NO_LOCK_MARKER, patchAccountSource, patchRequiredConfig, patchStandaloneConfig,
  validatePolicy, verifyInstallation,
} from './patch-runtime-policy.mjs';
const policy = validatePolicy(JSON.parse(await readFile(new URL('../../../9router/runtime-policy.json', import.meta.url), 'utf8')));
const base = 'let k=await (0,d.getProviderConnections)({provider:g,isActive:!0});' +
  'async function m(a,b,c,e=null,i=null,k=null){let l,n,o;if(!a||"noauth"===a)return{shouldFallback:!1,cooldownMs:0};' +
  'if(r?(l=!0,n=r-Date.now(),o=0):k&&k>Date.now()?(l=!0,n=3e4,o=0):{shouldFallback:l,cooldownMs:n,newBackoffLevel:o}=(0,f.hk)(b,c,q,(0,h.rs)(e)),!l)return{shouldFallback:!1,cooldownMs:0};' +
  'j.warn("AUTH",`${v} locked ${u} for ${Math.round(n/1e3)}s [${b}]`),e&&b&&s&&console.error';
const patched = patchAccountSource(base, policy);
assert.match(patched, new RegExp(MARKER));
assert.match(patched, new RegExp(NO_LOCK_MARKER));
assert.match(patched, /amadeusImageRequestScopedFailure/);
assert.match(patched, /image_result_missing/);
assert.match(patched, /upstream_failed/);
assert.doesNotMatch(patched, /not\\s\+entitled|plus\/pro/);
assert.match(patched, /cooldownMs:0/);
assert.equal(patchAccountSource(patched, policy), patched);
assert.throws(() => patchAccountSource(base.replace('getProviderConnections', 'getConnections'), policy), /anchor_drift/);
assert.throws(() => patchAccountSource(base + base, policy), /anchor_drift/);
const config = { distDir: './.next-cli-build', experimental: { proxyClientMaxBodySize: '128mb' } };
const standalone = `const nextConfig = ${JSON.stringify(config)}\n\nprocess.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);`;
const updated = patchStandaloneConfig(standalone, policy);
assert.equal(patchStandaloneConfig(updated, policy), updated);
assert.equal(JSON.parse(updated.split('const nextConfig = ')[1].split('\n/*')[0]).experimental.serverActions.bodySizeLimit, '20mb');
const required = patchRequiredConfig(JSON.stringify({config:{...config,distDir:'.next-cli-build'}}),policy);
assert.equal(JSON.parse(required).config.experimental.serverActions.bodySizeLimit, '20mb');
assert.equal(patchRequiredConfig(required,policy),required);
assert.throws(() => patchRequiredConfig('{}', policy), /shape_drift/);
assert.throws(() => validatePolicy({...policy, packageVersion:'0.5.91'}), /invalid_runtime_policy/);


const publicPolicy = validatePolicy({
  packageVersion: '0.5.95',
  imageAccount: null,
  serverActions: { bodySizeLimit: '20mb' },
});
const publicBundle = patchAccountSource(base, publicPolicy);
assert.match(publicBundle, new RegExp(NO_LOCK_MARKER));
assert.doesNotMatch(publicBundle, new RegExp(MARKER));
assert.equal(patchAccountSource(publicBundle, publicPolicy), publicBundle);
assert.throws(() => patchAccountSource(patched, publicPolicy), /community_account_policy_must_be_unrestricted/);
assert.match(patchStandaloneConfig(standalone, publicPolicy), /20mb/);

// Execute the exact pinned compiled selector, not a duplicate policy helper.
const root = process.argv[process.argv.indexOf('--root') + 1];
if (root && root !== process.argv[0]) {
  await verifyInstallation(root,policy);
  const chunks = join(root, 'app/.next-cli-build/server/chunks');
  const { readdir } = await import('node:fs/promises');
  const files = await Promise.all((await readdir(chunks)).filter(x=>x.endsWith('.js')).map(async x=>readFile(join(chunks,x),'utf8')));
  const source = files.find(x=>x.includes(MARKER));
  assert.ok(source && files.filter(x=>x.includes(MARKER)).length===1);
  const exports = {};
  runInNewContext(source,{exports,console,process,Buffer,Set,setTimeout,clearTimeout});
  const providerModule = exports.modules[80238];
  assert.equal(typeof providerModule,'function','pinned_account_selector_module_drift');
  const other={id:'other',provider:'codex',email:'other@example.net',priority:1,isActive:true,accessToken:'fixture'};
  const target={id:'target',provider:'codex',email:policy.imageAccount.email,priority:2,isActive:true,accessToken:'fixture'};
  let accounts=[other,target];
  let updates=0;
  const noop=()=>{};
  const stubs={
    89718:{getProviderConnections:async()=>accounts.filter(x=>x.isActive),updateProviderConnection:async()=>{updates++},mt:async()=>({fallbackStrategy:'fill-first'})},
    39326:{B:async()=>({})},
    12557:{Bl:(a)=>Boolean(a.locked),kJ:()=>null},
    3662:{},40615:{rs:a=>a,IS:{}},45974:{d0:()=>new Map()},
    7803:{debug:noop,warn:noop,info:noop},
  };
  function requireId(id){if(!(id in stubs))throw Error(`unexpected_module_${id}`);return stubs[id];}
  requireId.d=(destination,fields)=>{for(const [key,get] of Object.entries(fields))Object.defineProperty(destination,key,{get});};
  const moduleExports={}; providerModule({},moduleExports,requireId);
  const noLock=await moduleExports.vk('target',502,'amadeus_image_image_result_missing','codex','gpt-image-2.5');
  assert.deepEqual(noLock,{shouldFallback:true,cooldownMs:0},'request-scoped image failure must not lock the account');
  assert.equal(updates,0,'request-scoped image failure must not update provider state');
  const select=moduleExports.c1;
  assert.equal(typeof select,'function');
  for (const model of policy.imageAccount.models) {
    assert.equal((await select('codex',null,model)).connectionId,'target','target only even when lower priority');
    assert.equal((await select('codex',null,model,{preferredConnectionId:'other'})).connectionId,'target','other preferred ID denied');
    assert.equal(await select('codex',new Set(['target']),model),null,'other account denied on retry');
  }
  accounts=[other,{...target,isActive:false}];
  assert.equal(await select('codex',null,policy.imageAccount.models[0]),null,'other account denied when target inactive');
  accounts=[other,{...target,locked:true}];
  assert.equal(await select('codex',null,policy.imageAccount.models[0]),null,'other account denied when target model locked');
  accounts=[other,target];
  assert.equal((await select('codex',null,'gpt-6-sol')).connectionId,'other','other models unchanged');
  accounts=[{...other,provider:'antigravity'}];
  assert.equal((await select('antigravity',null,'gemini-3.1-flash-image')).connectionId,'other','other providers unchanged');
  console.log('9ROUTER_COMPILED_SELECTOR_TEST=passed');
}
console.log('9ROUTER_RUNTIME_POLICY_TEST=passed');
