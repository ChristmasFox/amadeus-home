#!/usr/bin/env node
// Shape/version-guarded patch for the effective 9Router 0.5.95 Codex image
// adapter. The upstream adapter used an entitlement-looking message whenever
// an image result was absent. That message is not an account check. Keep
// terminal SSE state typed and bounded, and never copy upstream payloads into
// logs or user-visible errors.
import { chmod, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MARKER = 'amadeus-image-upstream-diagnostics-0.5.95';
export const NO_PROMPT_MARKER = 'amadeus-image-no-prompt-logs-0.5.95';
export const DETAIL_MARKER = 'amadeus-image-upstream-diagnostic-headers-0.5.95';
const VERSION = '0.5.95';
const ROUTE = 'app/.next-cli-build/server/app/api/v1/images/generations/route.js';
const CODEX_START = 'async function n(a,b,c={}){';
const CODEX_END = '}let o={stream:!0,buildUrl:()=>h';
const PARSE_START = 'async parseResponse(a,{log:b,streamToClient:c,onRequestSuccess:d}){';
const PARSE_END = 'normalize:a=>a}},8128:a=>';
const PROMPT_LOG = 'd?.debug?.("IMAGE",`${v.toUpperCase()} | ${w} | prompt="${a.prompt.slice(0,50)}..."`);';
const PROMPT_LOG_EXECUTOR = 'd?.debug?.("IMAGE",`${v.toUpperCase()} | ${w} | prompt="${a.prompt.slice(0,50)}..." (executor)`);';
const NON_OK = 'if(!t.ok){let{statusCode:a,message:b}=await (0,e.zL)(t),c=(0,e.lR)(Error(b),v,w,a);';

function one(source, anchor, name) {
  if (source.split(anchor).length !== 2) throw Error(`${name}_anchor_drift`);
}

export function safeDiagnosticToken(value, limit = 64) {
  const token = typeof value === 'string' ? value.toLowerCase() : '';
  return /^[a-z0-9_./:-]{1,160}$/u.test(token) ? token.slice(0, limit) : '';
}

export function classifyCodexTerminal(event, payload) {
  const error = payload?.error || payload?.response?.error || payload?.response?.status_details?.error || payload || {};
  const type = safeDiagnosticToken(error?.type);
  const code = safeDiagnosticToken(error?.code);
  const reason = safeDiagnosticToken(error?.reason || error?.status);
  const text = `${type} ${code} ${reason}`.toLowerCase();
  if (/(?:safety|moderation|content[_ -]?policy|policy|copyright)/u.test(text)) return 'safety_refusal';
  if (/(?:auth|permission|unauthorized|forbidden|quota|entitlement|billing)/u.test(text)) return 'account_unavailable';
  return 'upstream_failed';
}

const RUNTIME_HELPERS = `/* ${MARKER} */
/* ${DETAIL_MARKER} */
function amadeusImageSafeToken(a,b=64){let c=typeof a==="string"?a.toLowerCase():"";return/^[a-z0-9_./:-]{1,160}$/u.test(c)?c.slice(0,b):""}
function amadeusImageError(a,b={}){let c=new Error("amadeus_image_"+a),d=Object.fromEntries(["event","type","code","reason","terminalEventSeen","imageResultSeen"].filter(a=>b[a]!==void 0).map(a=>{let c=b[a];return[a,"boolean"==typeof c?c:amadeusImageSafeToken(String(c),80)]})),e=Object.entries(d).filter(([a])=>["event","type","code","reason"].includes(a)).map(([a,b])=>a+"="+b).join(",");return e&&(c.message+=" ["+e+"]"),c.code="amadeus_image_"+a,c.amadeusImageDiagnostic=d,c}
function amadeusImageTerminalError(a,b){let c=b?.error||b?.response?.error||b?.response?.status_details?.error||b||{},d=amadeusImageSafeToken(c?.type),e=amadeusImageSafeToken(c?.code),f=amadeusImageSafeToken(c?.reason||c?.status),g=(d+" "+e+" "+f).toLowerCase(),h=/(?:safety|moderation|content[_ -]?policy|policy|copyright)/u.test(g),i=/(?:auth|permission|unauthorized|forbidden|quota|entitlement|billing)/u.test(g);return amadeusImageError(h?"safety_refusal":i?"account_unavailable":"upstream_failed",{event:a,type:d,code:e,reason:f,terminalEventSeen:!0,imageResultSeen:!1})}
function amadeusImageDiagnosticHeaders(a={}){let b=new Headers({"Content-Type":"application/json"}),c={"x-amadeus-image-event":a.event,"x-amadeus-image-error-type":a.type,"x-amadeus-image-error-code":a.code,"x-amadeus-image-error-reason":a.reason};for(let[d,e]of Object.entries(c))void 0!==e&&""!==e&&b.set(d,amadeusImageSafeToken(String(e),80));return b}
`;

const CODEX_PARSER = `async function n(a,b,c={}){
let d=a.body?.getReader?.();if(!d)throw amadeusImageError("transport_interrupted");let e=new TextDecoder,f="",g=null,h="",i=!1,j=!1,k=0,l=Date.now(),m=0,o=null,p=0;
const q=(a,d)=>{let e=a.split(/\\r?\\n/),f="",n=[];for(let a of e)a.startsWith("event:")?f=a.slice(6).trim():a.startsWith("data:")&&n.push(a.slice(5).trim());if(!f)return;h=amadeusImageSafeToken(f,80)||"unknown",p++,Date.now()-m>200&&(m=Date.now(),c.onProgress&&c.onProgress({stage:h,bytesReceived:k})),b?.info?.("IMAGE","codex progress: "+h);let l=n.join("\\n");if("response.image_generation_call.partial_image"===h&&l)try{let a=JSON.parse(l);c.onPartialImage&&a?.partial_image_b64&&c.onPartialImage({b64_json:a.partial_image_b64,index:a.partial_image_index})}catch{}if("response.output_item.done"===h&&l)try{let a=JSON.parse(l)?.item;a?.type==="image_generation_call"&&typeof a.result==="string"&&a.result.length>0&&(g=a,j=!0)}catch{}if("response.completed"===h){i=!0,!g&&!o&&(o=amadeusImageError("image_result_missing",{event:h,terminalEventSeen:!0,imageResultSeen:!1}));return}if(("response.failed"===h||"response.error"===h)&&!o){let a;try{a=l?JSON.parse(l):{}}catch{a={type:"parser_error",code:"malformed_terminal"}}o=amadeusImageTerminalError(h,a),i=!0}};
const r=()=>{let a=f.match(/\\r?\\n\\r?\\n/);if(!a)return!1;let b=f.slice(0,a.index);return f=f.slice(a.index+a[0].length),q(b),!0};
try{for(;;){let a=await d.read();if(a.done)break;k+=a.value?.byteLength||0,f+=e.decode(a.value,{stream:!0});while(r()){} }f+=e.decode();while(r()){}f.trim()&&q(f)}catch(a){if(a?.code?.startsWith("amadeus_image_"))throw a;throw amadeusImageError("transport_interrupted",{event:h,terminalEventSeen:i,imageResultSeen:j})}
if(g)return{result:g.result,diagnostic:{lastSseEvent:h,terminalEventSeen:i,imageResultSeen:!0,elapsedMs:Date.now()-l,events:p}};if(o)throw o;throw amadeusImageError(i?"image_result_missing":"sse_incomplete",{event:h,terminalEventSeen:i,imageResultSeen:j})`;

const PARSE_RESPONSE = `async parseResponse(a,{log:b,streamToClient:c,onRequestSuccess:d,model:f,body:g}){
let h=amadeusImageSafeToken(g?.__amadeusTraceId)||"direct",i=Number.isInteger(g?.__amadeusImageAttempt)?g.__amadeusImageAttempt:1,j=Array.isArray(g?.images)||Boolean(g?.image)?"edit":"generate",k=amadeusImageSafeToken(f)||"unknown",l=(a,d={})=>{d.event="amadeus_cloud_image_attempt",d.traceId=h,d.model=k,d.attempt=i,d.operation=j,d.upstreamStatus=a,d.elapsedMs=Number.isFinite(d.elapsedMs)?d.elapsedMs:0,d.terminalEventSeen=Boolean(d.terminalEventSeen),d.imageResultSeen=Boolean(d.imageResultSeen),d.cooldownDecision=d.cooldownDecision||"none";try{b?.info?.("IMAGE",JSON.stringify(d))}catch{}};
let m;try{m=await n(a,b,{model:f,operation:j,traceId:h})}catch(a){let d=a?.code?.replace(/^amadeus_image_/u,"")||"transport_interrupted",e=a?.amadeusImageDiagnostic||{};l(a?.status||502,{outcome:d,lastSseEvent:e.event,terminalEventSeen:e.terminalEventSeen,imageResultSeen:e.imageResultSeen,upstreamErrorType:e.type,upstreamErrorCode:e.code});if(c)return{sseResponse:new Response(JSON.stringify({error:{code:a?.code||"amadeus_image_upstream_failed",message:a?.message||"Image upstream request failed"}}),{status:502,statusText:a?.code||"amadeus_image_upstream_failed",headers:amadeusImageDiagnosticHeaders(e)})};throw a}
`;

// The stream branch is appended separately so failures can return a non-200
// terminal response. Returning HTTP 200 with an error event makes Combo think
// the model succeeded and prevents the next model from being attempted.
const PARSE_RESPONSE_REMAINDER = `l(200,{outcome:"success",lastSseEvent:m.diagnostic?.lastSseEvent,terminalEventSeen:m.diagnostic?.terminalEventSeen,imageResultSeen:!0,elapsedMs:m.diagnostic?.elapsedMs});let o={created:(0,e.kv)(),data:[{b64_json:m.result}]};if(c){d&&await d();return{sseResponse:new Response("event: done\\ndata: "+JSON.stringify(o)+"\\n\\n",{status:200,headers:{"Content-Type":"text/event-stream","Cache-Control":"no-cache, no-transform","Connection":"keep-alive","Access-Control-Allow-Origin":"*"}})}}return o},`;

export function patchCodexRouteSource(source) {
  if (source.includes(MARKER) && source.includes(NO_PROMPT_MARKER) && source.includes(DETAIL_MARKER)) return source;
  one(source, CODEX_START, 'codex_parser_start');
  one(source, CODEX_END, 'codex_parser_end');
  one(source, PARSE_START, 'codex_parse_response');
  one(source, PARSE_END, 'codex_parse_response_end');
  if (source.split(PROMPT_LOG).length - 1 !== 1 || source.split(PROMPT_LOG_EXECUTOR).length - 1 !== 1) throw Error('image_prompt_log_anchor_drift');
  one(source, NON_OK, 'codex_non_ok');
  let output = source;
  const parserStart = output.indexOf(CODEX_START);
  const parserEnd = output.indexOf(CODEX_END, parserStart);
  output = output.slice(0, parserStart) + RUNTIME_HELPERS + CODEX_PARSER + CODEX_END + output.slice(parserEnd + CODEX_END.length);
  const parseStart = output.indexOf(PARSE_START);
  const parseEnd = output.indexOf(PARSE_END, parseStart);
  output = output.slice(0, parseStart) + PARSE_RESPONSE + PARSE_RESPONSE_REMAINDER + output.slice(parseEnd);
  const noPromptLog = '/* ' + NO_PROMPT_MARKER + ' */d?.debug?.("IMAGE",`${v.toUpperCase()} | ${w} | image request`);';
  output = output.replaceAll(PROMPT_LOG, noPromptLog);
  output = output.replace(PROMPT_LOG_EXECUTOR, '/* ' + NO_PROMPT_MARKER + ' */d?.debug?.("IMAGE",`${v.toUpperCase()} | ${w} | image request (executor)`);');
  output = output.replace(NON_OK,
    'if(!t.ok){let{statusCode:a,message:b}=await (0,e.zL)(t),c=(0,e.lR)(Error("codex_image_http_"+a),v,w,a);');
  return output;
}

export async function install(root, mode = 'verify') {
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (packageJson.version !== VERSION) throw Error(`9router_version_mismatch:${packageJson.version}`);
  const path = join(root, ROUTE);
  const before = await readFile(path, 'utf8');
  const after = patchCodexRouteSource(before);
  if (mode === 'verify') {
    if (before !== after || !before.includes(MARKER) || !before.includes(NO_PROMPT_MARKER) || !before.includes(DETAIL_MARKER)) throw Error('image_upstream_diagnostics_not_installed');
    return path;
  }
  const permissions = (await stat(path)).mode & 0o777;
  await writeFile(path, after);
  await chmod(path, permissions);
  if (patchCodexRouteSource(await readFile(path, 'utf8')) !== after) throw Error('image_upstream_diagnostics_verify_failed');
  return path;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const root = process.argv[process.argv.indexOf('--root') + 1];
  if (!root) throw Error('usage: patch-image-upstream-diagnostics.mjs --root PATH [--apply]');
  const path = await install(root, process.argv.includes('--apply') ? 'apply' : 'verify');
  console.log(`9ROUTER_IMAGE_UPSTREAM_DIAGNOSTICS=${process.argv.includes('--apply') ? 'installed' : 'verified'}:${path}`);
}
