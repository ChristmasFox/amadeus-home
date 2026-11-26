#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  classifyCodexTerminal,
  DETAIL_MARKER,
  HTTP_MESSAGE_EXPR,
  MARKER,
  MODERATION_MARKER,
  NO_PROMPT_MARKER,
  patchCodexRouteSource,
  safeDiagnosticToken,
} from './patch-image-upstream-diagnostics.mjs';

assert.equal(classifyCodexTerminal('response.failed', { error: { type: 'server_error', code: 'server_overloaded' } }), 'upstream_failed');
assert.equal(classifyCodexTerminal('response.failed', { error: { type: 'content_policy_violation' } }), 'safety_refusal');
assert.equal(classifyCodexTerminal('response.failed', { error: { type: 'permission_error', code: 'insufficient_quota' } }), 'account_unavailable');
assert.equal(safeDiagnosticToken('server_overloaded'), 'server_overloaded');
assert.equal(safeDiagnosticToken('prompt secret\nBearer token'), '');

// Shape of the generic OpenAI-compatible adapter module (61613) in 0.5.116.
const GENERIC_ADAPTER = 'let e=a=>d.B$[a]?.imageConfig||{};function f(a){let b=e(a);return{buildUrl:()=>e(a).baseUrl,buildHeaders:a=>({}),buildBody:(a,c)=>{let{prompt:d,n:e=1,size:f="1024x1024",quality:g,style:h,response_format:i,output_format:j}=c,k={model:a,prompt:d,n:e,size:f,output_format:j};for(let a of(g&&(k.quality=g),h&&(k.style=h),i&&(k.response_format=i),["output_format","watermark","prompt_extend"]))b.bodyFields?.includes(a)&&void 0!==c[a]&&(k[a]=c[a]);if(Array.isArray(b.bodyFields)){let a={};for(let c of b.bodyFields)void 0!==k[c]&&(a[c]=k[c]);return a}return k},normalize:a=>a}}';
// Shape of the Codex/Plus adapter body builder (module 7648) in 0.5.116.
const CODEX_BODY_FIXTURE = 'let codexAdapter={buildBody:(a,b)=>{if(p(a,b))return{model:a,prompt:b.prompt,n:1,size:"auto",quality:b.quality||"auto",background:b.background||"auto",output_format:"png"};let i={type:"image_generation",output_format:(b.output_format||"png").toLowerCase()};return b.size&&(i.size=b.size),{model:"gpt-6-sol",tools:[i]}}};';
const source = [
  'd?.debug?.("IMAGE",`${w.toUpperCase()} | ${x} | prompt="${a.prompt.slice(0,50)}..." (executor)`);',
  'd?.debug?.("IMAGE",`${w.toUpperCase()} | ${x} | prompt="${a.prompt.slice(0,50)}..."`);',
  'async function s(a,b,c={}){return null}let t={stream:!0,canUseCredentials:',
  'async parseResponse(a,{log:b,streamToClient:c,onRequestSuccess:d,onUsage:f,requestBody:g}){return null},normalize:a=>a}},8128:a=>',
  'if(!u.ok){let{statusCode:a,message:b}=await (0,e.zL)(u),c=(0,e.lR)(Error(b),w,x,a);',
  GENERIC_ADAPTER,
  CODEX_BODY_FIXTURE,
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
assert.doesNotMatch(patched, /amadeusImageHttpMessage/u, 'non-OK branch must not call a helper from another module');
assert.ok(patched.includes('Error(' + HTTP_MESSAGE_EXPR + ')'));
assert.match(patched, new RegExp(MODERATION_MARKER));
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
// Evaluated with no helpers in scope, like the real non-OK branch in its own webpack module.
const httpMessage = new Function('a', 'b', `return ${HTTP_MESSAGE_EXPR};`);
assert.equal(httpMessage(400, 'Your request was rejected by our safety system'), 'amadeus_image_safety_refusal');
assert.equal(httpMessage(429, 'rate limit with private text'), 'codex_image_http_429');
// Installs from the earlier patch referenced an out-of-scope helper; re-applying repairs them in place.
const legacy = patched.replace('Error(' + HTTP_MESSAGE_EXPR + ')', 'Error(amadeusImageHttpMessage(a,b))');
assert.notEqual(legacy, patched);
assert.equal(patchCodexRouteSource(legacy), patched);
// Legacy installs without the moderation hook pick it up on re-apply.
const legacyNoModeration = legacy
  .replace(/\/\* amadeus-image-moderation-low-0\.5\.116 \*\/[^;]*;/u, '')
  .replace('let b=e(a),amadeusImageProvider=a;', 'let b=e(a);')
  .replace(',output_format:"png",moderation:"low"}', ',output_format:"png"}')
  .replace('.toLowerCase(),moderation:"low"};', '.toLowerCase()};');
assert.notEqual(legacyNoModeration, legacy);
assert.equal(patchCodexRouteSource(legacyNoModeration), patched);
// The earlier passthrough-only openai hook is upgraded to the forced value.
const legacyPassthrough = legacyNoModeration
  .replace('let b=e(a);', 'let b=e(a),amadeusImageProvider=a;')
  .replace('output_format:j};for(let a of(', 'output_format:j};/* amadeus-image-openai-moderation-0.5.116 */"openai"===amadeusImageProvider&&("auto"===c.moderation||"low"===c.moderation)&&(k.moderation=c.moderation);for(let a of(');
assert.equal(patchCodexRouteSource(legacyPassthrough), patched);
assert.equal(patchCodexRouteSource(patchCodexRouteSource(legacyPassthrough)), patched);

// moderation: the official openai provider always sends "low", whatever the client sent.
const genericStart = patched.indexOf('let e=a=>d.B$');
const genericSource = patched.slice(genericStart, patched.indexOf('let codexAdapter='));
const factory = new Function('d', `${genericSource};return f;`)({ B$: { openai: { imageConfig: {} }, xai: { imageConfig: {} }, minimax: { imageConfig: { bodyFields: ['model', 'prompt', 'n', 'size', 'moderation'] } } } });
const req = extra => ({ prompt: 'neutral placeholder', size: '1024x1024', ...extra });
for (const extra of [{}, { moderation: 'auto' }, { moderation: 'low' }, { moderation: 'off' }]) {
  assert.equal(factory('openai').buildBody('gpt-image-2.6-flare', req(extra)).moderation, 'low');
}
assert.equal('moderation' in factory('xai').buildBody('grok-image', req({ moderation: 'low' })), false);
assert.equal('moderation' in factory('minimax').buildBody('image-01', req({ moderation: 'low' })), false);
// Codex/Plus: both the Images API body and the Responses image_generation tool carry "low".
const codexSource = patched.slice(patched.indexOf('let codexAdapter='));
const makeCodex = imagesApi => new Function('p', `${codexSource};return codexAdapter;`)(() => imagesApi);
assert.equal(makeCodex(true).buildBody('gpt-image-2.6-sunburst', req({ moderation: 'auto' })).moderation, 'low');
const toolBody = makeCodex(false).buildBody('gpt-image-2.6-sunburst', req({}));
assert.equal(toolBody.tools[0].type, 'image_generation');
assert.equal(toolBody.tools[0].moderation, 'low');
assert.equal(toolBody.tools[0].size, '1024x1024');

// Executor log: evaluated in a handler-shaped scope where `v` is declared but unassigned
// (like the real 0.5.116 image handler) and the logger has debug().
assert.doesNotMatch(patched, /\$\{v\.toUpperCase\(\)\}/u, 'executor log must not read the unassigned v');
const executorLogStart = patched.indexOf('/* ' + NO_PROMPT_MARKER + ' */d?.debug?.("IMAGE",`${w.toUpperCase()} | ${x} | image request (executor)`);');
assert.ok(executorLogStart >= 0);
const executorLog = patched.slice(executorLogStart, patched.indexOf(';', patched.indexOf('(executor)', executorLogStart)) + 1);
const runExecutorLog = new Function('b', 'd', 'a', `let r,s,t,u,v,{provider:w,model:x}=b;${executorLog}return 'ok';`);
const debugLines = [];
const debugLog = { debug: (_tag, text) => debugLines.push(text) };
assert.equal(runExecutorLog({ provider: 'gemini-web', model: 'gemini-image' }, debugLog, prompt), 'ok');
assert.deepEqual(debugLines, ['GEMINI-WEB | gemini-image | image request (executor)']);
assert.equal(runExecutorLog({ provider: 'grok-web', model: 'grok-image' }, {}, prompt), 'ok');
// The earlier (broken) executor log really throws in that scope, and re-applying repairs it.
const legacyExecutor = patched.replace(executorLog, '/* ' + NO_PROMPT_MARKER + ' */d?.debug?.("IMAGE",`${v.toUpperCase()} | ${w} | image request (executor)`);');
assert.notEqual(legacyExecutor, patched);
const brokenLog = legacyExecutor.slice(legacyExecutor.indexOf('/* ' + NO_PROMPT_MARKER + ' */d?.debug?.("IMAGE",`${v.'));
const runBroken = new Function('b', 'd', `let r,s,t,u,v,{provider:w,model:x}=b;${brokenLog.slice(0, brokenLog.indexOf(';') + 1)}`);
assert.throws(() => runBroken({ provider: 'gemini-web', model: 'm' }, debugLog), TypeError);
assert.equal(patchCodexRouteSource(legacyExecutor), patched);
assert.equal(patchCodexRouteSource(patchCodexRouteSource(legacyExecutor)), patched);
console.log('IMAGE_UPSTREAM_DIAGNOSTICS_PATCH_0_5_116=passed');
