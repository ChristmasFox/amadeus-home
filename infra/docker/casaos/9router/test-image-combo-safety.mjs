#!/usr/bin/env node
import assert from 'node:assert/strict';
import { DIAGNOSTIC_MARKER, isImageSafetyFailure, MARKER, patchImageComboSource } from './patch-image-combo-safety.mjs';

assert.equal(isImageSafetyFailure(400, 'content policy violation'), true);
assert.equal(isImageSafetyFailure(403, 'safety refusal'), true);
assert.equal(isImageSafetyFailure(502, 'amadeus_image_safety_refusal'), true);
assert.equal(isImageSafetyFailure(502, 'upstream unavailable'), false);
assert.equal(isImageSafetyFailure(400, 'invalid prompt'), false);

const source = [
  'async function q({body:a,models:b,handleSingleModel:c,log:g,comboName:i,comboStrategy:j,comboStickyLimit:k=1,autoSwitch:m=!0}){',
  'let o=b,p=null,r=null,s=null;for(let b=0;b<o.length;b++){let e=o[b];try{let f=await c(a,e);if(f.ok){',
  'if(b!==o.length-1&&(f.headers?.get?.("content-type")||"").includes("application/json"))try{let a=await f.clone().json();if(function(a){return !1}(a)){',
  'g.warn("COMBO",`Model ${e} returned HTTP 200 with zero usable content, falling back to next model`),p="Zero usable content",s=200;continue}}catch{}return g.info("COMBO",`Model ${e} succeeded`),f}',
  'let h=f.statusText||"",i=null;try{let a=await f.clone().json();h=a?.error?.message||a?.error||a?.message||h,i=a?.retryAfter||null}catch{}if(i&&(!r||new Date(i)<new Date(r))&&(r=i),"string"!=typeof h)try{h=JSON.stringify(h)}catch{h=String(h)}',
  'let{shouldFallback:j,cooldownMs:k}=(0,d.hk)(f.status,h);if(!j)return g.warn("COMBO",`Model ${e} failed (no fallback)`,{status:f.status}),f;k&&k>0&&k<=5e3&&await new Promise(a=>setTimeout(a,k)),p=h||String(f.status),s||(s=f.status),g.warn("COMBO",`Model ${e} failed, trying next`,{status:f.status})',
  '}catch(a){p=a.message||String(a),s||(s=500),g.warn("COMBO",`Model ${e} threw error, trying next`,{error:p})}}let t=p&&p.toLowerCase().includes("no credentials")?503:s||503,u=p||"All combo models unavailable";return new Response(JSON.stringify({error:{message:u}}),{status:t})}',
].join('');

const patched = patchImageComboSource(source);
assert.match(patched, new RegExp(MARKER));
assert.match(patched, new RegExp(DIAGNOSTIC_MARKER));
assert.match(patched, /safety refusal; no fallback/);
assert.match(patched, /x-amadeus-image-model/);
assert.match(patched, /account_unavailable/);
assert.match(patched, /amadeus_cloud_image_attempt/);
assert.match(patched, /cooldownDecision/);
assert.match(patched, /upstream_failed/);
assert.match(patched, /x-amadeus-image-error-code/);
assert.match(patched, /upstreamErrorType/);
assert.match(patched, /upstreamErrorReason/);
assert.doesNotMatch(patched, /not\s\+entitled|plus\/pro/iu);
assert.ok(patched.indexOf('if(amadeusSafetyRefusal)') < patched.indexOf('let{shouldFallback:j,cooldownMs:k}'));
assert.match(patched, /if\(amadeusSafetyRefusal\).*?return f;/u);
assert.doesNotMatch(patched, /g\.warn\("COMBO"[^\n]*(?:message|body):h/u);
assert.equal(patchImageComboSource(patched), patched);

const comboFactory = new Function('d', 'logger', 'roundRobinState', 'capabilities', `${patched};return q;`);
const makeCombo = (responseFor, fallbackDecision) => {
  let requests = 0;
  let fallbackChecks = 0;
  const logs = [];
  const combo = comboFactory(
    { hk(status, message) { fallbackChecks++; return fallbackDecision(status, message); } },
    { info(...args) { logs.push(args); }, warn(...args) { logs.push(args); } },
    { get() { return null; }, set() {} },
    () => new Set(),
  );
  return {
    combo,
    logs,
    get requests() { return requests; },
    get fallbackChecks() { return fallbackChecks; },
    handle: async (_body, model) => { requests++; return responseFor(model); },
  };
};

const safety = makeCombo(
  () => new Response(JSON.stringify({ error: { message: 'content policy violation' } }), { status: 400 }),
  () => ({ shouldFallback: true, cooldownMs: 1 }),
);
const refused = await safety.combo({ body: { prompt: 'fixture' }, models: ['p/one', 'p/two'], handleSingleModel: safety.handle,
  log: { info() {}, warn(...args) { safety.logs.push(args); } }, comboName: 'amadeus-image', autoSwitch: false });
assert.equal(refused.status, 400);
assert.equal(safety.requests, 1, 'safety refusal must not invoke the next model');
assert.equal(safety.fallbackChecks, 0, 'safety refusal must return before upstream fallback policy');

const ordinaryFailure = makeCombo(
  model => model === 'p/one'
    ? new Response(JSON.stringify({ error: { message: 'invalid prompt' } }), { status: 400 })
    : new Response(JSON.stringify({ data: [{ b64_json: 'fixture' }] }), { status: 200 }),
  () => ({ shouldFallback: true, cooldownMs: 0 }),
);
const success = await ordinaryFailure.combo({ body: { prompt: 'fixture' }, models: ['p/one', 'p/two'], handleSingleModel: ordinaryFailure.handle,
  log: { info() {}, warn(...args) { ordinaryFailure.logs.push(args); } }, comboName: 'amadeus-image', autoSwitch: false });
assert.equal(success.status, 200);
assert.equal(ordinaryFailure.requests, 2, 'non-safety fallback should keep working');
assert.equal(success.headers.get('x-amadeus-image-model'), 'p/two');
console.log('IMAGE_COMBO_SAFETY_PATCH_0_5_104=passed');
