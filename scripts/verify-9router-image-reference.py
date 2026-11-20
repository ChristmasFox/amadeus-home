#!/usr/bin/env python3
"""Verify reference and prompt forwarding against the deployed 9Router bundle."""
import argparse
import subprocess

FIXTURE = r'''
(async()=>{
 const assert=require('node:assert/strict'),fs=require('node:fs');
 const pkg=require('/usr/local/lib/node_modules/9router/package.json');assert.match(pkg.version,/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
 const base='/usr/local/lib/node_modules/9router/app/.next-cli-build/server';
 const path=base+'/app/api/v1/images/generations/route.js';
 const routeSource=fs.readFileSync(path,'utf8');
 assert.ok(routeSource.includes('amadeus-image-upstream-diagnostics-'));
 assert.ok(routeSource.includes('amadeus-image-no-prompt-logs-'));
 global.fetch=async()=>{throw Error('network_forbidden_in_fixture')};
 const route=require(path);await route.routeModule._lazyUserland.waitUntilLoaded();
 const w=require(base+'/webpack-runtime.js'), codex=w(7648).A;
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=';
 const paths=[png,
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMwYmAAAACaADP5OrokAAAAAElFTkSuQmCC',
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNIYWAAAAEwAGXSlZcYAAAAAElFTkSuQmCC',
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOYxsAAAAHGAJfDS3eIAAAAAElFTkSuQmCC',
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4wcAAAAJcAMlDyBJGAAAAAElFTkSuQmCC'
 ].map(bytes=>'data:image/png;base64,'+bytes);
 const models=['cx/gpt-image-2.6-sunburst','cx/gpt-image-2.6-flare'];
 for(const count of [1,2,5]){
  const refs=paths.slice(0,count);
  const input={model:'amadeus-image',prompt:'合成样本：只编辑指定区域',quality:'max',...(count===1?{image:refs[0]}:{images:refs})};
  for(const fallbackSucceeds of [false,true]){
   const calls=[];
   const response=await w(25308).Pr({body:input,models,comboName:'amadeus-image',comboStrategy:'fallback',log:{info(){},warn(){}},handleSingleModel:async(body,model)=>{
    calls.push(model);
    const upstream=codex.buildBody(model.slice(model.indexOf('/')+1),body);
    const content=upstream.input.flatMap(message=>message.content);
    assert.deepEqual(content.filter(item=>item.type==='input_image').map(item=>item.image_url),refs);
    assert.equal(content.at(-1).text,input.prompt);
    assert.equal(upstream.tools[0].action,'edit');
    assert.equal(upstream.tools[0].quality,'max');
    if(fallbackSucceeds&&calls.length===2){
      return new Response(JSON.stringify({created:1,data:[{b64_json:png}]}),{status:200});
    }
    return new Response(JSON.stringify({error:{message:'synthetic unavailable'}}),{status:503});
   }});
   assert.deepEqual(calls,models);
   assert.equal(response.status,fallbackSucceeds?200:503);
   if(fallbackSucceeds) assert.equal(response.headers.get('x-amadeus-image-model'),models[1]);
  }
 }
 console.log('REFERENCE_COMBO_BYTE_PRESERVATION=passed refs=1,2,5 prompt=exact quality=max http_requests=0');
})().catch(()=>{console.error('REFERENCE_COMBO_BYTE_PRESERVATION=failed');process.exitCode=1});
'''

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--machine',default='example-node')
    a=p.parse_args()
    r=subprocess.run(['orb','-m',a.machine,'-u','root','docker','exec','-i','9router','node','-'],input=FIXTURE,text=True,capture_output=True,timeout=45)
    expected='REFERENCE_COMBO_BYTE_PRESERVATION=passed refs=1,2,5 prompt=exact quality=max http_requests=0'
    if r.returncode or r.stdout.strip()!=expected:raise SystemExit('REFERENCE_COMBO_BYTE_PRESERVATION=failed (no private output disclosed)')
    print(expected)
if __name__=='__main__':main()
