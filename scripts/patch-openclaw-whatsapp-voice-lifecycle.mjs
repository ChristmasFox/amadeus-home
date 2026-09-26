#!/usr/bin/env node
// Pinned OpenClaw 2026.9.4: keep WhatsApp composing active for voice replies
// through channel settlement and queue same-session arrivals behind that run.
import { chmod, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAmadeusJapaneseSpeechText, ensureAmadeusJapaneseVoiceText } from './openclaw-voice-policy.mjs';
import { resolveVoiceFollowup, whatsappHelpers, whatsappIngressQueueHelpers } from './openclaw-voice-lease.mjs';
import { VOICE_RUNS_GLOBAL, CORE_MARKER, TTS_MARKER, WHATSAPP_MARKER,
  WHATSAPP_INGRESS_QUEUE_MARKER, WHATSAPP_JAPANESE_TEXT_MARKER,
  WHATSAPP_JAPANESE_AUDIO_GUARD_MARKER } from './openclaw-voice-markers.mjs';
export { resolveAmadeusJapaneseSpeechText, ensureAmadeusJapaneseVoiceText,
  resolveVoiceFollowup, whatsappHelpers, whatsappIngressQueueHelpers };
export { VOICE_RUNS_GLOBAL, CORE_MARKER, TTS_MARKER, WHATSAPP_MARKER,
  WHATSAPP_INGRESS_QUEUE_MARKER, WHATSAPP_JAPANESE_TEXT_MARKER,
  WHATSAPP_JAPANESE_AUDIO_GUARD_MARKER };

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
    `// ${CORE_MARKER}: voice-run concurrency is scoped to a live WhatsApp voice lease.\n\tconst amadeusVoiceLease = sessionKey && globalThis.${VOICE_RUNS_GLOBAL} instanceof Map ? globalThis.${VOICE_RUNS_GLOBAL}.get(sessionKey) : void 0;\n\tconst amadeusCurrentMessageId = sessionCtx.MessageSidFull ?? sessionCtx.MessageSid;\n\tconst amadeusVoiceFollowup = !isHeartbeat && !effectiveResetTriggered && String(sessionCtx.OriginatingChannel ?? "").toLowerCase() === "whatsapp" && resolveAmadeusVoiceFollowup(amadeusVoiceLease, amadeusCurrentMessageId);\n\tconst effectiveShouldSteer = !amadeusVoiceFollowup && !isHeartbeat && !effectiveResetTriggered && shouldSteer;\n\tconst effectiveShouldFollowup = !effectiveResetTriggered && (shouldFollowup || amadeusVoiceFollowup);`,
    'voice queue policy',
  );
  const helperAnchor = '//#region src/auto-reply/reply/agent-runner-run.ts';
  result = replaceOnce(
    result,
    helperAnchor,
    `function resolveAmadeusVoiceFollowup(lease, currentMessageId) { return Boolean(lease && lease.messageId !== currentMessageId); }\n${helperAnchor}`,
    'voice queue helper',
  );
  result = replaceOnce(
    result,
    'const questionInput = await runReplyQuestionInput(params);',
    'const questionInput = amadeusVoiceFollowup ? { handled: false } : await runReplyQuestionInput(params);',
    'voice run defers question steering',
  );
  result = replaceOnce(
    result,
    'if (messageInjectionDisposition === "accepted") {',
    'if (messageInjectionDisposition === "accepted" && !amadeusVoiceFollowup) {',
    'voice run defers accepted injection',
  );
  result = replaceOnce(
    result,
    'const activeRunQueueAction = resolveActiveRunQueueAction({',
    'const activeRunQueueAction = amadeusVoiceFollowup ? "enqueue-followup" : resolveActiveRunQueueAction({',
    'voice queue admission',
  );
  result = replaceOnce(
    result,
    'else scheduleFollowupDrain(queueKey, queuedRunFollowupTurn);',
    'else if (amadeusVoiceFollowup && amadeusVoiceLease?.settled) void amadeusVoiceLease.settled.then(() => scheduleFollowupDrain(queueKey, queuedRunFollowupTurn));\n\t\telse scheduleFollowupDrain(queueKey, queuedRunFollowupTurn);',
    'voice queue drain',
  );
  return result;
}

export function patchTtsSource(original) {
  if (original.includes(TTS_MARKER)) return original;
  let result = replaceOnce(
    original,
    'const ttsText = explicitTtsText || visibleText;',
    `const amadeusInboundWhatsAppVoice = params.inboundAudio === true && String(params.channel ?? '').toLowerCase() === 'whatsapp';
	const ttsText = amadeusInboundWhatsAppVoice
		? resolveAmadeusJapaneseSpeechText(visibleText, explicitTtsText)
		: (explicitTtsText || visibleText);`,
    'Japanese voice TTS input selection',
  );
  result = replaceOnce(
    result,
    'async function maybeApplyTtsToPayloadCore(params, persistTtsAudio) {',
    `${resolveAmadeusJapaneseSpeechText.toString()}\nasync function maybeApplyTtsToPayloadCore(params, persistTtsAudio) {`,
    'Japanese voice TTS helper',
  );
  result = replaceOnce(
    result,
    'if (!ttsText.trim()) return nextPayload;',
    'if (amadeusInboundWhatsAppVoice && !ttsText.trim()) return nextPayload;\n\tif (!ttsText.trim()) return nextPayload;',
    'Japanese voice TTS fail-closed guard',
  );
  return `// ${TTS_MARKER}\n${result}`;
}

export function patchWhatsAppSource(original) {
  if (original.includes(WHATSAPP_MARKER)) return original;
  let result = replaceOnce(
    original,
    'function createWhatsAppReplyPlan(params) {',
    `${whatsappHelpers}\nfunction createWhatsAppReplyPlan(params) {`,
    'voice lease helper insertion',
  );
  result = replaceOnce(
    result,
    '\t\tconst sendComposing = async () => {\n\t\t\tconst currentSock = getCurrentSock();\n\t\t\tif (!currentSock) return;\n\t\t\ttry {\n\t\t\t\tawait assertCanSendToJid(chatJid, currentSock);\n\t\t\t\tawait socketOperations.sendPresenceUpdate("composing", chatJid);\n\t\t\t} catch (err) {\n\t\t\t\tlogWhatsAppVerbose$1(options.verbose, `Presence update failed: ${String(err)}`);\n\t\t\t}\n\t\t};',
    '\t\tconst sendComposing = async () => {\n\t\t\tconst currentSock = getCurrentSock();\n\t\t\tif (!currentSock) { clearAmadeusVoiceReplyLeasesForChat(chatJid); return; }\n\t\t\ttry {\n\t\t\t\tawait assertCanSendToJid(chatJid, currentSock);\n\t\t\t\tawait socketOperations.sendPresenceUpdate("composing", chatJid);\n\t\t\t} catch (err) {\n\t\t\t\tclearAmadeusVoiceReplyLeasesForChat(chatJid);\n\t\t\t\tlogWhatsAppVerbose$1(options.verbose, `Presence update failed: ${String(err)}`);\n\t\t\t}\n\t\t};',
    'voice presence failure cleanup',
  );
  result = replaceOnce(
    result,
    '\tconst mediaOnlyCoalescer = createWhatsAppMediaOnlyReplyCoalescer({ deliver: async (pending) => {\n\t\treturn await deliverNormalizedPayload(pending.payload, pending.info);\n\t} });\n\treturn {',
    '\tconst isAmadeusVoiceInbound = params.inbound.media?.some((media) => media?.kind === "audio" || String(media?.contentType ?? "").toLowerCase().startsWith("audio/")) === true;\n\tlet amadeusVoiceLease;\n\tconst sendTypingPresence = async () => { await params.transport.sendComposing?.(); };\n\tconst mediaOnlyCoalescer = createWhatsAppMediaOnlyReplyCoalescer({ deliver: async (pending) => {\n\t\treturn await deliverNormalizedPayload(pending.payload, pending.info);\n\t} });\n\treturn {',
    'voice lease initialization',
  );
  result = replaceOnce(
    result,
    '\t\t\tonSettled: async () => {\n\t\t\t\tconst flushResult = await mediaOnlyCoalescer.flushAll();\n\t\t\t\tlogWhatsAppMediaOnlyFlushResult(flushResult);\n\t\t\t\treturn whatsAppReplyDeliveryVisibility(didSendReply || flushResult.delivered > 0);\n\t\t\t},\n\t\t\tonReplyStart: params.transport.sendComposing',
    '\t\t\tonSettled: async () => {\n\t\t\t\tconst flushResult = await mediaOnlyCoalescer.flushAll();\n\t\t\t\tlogWhatsAppMediaOnlyFlushResult(flushResult);\n\t\t\t\treturn whatsAppReplyDeliveryVisibility(didSendReply || flushResult.delivered > 0);\n\t\t\t},\n\t\t\tonReplyStart: async () => {\n\t\t\t\tif (!isAmadeusVoiceInbound) return await params.transport.sendComposing?.();\n\t\t\t\tamadeusVoiceLease ??= startAmadeusVoiceReplyLease({\n\t\t\t\t\tsessionKey: params.route.sessionKey,\n\t\t\t\t\tmessageId: params.inbound.event?.id,\n\t\t\t\t\tsendComposing: sendTypingPresence\n\t\t\t\t});\n\t\t\t}',
    'voice typing lifecycle',
  );
  result = replaceOnce(
    result,
    '\t\t\tif (update.connection === "close") {',
    '\t\t\tif (update.connection === "close") {\n\t\t\t\tclearAmadeusVoiceReplyLeases();',
    'WhatsApp disconnect cleanup',
  );
  result = replaceOnce(
    result,
    '\t});\n\tconst didSendReply = turnResult.dispatched ? finalizeReply?.(turnResult.dispatchResult) ?? false : false;',
    '\t}).finally(() => closeAmadeusVoiceReplyLeaseForTurn(params.route.sessionKey, params.msg.event.id));\n\tconst didSendReply = turnResult.dispatched ? finalizeReply?.(turnResult.dispatchResult) ?? false : false;',
    'voice inbound turn settlement',
  );
  return result;
}

export function patchWhatsAppIngressQueueSource(original) {
  if (original.includes(WHATSAPP_INGRESS_QUEUE_MARKER)) return original;
  if (!original.includes(WHATSAPP_MARKER)) throw new Error('WhatsApp lifecycle base patch must be applied first');
  let result = replaceOnce(
    original,
    'function createWebOnMessageHandler(params) {',
    `${whatsappIngressQueueHelpers}\nfunction createWebOnMessageHandler(params) {`,
    'voice-scoped ingress queue helper insertion',
  );
  result = replaceOnce(
    result,
    'function clearAmadeusVoiceReplyLeasesForChat(chatJid) {\n\tconst registry = getAmadeusVoiceReplyRegistry();\n\tfor (const lease of registry.values()) if (lease.chatJid === chatJid) closeAmadeusVoiceReplyLease(lease, "presence-error");\n}',
    'function clearAmadeusVoiceReplyLeasesForChat(chatJid) {\n\tconst registry = getAmadeusVoiceReplyRegistry();\n\tfor (const lease of registry.values()) if (lease.chatJid === chatJid) { clearInterval(lease.refreshTimer); lease.refreshTimer = null; lease.presenceFailed = true; }\n}',
    'voice presence failure retains queue lock',
  );
  result = replaceOnce(
    result,
    '\t\treturn processMessage(processParams);',
    '\t\tconst admission = requireWhatsAppInboundAdmission(msg);\n\t\tconst media = msg.payload.media;\n\t\tconst isVoice = admission.ingress.admission === "dispatch" && (media?.kind === "audio" || String(media?.type ?? "").toLowerCase().startsWith("audio/"));\n\t\treturn runAmadeusWhatsAppVoiceScopedIngress({\n\t\t\tsessionKey: route.sessionKey,\n\t\t\tmessageId: msg.event.id,\n\t\t\tisVoice,\n\t\t\tchatJid: msg.platform.chatJid,\n\t\t\tsendComposing: msg.platform.sendComposing,\n\t\t\trun: () => processMessage(processParams)\n\t\t});',
    'voice-scoped WhatsApp ingress dispatch',
  );
  return result;
}

export function patchWhatsAppJapaneseAudioGuardSource(original) {
  if (original.includes(WHATSAPP_JAPANESE_AUDIO_GUARD_MARKER)) return original;
  const marker = `// ${WHATSAPP_JAPANESE_TEXT_MARKER}\n`;
  const count = original.split(marker).length - 1;
  if (count !== 1) throw new Error(`Japanese visible-text patch must be applied first: marker count=${count}`);
  const start = original.indexOf(marker) + marker.length;
  const end = original.indexOf('\nfunction createWhatsAppReplyPlan(params) {', start);
  if (end < 0 || !original.slice(start, end).startsWith('function ensureAmadeusJapaneseVoiceText(')) {
    throw new Error('pinned Japanese visible-text helper anchor missing');
  }
  return `${original.slice(0, start)}// ${WHATSAPP_JAPANESE_AUDIO_GUARD_MARKER}\n${ensureAmadeusJapaneseVoiceText.toString()}${original.slice(end)}`;
}

export function patchWhatsAppJapaneseTextSource(original) {
  if (original.includes(WHATSAPP_JAPANESE_TEXT_MARKER)) return original;
  if (!original.includes(WHATSAPP_INGRESS_QUEUE_MARKER)) throw new Error('WhatsApp ingress FIFO patch must be applied first');
  let result = replaceOnce(
    original,
    'function createWhatsAppReplyPlan(params) {',
    `// ${WHATSAPP_JAPANESE_TEXT_MARKER}\n${ensureAmadeusJapaneseVoiceText.toString()}\nfunction createWhatsAppReplyPlan(params) {`,
    'Japanese voice-text postprocessor insertion',
  );
  result = replaceOnce(
    result,
    '\t\t\t\tconst deliveryPayload = resolveWhatsAppDeliverablePayload(payload, info);\n\t\t\t\tif (!deliveryPayload) return null;\n\t\t\t\tconst normalizedOutboundPayload = normalizeWhatsAppOutboundPayload(deliveryPayload, { normalizeText: normalizeWhatsAppPayloadTextPreservingIndentation });',
    '\t\t\t\tconst deliveryPayload = resolveWhatsAppDeliverablePayload(payload, info);\n\t\t\t\tif (!deliveryPayload) return null;\n\t\t\t\tconst voiceTextPayload = ensureAmadeusJapaneseVoiceText(deliveryPayload, isAmadeusVoiceInbound);\n\t\t\t\tconst normalizedOutboundPayload = normalizeWhatsAppOutboundPayload(voiceTextPayload, { normalizeText: normalizeWhatsAppPayloadTextPreservingIndentation });',
    'Japanese visible-text delivery',
  );
  result = replaceOnce(
    result,
    '\t\t\t\tconst normalizedDeliveryPayload = deliveryPayload.text === void 0 ? {',
    '\t\t\t\tconst normalizedDeliveryPayload = voiceTextPayload.text === void 0 ? {',
    'Japanese visible text normalization',
  );
  return result;
}

async function patchFile(path, transform, marker) {
  const original = await readFile(path, 'utf8');
  if (original.includes(marker)) return 'already-applied';
  const transformed = transform(original);
  if (transformed === original) throw new Error(`patch made no change: ${path}`);
  await writeAtomic(path, transformed);
  return 'applied';
}

async function findFile(root, pattern, anchor) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isFile() && pattern.test(entry.name)) {
      const source = await readFile(path, 'utf8');
      if (source.includes(anchor)) return path;
    }
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      const found = await findFile(path, pattern, anchor);
      if (found) return found;
    }
  }
  return null;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`);
    options[key.slice(2)] = value;
    index += 1;
  }
  if (Object.keys(options).some((key) => !['core-root', 'whatsapp-root'].includes(key))) throw new Error('supported options: --core-root, --whatsapp-root');
  if (!options['core-root'] && !options['whatsapp-root']) throw new Error('provide --core-root and/or --whatsapp-root');
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options['core-root']) {
    const path = await findFile(options['core-root'], /^agent-runner\.runtime-.*\.mjs$/u, 'function runReplyAgent(params) {');
    if (!path) throw new Error('pinned OpenClaw agent-runner module missing');
    console.log(`CORE_VOICE_QUEUE_PATCH=${await patchFile(path, patchCoreSource, CORE_MARKER)}`);
    const ttsPath = await findFile(options['core-root'], /^runtime-api-.*\.mjs$/u, 'const ttsText = explicitTtsText || visibleText;');
    if (!ttsPath) throw new Error('pinned OpenClaw TTS runtime module missing');
    console.log(`CORE_JAPANESE_TTS_PATCH=${await patchFile(ttsPath, patchTtsSource, TTS_MARKER)}`);
  }
  if (options['whatsapp-root']) {
    const path = await findFile(options['whatsapp-root'], /^monitor-.*\.js$/u, 'function createWhatsAppReplyPlan(params) {');
    if (!path) throw new Error('pinned WhatsApp monitor module missing');
    console.log(`WHATSAPP_VOICE_TYPING_PATCH=${await patchFile(path, patchWhatsAppSource, WHATSAPP_MARKER)}`);
    console.log(`WHATSAPP_VOICE_INGRESS_QUEUE_PATCH=${await patchFile(path, patchWhatsAppIngressQueueSource, WHATSAPP_INGRESS_QUEUE_MARKER)}`);
    console.log(`WHATSAPP_JAPANESE_TEXT_PATCH=${await patchFile(path, patchWhatsAppJapaneseTextSource, WHATSAPP_JAPANESE_TEXT_MARKER)}`);
    console.log(`WHATSAPP_JAPANESE_AUDIO_GUARD_PATCH=${await patchFile(path, patchWhatsAppJapaneseAudioGuardSource, WHATSAPP_JAPANESE_AUDIO_GUARD_MARKER)}`);
  }
}

if (process.argv[1] === "-" || (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]))) {
  await main();
}
