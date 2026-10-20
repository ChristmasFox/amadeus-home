#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import vm from 'node:vm';
import { patchWhatsAppSource, patchWhatsAppIngressQueueSource } from './patch-openclaw-whatsapp-voice-lifecycle.mjs';
import { installSource, upstream, boundaryHookKeys, verifyLiveSource } from '../integrations/openclaw/delivery-boundary/install.mjs';
import { CORE_PIN as IMAGE_COMPLETION_PIN, assertPinnedCoreVersion, installCoreCompletionSource } from '../integrations/openclaw/delivery-boundary/core-completion.mjs';
const require = createRequire(new URL('../plugins/amadeus/package.json', import.meta.url));
const host = dirname(dirname(dirname(require.resolve('openclaw/plugin-sdk/core'))));
const original = process.env.AMADEUS_WHATSAPP_UPSTREAM_MODULE ? await readFile(process.env.AMADEUS_WHATSAPP_UPSTREAM_MODULE,'utf8') : await upstream(process.env.AMADEUS_WHATSAPP_ARCHIVE);
const template = await readFile(new URL('../integrations/openclaw/delivery-boundary/whatsapp-plan.js', import.meta.url),'utf8');
const statusTemplate = await readFile(new URL('../integrations/openclaw/delivery-boundary/whatsapp-status-reaction.js', import.meta.url),'utf8');
const acorn=createRequire(host+'/package.json')('acorn');
function acornParse(source){return acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'});}
const transformed=installSource(original,template,host,statusTemplate);
// Live-module verification: the installed module carries every template hook;
// a stale boundary (e.g. without sendReaction) must fail the deploy.
assert.ok(boundaryHookKeys(template,host).includes('sendReaction'));
assert.deepEqual(verifyLiveSource(transformed,template,host,statusTemplate),boundaryHookKeys(template,host));
assert.throws(()=>verifyLiveSource(installSource(original,template.replace('sendReaction: (emoji) =>','staleReaction: (emoji) =>'),host,statusTemplate),template,host,statusTemplate),/hooks_missing:sendReaction/u);
assert.throws(()=>verifyLiveSource(installSource(original,template,host),template,host,statusTemplate),/hooks_missing:status_reaction_controller/u);
assert.throws(()=>verifyLiveSource(original,template,host),/hooks_missing|port_missing/u);
console.log('DELIVERY_BOUNDARY_LIVE_VERIFY=passed');
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
const scope={globalThis:{__amadeusDeliveryBoundaryV2_20260930:{version:2,createWhatsAppPlan(input){port=input;return {replyOptions:{},dispatcherOptions:{},finalize:()=>true,delivery:{observeMessageSent:true,preparePayload:async()=>null,durable:()=>false,deliver:async()=>({visibleReplySent:false})}};}}},
 readAgentRunTerminalOutcome:()=> 'completed',finalizeWhatsAppStatusReaction:async({controller,outcome})=>{if(outcome==='done')await controller.setDone();else await controller.setError();await controller.restoreInitial();},
 buildQuotedMessageOptions:params=>params,listWhatsAppSendResultMessageIds:result=>[result.messageId],markdownToWhatsAppChunks:text=>[text],resolveTextChunkLimit:()=>4000,resolveMarkdownTableMode$1:()=> 'code',resolveChunkMode:()=> 'length',
 resolveWhatsAppInboundReplyPolicy:()=>({suppressTyping:false,disableBlockStreaming:false}),resolveChannelStreamingBlockEnabled:()=>false,
 startAmadeusVoiceReplyLease:()=>({}),startAmadeusWhatsAppTypingIndicator:()=>()=>{},closeAmadeusVoiceReplyLeaseForTurn:()=>{},
 prepareWhatsAppOutboundMedia:async media=>({buffer:media.buffer,mimetype:'audio/ogg; codecs=opus'}),
 sendReactionWhatsApp:async(...args)=>{reactions.push(args);}};
const reactions=[];
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
await port.sendReaction('😂');assert.deepEqual(reactions.at(-1).slice(0,3),['chat','m','😂']);assert.equal(reactions.at(-1)[3].fromMe,false);assert.equal('participant' in reactions.at(-1)[3],false);
// Staged status reactions end on the contextual emoji: never ✅ and never a
// 👀 restore, in either order of reply-reaction vs dispatch finalize.
{
 const { createStatusReactionController } = await import(createRequire(host+'/package.json').resolve('openclaw/plugin-sdk/channel-feedback'));
 const statusNode=acornParse(transformed).body.find(item=>item.type==='FunctionDeclaration'&&item.id?.name==='createWhatsAppStatusReactionController');
 const wire=[];
 const statusScope={createStatusReactionController,logVerbose:()=>{},
  sendReactionWhatsApp:async(chat,id,emoji,options)=>{wire.push({chat,id,emoji,options});},
  resolveWhatsAppReactionEligibility:async()=>({status:'enabled',chatId:'g@g.us',messageId:'gm',emoji:'👀',reactionOptions:{fromMe:false,participant:'p@s.whatsapp.net'}})};
 const basePort=port;const planReaction=scope.sendReactionWhatsApp;scope.sendReactionWhatsApp=statusScope.sendReactionWhatsApp;
 const createStatus=vm.runInNewContext(`${transformed.slice(statusNode.start,statusNode.end)}; createWhatsAppStatusReactionController`,statusScope);
 const statusArgs={msg:{event:{id:'gm'}},cfg:{messages:{statusReactions:{enabled:true}}}};
 assert.equal(await createStatus({...statusArgs,cfg:{}}),null,'disabled config keeps the native path');
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const run=async(order)=>{
  wire.length=0;const ctl=await createStatus(statusArgs);assert.equal(typeof ctl.finishWithContextual,'function');
  let releaseAck;const ackGate=new Promise(resolve=>{releaseAck=resolve;});const trace=[];
  const gatedSend=statusScope.sendReactionWhatsApp;statusScope.sendReactionWhatsApp=async(...args)=>{if(args[2]==='👀'&&!wire.length){await ackGate;}trace.push('reaction:'+args[2]);return gatedSend(...args);};
  ctl.setQueued();let composing=0;const plan=scope.globalThis.createPlan({...params,transport:{...params.transport,sendComposing:async()=>{composing+=1;trace.push('composing');}},statusReactionController:ctl});const statusPort=port;
  assert.equal(typeof ctl.onReactionSent,'function','plan re-asserts typing after reactions');
  port.start();await sleep(20);
  assert.equal(composing,0,'typing waits while the queued 👀 is in flight');
  releaseAck();await sleep(20);statusScope.sendReactionWhatsApp=gatedSend;
  assert.equal(trace[0],'reaction:👀');assert.ok(composing>=1,'typing starts right after the 👀 lands');
  const startPulses=composing;
  plan.afterRecord();await sleep(800);await plan.replyOptions.onToolStart({name:'web_search'});await sleep(800);
  let react;
  assert.ok(composing>=startPulses+2,`each stage reaction re-sends composing (${order}): ${composing}`);
  const stoppedPulses=composing;
  if(order==='react-first'){react=statusPort.sendReaction('😂');plan.finalize({});}
  else if(order==='finalize-first'){plan.finalize({});react=statusPort.sendReaction('😂');}
  else plan.finalize({});
  await react;await sleep(order==='none'?1800:0);
  assert.equal(composing,stoppedPulses,'terminal reactions never re-send composing');port.stop();
  return wire.map(item=>item.emoji);
 };
 for(const order of ['react-first','finalize-first']){
  const seen=await run(order);
  assert.equal(seen[0],'👀');assert.ok(seen.includes('🧠'),`thinking stage shown (${order}): ${seen}`);
  assert.ok(seen.length>=3,`tool stage shown (${order}): ${seen}`);
  assert.equal(seen.at(-1),'😂',`final reaction is contextual (${order}): ${seen}`);
  if(order==='react-first') assert.equal(seen.includes('✅'),false,`no done flash: ${seen}`);
  if(order==='react-first') assert.ok(wire.every(item=>item.chat==='g@g.us'&&item.id==='gm'&&item.options.participant==='p@s.whatsapp.net'),'group key carries participant');
  else assert.deepEqual(seen.slice(-3),['✅','👀','😂'],'late reaction lands strictly after the native restore');
 }
 const plain=await run('none');assert.deepEqual(plain.slice(-2),['✅','👀'],'no contextual emoji keeps native done/restore');
 scope.sendReactionWhatsApp=planReaction;port=basePort;
 console.log('WHATSAPP_STATUS_REACTION_CONTEXTUAL_TERMINAL=passed');
}
params.transport.sendMedia=async()=>{throw new Error('document rejected');};await assert.rejects(port.sendDocument({bytes:Buffer.from('document'),mimeType:'image/png',fileName:'file.png'}));
scope.globalThis.__amadeusDeliveryBoundaryV2_20260930=undefined;assert.throws(()=>scope.globalThis.createPlan(params),/unavailable/u);
console.log('DELIVERY_BOUNDARY_PINNED_AST_AND_PROVIDER_CONTRACT=passed');
