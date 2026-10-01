#!/usr/bin/env python3
"""Read-only exact compiled reference/fallback fixture; no HTTP or account mutations."""
import argparse
import subprocess

FIXTURE = r'''
(async()=>{
 const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
 const pkg=require('/usr/local/lib/node_modules/9router/package.json');assert.equal(pkg.version,'0.5.91');
 const base='/usr/local/lib/node_modules/9router/app/.next-cli-build/server';
 const path=base+'/app/api/v1/images/generations/route.js';
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex'),'c678bc204f0df0c027f2e293dc76068bcde874e76e762fb8145b175cff5f4a61');
 global.fetch=async()=>{throw Error('network_forbidden_in_fixture')};
 const route=require(path);await route.routeModule._lazyUserland.waitUntilLoaded();
 const w=require(base+'/webpack-runtime.js');const codex=w(7648).A, ag=(await w(91285)).A, executor=(await w(55330)).SB('antigravity');
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=';
 const input=Object.freeze({model:'amadeus-image',prompt:'synthetic fixture',image:'data:image/png;base64,'+png});
 const models=['cx/gpt-image-2.5','ag/gemini-3.1-flash-image'],calls=[];
 executor.execute=async req=>{
  const parts=req.body.contents[0].parts;
  assert.equal(parts[0].inlineData.mimeType,'image/png');assert.equal(parts[0].inlineData.data,png);
  assert.equal(parts[1].text,input.prompt);
  return {response:new Response(JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:png}}]}}]}),{status:200})};
 };
 const out=await w(18910).Pr({body:input,models,comboName:'amadeus-image',comboStrategy:'fallback',log:{info(){},warn(){}},handleSingleModel:async(body,model)=>{
  assert.equal(body,input);calls.push(model);
  if(model===models[0]){
   const upstream=codex.buildBody('gpt-image-2.5',body);
   assert.equal(upstream.tools[0].action,'edit');
   assert.equal(upstream.input[0].content.find(x=>x.type==='input_image').image_url,input.image);
   return new Response(JSON.stringify({error:{message:'synthetic unavailable'}}),{status:503});
  }
  await ag.executeViaExecutor('gemini-3.1-flash-image',body,{}, {info(){},warn(){}});
  return new Response(JSON.stringify({data:[{b64_json:png}]}),{status:200});
 }});
 assert.equal(out.status,200);assert.deepEqual(calls,models);
 console.log('REFERENCE_COMBO_BYTE_PRESERVATION=passed primary=edit fallback=inlineData refs=1 http_requests=0');
})().catch(()=>{console.error('REFERENCE_COMBO_BYTE_PRESERVATION=failed');process.exitCode=1});
'''

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--machine',default='nyannyan')
    a=p.parse_args()
    r=subprocess.run(['orb','-m',a.machine,'-u','root','docker','exec','-i','9router','node','-'],input=FIXTURE,text=True,capture_output=True,timeout=45)
    expected='REFERENCE_COMBO_BYTE_PRESERVATION=passed primary=edit fallback=inlineData refs=1 http_requests=0'
    if r.returncode or r.stdout.strip()!=expected:raise SystemExit('REFERENCE_COMBO_BYTE_PRESERVATION=failed (no private output disclosed)')
    print(expected)
if __name__=='__main__':main()
