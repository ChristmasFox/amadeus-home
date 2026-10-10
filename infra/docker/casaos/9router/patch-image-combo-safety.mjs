#!/usr/bin/env node
// Keep provider safety refusals terminal in the pinned 9Router image Combo.
// Sending the same prompt to another provider would be an unsafe moderation
// bypass. This patch is shape guarded and logs only bounded status/category
// diagnostics, never prompts, image bytes, account tokens or response bodies.
import { chmod, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MARKER = 'amadeus-image-combo-safety-model-id-0.5.95';
export const DIAGNOSTIC_MARKER = 'amadeus-image-upstream-diagnostics-0.5.95';
const VERSION = '0.5.95';
const ANCHOR = 'let{shouldFallback:i,cooldownMs:j}=(0,d.hk)(b.status,f);';
const COMBO_START = 'async function q({body:a,models:b,handleSingleModel:c,log:g,comboName:i,comboStrategy:j,comboStickyLimit:k=1,autoSwitch:m=!0}){';
const SAFETY_PATTERN = String.raw`(?:safety|moderation|content\s+policy|policy\s+(?:violation|refusal)|prompt\s+(?:blocked|rejected)|unsafe|disallowed|prohibited|responsible\s+ai|violat\w*\s+(?:guideline|policy)|copyright\s+restriction)`;

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

export function isImageSafetyFailure(status, message) {
  return new RegExp(SAFETY_PATTERN, 'iu').test(`${status ?? ''} ${message ?? ''}`);
}

export function patchImageComboSource(source) {
  if (source.includes(MARKER) && source.includes(DIAGNOSTIC_MARKER)) return source;
  if (source.split(ANCHOR).length - 1 !== 1) throw new Error('image_combo_safety_anchor_drift');
  if (source.split(COMBO_START).length - 1 !== 1) throw new Error('image_combo_diagnostics_start_drift');
  const guard = `/* ${MARKER} */const amadeusSafetyRefusal=/${SAFETY_PATTERN}/iu.test(f)||/amadeus_image_safety_refusal/iu.test(f);if(amadeusSafetyRefusal){amadeusImageCombo&&amadeusImageAttemptLog(e,amadeusAttempts.length+1,b.status,f,"safety_refusal","none");g.warn("COMBO",\`Model \${e} failed (safety refusal; no fallback)\`,{status:b.status,category:"safety_refusal",cooldownDecision:"none"});return b;}`;
  const success = 'if(b.ok)return g.info("COMBO",`Model ${e} succeeded`),b;';
  const successWithModel = 'if(b.ok){g.info("COMBO",`Model ${e} succeeded`);const amadeusHeaders=new Headers(b.headers);amadeusHeaders.set("x-amadeus-image-model",e);return new Response(b.body,{status:b.status,statusText:b.statusText,headers:amadeusHeaders});}';
  const diagnostics = `/* ${DIAGNOSTIC_MARKER} */const amadeusImageCombo=i==="amadeus-image",amadeusTraceId=(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8)).replace(/[^a-z0-9-]/giu,"").slice(0,32),amadeusAttempts=[];try{Object.defineProperty(a,"__amadeusTraceId",{value:amadeusTraceId,configurable:!0})}catch{}const amadeusImageSafeFailure=(a,b)=>{let c=String(b||"").toLowerCase(),d=c.match(/amadeus_image_([a-z0-9_]+)/u)?.[1];return d?"amadeus_image_"+d:/safety|moderation|content\\s+policy|policy\\s+(?:violation|refusal)/u.test(c)?"amadeus_image_safety_refusal":a>=500||a===408||a===429?"amadeus_image_http_"+a:a>=400?"amadeus_image_invalid_request":"amadeus_image_upstream_failed"},amadeusImageCategory=(a,b)=>/safety_refusal/u.test(b)?"safety_refusal":/image_result_missing|sse_incomplete|transport_interrupted/u.test(b)?"request_scoped":/upstream_failed/u.test(b)?"upstream_failed":/account_unavailable/u.test(b)?"account_unavailable":a>=500||a===408||a===429?"provider_unavailable":a>=400?"invalid_request":"unknown",amadeusImageAttemptLog=(a,b,c,d,e,f,q={})=>{let h={event:"amadeus_cloud_image_attempt",traceId:amadeusTraceId,model:String(a).replace(/[^a-z0-9_./:-]/giu,"").slice(0,96),operation:"edit",attempt:b,upstreamStatus:c,outcome:e,cooldownDecision:f,lastSseEvent:"unknown",terminalEventSeen:e!=="success",imageResultSeen:e==="success",elapsedMs:0};for(let[a,b]of Object.entries(q))void 0!==b&&""!==b&&(h[a]=String(b).replace(/[^a-z0-9_./:-]/giu,"").slice(0,80));amadeusAttempts.push({model:h.model,outcome:h.outcome,status:c,upstreamErrorType:h.upstreamErrorType||"",upstreamErrorCode:h.upstreamErrorCode||"",upstreamErrorReason:h.upstreamErrorReason||"",lastSseEvent:h.lastSseEvent||""});try{g.warn("COMBO",JSON.stringify(h))}catch{}};`;
  let output = source;
  output = output.replace(COMBO_START, `${COMBO_START}${diagnostics}`);
  output = output.replace('const amadeusImageCombo=i==="amadeus-image",amadeusTraceId=', 'const amadeusImageCombo=i==="amadeus-image",amadeusImageOperation=Array.isArray(a?.images)||Boolean(a?.image)?"edit":"generate",amadeusTraceId=');
  output = output.replace('operation:"edit",attempt:b', 'operation:amadeusImageOperation,attempt:b');
  if (!output.includes(MARKER)) output = output.replace(ANCHOR, `${guard}${ANCHOR}`);
  else {
    const legacyGuard = `/* ${MARKER} */const amadeusSafetyRefusal=/${SAFETY_PATTERN}/iu.test(f);if(amadeusSafetyRefusal){g.warn("COMBO",\`Model \${e} failed (safety refusal; no fallback)\`,{status:b.status});return b;}`;
    if (output.split(legacyGuard).length - 1 === 1) output = output.replace(legacyGuard, guard);
  }
  const successCount = output.split(success).length - 1;
  if (!output.includes('x-amadeus-image-model')) {
    if (successCount !== 1) throw new Error('image_combo_model_header_anchor_drift');
    output = output.replace(success, successWithModel);
  }
  const attemptAnchor = 'let b=await c(a,e);';
  if (output.split(attemptAnchor).length - 1 !== 1) throw new Error('image_combo_attempt_anchor_drift');
  output = output.replace(attemptAnchor, 'try{Object.defineProperty(a,"__amadeusImageAttempt",{value:amadeusAttempts.length+1,configurable:!0})}catch{}let b=await c(a,e);');
  const successLog = 'if(b.ok){g.info("COMBO",`Model ${e} succeeded`);';
  if (output.split(successLog).length - 1 !== 1) throw new Error('image_combo_success_log_anchor_drift');
  output = output.replace(successLog, `${successLog}if(amadeusImageCombo)amadeusImageAttemptLog(e,amadeusAttempts.length+1,b.status,"","success","none");`);
  const normalized = ',"string"!=typeof f)try{f=JSON.stringify(f)}catch{f=String(f)}';
  if (output.split(normalized).length - 1 !== 1) throw new Error('image_combo_error_normalization_anchor_drift');
  output = output.replace(normalized, `${normalized}if(amadeusImageCombo)f=amadeusImageSafeFailure(b.status,f);const amadeusCategory=amadeusImageCategory(b.status,f);`);
  const cooldownAnchor = 'let{shouldFallback:i,cooldownMs:j}=(0,d.hk)(b.status,f);';
  if (output.split(cooldownAnchor).length - 1 !== 1) throw new Error('image_combo_diagnostics_cooldown_anchor_drift');
  output = output.replace(cooldownAnchor, `${cooldownAnchor}const amadeusCooldownDecision=amadeusCategory==="safety_refusal"||amadeusCategory==="request_scoped"||amadeusCategory==="upstream_failed"?"none":j>0?String(j):"none",amadeusImageDiagnostic=amadeusImageCombo?{lastSseEvent:b.headers?.get?.("x-amadeus-image-event")||f.match(/(?:^|[\s\[]|,)event=([a-z0-9_.:-]+)/u)?.[1]||"",upstreamErrorType:b.headers?.get?.("x-amadeus-image-error-type")||f.match(/(?:^|[\s\[]|,)type=([a-z0-9_.:-]+)/u)?.[1]||"",upstreamErrorCode:b.headers?.get?.("x-amadeus-image-error-code")||f.match(/(?:^|[\s\[]|,)code=([a-z0-9_.:-]+)/u)?.[1]||"",upstreamErrorReason:b.headers?.get?.("x-amadeus-image-error-reason")||f.match(/(?:^|[\s\[]|,)reason=([a-z0-9_.:-]+)/u)?.[1]||""}:{};if(amadeusImageCombo)amadeusImageAttemptLog(e,amadeusAttempts.length+1,b.status,f,amadeusCategory,amadeusCooldownDecision,amadeusImageDiagnostic);`);
  const noFallback = 'g.warn("COMBO",`Model ${e} failed (no fallback)`,{status:b.status})';
  if (output.split(noFallback).length - 1 !== 1) throw new Error('image_combo_diagnostics_no_fallback_anchor_drift');
  output = output.replace(noFallback, 'g.warn("COMBO",`Model ${e} failed (no fallback)`,{status:b.status,category:amadeusCategory,cooldownDecision:"none"})');
  const fallback = 'g.warn("COMBO",`Model ${e} failed, trying next`,{status:b.status})';
  if (output.split(fallback).length - 1 !== 1) throw new Error('image_combo_diagnostics_fallback_anchor_drift');
  output = output.replace(fallback, 'g.warn("COMBO",`Model ${e} failed, trying next`,{status:b.status,category:amadeusCategory,cooldownDecision:amadeusCooldownDecision})');
  const throwAnchor = 'catch(a){p=a.message||String(a),s||(s=500),g.warn("COMBO",`Model ${e} threw error, trying next`,{error:p})}';
  if (output.split(throwAnchor).length - 1 !== 1) throw new Error('image_combo_throw_anchor_drift');
  output = output.replace(throwAnchor, 'catch(a){p=amadeusImageCombo?amadeusImageSafeFailure(502,a?.message):a.message||String(a),s||(s=500),amadeusImageCombo&&amadeusImageAttemptLog(e,amadeusAttempts.length+1,500,p,"provider_unavailable","none"),g.warn("COMBO",`Model ${e} threw error, trying next`,{category:"provider_unavailable",cooldownDecision:"none"})}');
  const terminalAnchor = 'let t=p&&p.toLowerCase().includes("no credentials")?503:s||503,u=p||"All combo models unavailable";';
  if (output.split(terminalAnchor).length - 1 !== 1) throw new Error('image_combo_terminal_anchor_drift');
  output = output.replace(terminalAnchor, `${terminalAnchor}if(amadeusImageCombo)try{g.warn("COMBO",JSON.stringify({event:"amadeus_cloud_image_terminal",traceId:amadeusTraceId,attempts:amadeusAttempts,finalOutcome:amadeusImageCategory(t,u)}))}catch{}`);
  return output;
}

async function findCandidate(root) {
  const candidates = [];
  for (const path of await filesUnder(root)) {
    const source = await readFile(path, 'utf8');
    if (source.includes(MARKER) || source.includes(ANCHOR)) candidates.push({ path, source });
  }
  if (candidates.length !== 1) throw new Error(`image_combo_safety_bundle_count:${candidates.length}`);
  return candidates[0];
}

export async function install(root, mode = 'verify', { checkVersion = true } = {}) {
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (checkVersion && packageJson.version !== VERSION) throw new Error(`9router_version_mismatch:${packageJson.version}`);
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
  const path = await install(root, process.argv.includes('--apply') ? 'apply' : 'verify', { checkVersion: !process.argv.includes('--allow-version-drift') });
  console.log(`9ROUTER_IMAGE_COMBO_SAFETY=${process.argv.includes('--apply') ? 'installed' : 'verified'}:${path}`);
}
