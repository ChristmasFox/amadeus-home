#!/usr/bin/env node
import assert from 'node:assert/strict';
import { DIAGNOSTIC_MARKER, isImageSafetyFailure, MARKER, patchImageComboSource } from './patch-image-combo-safety.mjs';

assert.equal(isImageSafetyFailure(400, 'content policy violation'), true);
assert.equal(isImageSafetyFailure(403, 'safety refusal'), true);
assert.equal(isImageSafetyFailure(502, 'upstream unavailable'), false);
assert.equal(isImageSafetyFailure(400, 'invalid prompt'), false);
const source = 'async function q({body:a,models:b,handleSingleModel:c,log:g,comboName:i,comboStrategy:j,comboStickyLimit:k=1,autoSwitch:m=!0}){for(let b=0;b<o.length;b++){let e=o[b];try{let b=await c(a,e);if(b.ok)return g.info("COMBO",`Model ${e} succeeded`),b;let f=b.statusText||"";if(h&&(!r||new Date(h)<new Date(r))&&(r=h),"string"!=typeof f)try{f=JSON.stringify(f)}catch{f=String(f)}let{shouldFallback:i,cooldownMs:j}=(0,d.hk)(b.status,f);if(!i)return g.warn("COMBO",`Model ${e} failed (no fallback)`,{status:b.status}),b;g.warn("COMBO",`Model ${e} failed, trying next`,{status:b.status})}catch(a){p=a.message||String(a),s||(s=500),g.warn("COMBO",`Model ${e} threw error, trying next`,{error:p})}}let t=p&&p.toLowerCase().includes("no credentials")?503:s||503,u=p||"All combo models unavailable";return new Response(JSON.stringify({error:{message:u}}),{status:t})}}';
const patched = patchImageComboSource(source);
assert.match(patched, new RegExp(MARKER));
assert.match(patched, new RegExp(DIAGNOSTIC_MARKER));
assert.match(patched, /safety refusal; no fallback/);
assert.match(patched, /x-amadeus-image-model/);
assert.match(patched, /account_unavailable/);
assert.match(patched, /amadeus_cloud_image_attempt/);
assert.match(patched, /cooldownDecision/);
assert.match(patched, /upstream_failed/);
assert.doesNotMatch(patched, /not\\s\+entitled|plus\/pro/);
assert.equal(patchImageComboSource(patched), patched);
console.log('IMAGE_COMBO_SAFETY_PATCH=passed');
