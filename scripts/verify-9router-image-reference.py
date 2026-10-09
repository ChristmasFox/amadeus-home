#!/usr/bin/env python3
"""Read-only exact compiled reference contract; local fallback is fail-closed for edits."""
import argparse
import subprocess

FIXTURE = r'''
(async()=>{
 const assert=require('node:assert/strict'),fs=require('node:fs');
 const pkg=require('/usr/local/lib/node_modules/9router/package.json');assert.equal(pkg.version,'0.5.95');
 const base='/usr/local/lib/node_modules/9router/app/.next-cli-build/server';
 const path=base+'/app/api/v1/images/generations/route.js';
 const routeSource=fs.readFileSync(path,'utf8');
 assert.ok(routeSource.includes('amadeus-image-upstream-diagnostics-0.5.95'));
 assert.ok(routeSource.includes('amadeus-image-no-prompt-logs-0.5.95'));
 global.fetch=async()=>{throw Error('network_forbidden_in_fixture')};
 const route=require(path);await route.routeModule._lazyUserland.waitUntilLoaded();
 const w=require(base+'/webpack-runtime.js'), codex=w(7648).A;
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=';
 const input=Object.freeze({model:'amadeus-image',prompt:'synthetic fixture',image:'data:image/png;base64,'+png});
 const models=['cx/gpt-image-2.5-sunburst','cx/gpt-image-2.5-flare','cx/gpt-image-2.5'],calls=[];
 const assertReference=(body,model)=>{assert.equal(body,input);const upstream=codex.buildBody(model.slice(model.indexOf('/')+1),body);assert.equal(upstream.tools[0].action,'edit');assert.equal(upstream.input[0].content.find(x=>x.type==='input_image').image_url,input.image)};
 const out=await w(18910).Pr({body:input,models,comboName:'amadeus-image',comboStrategy:'fallback',log:{info(){},warn(){}},handleSingleModel:async(body,model)=>{
  assertReference(body,model);calls.push(model);
  return new Response(JSON.stringify({error:{message:'synthetic unavailable'}}),{status:503});
 }});
 assert.equal(out.status,503);assert.deepEqual(calls,models);
 const successCalls=[];
 const success=await w(18910).Pr({body:input,models,comboName:'amadeus-image',comboStrategy:'fallback',log:{info(){},warn(){}},handleSingleModel:async(body,model)=>{
  assertReference(body,model);successCalls.push(model);
  if(successCalls.length<3)return new Response(JSON.stringify({error:{message:'synthetic unavailable'}}),{status:502});
  return new Response(JSON.stringify({created:1,data:[{b64_json:'c3VjY2Vzcw=='}]}),{status:200});
 }});
 assert.equal(success.status,200);assert.deepEqual(successCalls,models);assert.equal(success.headers.get('x-amadeus-image-model'),models[2]);
 console.log('REFERENCE_COMBO_BYTE_PRESERVATION=passed primary=edit local_fallback=fail_closed refs=1 http_requests=0');
})().catch(()=>{console.error('REFERENCE_COMBO_BYTE_PRESERVATION=failed');process.exitCode=1});
'''

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--machine',default='nyannyan')
    a=p.parse_args()
    r=subprocess.run(['orb','-m',a.machine,'-u','root','docker','exec','-i','9router','node','-'],input=FIXTURE,text=True,capture_output=True,timeout=45)
    expected='REFERENCE_COMBO_BYTE_PRESERVATION=passed primary=edit local_fallback=fail_closed refs=1 http_requests=0'
    if r.returncode or r.stdout.strip()!=expected:raise SystemExit('REFERENCE_COMBO_BYTE_PRESERVATION=failed (no private output disclosed)')
    print(expected)
if __name__=='__main__':main()
