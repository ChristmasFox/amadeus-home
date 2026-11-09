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
  'async function s(a,b,c={}){return null}let t={stream:!0,canUseCredentials:',
  'async parseResponse(a,{log:b,streamToClient:c,onRequestSuccess:d,onUsage:f,requestBody:g}){return null},normalize:a=>a}},8128:a=>',
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
assert.match(patched, /Error\(amadeusImageHttpMessage\(a,b\)\)/);
assert.match(patched, /return"codex_image_http_"\+a|:"codex_image_http_"\+a/u);
assert.equal(patchCodexRouteSource(patched), patched);

const parserStart = patched.indexOf('async function s(');
const parserEnd = patched.indexOf('}let t={stream:!0,canUseCredentials:', parserStart);
assert.ok(parserStart >= 0 && parserEnd > parserStart);
const runtimeHelpers = patched.slice(patched.indexOf(`/* ${MARKER} */`), parserStart);
const parserSource = patched.slice(parserStart, parserEnd + 1);
const parseSse = new Function('Response', `${runtimeHelpers}${parserSource};return s;`)(Response);
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
// A completed response that only lists the image in its output still counts (new upstream behavior).
const listed = await parseSse(responseFor([
  'event: response.completed\ndata: {"response":{"output":[{"type":"image_generation_call","result":"listed-image"}]}}\n\n',
]), { info() {} });
assert.equal(listed.result, 'listed-image');
// An upstream "error" event is a typed terminal failure too, with nothing from its body in the message.
await assert.rejects(parseSse(responseFor([
  'event: error\ndata: {"error":{"type":"server_error","code":"server_overloaded","message":"private detail"}}\n\n',
]), { info() {} }), error => {
  assert.equal(error.code, 'amadeus_image_upstream_failed');
  assert.doesNotMatch(error.message, /private detail/u);
  return true;
});
await assert.rejects(parseSse(responseFor(['event: response.created\ndata: {}\n\n']), { info() {} }), error => error.code === 'amadeus_image_sse_incomplete');

// parseResponse itself: the Images API (JSON) branch used for plain text-to-image, and the failure shape for streaming clients.
const responseStart = patched.indexOf('async parseResponse(');
const responseEnd = patched.indexOf(',normalize:a=>a}},8128:a=>', responseStart);
const parseResponseSource = patched.slice(responseStart, responseEnd);
const usage = value => (value ? { prompt_tokens: value.input_tokens, completion_tokens: value.output_tokens, total_tokens: value.input_tokens + value.output_tokens } : null);
const makeAdapter = () => new Function('Response', 'Headers', 'e', 'r', `${runtimeHelpers}${parserSource}const adapter={${parseResponseSource}};return adapter;`)(Response, Headers, { kv: () => 1700000000 }, usage);
const adapter = makeAdapter();
const jsonResponse = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const logs = [];
const log = { info: (_tag, text) => logs.push(text) };
const prompt = { prompt: 'private prompt text' };
const okJson = await adapter.parseResponse(jsonResponse({ created: 7, data: [{ b64_json: 'json-image' }], usage: { input_tokens: 4, output_tokens: 6 } }), { log, streamToClient: false, onRequestSuccess: async () => {}, onUsage: async () => {}, model: 'gpt-image-2.6-sunburst', body: prompt, requestBody: prompt });
assert.deepEqual(okJson, { created: 7, data: [{ b64_json: 'json-image' }] });
await assert.rejects(adapter.parseResponse(jsonResponse({ error: { type: 'content_policy_violation', message: 'private detail' } }), { log, streamToClient: false, model: 'gpt-image-2.6-flare', body: prompt, requestBody: prompt }), error => {
  assert.equal(error.code, 'amadeus_image_safety_refusal');
  assert.doesNotMatch(error.message, /private detail/u);
  return true;
});
await assert.rejects(adapter.parseResponse(jsonResponse({ data: [] }), { log, streamToClient: false, model: 'gpt-image-2.6-flare', body: prompt, requestBody: prompt }), error => error.code === 'amadeus_image_image_result_missing');
const streamed = await adapter.parseResponse(jsonResponse({ error: { code: 'server_overloaded' } }), { log, streamToClient: true, model: 'gpt-image-2.6-flare', body: prompt, requestBody: prompt });
assert.equal(streamed.sseResponse.status, 502, 'a failed image is a non-200 so Combo tries the next model');
assert.equal(streamed.sseResponse.headers.get('x-amadeus-image-error-code'), 'server_overloaded');
const streamedOk = await adapter.parseResponse(jsonResponse({ data: [{ b64_json: 'x' }] }), { log, streamToClient: true, onRequestSuccess: async () => {}, model: 'gpt-image-2.6-sunburst', body: prompt, requestBody: prompt });
assert.equal(streamedOk.sseResponse.status, 200);
assert.ok(!logs.join('\n').includes('private prompt text'), 'no prompt in logs');
// HTTP error bodies: a safety refusal keeps its typed token, anything else is reduced to the status.
const httpMessage = new Function(`${runtimeHelpers}return amadeusImageHttpMessage;`)();
assert.equal(httpMessage(400, 'Your request was rejected by our safety system'), 'amadeus_image_safety_refusal');
assert.equal(httpMessage(429, 'rate limit with private text'), 'codex_image_http_429');
console.log('IMAGE_UPSTREAM_DIAGNOSTICS_PATCH_0_5_116=passed');
