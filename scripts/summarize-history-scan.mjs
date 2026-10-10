#!/usr/bin/env node
// Prints a SAFE summary of a Gitleaks --redact scan. Never prints Secret, Match,
// StartLine content, Fingerprint, commit messages, or a full report.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const path=process.argv[2];
if(!path){console.error('usage: node scripts/summarize-history-scan.mjs <private-gitleaks-json>');process.exit(2);}
let findings=[];
if(existsSync(path)){
  try{findings=JSON.parse(readFileSync(resolve(path),'utf8'))??[];}
  catch{console.error('GITLEAKS_REPORT_PARSE_ERROR=true');process.exit(2);}
}
if(!Array.isArray(findings)){console.error('GITLEAKS_REPORT_FORMAT_INVALID=true');process.exit(2);}
const rules=new Map(),files=new Map();
for(const f of findings){
  const id=String(f.RuleID??'unknown').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,70);
  rules.set(id,(rules.get(id)??0)+1);
  const file=String(f.File??'unknown').replace(/[\r\n\t]/g,'_');
  // Only a very short, generated-safe basename summary; no snippets or values.
  const parts=file.split(/[\\/]/);
  const basename=(parts.at(-1)??'unknown').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,70);
  files.set(basename,(files.get(basename)??0)+1);
}
console.log('GITLEAKS_HISTORY_FINDINGS='+findings.length);
console.log('GITLEAKS_HISTORY_RULE_COUNTS='+JSON.stringify(Object.fromEntries([...rules].sort())));
console.log('GITLEAKS_HISTORY_TOP_FILE_BASENAMES='+JSON.stringify([...files].sort((a,b)=>b[1]-a[1]).slice(0,15)));
console.log('GITLEAKS_RAW_FINDINGS_REDACTED_AND_NOT_UPLOADED=true');
console.log('GITLEAKS_MATCHES_REQUIRE_PRIVATE_MANUAL_REVIEW=true');
