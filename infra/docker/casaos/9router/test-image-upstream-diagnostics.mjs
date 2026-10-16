#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  classifyCodexTerminal,
  DETAIL_MARKER,
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
  'd?.debug?.("IMAGE",`${w.toUpperCase()} | ${x} | prompt="${a.prompt.slice(0,50)}..." (executor)`);',
  'd?.debug?.("IMAGE",`${w.toUpperCase()} | ${x} | prompt="${a.prompt.slice(0,50)}..."`);',
  'async function n(a,b,c={}){return null}let o={stream:!0,buildUrl:()=>h',
  'async parseResponse(a,{log:b,streamToClient:c,onRequestSuccess:d,onUsage:f}){return null},normalize:a=>a}},8128:a=>',
  'if(!u.ok){let{statusCode:a,message:b}=await (0,e.zL)(u),c=(0,e.lR)(Error(b),w,x,a);',
].join('');
const patched = patchCodexRouteSource(source);
assert.match(patched, new RegExp(MARKER));
assert.match(patched, new RegExp(NO_PROMPT_MARKER));
assert.match(patched, new RegExp(DETAIL_MARKER));
assert.doesNotMatch(patched, /prompt="\$\{a\.prompt/u);
assert.doesNotMatch(patched, /Account may not be entitled/);
assert.match(patched, /image_result_missing/);
assert.match(patched, /response\.failed/);
assert.match(patched, /response\.done/);
assert.match(patched, /usageCallback&&m\.usage&&await usageCallback\(m\.usage\)/);
assert.match(patched, /statusText:a\?\.code\|\|"amadeus_image_upstream_failed"/);
assert.match(patched, /b\?\.error\|\|b\?\.response\?\.error/);
assert.match(patched, /"boolean"==typeof c\?c/);
assert.match(patched, /x-amadeus-image-error-type/);
assert.match(patched, /amadeusImageDiagnosticHeaders/);
assert.match(patched, /Error\("codex_image_http_"\+a\)/);
assert.equal(patchCodexRouteSource(patched), patched);

const parserStart = patched.indexOf('async function n(');
const parserEnd = patched.indexOf('}let o={stream:!0,buildUrl:()=>h', parserStart);
assert.ok(parserStart >= 0 && parserEnd > parserStart);
const runtimeHelpers = patched.slice(patched.indexOf(`/* ${MARKER} */`), parserStart);
const parserSource = patched.slice(parserStart, parserEnd + 1);
const parseSse = new Function('Response', `${runtimeHelpers}${parserSource};return n;`)(Response);
const responseFor = events => new Response(new ReadableStream({
  start(controller) {
    const encoder = new TextEncoder();
    for (const event of events) controller.enqueue(encoder.encode(event));
    controller.close();
  },
}));
const image = await parseSse(responseFor([
  'event: response.output_item.done\ndata: {"item":{"type":"image_generation_call","result":"fixture-image"}}\n\n',
  'event: response.done\ndata: {"response":{"usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}\n\n',
]), { info() {} });
assert.equal(image.result, 'fixture-image');
assert.deepEqual(image.usage, { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
await assert.rejects(parseSse(responseFor([
  'event: response.failed\ndata: {"error":{"type":"content_policy_violation","message":"sensitive body omitted"}}\n\n',
]), { info() {} }), error => {
  assert.equal(error.code, 'amadeus_image_safety_refusal');
  assert.doesNotMatch(error.message, /sensitive body/u);
  return true;
});
console.log('IMAGE_UPSTREAM_DIAGNOSTICS_PATCH_0_5_104=passed');
