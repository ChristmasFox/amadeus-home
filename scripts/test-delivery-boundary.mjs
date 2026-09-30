#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import vm from 'node:vm';
import { patchWhatsAppSource, patchWhatsAppIngressQueueSource } from './patch-openclaw-whatsapp-voice-lifecycle.mjs';
import { installSource, upstream } from '../integrations/openclaw/delivery-boundary/install.mjs';
const require = createRequire(new URL('../plugins/amadeus/package.json', import.meta.url));
const host = dirname(dirname(dirname(require.resolve('openclaw/plugin-sdk/core'))));
const original = process.env.AMADEUS_WHATSAPP_UPSTREAM_MODULE ? await readFile(process.env.AMADEUS_WHATSAPP_UPSTREAM_MODULE,'utf8') : await upstream(process.env.AMADEUS_WHATSAPP_ARCHIVE);
const template = await readFile(new URL('../integrations/openclaw/delivery-boundary/whatsapp-plan.js', import.meta.url),'utf8');
const acorn=createRequire(host+'/package.json')('acorn');
function acornParse(source){return acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'});}
const transformed=installSource(original,template,host);
const withLifecycle = patchWhatsAppIngressQueueSource(patchWhatsAppSource(transformed));
assert.equal(acornParse(withLifecycle).type, 'Program');

assert.throws(()=>installSource(original+'\n',template,host),/digest_mismatch/u);
const node=acorn.parse(transformed,{ecmaVersion:'latest',sourceType:'module'}).body.find(node=>node.type==='FunctionDeclaration'&&node.id?.name==='createWhatsAppReplyPlan');
const body=transformed.slice(node.start,node.end);
assert.equal(body.includes('mediaOnlyCoalescer'),false);
assert.equal(body.includes('mediaUrls'),false);
assert.equal(body.includes('JSON.parse'),false);
const provider=[];let port;
const scope={globalThis:{__amadeusDeliveryBoundaryV2_20260930:{version:2,createWhatsAppPlan(input){port=input;return {replyOptions:{},dispatcherOptions:{}};}}},
 buildQuotedMessageOptions:params=>params,listWhatsAppSendResultMessageIds:result=>[result.messageId],markdownToWhatsAppChunks:text=>[text],resolveTextChunkLimit:()=>4000,resolveMarkdownTableMode$1:()=> 'code',resolveChunkMode:()=> 'length',
 startAmadeusVoiceReplyLease:()=>({}),startAmadeusWhatsAppTypingIndicator:()=>()=>{},closeAmadeusVoiceReplyLeaseForTurn:()=>{},
 prepareWhatsAppOutboundMedia:async media=>({buffer:media.buffer,mimetype:'audio/ogg; codecs=opus'})};
vm.runInNewContext(body+'\nglobalThis.createPlan=createWhatsAppReplyPlan;',scope);
const params={route:{sessionKey:'s',accountId:'secondary'},cfg:{},inbound:{event:{id:'m'},conversation:{id:'chat'},media:[]},transport:{chatJid:'chat',reply:async text=>{provider.push({text});return{providerAccepted:true,messageId:'t'};},sendMedia:async payload=>{provider.push(payload);return{providerAccepted:true,messageId:'a'};}}};
scope.globalThis.createPlan(params);
for(const mimeType of ['image/png','image/jpeg']){
 const bytes=Buffer.from('original lossless file '+mimeType);await port.sendDocument({bytes,mimeType,fileName:'upscale.png'});const actual=provider.at(-1);
 assert.equal(actual.document,bytes);assert.equal('image' in actual,false);assert.equal(actual.mimetype,mimeType);
}
await port.sendImage({bytes:Buffer.from('image'),mimeType:'image/png'});assert.ok(provider.at(-1).image);
await port.sendText('typed text');assert.deepEqual(provider.at(-1),{text:'typed text'});
await port.sendVoice({audio:Buffer.from('audio'),mimeType:'audio/mpeg'});assert.equal(provider.at(-1).ptt,true);
params.transport.sendMedia=async()=>{throw new Error('document rejected');};await assert.rejects(port.sendDocument({bytes:Buffer.from('document'),mimeType:'image/png',fileName:'file.png'}));
scope.globalThis.__amadeusDeliveryBoundaryV2_20260930=undefined;assert.throws(()=>scope.globalThis.createPlan(params),/unavailable/u);
console.log('DELIVERY_BOUNDARY_PINNED_AST_AND_PROVIDER_CONTRACT=passed');
