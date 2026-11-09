#!/usr/bin/env node
// Keep image safety refusals terminal in the pinned 9Router 0.5.116 Combo.
// This patch is shape guarded and emits bounded metadata only: no prompts,
// response bodies, credentials, or image bytes are added to logs.
import { chmod, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MARKER = 'amadeus-image-combo-safety-model-id-0.5.116';
export const DIAGNOSTIC_MARKER = 'amadeus-image-upstream-diagnostics-0.5.116';
const VERSION = '0.5.116';
const ANCHOR = 'let{provider:n}=(0,g.Xh)(e),{shouldFallback:o,cooldownMs:p,requestScoped:q}=(0,d.hk)(f.status,k,0,n);';
const COMBO_START = 'async function G({body:a,models:b,handleSingleModel:c,log:h,comboName:i,comboStrategy:j,comboStickyLimit:k=1,autoSwitch:l=!0,sessionId:m=null,smartPolicy:n="smart",sessionSticky:o=!0,confidenceThreshold:p=.8,resolveSmartChoice:q=null}){';
const SAFETY_PATTERN = String.raw`(?:safety|moderation|content\s+policy|policy\s+(?:violation|refusal)|prompt\s+(?:blocked|rejected)|unsafe|disallowed|prohibited|responsible\s+ai|violat\w*\s+(?:guideline|policy)|copyright\s+restriction|amadeus_image_safety_refusal)`;

async function filesUnder(root) {
  const output = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && path.endsWith('.js')) output.push(path);
    }
  }
  await walk(root);
  return output;
}

function replaceOne(source, anchor, replacement, name) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) throw new Error(`${name}_anchor_drift:${count}`);
  return source.replace(anchor, replacement);
}

export function isImageSafetyFailure(status, message) {
  return new RegExp(SAFETY_PATTERN, 'iu').test(`${status ?? ''} ${message ?? ''}`);
}

export function patchImageComboSource(source) {
  if (source.includes(MARKER) && source.includes(DIAGNOSTIC_MARKER)) return source;
  if (source.split(ANCHOR).length - 1 !== 1) throw new Error('image_combo_safety_anchor_drift');
  if (source.split(COMBO_START).length - 1 !== 1) throw new Error('image_combo_diagnostics_start_drift');

  const diagnostics = `/* ${DIAGNOSTIC_MARKER} */const amadeusImageCombo=i==="amadeus-image",amadeusImageOperation=Array.isArray(a?.images)||Boolean(a?.image)?"edit":"generate",amadeusTraceId=(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8)).replace(/[^a-z0-9-]/giu,"").slice(0,32),amadeusAttempts=[];try{Object.defineProperty(a,"__amadeusTraceId",{value:amadeusTraceId,configurable:!0})}catch{}const amadeusImageSafeFailure=(a,b)=>{let c=String(b||"").toLowerCase(),d=c.match(/amadeus_image_([a-z0-9_]+)/u)?.[1];return d?"amadeus_image_"+d:/safety|moderation|content\\s+policy|policy\\s+(?:violation|refusal)|amadeus_image_safety_refusal/u.test(c)?"amadeus_image_safety_refusal":a>=500||a===408||a===429?"amadeus_image_http_"+a:a>=400?"amadeus_image_invalid_request":"amadeus_image_upstream_failed"},amadeusImageCategory=(a,b)=>/safety_refusal/u.test(b)?"safety_refusal":/image_result_missing|sse_incomplete|transport_interrupted/u.test(b)?"request_scoped":/upstream_failed/u.test(b)?"upstream_failed":/account_unavailable/u.test(b)?"account_unavailable":a>=500||a===408||a===429?"provider_unavailable":a>=400?"invalid_request":"unknown",amadeusImageAttemptLog=(a,b,c,d,e,f,q={})=>{let amadeusRec={event:"amadeus_cloud_image_attempt",traceId:amadeusTraceId,model:String(a).replace(/[^a-z0-9_./:-]/giu,"").slice(0,96),operation:amadeusImageOperation,attempt:b,upstreamStatus:c,outcome:e,cooldownDecision:f,lastSseEvent:"unknown",terminalEventSeen:e!=="success",imageResultSeen:e==="success",elapsedMs:0};for(let[a,b]of Object.entries(q))void 0!==b&&""!==b&&(amadeusRec[a]=String(b).replace(/[^a-z0-9_./:-]/giu,"").slice(0,80));amadeusAttempts.push({model:amadeusRec.model,outcome:amadeusRec.outcome,status:c,upstreamErrorType:amadeusRec.upstreamErrorType||"",upstreamErrorCode:amadeusRec.upstreamErrorCode||"",upstreamErrorReason:amadeusRec.upstreamErrorReason||"",lastSseEvent:amadeusRec.lastSseEvent||""});try{h.warn("COMBO",JSON.stringify(amadeusRec))}catch{}};`;
  const safetyRegex = new RegExp(SAFETY_PATTERN, 'iu').toString();
  const errorParse = 'let k=f.statusText||"",l=null;try{let a=await f.clone().json();k=a?.error?.message||a?.error||a?.message||k,l=a?.retryAfter||null}catch{}if(l&&(!y||new Date(l)<new Date(y))&&(y=l),"string"!=typeof k)try{k=JSON.stringify(k)}catch{k=String(k)}';
  const safetyCodeCapture = 'let k=f.statusText||"",l=null,amadeusSafetyCode="";try{let a=await f.clone().json();k=a?.error?.message||a?.error||a?.message||k,amadeusSafetyCode=String(a?.error?.code||a?.error?.type||a?.code||""),l=a?.retryAfter||null}catch{}if(l&&(!y||new Date(l)<new Date(y))&&(y=l),"string"!=typeof k)try{k=JSON.stringify(k)}catch{k=String(k)}';
  const diagnostic = 'const amadeusImageDiagnostic=amadeusImageCombo?{lastSseEvent:f.headers?.get?.("x-amadeus-image-event")||k.match(/(?:^|[\\s\\[]|,)event=([a-z0-9_.:-]+)/u)?.[1]||"",upstreamErrorType:f.headers?.get?.("x-amadeus-image-error-type")||k.match(/(?:^|[\\s\\[]|,)type=([a-z0-9_.:-]+)/u)?.[1]||"",upstreamErrorCode:f.headers?.get?.("x-amadeus-image-error-code")||k.match(/(?:^|[\\s\\[]|,)code=([a-z0-9_.:-]+)/u)?.[1]||"",upstreamErrorReason:f.headers?.get?.("x-amadeus-image-error-reason")||k.match(/(?:^|[\\s\\[]|,)reason=([a-z0-9_.:-]+)/u)?.[1]||""}:{};';
  const safetyGuard = `/* ${MARKER} */const amadeusSafetyRefusal=amadeusImageCombo&&${safetyRegex}.test(k+" "+amadeusSafetyCode+" "+(f.statusText||""));if(amadeusSafetyRefusal){amadeusImageAttemptLog(e,amadeusAttempts.length+1,f.status,k,"safety_refusal","none",amadeusImageDiagnostic);h.warn("COMBO",\`Model \${e} failed (safety refusal; no fallback)\`,{status:f.status,category:"safety_refusal",cooldownDecision:"none"});return f;}if(amadeusImageCombo)k=amadeusImageSafeFailure(f.status,k);const amadeusCategory=amadeusImageCategory(f.status,k);`;
  let output = source;
  output = replaceOne(output, COMBO_START, COMBO_START + diagnostics, 'image_combo_diagnostics_start');
  // Image results are JSON (or a single done event), never a chat stream: skip the empty-stream peek that would
  // read an image SSE as "no content" and fall through to the next model.
  output = replaceOne(output, 'a=await w(f,h)', 'a=amadeusImageCombo?null:await w(f,h)', 'image_combo_no_peek');
  output = replaceOne(output, 'let f=await c(a,e);', 'try{Object.defineProperty(a,"__amadeusImageAttempt",{value:amadeusAttempts.length+1,configurable:!0})}catch{}let f=await c(a,e);', 'image_combo_attempt');
  output = replaceOne(output, 'return h.info("COMBO",`Model ${e} succeeded`),f}',
    'amadeusImageCombo&&amadeusImageAttemptLog(e,amadeusAttempts.length+1,f.status,"","success","none");h.info("COMBO",`Model ${e} succeeded`);if(amadeusImageCombo){const amadeusHeaders=new Headers(f.headers);amadeusHeaders.set("x-amadeus-image-model",e);return new Response(f.body,{status:f.status,statusText:f.statusText,headers:amadeusHeaders})}return f}', 'image_combo_model_header');
  output = replaceOne(output,
    'h.warn("COMBO",`Model ${e} returned HTTP 200 with zero usable content, falling back to next model`)',
    'amadeusImageCombo&&amadeusImageAttemptLog(e,amadeusAttempts.length+1,200,"zero_usable_content","upstream_failed","none");h.warn("COMBO",`Model ${e} returned HTTP 200 with zero usable content, falling back to next model`)',
    'image_combo_zero_content');
  output = replaceOne(output, errorParse, safetyCodeCapture, 'image_combo_error_parse');
  output = replaceOne(output, ANCHOR, `${diagnostic}${safetyGuard}${ANCHOR}const amadeusCooldownDecision=amadeusCategory==="safety_refusal"||amadeusCategory==="request_scoped"||amadeusCategory==="upstream_failed"?"none":p>0?String(p):"none";`, 'image_combo_safety');
  output = replaceOne(output,
    'if(!o&&!q)return h.warn("COMBO",`Model ${e} failed (no fallback)`,{status:f.status}),f;',
    'if(amadeusImageCombo)amadeusImageAttemptLog(e,amadeusAttempts.length+1,f.status,k,amadeusCategory,"none",amadeusImageDiagnostic);if(!o&&!q)return h.warn("COMBO",`Model ${e} failed (no fallback)`,{status:f.status,category:amadeusCategory,cooldownDecision:"none"}),f;',
    'image_combo_no_fallback');
  output = replaceOne(output,
    'h.warn("COMBO",`Model ${e} failed, trying next`,{status:f.status})',
    'amadeusImageCombo&&amadeusImageAttemptLog(e,amadeusAttempts.length+1,f.status,k,amadeusCategory,amadeusCooldownDecision,amadeusImageDiagnostic);h.warn("COMBO",`Model ${e} failed, trying next`,{status:f.status,category:amadeusCategory,cooldownDecision:amadeusCooldownDecision})',
    'image_combo_fallback');
  output = replaceOne(output,
    'u=a.message||String(a),z||(z=500),h.warn("COMBO",`Model ${e} threw error, trying next`,{error:u})}',
    'u=amadeusImageCombo?amadeusImageSafeFailure(502,a?.message):a.message||String(a),z||(z=500),amadeusImageCombo&&amadeusImageAttemptLog(e,amadeusAttempts.length+1,500,u,"provider_unavailable","none"),h.warn("COMBO",`Model ${e} threw error, trying next`,{category:"provider_unavailable",cooldownDecision:"none"})}',
    'image_combo_throw');
  const terminalAnchor = 'let C=u&&u.toLowerCase().includes("no credentials")?503:z||503,E=u||"All combo models unavailable";';
  output = replaceOne(output, terminalAnchor,
    `${terminalAnchor}if(amadeusImageCombo)try{h.warn("COMBO",JSON.stringify({event:"amadeus_cloud_image_terminal",traceId:amadeusTraceId,attempts:amadeusAttempts,finalOutcome:amadeusImageCategory(C,E)}))}catch{}`,
    'image_combo_terminal');
  return output;
}

async function findCandidate(root) {
  const candidates = [];
  for (const path of await filesUnder(root)) {
    const source = await readFile(path, 'utf8');
    if (source.includes(COMBO_START) && (source.includes(ANCHOR) || source.includes(MARKER))) candidates.push({ path, source });
  }
  if (candidates.length !== 1) throw new Error(`image_combo_safety_bundle_count:${candidates.length}`);
  return candidates[0];
}

export async function install(root, mode = 'verify') {
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (packageJson.version !== VERSION) throw new Error(`9router_version_mismatch:${packageJson.version}`);
  const candidate = await findCandidate(root);
  const output = patchImageComboSource(candidate.source);
  if (mode === 'verify') {
    if (output !== candidate.source || !candidate.source.includes(MARKER) || !candidate.source.includes(DIAGNOSTIC_MARKER)) throw new Error('image_combo_safety_not_installed');
    return candidate.path;
  }
  const permissions = (await stat(candidate.path)).mode & 0o777;
  await writeFile(candidate.path, output);
  await chmod(candidate.path, permissions);
  if (patchImageComboSource(await readFile(candidate.path, 'utf8')) !== output) throw new Error('image_combo_safety_verify_failed');
  return candidate.path;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[process.argv.indexOf('--root') + 1];
  if (!root) throw new Error('usage: patch-image-combo-safety.mjs --root PATH [--apply]');
  const path = await install(root, process.argv.includes('--apply') ? 'apply' : 'verify');
  console.log(`9ROUTER_IMAGE_COMBO_SAFETY=${process.argv.includes('--apply') ? 'installed' : 'verified'}:${path}`);
}
