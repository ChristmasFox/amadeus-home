#!/usr/bin/env node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { patchCoreSource, patchDispatchTtsContextSource, patchMessageActionSource, patchWhatsAppSource, patchWhatsAppIngressQueueSource, patchWhatsAppTypingIndicatorSource, REPLY_ENVELOPE_MESSAGE_ACTION_MARKER, REPLY_ENVELOPE_WHATSAPP_BOUNDARY_MARKER, CORE_MARKER, WHATSAPP_MARKER, WHATSAPP_INGRESS_QUEUE_MARKER, WHATSAPP_TYPING_INDICATOR_MARKER } from './patch-openclaw-whatsapp-voice-lifecycle.mjs';
import { resolveVoiceFollowup, whatsappHelpers, whatsappIngressQueueHelpers } from './openclaw-voice-lease.mjs';

assert.equal(resolveVoiceFollowup(undefined, 'typed'), false);
assert.equal(resolveVoiceFollowup({ messageId: 'voice' }, 'typed'), true);
const core = `const effectiveShouldSteer = !isHeartbeat && !effectiveResetTriggered && shouldSteer;\n\tconst effectiveShouldFollowup = !effectiveResetTriggered && shouldFollowup;\nconst questionInput = await runReplyQuestionInput(params);\nif (messageInjectionDisposition === "accepted") {\nconst activeRunQueueAction = resolveActiveRunQueueAction({\n});\nelse scheduleFollowupDrain(queueKey, queuedRunFollowupTurn);\n//#region src/auto-reply/reply/agent-runner-run.ts`;
const patchedCore = patchCoreSource(core);
assert.match(patchedCore, new RegExp(CORE_MARKER));
assert.doesNotMatch(patchedCore, /\[\[|legacy/iu);
assert.equal(patchCoreSource(patchedCore), patchedCore);
const whatsapp = `async function enqueueInboundMessage(chatJid) {\n\t\tconst sendComposing = async () => {\n\t\t\tconst currentSock = getCurrentSock();\n\t\t\tif (!currentSock) return;\n\t\t\ttry {\n\t\t\t\tawait assertCanSendToJid(chatJid, currentSock);\n\t\t\t\tawait socketOperations.sendPresenceUpdate("composing", chatJid);\n\t\t\t} catch (err) {\n\t\t\t\tlogWhatsAppVerbose$1(options.verbose, \`Presence update failed: \${String(err)}\`);\n\t\t\t}\n\t\t};\n}\nfunction createWhatsAppReplyPlan(params) {\n\tconst mediaOnlyCoalescer = createWhatsAppMediaOnlyReplyCoalescer({ deliver: async (pending) => {\n\t\treturn await deliverNormalizedPayload(pending.payload, pending.info);\n\t} });\n\treturn {\n\t\tdispatcherOptions: {\n\t\t\tonSettled: async () => {\n\t\t\t\tconst flushResult = await mediaOnlyCoalescer.flushAll();\n\t\t\t\tlogWhatsAppMediaOnlyFlushResult(flushResult);\n\t\t\t\treturn whatsAppReplyDeliveryVisibility(didSendReply || flushResult.delivered > 0);\n\t\t\t},\n\t\t\tonReplyStart: params.transport.sendComposing\n\t\t}\n\t};\n}\nfunction createWebOnMessageHandler(params) {\n\t\treturn processMessage(processParams);\n}\n\t\t\tif (update.connection === "close") {\n\t\t\t}\n\t});\n\tconst didSendReply = turnResult.dispatched ? finalizeReply?.(turnResult.dispatchResult) ?? false : false;`;
const patchedWhatsApp = patchWhatsAppSource(whatsapp);
const queued = patchWhatsAppIngressQueueSource(patchedWhatsApp);
const typing = patchWhatsAppTypingIndicatorSource(queued);
assert.match(typing, new RegExp(WHATSAPP_MARKER));
assert.match(typing, new RegExp(WHATSAPP_INGRESS_QUEUE_MARKER));
assert.match(typing, new RegExp(WHATSAPP_TYPING_INDICATOR_MARKER));
assert.match(typing, new RegExp(REPLY_ENVELOPE_WHATSAPP_BOUNDARY_MARKER));
assert.doesNotMatch(typing, /\[\[|scrub|recovery|legacy/iu);
assert.equal(patchWhatsAppTypingIndicatorSource(typing), typing);
const staleBoundary = `${typing.replace('function createWhatsAppReplyPlan(params) {', '// amadeus-whatsapp-japanese-visible-tts-v1\nfunction parseAmadeusReplyModalityMarker() {}\nfunction ensureAmadeusJapaneseVoiceText() {}\nfunction createWhatsAppReplyPlan(params) {')}`;
const repairedBoundary = patchWhatsAppSource(staleBoundary);
assert.match(repairedBoundary, new RegExp(REPLY_ENVELOPE_WHATSAPP_BOUNDARY_MARKER));
assert.doesNotMatch(repairedBoundary, /parseAmadeusReplyModalityMarker|ensureAmadeusJapaneseVoiceText|amadeus-whatsapp-japanese-visible-tts-v1/u);
assert.equal(patchWhatsAppSource(repairedBoundary), repairedBoundary);
const dispatch = `const maybeApplyTtsWithFinalizationLease = createFinalizationAwareTtsPayloadApplier({
\t\thasInboundAudio: () => inboundAudio || getDispatchReplyOperation()?.acceptedSteeredInboundAudio === true
\t});`;
const patchedDispatch = patchDispatchTtsContextSource(dispatch);
assert.match(patchedDispatch, /getChannel: \(\) => replyRoute\.channel \?\? ctx\.Surface \?\? ctx\.Provider/u);
assert.doesNotMatch(patchedDispatch, /deliveryChannel/u);
assert.equal(patchDispatchTtsContextSource(patchedDispatch), patchedDispatch);
const messageAction = `async function maybeApplyTtsToMessageActionSendPayload(params) {
\tif (params.dryRun) return params.payload;
\tconst ttsAuto = resolveMessageActionSessionTtsAuto({
\t\tcfg: params.cfg,
\t\tsessionKey: params.sessionKey,
\t\tagentId: params.agentId
\t});
\tif (!(getReplyPayloadMetadata(params.payload)?.ttsExplicit === true) && !shouldAttemptTtsPayload({
\t\tcfg: params.cfg,
\t\tttsAuto,
\t\tagentId: params.agentId,
\t\tchannelId: params.channel,
\t\taccountId: params.accountId ?? void 0
\t})) return params.payload;
\tconst { maybeApplyTtsToPayload } = await loadMessageActionTtsRuntime();
\treturn await maybeApplyTtsToPayload({
\t\tpayload: params.payload,
\t\tcfg: params.cfg,
\t\tchannel: params.channel,
\t\tkind: "final",
\t\tinboundAudio: params.inboundAudio,
\t\tttsAuto,
\t\tagentId: params.agentId,
\t\taccountId: params.accountId ?? void 0
\t});
}`;
const patchedMessageAction = patchMessageActionSource(messageAction);
assert.match(patchedMessageAction, new RegExp(REPLY_ENVELOPE_MESSAGE_ACTION_MARKER));
assert.match(patchedMessageAction, /normalizeAmadeusMessageActionPayload\(params\)/u);
assert.match(patchedMessageAction, /payload: normalizedPayload/u);
assert.match(patchedMessageAction, /sessionKey: params\.sessionKey/u);
assert.match(patchedMessageAction, /runId: params\.runId/u);
assert.match(patchedMessageAction, /amadeusEnvelope\?\.modality !== "voice"/u);
assert.equal(patchMessageActionSource(patchedMessageAction), patchedMessageAction);

const queueContext = {
  globalThis: {},
  Map,
  Promise,
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout,
};
vm.runInNewContext(`${whatsappHelpers}\n${whatsappIngressQueueHelpers}\nglobalThis.runIngress = runAmadeusWhatsAppVoiceScopedIngress;`, queueContext);
const ingressEvents = [];
let activeIngressRuns = 0;
await Promise.all([
  ['first', 25],
  ['second', 5],
  ['third', 0],
].map(([messageId, delay]) => queueContext.globalThis.runIngress({
  sessionKey: 'agent:main:whatsapp:group:fixture',
  messageId,
  isVoice: false,
  run: async () => {
    activeIngressRuns += 1;
    assert.equal(activeIngressRuns, 1);
    ingressEvents.push(`${messageId}:start`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    ingressEvents.push(`${messageId}:end`);
    activeIngressRuns -= 1;
  },
})));
assert.deepEqual(ingressEvents, ['first:start', 'first:end', 'second:start', 'second:end', 'third:start', 'third:end']);
console.log('OPENCLAW_REPLY_ENVELOPE_LIFECYCLE=passed');
