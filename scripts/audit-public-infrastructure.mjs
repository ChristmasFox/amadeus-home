#!/usr/bin/env node
// Read-only audit of current tracked plaintext. Intentionally NEVER prints values.
// This is NOT a history scan and cannot prove that old Git objects are private.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const PUBLIC_DOMAIN = /(?:^|[^\w.-])(?:[\w-]+\.)*nyannyan\.top(?=$|[^\w.-])/i;
const PERSONAL_ID = /\b(?:M204-Net-Core|Labmem\d{2,4}|nyannyan)\b/i;
const PRIVATE_KEY = /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/;
const PROXY_URI = /(?:vless|hysteria2|hy2):\/\/(?!<|REPLACE_|EXAMPLE_)[A-Za-z0-9_-]{16,}(?::[A-Za-z0-9_-]{8,})?@/i;
const CREDENTIAL_ASSIGNMENT = /^\s*(?:["']?)(?:password|api_key|auth_token|access_token|client_secret|private_key)\s*[:=]\s*["']?([A-Za-z0-9_+\/=-]{25,})(?:["',\s]|$)/im;
const PUBLIC_IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const FLAGS = ['personal_domain','personal_host_or_identity','private_key_header','inline_proxy_uri','credential_assignment','public_ipv4_candidate'];
const ELIGIBLE = (p) =>
  ((p.startsWith('infra/vps/') || p.startsWith('infra/cloudflare/')) && (/\.md$|\.example(?:\.|$)/.test(p))) ||
  /^docs\/AMADEUS_VPS.*\.md$/.test(p) ||
  (/^\.agent\/(?:checkpoints|tasks)\//.test(p) && /(?:vps|frp|proxy|subscription|public.services|qwen-image-public-lab)/i.test(p) && p.endsWith('.md')) ||
  p === 'infra/host-profile.env.example';
function isPublicIPv4(address) {
  const a=address.split('.').map(Number);
  if (a.length!==4 || a.some(n=>n<0||n>255)) return false;
  if (a[0]===0||a[0]===10||a[0]===127||a[0]>=224) return false;
  if (a[0]===169&&a[1]===254) return false;
  if (a[0]===192&&a[1]===168) return false;
  if (a[0]===172&&a[1]>=16&&a[1]<=31) return false;
  if (a[0]===100&&a[1]>=64&&a[1]<=127) return false;
  if (a[0]===192&&a[1]===0&&a[2]===2) return false; // TEST-NET-1
  if (a[0]===198&&a[1]===51&&a[2]===100) return false; // TEST-NET-2
  if (a[0]===203&&a[1]===0&&a[2]===113) return false; // TEST-NET-3
  return true;
}
export function analyze(text){
  const violations=[];
  if (PUBLIC_DOMAIN.test(text)) violations.push('personal_domain');
  if (PERSONAL_ID.test(text)) violations.push('personal_host_or_identity');
  if (PRIVATE_KEY.test(text)) violations.push('private_key_header');
  if (PROXY_URI.test(text)) violations.push('inline_proxy_uri');
  if (CREDENTIAL_ASSIGNMENT.test(text)) violations.push('credential_assignment');
  if ([...text.matchAll(PUBLIC_IPV4)].some(x=>isPublicIPv4(x[0]))) violations.push('public_ipv4_candidate');
  return violations;
}
function scan() {
  const mode=process.argv[2]??'--strict-vps';
  if(mode==='--self-test'){
    assert.deepEqual(analyze('visit sub.nyannyan.top'),['personal_domain']);
    assert.deepEqual(analyze('M204-Net-Core'),['personal_host_or_identity']);
    assert.deepEqual(analyze('server 203.0.113.10'),[]);
    assert.ok(analyze('server 8.8.8.8').includes('public_ipv4_candidate'));
    assert.deepEqual(analyze('sub.example.com and example-device'),[]);
    console.log('PUBLIC_INFRA_AUDIT_SELF_TEST=passed');
    return;
  }
  if(!['--strict-vps','--audit-all'].includes(mode)){
    console.error('usage: node scripts/audit-public-infrastructure.mjs [--strict-vps|--audit-all|--self-test]');
    process.exitCode=2;return;
  }
  const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
  let scanned=0;
  const findings=[];
  for(const path of files) {
    if(mode==='--strict-vps'?!ELIGIBLE(path):!/\.(?:md|json|toml|yaml|yml|conf|txt|ts|js|mjs|sh)$/.test(path))continue;
    let content;
    try{content=readFileSync(resolve(path),'utf8')}catch{continue}
    scanned++;
    const flags=analyze(content);
    if(flags.length)findings.push({path,flags});
  }
  console.log('PUBLIC_INFRA_AUDIT_MODE='+mode);
  console.log('PUBLIC_INFRA_AUDIT_SCANNED='+scanned);
  console.log('PUBLIC_INFRA_AUDIT_FLAGGED='+findings.length);
  // Intentionally do not print contents, IPs, domains, secrets or matched lines.
  for (const item of findings)console.log(item.path+': '+item.flags.join(','));
  console.log('NOT_A_GIT_HISTORY_AUDIT=true');
  if(mode==='--strict-vps'&&findings.length)process.exitCode=1;
}
scan();
