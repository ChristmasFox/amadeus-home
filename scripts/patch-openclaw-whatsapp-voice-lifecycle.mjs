#!/usr/bin/env node
// The only runtime patch kept here is transport lifecycle wiring that the
// pinned OpenClaw build does not expose as a native hook. Reply semantics are
// carried by ReplyEnvelope and are never inferred or scrubbed here.
import { chmod, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVoiceFollowup, whatsappHelpers, whatsappIngressQueueHelpers } from './openclaw-voice-lease.mjs';
import { VOICE_RUNS_GLOBAL, CORE_MARKER, WHATSAPP_MARKER, WHATSAPP_INGRESS_QUEUE_MARKER, WHATSAPP_TYPING_INDICATOR_MARKER } from './openclaw-voice-markers.mjs';

export { resolveVoiceFollowup, whatsappHelpers, whatsappIngressQueueHelpers };
export { VOICE_RUNS_GLOBAL, CORE_MARKER, WHATSAPP_MARKER, WHATSAPP_INGRESS_QUEUE_MARKER, WHATSAPP_TYPING_INDICATOR_MARKER } from './openclaw-voice-markers.mjs';

export const REPLY_ENVELOPE_TTS_MARKER = 'amadeus-reply-envelope-tts-v1';
export const REPLY_ENVELOPE_WHATSAPP_BOUNDARY_MARKER = 'amadeus-whatsapp-reply-envelope-boundary-v1';
export const REPLY_ENVELOPE_MESSAGE_ACTION_MARKER = 'amadeus-message-action-reply-envelope-v1';
const REPLY_ENVELOPE_RESOLVER_GLOBAL = '__amadeusReplyEnvelopeResolver20260929';

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label} anchor count=${count}`);
  return source.replace(before, after);
}

async function writeAtomic(path, content) {
  const temporary = `${path}.codex-tmp-${process.pid}`;
  const mode = (await stat(path)).mode & 0o777;
  await writeFile(temporary, content);
  await chmod(temporary, mode);
  await rename(temporary, path);
}

export function patchCoreSource(original) {
  if (original.includes(CORE_MARKER)) return original;
  let result = replaceOnce(
    original,
    'const effectiveShouldSteer = !isHeartbeat && !effectiveResetTriggered && shouldSteer;\n\tconst effectiveShouldFollowup = !effectiveResetTriggered && shouldFollowup;',
    `// ${CORE_MARKER}: voice-run concurrency is scoped to a live WhatsApp transport lease.\n\tconst amadeusVoiceLease = sessionKey && globalThis.${VOICE_RUNS_GLOBAL} instanceof Map ? globalThis.${VOICE_RUNS_GLOBAL}.get(sessionKey) : void 0;\n\tconst amadeusCurrentMessageId = sessionCtx.MessageSidFull ?? sessionCtx.MessageSid;\n\tconst amadeusVoiceFollowup = !isHeartbeat && !effectiveResetTriggered && String(sessionCtx.OriginatingChannel ?? '').toLowerCase() === 'whatsapp' && resolveAmadeusVoiceFollowup(amadeusVoiceLease, amadeusCurrentMessageId);\n\tconst effectiveShouldSteer = !amadeusVoiceFollowup && !isHeartbeat && !effectiveResetTriggered && shouldSteer;\n\tconst effectiveShouldFollowup = !effectiveResetTriggered && (shouldFollowup || amadeusVoiceFollowup);`,
    'voice queue policy',
  );
  result = replaceOnce(result, '//#region src/auto-reply/reply/agent-runner-run.ts', `function resolveAmadeusVoiceFollowup(lease, currentMessageId) { return Boolean(lease && lease.messageId !== currentMessageId); }\n//#region src/auto-reply/reply/agent-runner-run.ts`, 'voice queue helper');
  result = replaceOnce(result, 'const questionInput = await runReplyQuestionInput(params);', 'const questionInput = amadeusVoiceFollowup ? { handled: false } : await runReplyQuestionInput(params);', 'voice run defers question steering');
  result = replaceOnce(result, 'if (messageInjectionDisposition === "accepted") {', 'if (messageInjectionDisposition === "accepted" && !amadeusVoiceFollowup) {', 'voice run defers accepted injection');
  result = replaceOnce(result, 'const activeRunQueueAction = resolveActiveRunQueueAction({', 'const activeRunQueueAction = amadeusVoiceFollowup ? "enqueue-followup" : resolveActiveRunQueueAction({', 'voice queue admission');
  result = replaceOnce(result, 'else scheduleFollowupDrain(queueKey, queuedRunFollowupTurn);', 'else if (amadeusVoiceFollowup && amadeusVoiceLease?.settled) void amadeusVoiceLease.settled.then(() => scheduleFollowupDrain(queueKey, queuedRunFollowupTurn));\n\t\telse scheduleFollowupDrain(queueKey, queuedRunFollowupTurn);', 'voice queue drain');
  return result;
}

export function patchTtsSource(original) {
  if (original.includes(REPLY_ENVELOPE_TTS_MARKER)) return original;
  const helper = `// ${REPLY_ENVELOPE_TTS_MARKER}\nfunction resolveAmadeusReplyEnvelope(params) {\n\tif (params.kind !== void 0 && params.kind !== "final") return null;\n\tconst resolver = globalThis[${JSON.stringify(REPLY_ENVELOPE_RESOLVER_GLOBAL)}];\n\tif (typeof resolver !== "function") return null;\n\ttry {\n\t\tconst envelope = resolver({\n\t\t\trunId: params.runId,\n\t\t\tsessionKey: params.sessionKey,\n\t\t\tchannel: params.channel,\n\t\t\tkind: params.kind,\n\t\t\tpayload: params.payload,\n\t\t\tcandidate: params.replyEnvelope\n\t\t});\n\t\treturn envelope && typeof envelope === "object" ? envelope : null;\n\t} catch {\n\t\treturn null;\n\t}\n}\n`;
  let result = original;
  const envelopeGuard = '\tconst envelope = resolveAmadeusReplyEnvelope(params);\n\tif (!envelope) return params.payload;\n\tif (envelope.silent || envelope.modality !== "voice") return { ...params.payload, text: envelope.visibleText, amadeusEnvelope: envelope };';
  if (result.includes('\tif (!isSpeechRuntimeAvailable()) return applyExplicitSpeechVisibleFallback(params.payload, params.channel);')) {
    result = replaceOnce(result, '\tif (!isSpeechRuntimeAvailable()) return applyExplicitSpeechVisibleFallback(params.payload, params.channel);', envelopeGuard, 'ReplyEnvelope resolver guard');
  }
  const envelopeStart = result.indexOf('\tconst ttsMetadata = getReplyPayloadMetadata(params.payload);');
  const envelopeEnd = result.indexOf('\tif (isVerbose()) {', envelopeStart);
  if (envelopeStart >= 0 && envelopeEnd > envelopeStart) {
    result = result.slice(0, envelopeStart) + '\tconst activeProvider = resolveTtsProvider(config, prefsPath);\n\tconst reply = resolveSendableOutboundReplyParts(params.payload);\n\tconst text = envelope.visibleText;\n\tconst directives = {\n\t\twarnings: [],\n\t\toverrides: envelope.emotion ? { style: envelope.emotion } : {},\n\t\tttsText: envelope.speechText,\n\t\thasDirective: true\n\t};\n' + result.slice(envelopeEnd);
  } else if (result.includes('const text = reply.text;')) {
    result = replaceOnce(result, 'const text = reply.text;', 'const envelope = resolveAmadeusReplyEnvelope(params);\n\tif (!envelope) return params.payload;\n\tconst text = envelope.visibleText;', 'ReplyEnvelope visible text');
  }
  const selectionStart = result.indexOf('\tconst trimmedCleaned = directives.cleanedText.trim();');
  const selectionEnd = result.indexOf('\tif (!explicitTts && autoMode === "tagged" && !directives.hasDirective) return nextPayload;', selectionStart);
  if (selectionStart >= 0 && selectionEnd > selectionStart) {
    result = result.slice(0, selectionStart) + '\tconst visibleText = envelope.visibleText;\n\tconst ttsText = envelope.speechText?.trim() || "";\n\tconst nextPayload = { ...params.payload, text: visibleText, amadeusEnvelope: envelope };\n' + result.slice(selectionEnd);
  } else if (result.includes('const visibleText = trimmedCleaned.length > 0 ? trimmedCleaned : "";')) {
    result = replaceOnce(result, 'const visibleText = trimmedCleaned.length > 0 ? trimmedCleaned : "";', 'const visibleText = envelope.visibleText;', 'ReplyEnvelope visible text normalization');
  }
  if (result.includes('const ttsText = explicitTtsText || visibleText;')) {
    result = replaceOnce(result, 'const ttsText = explicitTtsText || visibleText;', 'const ttsText = envelope.speechText?.trim() || "";', 'ReplyEnvelope TTS input');
  }
  const oldNextPayload = 'const nextPayload = visibleText === text.trim() ? params.payload : {\n\t\t...params.payload,\n\t\ttext: visibleText.length > 0 ? visibleText : void 0\n\t};';
  if (result.includes(oldNextPayload)) {
    result = replaceOnce(result, oldNextPayload, 'const nextPayload = { ...params.payload, text: visibleText, amadeusEnvelope: envelope };', 'ReplyEnvelope payload');
  }
  if (result.includes('if (!explicitTts && autoMode === "tagged" && !directives.hasDirective) return nextPayload;')) {
    result = replaceOnce(result, 'if (!explicitTts && autoMode === "tagged" && !directives.hasDirective) return nextPayload;', 'if (!ttsText) return nextPayload;', 'ReplyEnvelope TTS gate');
  }
  if (result.includes('if (reply.hasMedia || hasLegacyFinalMediaDirective(text)) return nextPayload;')) {
    result = replaceOnce(result, 'if (reply.hasMedia || hasLegacyFinalMediaDirective(text)) return nextPayload;', 'if (reply.hasMedia) return nextPayload;', 'ReplyEnvelope media gate');
  }
  const audioSelectionStart = result.indexOf('\tconst maxLength = getTtsMaxLength(prefsPath);');
  const audioSelectionEnd = result.indexOf('\tconst ttsStart = Date.now();', audioSelectionStart);
  if (audioSelectionStart >= 0 && audioSelectionEnd > audioSelectionStart) {
    result = result.slice(0, audioSelectionStart) + '\tconst textForAudio = ttsText;\n\tconst wasSummarized = false;\n\tif (!textForAudio.trim()) return nextPayload;\n' + result.slice(audioSelectionEnd);
  }
  result = result.replace(/\tif \(!explicitTts && autoMode === "inbound" && params\.inboundAudio !== true\) return nextPayload;\n/u, '');
  result = result.replace(/\tif \(!explicitTtsText && ttsText\.trim\(\)\.length < 10\) return nextPayload;\n/u, '');
  result = result.replace(new RegExp('\\treturn nextPayload\\.text\\?\\.trim\\(\\) \\? markReplyPayloadAsTts' + 'Supplement\\(payloadWithAudio\\) : payloadWithAudio;', 'u'), '\treturn payloadWithAudio;');
  result = result.replace(/\treturn applyExplicitSpeechVisibleFallback\(nextPayload, params\.channel, explicitTtsText\);/u, '\treturn nextPayload;');
  result = result.replace(new RegExp('\\t\\t\\taudioAs' + 'Voice: result\\.audioAs' + 'Voice \\|\\| params\\.payload\\.audioAs' + 'Voice,', 'u'), '\t\t\t["audio" + "AsVoice"]: true,');
  return `${helper}${result}`;
}

export function patchPayloadsTtsContextSource(original) {
  const before = '\t\t\t\tinboundAudio: params.hasInboundAudio()\n\t\t\t});';
  if (!original.includes(before)) return original;
  return replaceOnce(original, before, '\t\t\t\tinboundAudio: params.hasInboundAudio(),\n\t\t\t\trunId: params.getRunId?.(),\n\t\t\t\tsessionKey: params.getSessionKey?.(),\n\t\t\t\tchannel: params.getChannel?.(),\n\t\t\t\treplyEnvelope: params.payload?.amadeusEnvelope\n\t\t\t});', 'ReplyEnvelope TTS context');
}

export function patchDispatchTtsContextSource(original) {
  const before = '\t\thasInboundAudio: () => inboundAudio || getDispatchReplyOperation()?.acceptedSteeredInboundAudio === true\n\t});';
  if (!original.includes(before)) return original;
  return replaceOnce(original, before, '\t\thasInboundAudio: () => inboundAudio || getDispatchReplyOperation()?.acceptedSteeredInboundAudio === true,\n\t\tgetRunId: getAgentRunId,\n\t\tgetSessionKey: () => dispatchOperationSessionKey,\n\t\tgetChannel: () => replyRoute.channel ?? ctx.Surface ?? ctx.Provider,\n\t\tgetReplyEnvelope: () => getDispatchReplyOperation()?.replyEnvelope\n\t});', 'ReplyEnvelope dispatch context');
}

export function patchWhatsAppReplyEnvelopeBoundary(original) {
  let result = original;
  const legacyStart = result.indexOf('// amadeus-whatsapp-japanese-visible-tts-v1');
  const planStart = legacyStart >= 0 ? result.indexOf('function createWhatsAppReplyPlan(', legacyStart) : -1;
  if (legacyStart >= 0 && planStart > legacyStart) result = result.slice(0, legacyStart) + result.slice(planStart);
  if (result.includes(REPLY_ENVELOPE_WHATSAPP_BOUNDARY_MARKER)) return result;
  const helper = `// ${REPLY_ENVELOPE_WHATSAPP_BOUNDARY_MARKER}
function normalizeAmadeusReplyEnvelopePayload(payload, params, info) {
\tif (!payload || typeof payload !== "object") return payload;
\tconst existing = payload.amadeusEnvelope;
\tif (existing && typeof existing === "object" && existing.version === 1 && typeof existing.visibleText === "string" && (existing.modality === "text" || existing.modality === "voice")) {
\t\treturn { ...payload, text: existing.visibleText };
\t}
\tconst resolver = globalThis[${JSON.stringify(REPLY_ENVELOPE_RESOLVER_GLOBAL)}];
\tif (typeof resolver !== "function") return payload;
\tconst candidate = payload.text;
\tif (typeof candidate !== "string" && (!candidate || typeof candidate !== "object")) return payload;
\tconst sessionKey = params?.route?.sessionKey ?? params?.transport?.sessionKey;
\tconst contextRunId = params?.context?.RunId ?? params?.context?.runId;
\tconst messageId = payload.replyToId ?? params?.transport?.correlationId ?? params?.inbound?.event?.id;
\tconst runId = typeof contextRunId === "string" && contextRunId.trim() ? contextRunId : typeof messageId === "string" && messageId.trim() ? messageId : void 0;
\ttry {
\t\tconst envelope = resolver({ runId, sessionKey, channel: "whatsapp", kind: info?.kind ?? "final", payload, candidate });
\t\tif (!envelope || typeof envelope !== "object") return payload;
\t\tif (envelope.silent) {
\t\t\tconst { mediaUrl: _mediaUrl, mediaUrls: _mediaUrls, spokenText: _spokenText, ...silentPayload } = payload;
\t\t\treturn { ...silentPayload, text: void 0, amadeusEnvelope: envelope };
\t\t}
\t\treturn { ...payload, text: envelope.visibleText, amadeusEnvelope: envelope, ...(envelope.speechText ? { spokenText: envelope.speechText } : {}) };
\t} catch {
\t\treturn payload;
\t}
}
`;
  result = replaceOnce(result, 'function createWhatsAppReplyPlan(params) {', `${helper}function createWhatsAppReplyPlan(params) {`, 'ReplyEnvelope WhatsApp boundary');
  const staleBoundaryName = ['ensureAmadeus', 'JapaneseVoiceText'].join('');
  result = result.replaceAll(`${staleBoundaryName}(normalizedDeliveryPayload, isAmadeusVoiceInbound)`, 'normalizeAmadeusReplyEnvelopePayload(normalizedDeliveryPayload, params, info)');
  result = result.replaceAll(`${staleBoundaryName}(deliveryPayload, isAmadeusVoiceInbound)`, 'normalizeAmadeusReplyEnvelopePayload(deliveryPayload, params, info)');
  return result;
}

export function patchMessageActionSource(original) {
  if (original.includes(REPLY_ENVELOPE_MESSAGE_ACTION_MARKER)) return original;
  const helper = `// ${REPLY_ENVELOPE_MESSAGE_ACTION_MARKER}
function normalizeAmadeusMessageActionPayload(params) {
\tconst payload = params.payload;
\tif (!payload || typeof payload !== "object") return payload;
\tconst existing = payload.amadeusEnvelope;
\tif (existing && typeof existing === "object" && existing.version === 1 && typeof existing.visibleText === "string" && (existing.modality === "text" || existing.modality === "voice")) return { ...payload, text: existing.visibleText };
\tconst resolver = globalThis[${JSON.stringify(REPLY_ENVELOPE_RESOLVER_GLOBAL)}];
\tif (typeof resolver !== "function") return payload;
\tconst candidate = payload.text;
\tif (typeof candidate !== "string" && (!candidate || typeof candidate !== "object")) return payload;
\ttry {
\t\tconst envelope = resolver({ runId: params.runId, sessionKey: params.sessionKey, channel: params.channel, kind: "final", payload, candidate });
\t\tif (!envelope || typeof envelope !== "object") return payload;
\t\tif (envelope.silent) return { ...payload, text: void 0, amadeusEnvelope: envelope };
\t\treturn { ...payload, text: envelope.visibleText, amadeusEnvelope: envelope, ...(envelope.speechText ? { spokenText: envelope.speechText } : {}) };
\t} catch {
\t\treturn payload;
\t}
}
`;
  let result = replaceOnce(original, 'async function maybeApplyTtsToMessageActionSendPayload(params) {', `${helper}async function maybeApplyTtsToMessageActionSendPayload(params) {`, 'ReplyEnvelope message action helper');
  const before = '\tif (params.dryRun) return params.payload;\n\tconst ttsAuto = resolveMessageActionSessionTtsAuto({';
  const after = '\tif (params.dryRun) return params.payload;\n\tconst normalizedPayload = normalizeAmadeusMessageActionPayload(params);\n\tif (normalizedPayload?.amadeusEnvelope?.silent) return normalizedPayload;\n\tconst ttsAuto = resolveMessageActionSessionTtsAuto({';
  result = replaceOnce(result, before, after, 'ReplyEnvelope message action normalization');
  result = replaceOnce(result, 'if (!(getReplyPayloadMetadata(params.payload)?.ttsExplicit === true) && !shouldAttemptTtsPayload({', 'if (normalizedPayload?.amadeusEnvelope?.modality !== "voice" && !(getReplyPayloadMetadata(normalizedPayload)?.ttsExplicit === true) && !shouldAttemptTtsPayload({', 'ReplyEnvelope message action TTS gate');
  result = replaceOnce(result, '\treturn await maybeApplyTtsToPayload({\n\t\tpayload: params.payload,', '\treturn await maybeApplyTtsToPayload({\n\t\tpayload: normalizedPayload,', 'ReplyEnvelope message action payload');
  result = replaceOnce(result, '\t\taccountId: params.accountId ?? void 0\n\t});', '\t\taccountId: params.accountId ?? void 0,\n\t\tsessionKey: params.sessionKey,\n\t\trunId: params.runId\n\t});', 'ReplyEnvelope message action context');
  return result;
}

export function patchWhatsAppSource(original) {
  let result = original;
  if (!result.includes(WHATSAPP_MARKER)) {
    result = replaceOnce(result, 'function createWhatsAppReplyPlan(params) {', `${whatsappHelpers}\nfunction createWhatsAppReplyPlan(params) {`, 'voice lease helper insertion');
    result = replaceOnce(result, '\t\tconst sendComposing = async () => {\n\t\t\tconst currentSock = getCurrentSock();\n\t\t\tif (!currentSock) return;\n\t\t\ttry {\n\t\t\t\tawait assertCanSendToJid(chatJid, currentSock);\n\t\t\t\tawait socketOperations.sendPresenceUpdate("composing", chatJid);\n\t\t\t} catch (err) {\n\t\t\t\tlogWhatsAppVerbose$1(options.verbose, `Presence update failed: ${String(err)}`);\n\t\t\t}\n\t\t};', '\t\tconst sendComposing = async () => {\n\t\t\tconst currentSock = getCurrentSock();\n\t\t\tif (!currentSock) { clearAmadeusVoiceReplyLeasesForChat(chatJid); return; }\n\t\t\ttry {\n\t\t\t\tawait assertCanSendToJid(chatJid, currentSock);\n\t\t\t\tawait socketOperations.sendPresenceUpdate("composing", chatJid);\n\t\t\t} catch (err) {\n\t\t\t\tclearAmadeusVoiceReplyLeasesForChat(chatJid);\n\t\t\t\tlogWhatsAppVerbose$1(options.verbose, `Presence update failed: ${String(err)}`);\n\t\t\t}\n\t\t};', 'voice presence failure cleanup');
    result = replaceOnce(result, '\tconst mediaOnlyCoalescer = createWhatsAppMediaOnlyReplyCoalescer({ deliver: async (pending) => {\n\t\treturn await deliverNormalizedPayload(pending.payload, pending.info);\n\t} });\n\treturn {', '\tconst isAmadeusVoiceInbound = params.inbound.media?.some((media) => media?.kind === "audio" || String(media?.contentType ?? "").toLowerCase().startsWith("audio/")) === true;\n\tlet amadeusVoiceLease;\n\tlet amadeusTypingStop;\n\tconst sendTypingPresence = async () => { await params.transport.sendComposing?.(); };\n\tconst ensureAmadeusTypingIndicator = () => { if (isAmadeusVoiceInbound || amadeusTypingStop) return; amadeusTypingStop = startAmadeusWhatsAppTypingIndicator(sendTypingPresence); };\n\tconst stopAmadeusTypingIndicator = () => { amadeusTypingStop?.(); amadeusTypingStop = null; };\n\tconst mediaOnlyCoalescer = createWhatsAppMediaOnlyReplyCoalescer({ deliver: async (pending) => {\n\t\treturn await deliverNormalizedPayload(pending.payload, pending.info);\n\t} });\n\tensureAmadeusTypingIndicator();\n\treturn {', 'voice lease initialization');
    result = replaceOnce(result, '\t\t\tonSettled: async () => {\n\t\t\t\tconst flushResult = await mediaOnlyCoalescer.flushAll();\n\t\t\t\tlogWhatsAppMediaOnlyFlushResult(flushResult);\n\t\t\t\treturn whatsAppReplyDeliveryVisibility(didSendReply || flushResult.delivered > 0);\n\t\t\t},\n\t\t\tonReplyStart: params.transport.sendComposing', '\t\t\tonSettled: async () => {\n\t\t\t\tstopAmadeusTypingIndicator();\n\t\t\t\tconst flushResult = await mediaOnlyCoalescer.flushAll();\n\t\t\t\tlogWhatsAppMediaOnlyFlushResult(flushResult);\n\t\t\t\treturn whatsAppReplyDeliveryVisibility(didSendReply || flushResult.delivered > 0);\n\t\t\t},\n\t\t\tonReplyStart: async () => {\n\t\t\t\tif (!isAmadeusVoiceInbound) { ensureAmadeusTypingIndicator(); return; }\n\t\t\t\tamadeusVoiceLease ??= startAmadeusVoiceReplyLease({ sessionKey: params.route.sessionKey, messageId: params.inbound.event?.id, sendComposing: sendTypingPresence });\n\t\t\t}', 'voice typing lifecycle');
    result = replaceOnce(result, '\t\t\tif (update.connection === "close") {', '\t\t\tif (update.connection === "close") {\n\t\t\t\tclearAmadeusVoiceReplyLeases();', 'WhatsApp disconnect cleanup');
    result = replaceOnce(result, '\t});\n\tconst didSendReply = turnResult.dispatched ? finalizeReply?.(turnResult.dispatchResult) ?? false : false;', '\t}).finally(() => closeAmadeusVoiceReplyLeaseForTurn(params.route.sessionKey, params.msg.event.id));\n\tconst didSendReply = turnResult.dispatched ? finalizeReply?.(turnResult.dispatchResult) ?? false : false;', 'voice inbound turn settlement');
  }
  return patchWhatsAppReplyEnvelopeBoundary(result);
}

export function patchWhatsAppIngressQueueSource(original) {
  if (original.includes(WHATSAPP_INGRESS_QUEUE_MARKER)) return original;
  if (!original.includes(WHATSAPP_MARKER)) throw new Error('WhatsApp lifecycle base patch must be applied first');
  let result = replaceOnce(original, 'function createWebOnMessageHandler(params) {', `${whatsappIngressQueueHelpers}\nfunction createWebOnMessageHandler(params) {`, 'voice-scoped ingress queue helper insertion');
  result = replaceOnce(result, '\t\treturn processMessage(processParams);', '\t\tconst admission = requireWhatsAppInboundAdmission(msg);\n\t\tconst media = msg.payload.media;\n\t\tconst isVoice = admission.ingress.admission === "dispatch" && (media?.kind === "audio" || String(media?.type ?? "").toLowerCase().startsWith("audio/"));\n\t\treturn runAmadeusWhatsAppVoiceScopedIngress({ sessionKey: route.sessionKey, messageId: msg.event.id, isVoice, chatJid: msg.platform.chatJid, sendComposing: msg.platform.sendComposing, run: () => processMessage(processParams) });', 'voice-scoped WhatsApp ingress dispatch');
  return result;
}

export function patchWhatsAppTypingIndicatorSource(original) {
  if (original.includes(`// ${WHATSAPP_TYPING_INDICATOR_MARKER}`)) return original;
  const anchor = '\tconst isAmadeusVoiceInbound = params.inbound.media?.some((media) => media?.kind === "audio" || String(media?.contentType ?? "").toLowerCase().startsWith("audio/")) === true;';
  if (!original.includes(anchor)) return original;
  return original.replace(anchor, `// ${WHATSAPP_TYPING_INDICATOR_MARKER}\n${anchor}`);
}

async function patchFile(path, transform) {
  const original = await readFile(path, 'utf8');
  const transformed = transform(original);
  if (transformed === original) return 'already-applied';
  await writeAtomic(path, transformed);
  return 'applied';
}

async function findFile(root, pattern, anchor) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isFile() && pattern.test(entry.name) && (await readFile(path, 'utf8')).includes(anchor)) return path;
    if (entry.isDirectory() && !entry.isSymbolicLink()) { const found = await findFile(path, pattern, anchor); if (found) return found; }
  }
  return null;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]; const value = argv[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) throw new Error('arguments require --core-root/--whatsapp-root values');
    options[key.slice(2)] = value; index += 1;
  }
  if (Object.keys(options).some((key) => !['core-root', 'whatsapp-root'].includes(key))) throw new Error('unsupported option');
  if (!options['core-root'] && !options['whatsapp-root']) throw new Error('provide a patch root');
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options['core-root']) {
    const corePath = await findFile(options['core-root'], /^agent-runner\.runtime-.*\.mjs$/u, 'function runReplyAgent(params) {');
    if (!corePath) throw new Error('pinned OpenClaw agent-runner module missing');
    console.log(`CORE_VOICE_QUEUE_PATCH=${await patchFile(corePath, patchCoreSource)}`);
    const ttsPath = await findFile(options['core-root'], /^runtime-api-.*\.mjs$/u, 'const ttsText = explicitTtsText || visibleText;');
    if (!ttsPath) throw new Error('pinned OpenClaw TTS runtime module missing');
    console.log(`CORE_REPLY_ENVELOPE_TTS_PATCH=${await patchFile(ttsPath, patchTtsSource)}`);
    const messageActionPath = await findFile(options['core-root'], /^message-action-runner-.*\.mjs$/u, 'async function maybeApplyTtsToMessageActionSendPayload(params) {');
    if (messageActionPath) console.log(`CORE_REPLY_ENVELOPE_MESSAGE_ACTION_PATCH=${await patchFile(messageActionPath, patchMessageActionSource)}`);
    const payloadsPath = await findFile(options['core-root'], /^dispatch-from-config\.payloads-.*\.mjs$/u, 'function createFinalizationAwareTtsPayloadApplier(params) {');
    if (payloadsPath) console.log(`CORE_REPLY_ENVELOPE_CONTEXT_PATCH=${await patchFile(payloadsPath, patchPayloadsTtsContextSource)}`);
    const dispatchPath = await findFile(options['core-root'], /^dispatch-from-config-.*\.mjs$/u, 'const maybeApplyTtsWithFinalizationLease = createFinalizationAwareTtsPayloadApplier({');
    if (dispatchPath) console.log(`CORE_REPLY_ENVELOPE_DISPATCH_PATCH=${await patchFile(dispatchPath, patchDispatchTtsContextSource)}`);
  }
  if (options['whatsapp-root']) {
    const path = await findFile(options['whatsapp-root'], /^monitor-.*\.js$/u, 'function createWhatsAppReplyPlan(params) {');
    if (!path) throw new Error('pinned WhatsApp monitor module missing');
    console.log(`WHATSAPP_VOICE_TYPING_PATCH=${await patchFile(path, patchWhatsAppSource)}`);
    console.log(`WHATSAPP_VOICE_INGRESS_QUEUE_PATCH=${await patchFile(path, patchWhatsAppIngressQueueSource)}`);
    console.log(`WHATSAPP_TYPING_INDICATOR_PATCH=${await patchFile(path, patchWhatsAppTypingIndicatorSource)}`);
  }
}

if (process.argv[1] === '-' || (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]))) await main();
