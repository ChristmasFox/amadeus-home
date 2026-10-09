#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  classifyCodexTerminal,
  MARKER,
  NO_PROMPT_MARKER,
  patchCodexRouteSource,
  safeDiagnosticToken,
} from './patch-image-upstream-diagnostics.mjs';

assert.equal(classifyCodexTerminal('response.failed', { error: { type: 'server_error', code: 'server_overloaded' } }), 'upstream_failed');
assert.equal(classifyCodexTerminal('response.failed', { error: { type: 'content_policy_violation' } }), 'safety_refusal');
assert.equal(classifyCodexTerminal('response.failed', { error: { type: 'permission_error', code: 'insufficient_quota' } }), 'account_unavailable');
assert.equal(safeDiagnosticToken('server_overloaded'), 'server_overloaded');
assert.equal(safeDiagnosticToken('prompt secret\nBearer token'), '');

const source = [
  'd?.debug?.("IMAGE",`${v.toUpperCase()} | ${w} | prompt="${a.prompt.slice(0,50)}..." (executor)`);',
  'd?.debug?.("IMAGE",`${v.toUpperCase()} | ${w} | prompt="${a.prompt.slice(0,50)}..."`);',
  'async function n(a,b,c={}){return null}let o={stream:!0,buildUrl:()=>h',
  'async parseResponse(a,{log:b,streamToClient:c,onRequestSuccess:d}){return null}normalize:a=>a}},8128:a=>',
  'if(!t.ok){let{statusCode:a,message:b}=await (0,e.zL)(t),c=(0,e.lR)(Error(b),v,w,a);',
].join('');
const patched = patchCodexRouteSource(source);
assert.match(patched, new RegExp(MARKER));
assert.match(patched, new RegExp(NO_PROMPT_MARKER));
assert.doesNotMatch(patched, /Account may not be entitled/);
assert.match(patched, /image_result_missing/);
assert.match(patched, /response\.failed/);
assert.match(patched, /statusText:a\?\.code\|\|"amadeus_image_upstream_failed"/);
assert.match(patched, /b\?\.error\|\|b\?\.response\?\.error/);
assert.equal(patchCodexRouteSource(patched), patched);
console.log('IMAGE_UPSTREAM_DIAGNOSTICS_PATCH=passed');
