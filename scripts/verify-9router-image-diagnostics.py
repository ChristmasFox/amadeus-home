#!/usr/bin/env python3
"""Run bounded SSE terminal fixtures against the effective 9Router 0.5.95 bundle."""
from __future__ import annotations

import argparse
import subprocess


FIXTURE = r'''
(async()=>{
 const assert=require('node:assert/strict'),fs=require('node:fs');
 const base='/usr/local/lib/node_modules/9router/app/.next-cli-build/server';
 const route= require(base+'/app/api/v1/images/generations/route.js');
 await route.routeModule._lazyUserland.waitUntilLoaded();
 const codex=require(base+'/webpack-runtime.js')(7648).A;
 assert.equal(typeof codex.parseResponse,'function');
 const one=async(name,events,{abort=false}={})=>{
  const logs=[];let index=0;
  const reader={read:async()=>{if(abort&&index===events.length)throw Error('socket closed');if(index>=events.length)return{done:true};return{done:false,value:Buffer.from(events[index++])}}};
  const response={body:{getReader:()=>reader}};
  try{
   const value=await codex.parseResponse(response,{log:{info:(...args)=>logs.push(args)},streamToClient:false,onRequestSuccess:async()=>{},requestBody:{},model:'gpt-image-2.5',body:{__amadeusTraceId:'fixture-'+name,__amadeusImageAttempt:1}});
   return{name,code:'success',result:value.result||'',logs};
  }catch(error){
   const line=logs.find(args=>typeof args[1]==='string'&&args[1].includes('amadeus_cloud_image_attempt'));
   return{name,code:error.code||'unknown',diagnostic:error.amadeusImageDiagnostic||{},attemptLog:line?JSON.parse(line[1]):null};
  }
 };
 const frame=(event,data)=>`event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
 const valid=await one('valid',[frame('response.output_item.done',{item:{type:'image_generation_call',result:'c3VjY2Vzcw=='}}),frame('response.completed',{response:{status:'completed'}})]);
 const missing=await one('missing',[frame('response.completed',{response:{status:'completed'}})]);
 const incomplete=await one('incomplete',[frame('response.output_item.done',{item:{type:'message'}})]);
 const overloaded=await one('overloaded',[frame('response.failed',{error:{type:'server_error',code:'server_overloaded'}})]);
 const safety=await one('safety',[frame('response.failed',{error:{type:'content_policy_violation',code:'safety_block'}})]);
 const quota=await one('quota',[frame('response.failed',{error:{type:'rate_limit_error',code:'insufficient_quota'}})]);
 const partial=await one('partial',[frame('response.image_generation_call.partial_image',{partial_image_b64:'c2VudGluaW5n',partial_image_index:0}),frame('response.failed',{error:{type:'server_error',code:'server_overloaded'}})]);
 const transport=await one('transport',[],{abort:true});
 assert.equal(valid.code,'success');assert.equal(valid.result,'c3VjY2Vzcw==');
 assert.equal(missing.code,'amadeus_image_image_result_missing');assert.equal(incomplete.code,'amadeus_image_sse_incomplete');
 assert.equal(overloaded.code,'amadeus_image_upstream_failed');assert.equal(safety.code,'amadeus_image_safety_refusal');assert.equal(quota.code,'amadeus_image_account_unavailable');
 assert.equal(partial.code,'amadeus_image_upstream_failed');assert.equal(transport.code,'amadeus_image_transport_interrupted');
 for(const item of [missing,incomplete,overloaded,safety,quota,partial]){assert.equal(item.diagnostic.imageResultSeen,false);assert.equal(item.diagnostic.terminalEventSeen,true)}
 assert.equal(overloaded.attemptLog.upstreamErrorCode,'server_overloaded');assert.equal(overloaded.attemptLog.imageResultSeen,false);
 assert.equal(safety.attemptLog.outcome,'safety_refusal');assert.equal(quota.attemptLog.outcome,'account_unavailable');
 console.log(JSON.stringify({valid:'passed',image_result_missing:'passed',sse_incomplete:'passed',upstream_failed:'passed',safety_refusal:'passed',account_unavailable:'passed',partial_terminal_not_success:'passed',transport_interrupted:'passed',diagnostics_boolean_types:'passed'}));
})().catch(()=>{console.error('IMAGE_DIAGNOSTICS_FIXTURE=failed');process.exitCode=1});
'''


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--machine", default="nyannyan")
    args = parser.parse_args()
    result = subprocess.run(
        ["orb", "-m", args.machine, "-u", "root", "docker", "exec", "-i", "9router", "node", "-"],
        input=FIXTURE,
        text=True,
        capture_output=True,
        timeout=45,
    )
    if result.returncode:
        raise SystemExit("IMAGE_DIAGNOSTICS_FIXTURE=failed")
    print(result.stdout.strip())


if __name__ == "__main__":
    main()
