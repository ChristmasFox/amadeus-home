#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import vm from 'node:vm';
import { patchWhatsAppSource, patchWhatsAppIngressQueueSource } from './patch-openclaw-whatsapp-voice-lifecycle.mjs';
import { installSource, upstream } from '../integrations/openclaw/delivery-boundary/install.mjs';
import { CORE_PIN as IMAGE_COMPLETION_PIN, assertPinnedCoreVersion, installCoreCompletionSource } from '../integrations/openclaw/delivery-boundary/core-completion.mjs';
const require = createRequire(new URL('../plugins/amadeus/package.json', import.meta.url));
const host = dirname(dirname(dirname(require.resolve('openclaw/plugin-sdk/core'))));
const original = process.env.AMADEUS_WHATSAPP_UPSTREAM_MODULE ? await readFile(process.env.AMADEUS_WHATSAPP_UPSTREAM_MODULE,'utf8') : await upstream(process.env.AMADEUS_WHATSAPP_ARCHIVE);
const template = await readFile(new URL('../integrations/openclaw/delivery-boundary/whatsapp-plan.js', import.meta.url),'utf8');
const acorn=createRequire(host+'/package.json')('acorn');
function acornParse(source){return acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'});}
const transformed=installSource(original,template,host);
// Exercise the exact pinned OpenClaw accepted + terminal lifecycle functions.
// Only task identity/origin and persisted attachment facts cross this bridge.
const coreOriginal=await readFile(`${host}/dist/${IMAGE_COMPLETION_PIN.module}`,'utf8');
assertPinnedCoreVersion('2026.9.4');
assert.throws(()=>assertPinnedCoreVersion('2026.9.5'),/version_mismatch/u);
const corePatched=installCoreCompletionSource(coreOriginal,host);
assert.throws(()=>installCoreCompletionSource(coreOriginal+'\n',host),/digest_mismatch/u);
assert.throws(()=>installCoreCompletionSource(coreOriginal.replace('async function wakeMediaGenerationTaskCompletion(params)','async function wakeMediaGenerationTaskCompletionChanged(params)'),host),/anchor_mismatch/u);
const coreAst=acornParse(corePatched);
const functionNode=(name,source=corePatched)=>acornParse(source).body.find(node=>node.type==='FunctionDeclaration'&&node.id?.name===name);
const completionNode=functionNode('wakeMediaGenerationTaskCompletion');
const acceptedNode=functionNode('notifyMediaGenerationAsyncTaskStarted');
assert.ok(completionNode&&acceptedNode,'pinned lifecycle functions must remain uniquely anchored');
const accepted=[];const claimed=[];const failures=[];let nativeAnnouncements=0;let callbackText;
const boundary={version:2,
 acceptImageGeneration:async input=>{accepted.push(input);},
 completeImageGeneration:async input=>{claimed.push(input);},
 failImageGeneration:async input=>{failures.push(input);},
};
const completionScope={
 globalThis:{__amadeusDeliveryBoundaryV2_20260930:boundary},
 mediaUrlsFromGeneratedAttachments:attachments=>attachments.map(attachment=>attachment.url).filter(Boolean),
 formatAgentInternalEventsForPrompt:events=>JSON.stringify(events),
 buildMediaGenerationReplyInstruction:()=> 'process the completion update',
 deliverSubagentAnnouncement:async()=>{nativeAnnouncements++;return {delivered:true};},
 'log$7':{warn(){},error(){}}
};
const completionHandler=vm.runInNewContext(`${corePatched.slice(completionNode.start,completionNode.end)}; wakeMediaGenerationTaskCompletion`,completionScope);
const trustedAttachment={type:'image',path:'/tmp/openclaw-generated/image.png',mimeType:'image/png'};
const handle={taskId:'00000000-0000-4000-8000-000000000001',runId:'run-1',requesterSessionKey:'owner-session',requesterAgentId:'main',taskLabel:'a bounded image request',requesterOrigin:{channel:'whatsapp',accountId:'secondary',to:'owner-chat',threadId:9}};
const startedHandler=vm.runInNewContext(`${corePatched.slice(acceptedNode.start,acceptedNode.end)}; notifyMediaGenerationAsyncTaskStarted`,completionScope);
await startedHandler({toolName:'image_generate',handle,message:'OpenClaw internal started receipt',callback:async message=>{callbackText=message;},onFailure(){}});
assert.equal(accepted.length,1);assert.equal(accepted[0].taskId,handle.taskId);assert.equal(accepted[0].requestContext,handle.taskLabel);
assert.equal(callbackText,'OpenClaw internal started receipt','the integration does not parse or reuse started prose');
const failedNotification=vm.runInNewContext(`${corePatched.slice(acceptedNode.start,acceptedNode.end)}; notifyMediaGenerationAsyncTaskStarted`,{globalThis:{__amadeusDeliveryBoundaryV2_20260930:{version:2,acceptImageGeneration:async()=>{throw new Error('notice failure');}}}});
await assert.doesNotReject(failedNotification({toolName:'image_generate',handle,message:'started',callback:async()=>{},onFailure(){}}),'accepted notification errors cannot cancel admission');
const completionResult=await completionHandler({eventSource:'image_generation',status:'ok',toolName:'image_generate',attachments:[trustedAttachment],mediaUrls:[],handle});
assert.equal(completionResult.status,'delivered');assert.equal(claimed.length,1);assert.equal(claimed[0].attachments[0],trustedAttachment);
assert.equal(claimed[0].sessionKey,'owner-session');assert.equal(claimed[0].requesterAgentId,'main');assert.equal(claimed[0].requestContext,'a bounded image request');assert.equal(claimed[0].threadId,9);
assert.equal(nativeAnnouncements,1,'native task completion continues after typed success settlement');
const failureResult=await completionHandler({eventSource:'image_generation',status:'error',toolName:'image_generate',result:'raw provider payload must not be forwarded',handle:{...handle,taskId:'00000000-0000-4000-8000-000000000002'}});
assert.equal(failureResult.status,'delivered');assert.equal(failures.length,1);assert.equal(failures[0].taskId,'00000000-0000-4000-8000-000000000002');
assert.equal('result' in failures[0],false,'raw failure payload is not forwarded');assert.equal(nativeAnnouncements,1,'failure settlement does not emit a second native completion');
const safetyFailureResult=await completionHandler({eventSource:'image_generation',status:'error',toolName:'image_generate',result:{status:400,error:{message:'content policy violation'}},handle:{...handle,taskId:'00000000-0000-4000-8000-000000000003'}});
assert.equal(safetyFailureResult.status,'delivered');assert.equal(failures.at(-1).failureReason,'safety_refusal');
// A true admission failure occurs before OpenClaw invokes the accepted observer.
const originalAst=acornParse(coreOriginal);const runnerNode=originalAst.body.find(node=>node.type==='FunctionDeclaration'&&node.id?.name==='runMediaGenerationTask');
assert.ok(runnerNode,'pinned detached task admission boundary must remain anchored');let preAdmissionAck=0;
const runnerBody=coreOriginal.slice(runnerNode.body.start,runnerNode.body.end);
assert.ok(runnerBody.indexOf('scheduleMediaGenerationTaskCompletion')<runnerBody.indexOf('notifyMediaGenerationAsyncTaskStarted'),'accepted signal must follow detached scheduling');
const runnerScope={};const runTask=vm.runInNewContext(`${coreOriginal.slice(runnerNode.start,runnerNode.end)}; runMediaGenerationTask`,runnerScope);
await assert.rejects(runTask({generationLabel:'image',lifecycle:{createTaskRun(){throw new Error('admission rejected');}},sessionKey:'owner-session',requesterAgentId:'main',prompt:'image',scheduleBackgroundWork(){},onAsyncTaskStarted(){preAdmissionAck++;}}),/admission rejected/u);
assert.equal(preAdmissionAck,0,'pre-admission failure cannot produce an accepted acknowledgement');
const withLifecycle = patchWhatsAppIngressQueueSource(patchWhatsAppSource(transformed));
assert.equal(acornParse(withLifecycle).type, 'Program');

assert.throws(()=>installSource(original+'\n',template,host),/digest_mismatch/u);
const node=acorn.parse(transformed,{ecmaVersion:'latest',sourceType:'module'}).body.find(node=>node.type==='FunctionDeclaration'&&node.id?.name==='createWhatsAppReplyPlan');
const body=transformed.slice(node.start,node.end);
assert.equal(body.includes('mediaOnlyCoalescer'),false);
assert.equal(body.includes('mediaUrls'),false);
assert.equal(body.includes('JSON.parse'),false);
const provider=[];let port;
const scope={globalThis:{__amadeusDeliveryBoundaryV2_20260930:{version:2,createWhatsAppPlan(input){port=input;return {replyOptions:{},dispatcherOptions:{},delivery:{observeMessageSent:true,preparePayload:async()=>null,durable:()=>false,deliver:async()=>({visibleReplySent:false})}};}}},
 buildQuotedMessageOptions:params=>params,listWhatsAppSendResultMessageIds:result=>[result.messageId],markdownToWhatsAppChunks:text=>[text],resolveTextChunkLimit:()=>4000,resolveMarkdownTableMode$1:()=> 'code',resolveChunkMode:()=> 'length',
 resolveWhatsAppInboundReplyPolicy:()=>({suppressTyping:false,disableBlockStreaming:false}),resolveChannelStreamingBlockEnabled:()=>false,
 startAmadeusVoiceReplyLease:()=>({}),startAmadeusWhatsAppTypingIndicator:()=>()=>{},closeAmadeusVoiceReplyLeaseForTurn:()=>{},
 prepareWhatsAppOutboundMedia:async media=>({buffer:media.buffer,mimetype:'audio/ogg; codecs=opus'})};
vm.runInNewContext(body+'\nglobalThis.createPlan=createWhatsAppReplyPlan;',scope);
const params={route:{sessionKey:'s',accountId:'secondary'},cfg:{},inbound:{event:{id:'m'},conversation:{id:'chat'},media:[]},transport:{chatJid:'chat',reply:async text=>{provider.push({text});return{providerAccepted:true,messageId:'t'};},sendMedia:async payload=>{provider.push(payload);return{providerAccepted:true,messageId:'a'};}}};
const plan=scope.globalThis.createPlan(params);
assert.equal(plan.delivery.observeMessageSent,true);assert.equal(typeof plan.delivery.preparePayload,'function');assert.equal(typeof plan.delivery.deliver,'function');
for(const mimeType of ['image/png','image/jpeg']){
 const bytes=Buffer.from('original lossless file '+mimeType);await port.sendDocument({bytes,mimeType,fileName:'upscale.png'});const actual=provider.at(-1);
 assert.equal(actual.document,bytes);assert.equal('image' in actual,false);assert.equal(actual.mimetype,mimeType);
}
await port.sendImage({bytes:Buffer.from('image'),mimeType:'image/png'},'same-bubble caption');assert.ok(provider.at(-1).image);assert.equal(provider.at(-1).caption,'same-bubble caption');assert.equal(provider.filter(item=>item.text).length,0,'no independent caption text send occurs');
await port.sendText('typed text');assert.deepEqual(provider.at(-1),{text:'typed text'});
await assert.rejects(port.sendText('[[control]]\nNO_REPLY'),/protocol_text_rejected/u);
await port.sendVoice({audio:Buffer.from('audio'),mimeType:'audio/mpeg'});assert.equal(provider.at(-1).ptt,true);
params.transport.sendMedia=async()=>{throw new Error('document rejected');};await assert.rejects(port.sendDocument({bytes:Buffer.from('document'),mimeType:'image/png',fileName:'file.png'}));
scope.globalThis.__amadeusDeliveryBoundaryV2_20260930=undefined;assert.throws(()=>scope.globalThis.createPlan(params),/unavailable/u);
console.log('DELIVERY_BOUNDARY_PINNED_AST_AND_PROVIDER_CONTRACT=passed');
