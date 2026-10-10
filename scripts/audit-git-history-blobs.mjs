#!/usr/bin/env node
// Read-only scan of ALL Git-reachable blob versions. Never prints matched values,
// only coarse categories and sanitized filenames. Not a replacement for Gitleaks.
import { execFileSync, spawnSync } from 'node:child_process';
const git=(args,options={})=>execFileSync('git',args,{encoding:'utf8',maxBuffer:64*1024*1024,...options});
const items=git(['rev-list','--objects','--all']).split('\n').filter(Boolean).map(line=>({sha:line.slice(0,40),path:line.slice(41)}));
const extensions=/\.(?:md|markdown|json|jsonc|yaml|yml|toml|conf|txt|env|example|sh|bash|zsh|py|ts|tsx|js|mjs|cjs|service|plist|xml|ini|cfg|properties)$/i;
const candidates=items.filter(x=>x.path&&extensions.test(x.path)&&!x.path.includes('node_modules/'));
const seen=new Set();
const blobs=candidates.filter(x=>{if(seen.has(x.sha))return false;seen.add(x.sha);return true;});
const labels=['personal_domain','named_operator_identity','account_email_policy','proxy_subscription_uri','private_key_header','public_ipv4_candidate'];
const entries=new Map(labels.map(s=>[s,{count:0,files:new Set()}]));
function checkIPv4(ip) {
 const p=ip.split('.').map(Number);
 if(p.length!==4||p.some(n=>n<0||n>255)||p[0]===0||p[0]===10||p[0]===127||p[0]>=224||p[0]===169&&p[1]===254||p[0]===192&&p[1]===168||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===100&&p[1]>=64&&p[1]<=127) return false;
 if(p[0]===192&&p[1]===0&&p[2]===2||p[0]===198&&p[1]===51&&p[2]===100||p[0]===203&&p[1]===0&&p[2]===113||p[0]===198&&p[1]>=18&&p[1]<=19) return false;
 return true;
}
function inspect(path,buf){
 if(buf.includes(0))return;
 const s=buf.toString('utf8');
 const checks={
  personal_domain:/\b(?:[\w-]+\.)*nyannyan\.top\b/i.test(s),
  named_operator_identity:/\b(?:M204-Net-Core|Labmem\d{2,4})\b/i.test(s),
  account_email_policy:/"email"\s*:\s*"[^"\s]+@[^"\s]+\.[^"\s]+"\s*[,}]/i.test(s)&&/imageAccount|account.*policy/i.test(s),
  proxy_subscription_uri:/(?:vless|hysteria2|hy2):\/\/[^\s"'<>]{18,}/i.test(s),
  private_key_header:/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(s),
  public_ipv4_candidate:[...s.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)].some(x=>checkIPv4(x[0])),
 };
 for(const [label,yes] of Object.entries(checks))if(yes){const e=entries.get(label);e.count++;e.files.add(path);}
}
let scanned=0,failed=0;
for(let i=0;i<blobs.length;i+=48){
 const part=blobs.slice(i,i+48);
 const batch=spawnSync('git',['cat-file','--batch'],{
  input:part.map(x=>x.sha).join('\n')+'\n',encoding:'buffer',maxBuffer:128*1024*1024,
 });
 if(batch.error||batch.status!==0){failed++;continue;}
 const output=batch.stdout;
 let off=0;
 for(const item of part) {
  let end=output.indexOf(10,off);
  if(end<0){failed++;break;}
  const hdr=output.subarray(off,end).toString('utf8').split(' ');
  const len=Number(hdr[2]);
  if(hdr[1]!=='blob'||!Number.isFinite(len)||len<0){failed++;break;}
  const start=end+1;
  if(start+len>output.length){failed++;break;}
  if(len<=2*1024*1024){inspect(item.path,output.subarray(start,start+len));scanned++;}
  off=start+len+1;
 }
}
console.log('HISTORY_REACHABLE_OBJECTS='+items.length);
console.log('HISTORY_TEXT_BLOBS_SCANNED='+scanned);
console.log('HISTORY_BLOB_READ_ERRORS='+failed);
for(const [label,{count,files}] of entries){
 const top=[...files].slice(0,12).map(f=>f.split('/').at(-1).replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,70));
 console.log('HISTORY_'+label.toUpperCase()+'_BLOBS='+count);
 console.log('HISTORY_'+label.toUpperCase()+'_EXAMPLE_BASENAMES='+JSON.stringify(top));
}
console.log('NO_HISTORIC_VALUES_ARE_PRINTED=true');
console.log('HISTORY_AUDIT_DOES_NOT_COVER_DELETED_REMOTE_REFS_OR_EXTERNAL_FORKS=true');
