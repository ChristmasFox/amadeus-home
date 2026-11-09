#!/usr/bin/env node
import assert from 'node:assert/strict';
import { DIAGNOSTIC_MARKER, isImageSafetyFailure, MARKER, patchImageComboSource } from './patch-image-combo-safety.mjs';

assert.equal(isImageSafetyFailure(400, 'content policy violation'), true);
assert.equal(isImageSafetyFailure(403, 'safety refusal'), true);
assert.equal(isImageSafetyFailure(502, 'amadeus_image_safety_refusal'), true);
assert.equal(isImageSafetyFailure(502, 'upstream unavailable'), false);
assert.equal(isImageSafetyFailure(400, 'invalid prompt'), false);

// Same anchors, argument names and statement order as the 0.5.116 Combo function (reduced to what the patch touches).
const source = [
  'async function G({body:a,models:b,handleSingleModel:c,log:h,comboName:i,comboStrategy:j,comboStickyLimit:k=1,autoSwitch:l=!0,sessionId:m=null,smartPolicy:n="smart",sessionSticky:o=!0,confidenceThreshold:p=.8,resolveSmartChoice:q=null}){',
  'let r=b;let u=null,y=null,z=null,A=null;for(let b=0;b<r.length;b++){let e=r[b];h.info("COMBO",`Trying model ${b+1}/${r.length}: ${e}`);try{let f=await c(a,e);if(f.ok){let a=null;try{a=await w(f,h)}catch(a){return new Response("empty")}if(!a){if(b!==r.length-1&&(f.headers?.get?.("content-type")||"").includes("application/json"))try{let a=await f.clone().json();if(function(a){return !1}(a)){',
  'h.warn("COMBO",`Model ${e} returned HTTP 200 with zero usable content, falling back to next model`),"smart"===j&&m&&e===s&&(0,v.F5)(i,m),u="Zero usable content",z=200;continue}}catch{}return h.info("COMBO",`Model ${e} succeeded`),f}if("content"===a.outcome)return h.info("COMBO",`Model ${e} succeeded${a.timedOut?" (peek deadline; committed)":""}`),a.response}',
  '"smart"===j&&m&&e===s&&(0,v.F5)(i,m);let k=f.statusText||"",l=null;try{let a=await f.clone().json();k=a?.error?.message||a?.error||a?.message||k,l=a?.retryAfter||null}catch{}if(l&&(!y||new Date(l)<new Date(y))&&(y=l),"string"!=typeof k)try{k=JSON.stringify(k)}catch{k=String(k)}',
  'let{provider:n}=(0,g.Xh)(e),{shouldFallback:o,cooldownMs:p,requestScoped:q}=(0,d.hk)(f.status,k,0,n);if(!o&&!q)return h.warn("COMBO",`Model ${e} failed (no fallback)`,{status:f.status}),f;if(q){h.warn("COMBO",`Model ${e} rejected the request (${f.status}), trying next`,{status:f.status}),u=k||String(f.status),z||(z=f.status),A||(A=f);continue}',
  'p&&p>0&&p<=5e3&&await new Promise(a=>setTimeout(a,p)),u=k||String(f.status),z||(z=f.status),h.warn("COMBO",`Model ${e} failed, trying next`,{status:f.status})',
  '}catch(a){"smart"===j&&m&&e===s&&(0,v.F5)(i,m),u=a.message||String(a),z||(z=500),h.warn("COMBO",`Model ${e} threw error, trying next`,{error:u})}}if(A)return A;let C=u&&u.toLowerCase().includes("no credentials")?503:z||503,E=u||"All combo models unavailable";return new Response(JSON.stringify({error:{message:E}}),{status:C})}',
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
assert.ok(patched.indexOf('if(amadeusSafetyRefusal)') < patched.indexOf('let{provider:n}=(0,g.Xh)(e)'));
assert.match(patched, /if\(amadeusSafetyRefusal\).*?return f;/u);
assert.doesNotMatch(patched, /h\.warn\("COMBO"[^\n]*(?:message|body):k/u);
assert.match(patched, /a=amadeusImageCombo\?null:await w\(f,h\)/u);
assert.equal(patchImageComboSource(patched), patched);

const comboFactory = new Function('d', 'g', 'w', `${patched};return G;`);
const makeCombo = (responseFor, fallbackDecision) => {
  let requests = 0;
  let fallbackChecks = 0;
  const logs = [];
  const combo = comboFactory(
    { hk(status, message) { fallbackChecks++; return fallbackDecision(status, message); } },
    { Xh: model => ({ provider: String(model).split('/')[0] }) },
    async () => null,
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

// A safety refusal also stops the chain when upstream policy would call it request-scoped (the new 0.5.116 path).
const scoped = makeCombo(() => new Response(JSON.stringify({ error: { message: 'moderation blocked' } }), { status: 400 }), () => ({ shouldFallback: false, requestScoped: true }));
const scopedOut = await scoped.combo({ body: { prompt: 'fixture' }, models: ['p/one', 'p/two'], handleSingleModel: scoped.handle,
  log: { info() {}, warn(...args) { scoped.logs.push(args); } }, comboName: 'amadeus-image', autoSwitch: false });
assert.equal(scopedOut.status, 400);
assert.equal(scoped.requests, 1);
// The empty-stream peek is skipped for the image combo, so an image response is never read as an empty chat stream.
const peeked = [];
const imageCombo = comboFactory({ hk: () => ({ shouldFallback: true, cooldownMs: 0 }) }, { Xh: () => ({ provider: 'p' }) }, async () => { peeked.push(1); return { outcome: 'empty', response: new Response('') }; });
const imageOut = await imageCombo({ body: { prompt: 'fixture' }, models: ['p/one', 'p/two'], handleSingleModel: async () => new Response('event: done\ndata: {}\n\n', { headers: { 'content-type': 'text/event-stream' } }),
  log: { info() {}, warn() {} }, comboName: 'amadeus-image', autoSwitch: false });
assert.equal(imageOut.status, 200);
assert.deepEqual(peeked, []);
console.log('IMAGE_COMBO_SAFETY_PATCH_0_5_116=passed');
