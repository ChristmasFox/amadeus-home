#!/usr/bin/env node
import assert from 'node:assert/strict';import vm from 'node:vm';
import { patchWhatsAppSource,patchWhatsAppIngressQueueSource,whatsappHelpers,whatsappIngressQueueHelpers,WHATSAPP_MARKER,WHATSAPP_INGRESS_QUEUE_MARKER } from './patch-openclaw-whatsapp-voice-lifecycle.mjs';
const fixture=`function createWhatsAppReplyPlan(params) { return {}; }
		const sendComposing = async () => {
\t\t\tconst currentSock = getCurrentSock();
\t\t\tif (!currentSock) return;
\t\t\ttry {
\t\t\t\tawait assertCanSendToJid(chatJid, currentSock);
\t\t\t\tawait socketOperations.sendPresenceUpdate("composing", chatJid);
\t\t\t} catch (err) {
\t\t\t\tlogWhatsAppVerbose$1(options.verbose, \`Presence update failed: \${String(err)}\`);
\t\t\t}
\t\t};
function createWebOnMessageHandler(params) {
\t\treturn processMessage(processParams);
}
\t\t\tif (update.connection === "close") {}
\t});
\tconst didSendReply = turnResult.dispatched ? finalizeReply?.(turnResult.dispatchResult) ?? false : false;`;
const patched=patchWhatsAppIngressQueueSource(patchWhatsAppSource(fixture));assert.ok(patched.includes(WHATSAPP_MARKER));assert.ok(patched.includes(WHATSAPP_INGRESS_QUEUE_MARKER));assert.equal(patchWhatsAppIngressQueueSource(patched),patched);
assert.equal(patched.includes('JSON.parse'),false);assert.equal(patched.includes('speechText'),false);
const scope={globalThis:{},Map,Promise,setInterval,clearInterval,setTimeout,clearTimeout};
vm.runInNewContext(whatsappHelpers+'\n'+whatsappIngressQueueHelpers+'\nglobalThis.run=runAmadeusWhatsAppVoiceScopedIngress;',scope);
const calls=[];let active=0;
await Promise.all([1,2,3].map(id=>scope.globalThis.run({sessionKey:'s',messageId:String(id),isVoice:false,run:async()=>{assert.equal(++active,1);calls.push(id);await new Promise(resolve=>setTimeout(resolve,2));active--;}})));
assert.deepEqual(calls,[1,2,3]);console.log('WHATSAPP_TRANSPORT_LIFECYCLE_ONLY=passed');
