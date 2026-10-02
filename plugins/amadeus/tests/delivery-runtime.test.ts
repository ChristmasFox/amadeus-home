import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import type {OpenClawPluginApi,OpenClawPluginToolContext} from 'openclaw/plugin-sdk/core';
import {registerImageAssets,explicitUpscaleScale} from '../src/image-assets.js';import {registerVoiceReplyPrompt} from '../src/voice-reply-prompt.js';import {DELIVERY_BOUNDARY_GLOBAL,type WhatsAppDeliveryPort} from '../src/delivery-boundary.js';import {settleTelegramDelivery} from '../src/telegram-runtime.js';import {createAttachmentPart,createDeliveryEnvelope} from '../src/delivery-envelope.js';import {INVALID_STRUCTURED_OUTPUT_MESSAGE} from '../src/delivery-decoder.js';

test('explicit multiplier is a bounded parameter constraint, not a 4K resolution guess',()=>{
 assert.equal(explicitUpscaleScale('把刚才私聊的图超分 4x'),4);
 assert.equal(explicitUpscaleScale('不写倍率，默认超分'),undefined);
 assert.equal(explicitUpscaleScale('请做4倍超分'),4);
 assert.equal(explicitUpscaleScale('超分两倍'),2);
 assert.equal(explicitUpscaleScale('做4K长边'),undefined);
 assert.equal(explicitUpscaleScale('比较2x和4x'),undefined);
});

let taskCounter=1;
for(const [mimeType,source] of [['image/png','upscale'],['image/jpeg','upscale'],['image/png','upscale2'],['image/png','generate'],['image/png','upscale4'],['image/png','completion'],['image/jpeg','provider-fallback'],['image/png','caption-omitted'],['image/png','caption-malformed'],['image/png','caption-error'],['image/png','attachment-failure'],['image/png','failure']] as const) test(`real hook chain ${source} ${mimeType} -> one typed provider primitive`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'delivery-runtime-'));await mkdir(join(root,'derived'));
 const bytes=mimeType==='image/png'?Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1]):Buffer.from([255,216,255,224,0,16,1,2,3,4]);
 const id=`img_${(mimeType==='image/png'?'a':'b').repeat(32)}`;const asset={imageId:id,storageKey:'derived/asset.bin',mimeType,width:1,height:1,byteSize:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),status:'ready'};
 const requests:Array<{path:string;body:unknown}>=[];
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requests.push({path:req.url!,body:req.url==='/v1/assets/import'?'binary':body?JSON.parse(body):undefined});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok',asset}));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as {port:number}).port;
 try{
  await writeFile(join(root,'derived/asset.bin'),bytes);await writeFile(join(root,'token'),'test-only');await writeFile(join(root,'native-generated.bin'),bytes);
  const hooks=new Map<string,Array<(...args:any[])=>any>>();const tools=new Map<string,(ctx:OpenClawPluginToolContext)=>any>();
  const api={rootDir:new URL('../',import.meta.url).pathname,config:{},pluginConfig:{imageAssetServiceBaseUrl:`http://127.0.0.1:${port}`,imageAssetServiceTokenFile:join(root,'token'),imageAssetContainerRoot:root},logger:{info(){},warn(){}},on(name:string,fn:(...args:any[])=>any){hooks.set(name,[...(hooks.get(name)??[]),fn]);},registerTool(factory:any,options:{name:string}){tools.set(options.name,factory);}} as unknown as OpenClawPluginApi;
  const captionInputs:any[]=[];const lifecycleInputs:any[]=[];
  registerVoiceReplyPrompt(api,{captionEnricher:async input=>{captionInputs.push(input);if(source==='caption-error')throw new Error('raw model provider error');if(source==='caption-omitted')return {};return source==='caption-malformed'?{caption:'{"caption":"raw caption protocol"}'}:{caption:`Kurisu caption for ${input.mimeType}`};},lifecycleMessageEnricher:async input=>{lifecycleInputs.push(input);return input.kind==='accepted'?'生成を始めたわ。':'生成に失敗したわ。';}});registerImageAssets(api);
  const boundary=(globalThis as Record<string,unknown>)[DELIVERY_BOUNDARY_GLOBAL] as {acceptImageGeneration(input:any):Promise<void>;failImageGeneration(input:any):Promise<void>;completeImageGeneration(input:any):Promise<void>;createWhatsAppPlan(port:WhatsAppDeliveryPort):any};const sends:Array<{kind:string;bytes?:Buffer;text?:string;caption?:string}>=[];
  const sessionKey=`runtime-${source}-${mimeType}`;const taskId=`00000000-0000-4000-8000-${String(taskCounter++).padStart(12,'0')}`;const runId=`run-${sessionKey}`;
  const inboundBody=source==='upscale2'?'请把刚才的图超分 2x':source==='upscale4'?'请把刚才的图超分 4x':source.startsWith('upscale')?'请把刚才的图超分':'请用中文生成一只戴宇航员头盔的橘猫。';
  const lifecycleInput={taskId,sessionKey,requesterAgentId:'main',channel:'whatsapp',accountId:'secondary',conversationId:'chat',requestContext:'a bounded original image request'};
  const expectedRequestContext=`Original user request: ${inboundBody} | Image prompt: ${lifecycleInput.requestContext}`;
  const plan=boundary.createWhatsAppPlan({sessionKey,accountId:'secondary',conversationId:'chat',messageId:'inbound',inboundVoice:false,start(){},stop(){},sendText:async text=>{sends.push({kind:'text',text});return{messageId:'text-id'};},sendVoice:async()=>{throw new Error('unexpected voice');},sendImage:async(asset,caption)=>{sends.push({kind:'image',bytes:asset.bytes,...(caption?{caption}:{})});return{messageId:'image-id'};},sendDocument:async asset=>{sends.push({kind:'document',bytes:asset.bytes});return{messageId:'document-id'};}});
  assert.equal(plan.delivery.observeMessageSent,true);
  plan.replyOptions.onAgentRunStart(runId);
  for(const hook of hooks.get('before_prompt_build')??[])hook({}, {runId,sessionKey,channel:'whatsapp'});
  for(const hook of hooks.get('before_dispatch')??[])hook({channel:'whatsapp',sessionKey,body:inboundBody}, {channelId:'whatsapp',sessionKey,conversationId:'chat',messageId:'inbound',replyToId:'old-image'});
  let result:unknown;
  if(source==='upscale'||source==='upscale2'||source==='upscale4'){
    const tool=tools.get('amadeus_image_upscale')!({sessionKey,messageChannel:'whatsapp'} as OpenClawPluginToolContext);
    result=await tool.execute('tool-id',{target:{imageId:`img_${'c'.repeat(32)}`},scale:4,mode:'anime'},undefined);
    const details=(result as any).details;assert.equal(details.deliveryAttachment.disposition,'document');assert.equal(details.mediaUrls,undefined);assert.equal(details.storageKey,undefined);
    const request=requests.find(request=>request.path==='/v1/upscale')!.body as any;assert.equal(request.replyMessageId,'old-image');assert.equal(request.scale,source==='upscale4'?4:2, 'explicit 4x remains available while model-supplied 4x cannot override the 2x default');assert.equal(request.imageId,`img_${'c'.repeat(32)}`);
  }else if(source==='completion'||source==='provider-fallback'||source==='caption-omitted'||source==='caption-malformed'||source==='caption-error'||source==='attachment-failure'||source==='failure') result={content:[{type:'text',text:'Background task started (async=true)'}],details:{async:true}};
  else result={details:{paths:[join(root,'native-generated.bin')],attachments:[{path:join(root,'native-generated.bin'),mimeType}]},content:[{type:'text',text:'tool result text is not an image authority'}]};
  const detached=source==='completion'||source==='provider-fallback'||source==='caption-omitted'||source==='caption-malformed'||source==='caption-error'||source==='attachment-failure'||source==='failure';
  const jobs=detached?[]:(hooks.get('after_tool_call')??[]).map(hook=>hook({toolName:source==='generate'?'image_generate':'amadeus_image_upscale',runId,result},{runId,sessionKey,toolName:source,channelId:'whatsapp'}));
  if(detached){
    assert.equal((result as any).details.async,true);assert.equal(requests.filter(x=>x.path==='/v1/assets/import').length,0);assert.equal(sends.length,0);
    if(source==='attachment-failure'){
      await boundary.acceptImageGeneration(lifecycleInput);
      await assert.rejects(boundary.completeImageGeneration({...lifecycleInput,attachments:[{type:'image',path:join(root,'missing-generated.bin'),mimeType}] }));
      assert.deepEqual(sends.map(x=>x.kind),['text']);assert.equal(captionInputs.length,0);assert.equal(requests.filter(x=>x.path==='/v1/assets/bind-delivery').length,0);
    }else if(source!=='failure'){
      await boundary.acceptImageGeneration(lifecycleInput);await boundary.acceptImageGeneration(lifecycleInput);
      assert.deepEqual(sends.map(x=>x.kind),['text'],'the started receipt itself is not an accepted acknowledgement');
      assert.equal(lifecycleInputs[0]?.requestContext,expectedRequestContext);assert.equal(lifecycleInputs[0]?.requestLanguage,'chinese');
      await boundary.completeImageGeneration({...lifecycleInput,attachments:[{type:'image',path:join(root,'native-generated.bin'),mimeType}]});
      await boundary.completeImageGeneration({...lifecycleInput,attachments:[{type:'image',path:join(root,'native-generated.bin'),mimeType}]});
      await boundary.failImageGeneration(lifecycleInput);
      assert.deepEqual(sends.map(x=>x.kind),['text','image']);assert.equal(sends[0]?.text,'生成を始めたわ。');assert.deepEqual(sends[1]?.bytes,bytes);
      assert.equal(sends[1]?.caption,source==='caption-omitted'||source==='caption-malformed'||source==='caption-error'?undefined:`Kurisu caption for ${mimeType}`);assert.equal(captionInputs.length,1);assert.equal(captionInputs[0]?.filePath,await realpath(join(root,'derived/asset.bin')));assert.equal(captionInputs[0]?.requestContext,expectedRequestContext);assert.equal(captionInputs[0]?.requestLanguage,'chinese');
      assert.equal(requests.filter(x=>x.path==='/v1/assets/import').length,1);assert.equal(requests.filter(x=>x.path==='/v1/assets/bind-delivery').length,1);
    }else{
      await boundary.acceptImageGeneration(lifecycleInput);await boundary.failImageGeneration(lifecycleInput);await boundary.failImageGeneration(lifecycleInput);
      assert.deepEqual(sends.map(x=>x.kind),['text','text']);assert.equal(sends[0]?.text,'生成を始めたわ。');assert.equal(sends[1]?.text,'生成に失敗したわ。');assert.deepEqual(lifecycleInputs.map(({kind,taskId,agentId,sessionKey,channel,requestContext,requestLanguage})=>({kind,taskId,agentId,sessionKey,channel,requestContext,requestLanguage})),[{kind:'accepted',taskId,agentId:'main',sessionKey,channel:'whatsapp',requestContext:expectedRequestContext,requestLanguage:'chinese'},{kind:'failed',taskId,agentId:'main',sessionKey,channel:'whatsapp',requestContext:expectedRequestContext,requestLanguage:'chinese'}]);
      assert.equal(captionInputs.length,0,'generation failure never runs caption enrichment');assert.equal(requests.filter(x=>x.path==='/v1/assets/import').length,0);
    }
    return;
  }
  const wire=JSON.stringify({version:2,silent:false,parts:[{kind:'text',text:'完成。'}]});
  for(const hook of hooks.get('before_agent_finalize')??[])hook({runId,lastAssistantMessage:wire},{});
  const prepared=await plan.delivery.preparePayload({text:'RAW JSON + MEDIA merge must be ineligible',mediaUrls:['/native/tool/result']},{kind:'final'});await Promise.all(jobs);
  assert.deepEqual(Object.keys(prepared),['channelData']);assert.equal(prepared.channelData.amadeusDelivery.parts.at(-1).disposition,source==='upscale'||source==='upscale2'||source==='upscale4'?'document':'inline');
  assert.equal(await plan.delivery.preparePayload({mediaUrls:['/native/tool/result']},{kind:'tool'}),null);
  await plan.delivery.deliver(prepared,{kind:'tool'});assert.equal(sends.length,0);
  await plan.delivery.deliver(prepared,{kind:'final'});await plan.delivery.deliver(prepared,{kind:'final'});
  assert.deepEqual(sends.map(send=>send.kind),['text',source==='upscale'||source==='upscale2'||source==='upscale4'?'document':'image']);assert.equal(sends[0]?.text,'完成。');assert.deepEqual(sends[1]?.bytes,bytes);
  const binding=requests.find(request=>request.path==='/v1/assets/bind-delivery')!.body as any;assert.equal(binding.messageId,source==='upscale'||source==='upscale2'||source==='upscale4'?'document-id':'image-id');assert.deepEqual(binding.assetIds,[id]);
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(root,{recursive:true,force:true});}
});
test('Telegram native text and actual Bot API document/photo primitives preserve disposition',async()=>{
 const root=await mkdtemp(join(tmpdir(),'delivery-telegram-'));await mkdir(join(root,'derived'));
 const bytes=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1]);
 const id=`img_${'f'.repeat(32)}`;const sha=createHash('sha256').update(bytes).digest('hex');
 const asset={imageId:id,storageKey:'derived/file.png',mimeType:'image/png',width:1,height:1,byteSize:bytes.length,sha256:sha,status:'ready'};
 const gatewayCalls:any[]=[];const uploads:Array<{url:string;form:FormData}>=[];const original=globalThis.fetch;
 try{
  await writeFile(join(root,'derived/file.png'),bytes);await writeFile(join(root,'token'),'test-only');
  globalThis.fetch=async(url,init)=>{
    const address=String(url);
    if(address.includes('/v1/assets/'))return new Response(JSON.stringify({asset}),{headers:{'Content-Type':'application/json'}});
    if(address.endsWith('/v1/assets/bind-delivery'))return new Response(JSON.stringify({status:'ok'}),{headers:{'Content-Type':'application/json'}});
    if(address.includes('/bot')){uploads.push({url:address,form:init?.body as FormData});return new Response(JSON.stringify({ok:true,result:{message_id:uploads.length+100}}),{headers:{'Content-Type':'application/json'}});}
    throw new Error('unexpected outbound endpoint');
  };
  const api={config:{channels:{telegram:{enabled:true,botToken:'123:test-only'}}},pluginConfig:{imageAssetServiceBaseUrl:'http://127.0.0.1:18792',imageAssetServiceTokenFile:join(root,'token'),imageAssetContainerRoot:root},runtime:{gateway:{request:async(_method:string,params:any)=>{gatewayCalls.push(params);}}},logger:{info(){},warn(){}}} as unknown as OpenClawPluginApi;
  const route={conversationId:'12345',threadId:42};
  const textEnv=createDeliveryEnvelope({runId:'telegram-text-run',deliveryId:'telegram-text-id',sessionKey:'telegram-s',channel:'telegram',origin:'external_user',silent:false,source:'agent_structured_output',parts:[{kind:'text',text:'Telegram 文本'}]});
  await settleTelegramDelivery(api,textEnv,route);assert.equal(gatewayCalls[0].message,'Telegram 文本');assert.equal(gatewayCalls[0].threadId,42);assert.equal(uploads.length,0);
  for(const disposition of ['document','inline'] as const){
    const part=createAttachmentPart({assetId:id,mimeType:'image/png',fileName:'file.png',disposition,byteSize:bytes.length,sha256:sha,...(disposition==='inline'?{caption:'Telegram caption'}:{})});
    const env=createDeliveryEnvelope({runId:`telegram-${disposition}-run`,deliveryId:`telegram-${disposition}-id`,sessionKey:'telegram-s',channel:'telegram',origin:'external_user',silent:false,source:'tool_result',parts:[part]});
    await settleTelegramDelivery(api,env,route,globalThis.fetch);
  }
  assert.deepEqual(uploads.map(u=>u.url.split('/').at(-1)),['sendDocument','sendPhoto']);
  assert.equal(uploads[0]?.form.get('message_thread_id'),'42');assert.equal(uploads[1]?.form.get('caption'),'Telegram caption');
  const doc=uploads[0]?.form.get('document') as File;assert.equal(doc.name,'file.png');assert.deepEqual(Buffer.from(await doc.arrayBuffer()),bytes);
 }finally{globalThis.fetch=original;await rm(root,{recursive:true,force:true});}
});

test('Telegram accepted/failure lifecycle notices use the original native text route exactly once',async()=>{
 const gatewayCalls:any[]=[];const lifecycleInputs:any[]=[];const hooks=new Map<string,Array<(...args:any[])=>any>>();
 const api={rootDir:new URL('../',import.meta.url).pathname,config:{channels:{telegram:{enabled:true,botToken:'123:test-only'}}},pluginConfig:{},runtime:{gateway:{request:async(method:string,params:any)=>{gatewayCalls.push({method,params});}}},logger:{info(){},warn(){}},on(name:string,fn:(...args:any[])=>any){hooks.set(name,[...(hooks.get(name)??[]),fn]);}} as unknown as OpenClawPluginApi;
 registerVoiceReplyPrompt(api,{captionEnricher:async()=>{throw new Error('caption must not run for lifecycle text');},lifecycleMessageEnricher:async input=>{lifecycleInputs.push(input);return input.kind==='accepted'?'生成を始めたわ。':'画像生成に失敗したわ。';}});
 const boundary=(globalThis as Record<string,unknown>)[DELIVERY_BOUNDARY_GLOBAL] as {acceptImageGeneration(input:any):Promise<void>;failImageGeneration(input:any):Promise<void>};
 const input={taskId:'00000000-0000-4000-8000-000000000021',sessionKey:'telegram-owner-session',requesterAgentId:'main',channel:'telegram',accountId:'default',conversationId:'12345',threadId:42};
 const userRequest='请用中文生成一幅樱花季京都街景。';
 for(const hook of hooks.get('before_dispatch')??[])hook({channel:'telegram',sessionKey:input.sessionKey,body:userRequest},{channelId:'telegram',sessionKey:input.sessionKey,conversationId:input.conversationId});
 await boundary.acceptImageGeneration(input);await boundary.acceptImageGeneration(input);
 await boundary.failImageGeneration(input);await boundary.failImageGeneration(input);
 assert.deepEqual(gatewayCalls.map(call=>call.params.message),['生成を始めたわ。','画像生成に失敗したわ。']);
 assert.ok(gatewayCalls.every(call=>call.method==='send'&&call.params.threadId===42&&call.params.to==='12345'));
 assert.deepEqual(lifecycleInputs.map(({kind,taskId,agentId,sessionKey,channel,requestContext,requestLanguage})=>({kind,taskId,agentId,sessionKey,channel,requestContext,requestLanguage})),[{kind:'accepted',taskId:input.taskId,agentId:'main',sessionKey:input.sessionKey,channel:'telegram',requestContext:userRequest,requestLanguage:'chinese'},{kind:'failed',taskId:input.taskId,agentId:'main',sessionKey:input.sessionKey,channel:'telegram',requestContext:userRequest,requestLanguage:'chinese'}]);
});

test('WhatsApp final deliver bypass re-runs typed preparation and preserves internal origin', async () => {
 const hooks = new Map<string, Array<(...args: any[]) => any>>();
 const api = {
  rootDir: new URL('../', import.meta.url).pathname,
  config: {},
  pluginConfig: {},
  logger: { info() {}, warn() {} },
  on(name: string, handler: (...args: any[]) => any) { hooks.set(name, [...(hooks.get(name) ?? []), handler]); },
 } as unknown as OpenClawPluginApi;
 registerVoiceReplyPrompt(api);
 const boundary = (globalThis as Record<string, unknown>)[DELIVERY_BOUNDARY_GLOBAL] as { createWhatsAppPlan(port: WhatsAppDeliveryPort): any };
 const sent: string[] = [];
 const makePlan = (sessionKey: string) => {
  const plan = boundary.createWhatsAppPlan({
   sessionKey, accountId: 'secondary', conversationId: 'chat', messageId: `message-${sessionKey}`, inboundVoice: false,
   sendText: async (text) => { sent.push(text); return { messageId: `sent-${sessionKey}` }; },
   sendVoice: async () => ({ messageId: `voice-${sessionKey}` }),
   sendImage: async () => ({ messageId: `image-${sessionKey}` }),
   sendDocument: async () => ({ messageId: `document-${sessionKey}` }),
   start() {}, stop() {},
  });
  return plan;
 };
 const rawWire = (text: string) => JSON.stringify({ version: 2, silent: false, parts: [{ kind: 'text', text }] });

 const internalPlan = makePlan('delivery-bypass-heartbeat');
 internalPlan.replyOptions.onAgentRunStart('delivery-bypass-heartbeat-run');
 for (const hook of hooks.get('before_prompt_build') ?? []) hook({}, {
  runId: 'delivery-bypass-heartbeat-run', sessionKey: 'delivery-bypass-heartbeat', channel: 'whatsapp', trigger: 'heartbeat',
  inputProvenance: { kind: 'internal_system' },
 });
 const internal = await internalPlan.delivery.deliver({ text: '[[amadeus:reply-modality=default]]\nNO_REPLY' }, { kind: 'final' });
 assert.deepEqual(internal, { visibleReplySent: false });
 assert.deepEqual(sent, [], 'raw internal marker/sentinel text is never sent');

 const malformedMarkerPlan = makePlan('delivery-bypass-marker');
 malformedMarkerPlan.replyOptions.onAgentRunStart('delivery-bypass-marker-run');
 for (const hook of hooks.get('before_prompt_build') ?? []) hook({}, {
  runId: 'delivery-bypass-marker-run', sessionKey: 'delivery-bypass-marker', channel: 'whatsapp', inputProvenance: { kind: 'external_user' },
 });
 const marked = await malformedMarkerPlan.delivery.deliver({
  text: rawWire('[[amadeus:reply-modality=default]]\nNO_REPLY'),
 }, { kind: 'final' });
 assert.deepEqual(marked, { visibleReplySent: true });
 assert.deepEqual(sent, [INVALID_STRUCTURED_OUTPUT_MESSAGE], 'control-token content receives the bounded structured-output fallback');

 const normalPlan = makePlan('delivery-bypass-normal');
 normalPlan.replyOptions.onAgentRunStart('delivery-bypass-normal-run');
 for (const hook of hooks.get('before_prompt_build') ?? []) hook({}, {
  runId: 'delivery-bypass-normal-run', sessionKey: 'delivery-bypass-normal', channel: 'whatsapp', inputProvenance: { kind: 'external_user' },
 });
 const delivered = await normalPlan.delivery.deliver({ text: rawWire('正常回复。') }, { kind: 'final' });
 assert.deepEqual(delivered, { visibleReplySent: true });
 assert.deepEqual(sent, [INVALID_STRUCTURED_OUTPUT_MESSAGE, '正常回复。'], 'direct final delivery still settles valid typed content');
});

test('image lifecycle recovers original request language from account-scoped conversation when task session differs', async () => {
 const hooks = new Map<string, Array<(...args: any[]) => any>>();
 const captured: any[] = [];
 const api = {
  rootDir: new URL('../', import.meta.url).pathname,
  config: {},
  pluginConfig: {},
  logger: { info() {}, warn() {} },
  on(name: string, handler: (...args: any[]) => any) { hooks.set(name, [...(hooks.get(name) ?? []), handler]); },
 } as unknown as OpenClawPluginApi;
 registerVoiceReplyPrompt(api, { lifecycleMessageEnricher: async input => { captured.push(input); return '已开始。'; } });
 const inbound = { channel: 'whatsapp', sessionKey: 'inbound-session', body: '', content: '请生成一张竖屏插画。' };
 for (const hook of hooks.get('before_dispatch') ?? []) hook(inbound, {
  channelId: 'whatsapp', sessionKey: 'inbound-session', accountId: 'secondary', conversationId: 'chat-42',
 });
 const boundary = (globalThis as Record<string, unknown>)[DELIVERY_BOUNDARY_GLOBAL] as { acceptImageGeneration(input: any): Promise<void> };
 await boundary.acceptImageGeneration({
  taskId: '00000000-0000-4000-8000-000000000777', sessionKey: 'detached-task-session', requesterAgentId: 'main',
  channel: 'whatsapp', accountId: 'secondary', conversationId: 'chat-42', requestContext: 'an English model-generated image prompt',
 });
 assert.equal(captured[0]?.requestLanguage, 'chinese');
 assert.match(captured[0]?.requestContext, /请生成一张竖屏插画/u);
 assert.match(captured[0]?.requestContext, /English model-generated image prompt/u);

 const sameSessionInbound = { channel: 'whatsapp', sessionKey: 'same-session', body: '', content: '日本語で画像を作って。' };
 for (const hook of hooks.get('before_dispatch') ?? []) hook(sameSessionInbound, {
  channelId: 'whatsapp', sessionKey: 'same-session', accountId: 'secondary', conversationId: 'chat-43',
 });
 await boundary.acceptImageGeneration({
  taskId: '00000000-0000-4000-8000-000000000778', sessionKey: 'same-session', requesterAgentId: 'main',
  channel: 'whatsapp', accountId: 'secondary', conversationId: 'chat-43', requestContext: 'English translated prompt',
 });
 assert.equal(captured[1]?.requestLanguage, 'japanese');
});
