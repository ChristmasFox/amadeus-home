#!/usr/bin/env node
// 9Router 0.5.116 replaces the global fetch with its own proxy-aware wrapper, but its STT route still builds the
// upload with the global FormData class that wrapper's HTTP client does not recognise: the request goes out as the
// text "[object FormData]" (text/plain, 17 bytes) and every self-hosted transcription is rejected. Build the
// multipart body as plain bytes instead, so any fetch implementation sends it unchanged.
import { chmod, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MARKER = 'amadeus-stt-multipart-bytes-0.5.116';
const VERSION = '0.5.116';
const ROUTE = 'app/.next-cli-build/server/app/api/v1/audio/transcriptions/route.js';
const R_START = 'async function R(a,b,c,d,e){let f=new FormData;for(let a of(f.append("file",b,b.name||"audio.wav"),f.append("model",c),["language","prompt","response_format","temperature"])){let b=e.get(a);null!=b&&""!==b&&f.append(a,b)}let g=await fetch(a.baseUrl,{method:"POST",headers:H(a,d),body:f});';
const HELPER = `/* ${MARKER} */async function amadeusMultipartBody(a,b){let c="----amadeus"+globalThis.crypto.randomUUID().replace(/-/g,""),d=new TextEncoder,e=[];for(let[a,f]of b)e.push(d.encode("--"+c+"\\r\\nContent-Disposition: form-data; name=\\""+String(a).replace(/["\\r\\n]/g,"_")+"\\"\\r\\n\\r\\n"+f+"\\r\\n"));let f=String(a.name||"audio.wav").replace(/["\\r\\n]/g,"_"),g=String(a.type||"audio/wav").replace(/[\\r\\n]/g,"");e.push(d.encode("--"+c+"\\r\\nContent-Disposition: form-data; name=\\"file\\"; filename=\\""+f+"\\"\\r\\nContent-Type: "+g+"\\r\\n\\r\\n"),new Uint8Array(await a.arrayBuffer()),d.encode("\\r\\n--"+c+"--\\r\\n"));let h=new Uint8Array(e.reduce((a,b)=>a+b.length,0)),i=0;for(let a of e)h.set(a,i),i+=a.length;return{boundary:c,body:h}}`;
const R_REPLACEMENT = 'async function R(a,b,c,d,e){let f=[["model",c]];for(let a of["language","prompt","response_format","temperature"]){let b=e.get(a);null!=b&&""!==b&&f.push([a,String(b)])}let{boundary:amadeusBoundary,body:amadeusBody}=await amadeusMultipartBody(b,f);let g=await fetch(a.baseUrl,{method:"POST",headers:{...H(a,d),"Content-Type":"multipart/form-data; boundary="+amadeusBoundary},body:amadeusBody});';

export function patchSttMultipartSource(source) {
  if (source.includes(MARKER)) return source;
  if (source.split(R_START).length !== 2) throw Error('stt_multipart_anchor_drift');
  return source.replace(R_START, `${HELPER}${R_REPLACEMENT}`);
}

export async function install(root, mode = 'verify') {
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (packageJson.version !== VERSION) throw Error(`9router_version_mismatch:${packageJson.version}`);
  const path = join(root, ROUTE);
  const before = await readFile(path, 'utf8');
  const after = patchSttMultipartSource(before);
  if (mode === 'verify') {
    if (before !== after) throw Error('stt_multipart_not_installed');
    return path;
  }
  const permissions = (await stat(path)).mode & 0o777;
  await writeFile(path, after);
  await chmod(path, permissions);
  if (patchSttMultipartSource(await readFile(path, 'utf8')) !== after) throw Error('stt_multipart_verify_failed');
  return path;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const root = process.argv[process.argv.indexOf('--root') + 1];
  if (!root) throw Error('usage: patch-stt-multipart-body.mjs --root PATH [--apply]');
  const path = await install(root, process.argv.includes('--apply') ? 'apply' : 'verify');
  console.log(`9ROUTER_STT_MULTIPART=${process.argv.includes('--apply') ? 'installed' : 'verified'}:${path}`);
}
