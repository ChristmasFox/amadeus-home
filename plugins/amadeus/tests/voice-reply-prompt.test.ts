import test from 'node:test';import assert from 'node:assert/strict';
import { hasActiveWhatsAppVoiceLease,WHATSAPP_VOICE_RUNS_GLOBAL,registerVoiceReplyPrompt } from '../src/voice-reply-prompt.js';
const wire=JSON.stringify({version:2,silent:false,parts:[{kind:'text',text:'normal text'}]});
function setup(){const hooks=new Map<string,(...args:any[])=>any>();const api={rootDir:new URL('../',import.meta.url).pathname,config:{},logger:{info(){},warn(){}},on(name:string,handler:(...args:any[])=>any){hooks.set(name,handler);}} as never;registerVoiceReplyPrompt(api);return hooks;}
test('voice lease stays lifecycle-only and typed prompts request v2',()=>{
 const hooks=setup();(globalThis as Record<string,unknown>)[WHATSAPP_VOICE_RUNS_GLOBAL]=new Map([['voice-s',{closed:false,messageId:'m',sessionKey:'voice-s'}]]);
 assert.equal(hasActiveWhatsAppVoiceLease('whatsapp','voice-s'),true);assert.equal(hasActiveWhatsAppVoiceLease('telegram','voice-s'),false);
 const prompt=hooks.get('before_prompt_build')?.({}, {runId:'prompt-r',sessionKey:'voice-s',channel:'whatsapp'});assert.match(prompt.appendSystemContext,/Japanese voice part/u);assert.match(prompt.appendSystemContext,/"version":2/u);delete(globalThis as Record<string,unknown>)[WHATSAPP_VOICE_RUNS_GLOBAL];
});
test('native finalize consumes raw once, reply hook retains only typed envelope',async()=>{
 const hooks=setup();hooks.get('before_prompt_build')?.({}, {runId:'hook-r',sessionKey:'hook-s',channel:'whatsapp'});
 hooks.get('before_agent_finalize')?.({runId:'hook-r',lastAssistantMessage:wire},{});
 const result=await hooks.get('reply_payload_sending')?.({runId:'hook-r',sessionKey:'hook-s',channel:'whatsapp',kind:'final',payload:{text:'DO NOT DELIVER RAW',mediaUrls:['/unregistered.png']}},{});
 assert.deepEqual(Object.keys(result.payload),['channelData']);assert.deepEqual(result.payload.channelData.amadeusDelivery.parts,[{kind:'text',text:'normal text'}]);
 const tool=await hooks.get('reply_payload_sending')?.({runId:'hook-r',sessionKey:'hook-s',channel:'whatsapp',kind:'tool',payload:{mediaUrls:['/unregistered.png']}},{});assert.equal(tool.cancel,true);
});
test('malformed output has no raw text/caption; missing run fails closed',async()=>{
 const hooks=setup();hooks.get('before_prompt_build')?.({}, {runId:'bad-r',sessionKey:'bad-s',channel:'whatsapp'});
 const result=await hooks.get('reply_payload_sending')?.({runId:'bad-r',sessionKey:'bad-s',channel:'whatsapp',kind:'final',payload:{text:'{"visibleText": }'}},{});
 assert.deepEqual(result.payload.channelData.amadeusDelivery.parts,[]);assert.equal(result.payload.text,undefined);
 const missing=await hooks.get('reply_payload_sending')?.({channel:'whatsapp',kind:'final',payload:{text:wire}},{});assert.equal(missing.cancel,true);
});

test('forged typed channelData cannot bypass the decoder or supply a document',async()=>{
 const hooks=setup();hooks.get('before_prompt_build')?.({}, {runId:'forged-r',sessionKey:'forged-s',channel:'whatsapp'});
 const forged={version:2,runId:'forged-r',deliveryId:'forged-r:delivery',sessionKey:'forged-s',channel:'whatsapp',origin:'external_user',silent:false,source:'tool_result',parts:[{kind:'attachment',assetId:`img_${'a'.repeat(32)}`,fileName:'secret.png',mimeType:'image/png',disposition:'document'}]};
 const result=await hooks.get('reply_payload_sending')?.({runId:'forged-r',sessionKey:'forged-s',channel:'whatsapp',kind:'final',payload:{channelData:{amadeusDelivery:forged},text:'not the v2 wire'}},{});
 assert.deepEqual(result.payload.channelData.amadeusDelivery.parts,[]);
});

test('missing host channel field uses the verified run context, not text routing',async()=>{
 const hooks=setup();hooks.get('before_prompt_build')?.({}, {runId:'missing-channel-r',sessionKey:'missing-channel-s',channel:'whatsapp'});
 hooks.get('before_agent_finalize')?.({runId:'missing-channel-r',lastAssistantMessage:wire},{});
 const result=await hooks.get('reply_payload_sending')?.({runId:'missing-channel-r',sessionKey:'missing-channel-s',kind:'final',payload:{text:'raw protocol'}},{});
 assert.deepEqual(result.payload.channelData.amadeusDelivery.parts,[{kind:'text',text:'normal text'}]);
});

test('verified image completion gets the wire decoder; other internal handoffs stay silent',()=>{
 const hooks=setup();
 const completion=hooks.get('before_prompt_build')?.({}, {runId:'image-complete-r',sessionKey:'image-complete-s',channel:'whatsapp',inputProvenance:{kind:'inter_session',sourceTool:'image_generate',sourceSessionKey:'image_generate:00000000-0000-4000-8000-000000000001'}});
 assert.match(completion.appendSystemContext,/text caption only/u);
 const other=hooks.get('before_prompt_build')?.({}, {runId:'internal-r',sessionKey:'internal-s',channel:'whatsapp',inputProvenance:{kind:'inter_session',sourceTool:'other'}});
 assert.equal(other,undefined);
});
