import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import type {OpenClawPluginApi,OpenClawPluginToolContext} from 'openclaw/plugin-sdk/core';
import {registerImageAssets,explicitUpscaleScale} from '../src/image-assets.js';import {registerVoiceReplyPrompt} from '../src/voice-reply-prompt.js';import {DELIVERY_BOUNDARY_GLOBAL,type WhatsAppDeliveryPort} from '../src/delivery-boundary.js';import {settleTelegramDelivery} from '../src/telegram-runtime.js';import {createAttachmentPart,createDeliveryEnvelope} from '../src/delivery-envelope.js';

test('explicit multiplier is a bounded parameter constraint, not a 4K resolution guess',()=>{
 assert.equal(explicitUpscaleScale('把刚才私聊的图超分 4x'),4);
 assert.equal(explicitUpscaleScale('请做4倍超分'),4);
 assert.equal(explicitUpscaleScale('超分两倍'),2);
 assert.equal(explicitUpscaleScale('做4K长边'),undefined);
 assert.equal(explicitUpscaleScale('比较2x和4x'),undefined);
});

for(const [mimeType,source] of [['image/png','upscale'],['image/jpeg','upscale'],['image/png','upscale2'],['image/png','generate'],['image/png','completion']] as const) test(`real hook chain ${source} ${mimeType} -> one typed provider primitive`,async()=>{
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
  registerVoiceReplyPrompt(api);registerImageAssets(api);
  const boundary=(globalThis as Record<string,unknown>)[DELIVERY_BOUNDARY_GLOBAL] as {createWhatsAppPlan(port:WhatsAppDeliveryPort):any};const sends:Array<{kind:string;bytes?:Buffer;text?:string}>=[];
  const sessionKey=`runtime-${source}-${mimeType}`;const taskId='00000000-0000-4000-8000-000000000001';const runId=`run-${sessionKey}`;
  const plan=boundary.createWhatsAppPlan({sessionKey,accountId:'secondary',conversationId:'chat',messageId:'inbound',inboundVoice:false,start(){},stop(){},sendText:async text=>{sends.push({kind:'text',text});return{messageId:'text-id'};},sendVoice:async()=>{throw new Error('unexpected voice');},sendImage:async asset=>{sends.push({kind:'image',bytes:asset.bytes});return{messageId:'image-id'};},sendDocument:async asset=>{sends.push({kind:'document',bytes:asset.bytes});return{messageId:'document-id'};}});
  assert.equal(plan.delivery.observeMessageSent,true);
  plan.replyOptions.onAgentRunStart(runId);
  for(const hook of hooks.get('before_prompt_build')??[])hook({}, {runId,sessionKey,channel:'whatsapp'});
  for(const hook of hooks.get('before_dispatch')??[])hook({channel:'whatsapp',sessionKey,body:source==='upscale2'?'请把刚才的图超分 2x':'请把刚才的图超分'}, {channelId:'whatsapp',sessionKey,conversationId:'chat',messageId:'inbound',replyToId:'old-image'});
  let result:unknown;
  if(source==='upscale'||source==='upscale2'){
    const tool=tools.get('amadeus_image_upscale')!({sessionKey,messageChannel:'whatsapp'} as OpenClawPluginToolContext);
    result=await tool.execute('tool-id',{target:{imageId:`img_${'c'.repeat(32)}`},scale:source==='upscale2'?4:2,mode:'anime'},undefined);
    const details=(result as any).details;assert.equal(details.deliveryAttachment.disposition,'document');assert.equal(details.mediaUrls,undefined);assert.equal(details.storageKey,undefined);
    const request=requests.find(request=>request.path==='/v1/upscale')!.body as any;assert.equal(request.replyMessageId,'old-image');assert.equal(request.scale,source==='upscale2'?2:4, 'user multiplier or default overrides an incorrect model-supplied scale');assert.equal(request.imageId,`img_${'c'.repeat(32)}`);
  }else if(source==='completion') result={content:[{type:'text',text:'Background task started (async=true)'}],details:{async:true}};
  else result={details:{paths:[join(root,'native-generated.bin')],attachments:[{path:join(root,'native-generated.bin'),mimeType}]},content:[{type:'text',text:'tool result text is not an image authority'}]};
  const jobs=source==='completion'?[]:(hooks.get('after_tool_call')??[]).map(hook=>hook({toolName:source==='generate'?'image_generate':'amadeus_image_upscale',runId,result},{runId,sessionKey,toolName:source,channelId:'whatsapp'}));
  if(source==='completion'){
    assert.equal((result as any).details.async,true);
    assert.equal(requests.filter(x=>x.path==='/v1/assets/import').length,0);
    assert.equal(sends.length,0);
    const boundary=(globalThis as Record<string,unknown>)[DELIVERY_BOUNDARY_GLOBAL] as {completeImageGeneration(input:any):Promise<void>};
    await boundary.completeImageGeneration({taskId,sessionKey,channel:'whatsapp',attachments:[{type:'image',path:join(root,'native-generated.bin'),mimeType:'image/png'}]});
    // Replayed detached completion shares the stable delivery id and cannot duplicate send.
    await boundary.completeImageGeneration({taskId,sessionKey,channel:'whatsapp',attachments:[{type:'image',path:join(root,'native-generated.bin'),mimeType:'image/png'}]});
    assert.deepEqual(sends.map(x=>x.kind),['image']);
    assert.deepEqual(sends[0]?.bytes,bytes);
    assert.equal(requests.filter(x=>x.path==='/v1/assets/import').length,1);
    assert.equal(requests.filter(x=>x.path==='/v1/assets/bind-delivery').length,1);
    return;
  }
  const wire=JSON.stringify({version:2,silent:false,parts:[{kind:'text',text:'完成。'}]});
  for(const hook of hooks.get('before_agent_finalize')??[])hook({runId,lastAssistantMessage:wire},{});
  const prepared=await plan.delivery.preparePayload({text:'RAW JSON + MEDIA merge must be ineligible',mediaUrls:['/native/tool/result']},{kind:'final'});await Promise.all(jobs);
  assert.deepEqual(Object.keys(prepared),['channelData']);assert.equal(prepared.channelData.amadeusDelivery.parts.at(-1).disposition,source==='upscale'||source==='upscale2'?'document':'inline');
  assert.equal(await plan.delivery.preparePayload({mediaUrls:['/native/tool/result']},{kind:'tool'}),null);
  await plan.delivery.deliver(prepared,{kind:'tool'});assert.equal(sends.length,0);
  await plan.delivery.deliver(prepared,{kind:'final'});await plan.delivery.deliver(prepared,{kind:'final'});
  assert.deepEqual(sends.map(send=>send.kind),['text',source==='upscale'||source==='upscale2'?'document':'image']);assert.equal(sends[0]?.text,'完成。');assert.deepEqual(sends[1]?.bytes,bytes);
  const binding=requests.find(request=>request.path==='/v1/assets/bind-delivery')!.body as any;assert.equal(binding.messageId,source==='upscale'||source==='upscale2'?'document-id':'image-id');assert.deepEqual(binding.assetIds,[id]);
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
    const part=createAttachmentPart({assetId:id,mimeType:'image/png',fileName:'file.png',disposition,byteSize:bytes.length,sha256:sha});
    const env=createDeliveryEnvelope({runId:`telegram-${disposition}-run`,deliveryId:`telegram-${disposition}-id`,sessionKey:'telegram-s',channel:'telegram',origin:'external_user',silent:false,source:'tool_result',parts:[part]});
    await settleTelegramDelivery(api,env,route,globalThis.fetch);
  }
  assert.deepEqual(uploads.map(u=>u.url.split('/').at(-1)),['sendDocument','sendPhoto']);
  assert.equal(uploads[0]?.form.get('message_thread_id'),'42');
  const doc=uploads[0]?.form.get('document') as File;assert.equal(doc.name,'file.png');assert.deepEqual(Buffer.from(await doc.arrayBuffer()),bytes);
 }finally{globalThis.fetch=original;await rm(root,{recursive:true,force:true});}
});
