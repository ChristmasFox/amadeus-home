#!/usr/bin/env node
// Pinned OpenClaw 2026.9.4: keep WhatsApp composing active for voice replies
// through channel settlement and queue same-session arrivals behind that run.
import { chmod, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const VOICE_RUNS_GLOBAL = '__amadeusWhatsAppVoiceRuns20260925';
export const CORE_MARKER = 'amadeus-whatsapp-voice-followup-v1';
export const TTS_MARKER = 'amadeus-whatsapp-japanese-tts-input-v1';
export const WHATSAPP_MARKER = 'amadeus-whatsapp-voice-typing-lifecycle-v1';
export const WHATSAPP_INGRESS_QUEUE_MARKER = 'amadeus-whatsapp-voice-ingress-queue-v1';
export const WHATSAPP_JAPANESE_TEXT_MARKER = 'amadeus-whatsapp-japanese-visible-tts-v1';
export const WHATSAPP_JAPANESE_AUDIO_GUARD_MARKER = 'amadeus-whatsapp-japanese-audio-guard-v1';

export function resolveVoiceFollowup(lease, currentMessageId) {
  return Boolean(lease && lease.messageId !== currentMessageId);
}

export function resolveAmadeusJapaneseSpeechText(visibleText, explicitTtsText = '') {
  const source = typeof visibleText === 'string' ? visibleText : '';
  const labeledCandidates = source.split(/\r?\n/u)
    .map((line) => line.trim().match(/^日本語[：:]\s*(.*)$/u)?.[1]?.trim() ?? '')
    .filter((line) => line && /[\u3040-\u30ff]/u.test(line));
  if (labeledCandidates.length > 0) return labeledCandidates.at(-1);

  const explicit = typeof explicitTtsText === 'string' ? explicitTtsText.trim() : '';
  if (explicit && !/(?:^|\n)\s*(?:中文|日本語)[：:]/u.test(explicit) && /[\u3040-\u30ff]/u.test(explicit)) {
    return explicit;
  }
  return '';
}

export function ensureAmadeusJapaneseVoiceText(payload, isVoiceInbound) {
  if (!isVoiceInbound || !payload || typeof payload !== 'object') return payload;
  const hasMedia = (typeof payload.mediaUrl === 'string' && payload.mediaUrl.trim().length > 0)
    || (Array.isArray(payload.mediaUrls) && payload.mediaUrls.some((url) => typeof url === 'string' && url.trim().length > 0));
  if (!hasMedia) return payload;
  const isTtsVoice = payload.audioAsVoice === true || typeof payload.ttsSupplement?.spokenText === 'string';
  if (!isTtsVoice) return payload;
  const supplementText = typeof payload.ttsSupplement?.spokenText === 'string' ? payload.ttsSupplement.spokenText : '';
  const spokenText = (supplementText || (typeof payload.spokenText === 'string' ? payload.spokenText : '')).trim();
  const visibleText = typeof payload.text === 'string' ? payload.text : '';
  const spokenTextIsStructuredOrMultiline = /(?:^|\n)\s*(?:中文|日本語)[：:]/u.test(spokenText) || /\r?\n/u.test(spokenText);
  if (spokenTextIsStructuredOrMultiline || !/[\u3040-\u30ff]/u.test(spokenText)) {
    // An untagged Chinese-only final must never become a Chinese WhatsApp PTT.
    // Return text-only instead of trying to relabel or reuse already-synthesized audio.
    const safeText = visibleText.split(/\r?\n/u).filter((line) => !/^日本語[：:]/u.test(line.trim())).join('\n').trim();
    const warning = '日语语音暂时无法生成，请稍后重试。';
    const { mediaUrl: _mediaUrl, mediaUrls: _mediaUrls, audioAsVoice: _audioAsVoice,
      spokenText: _spokenText, ttsSupplement: _ttsSupplement, trustedLocalMedia: _trustedLocalMedia,
      ...textOnlyPayload } = payload;
    return { ...textOnlyPayload, text: safeText ? `${safeText}\n${warning}` : warning };
  }
  const outputLines = [];
  let japaneseLineWritten = false;
  for (const line of visibleText.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (/^日本語[：:]/u.test(trimmed) || trimmed === spokenText) {
      if (!japaneseLineWritten) outputLines.push(`日本語：${spokenText}`);
      japaneseLineWritten = true;
      continue;
    }
    outputLines.push(line);
  }
  if (!japaneseLineWritten) outputLines.push(`日本語：${spokenText}`);
  const japaneseIndex = outputLines.findIndex((line) => /^日本語[：:]/u.test(line.trim()));
  if (japaneseIndex > 0) {
    let insertAt = japaneseIndex;
    while (insertAt > 0 && outputLines[insertAt - 1].trim() === '') {
      outputLines.splice(insertAt - 1, 1);
      insertAt -= 1;
    }
    outputLines.splice(insertAt, 0, '');
  }
  const nextText = outputLines.join('\n').trim();
  return nextText === visibleText ? payload : { ...payload, text: nextText };
}

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

export const whatsappHelpers = `// ${WHATSAPP_MARKER}: lease scoped to an admitted WhatsApp voice reply.
const AMADEUS_VOICE_REPLY_TIMEOUT_MS = 120000;
const AMADEUS_VOICE_REPLY_REFRESH_MS = 3000;
function getAmadeusVoiceReplyRegistry() {
\tconst current = globalThis.${VOICE_RUNS_GLOBAL};
\tif (current instanceof Map) return current;
\tconst registry = new Map();
\tObject.defineProperty(globalThis, "${VOICE_RUNS_GLOBAL}", { value: registry, configurable: true, writable: true });
\treturn registry;
}
function closeAmadeusVoiceReplyLease(lease, reason = "settled") {
\tif (!lease || lease.closed) return;
\tlease.closed = true;
\tclearInterval(lease.refreshTimer);
\tclearTimeout(lease.timeoutTimer);
\tif (lease.registry.get(lease.sessionKey) === lease) lease.registry.delete(lease.sessionKey);
\tlease.resolveSettled({ reason });
}
function clearAmadeusVoiceReplyLeases() {
\tconst registry = getAmadeusVoiceReplyRegistry();
\tfor (const lease of registry.values()) closeAmadeusVoiceReplyLease(lease, "disconnect");
}
function clearAmadeusVoiceReplyLeasesForChat(chatJid) {
\tconst registry = getAmadeusVoiceReplyRegistry();
\tfor (const lease of registry.values()) if (lease.chatJid === chatJid) closeAmadeusVoiceReplyLease(lease, "presence-error");
}
function closeAmadeusVoiceReplyLeaseForTurn(sessionKey, messageId) {
\tconst lease = getAmadeusVoiceReplyRegistry().get(sessionKey);
\tif (lease && lease.messageId === messageId) closeAmadeusVoiceReplyLease(lease, "turn-settled");
}
function startAmadeusVoiceReplyLease(params) {
\tif (!params.sessionKey || typeof params.sendComposing !== "function") return null;
\tconst registry = getAmadeusVoiceReplyRegistry();
\tconst previous = registry.get(params.sessionKey);
\tif (previous && !previous.closed) return previous;
\tlet resolveSettled;
\tconst lease = {
\t\tregistry,
\t\tsessionKey: params.sessionKey,
\t\tmessageId: params.messageId,
\t\tchatJid: params.chatJid,
\t\tclosed: false,
\t\tsettled: new Promise((resolve) => { resolveSettled = resolve; }),
\t\tresolveSettled: (value) => resolveSettled(value)
\t};
\tlease.refreshTimer = setInterval(() => { Promise.resolve(params.sendComposing()).catch(() => {}); }, AMADEUS_VOICE_REPLY_REFRESH_MS);
\tlease.timeoutTimer = setTimeout(() => closeAmadeusVoiceReplyLease(lease, "timeout"), AMADEUS_VOICE_REPLY_TIMEOUT_MS);
\tlease.refreshTimer.unref?.();
\tlease.timeoutTimer.unref?.();
\tregistry.set(params.sessionKey, lease);
\tPromise.resolve(params.sendComposing()).catch(() => {});
\treturn lease;
}
`;

export const whatsappIngressQueueHelpers = `// ${WHATSAPP_INGRESS_QUEUE_MARKER}: serialize WhatsApp arrivals behind a voice run before Agent dispatch.
const AMADEUS_WHATSAPP_VOICE_INGRESS_TAILS = new Map();
async function runAmadeusWhatsAppVoiceScopedIngress(params) {
\tconst sessionKey = String(params.sessionKey ?? "").trim();
\tconst messageId = String(params.messageId ?? "").trim();
\tif (!sessionKey || !messageId || typeof params.run !== "function") return await params.run();
\tconst registry = getAmadeusVoiceReplyRegistry();
\tconst previousTail = AMADEUS_WHATSAPP_VOICE_INGRESS_TAILS.get(sessionKey);
\tconst activeLease = registry.get(sessionKey);
\tconst mustQueue = Boolean(previousTail || activeLease && activeLease.messageId !== messageId);
\tif (!mustQueue) {
\t\tconst lease = params.isVoice ? activeLease && activeLease.messageId === messageId ? activeLease : startAmadeusVoiceReplyLease({ sessionKey, messageId, chatJid: params.chatJid, sendComposing: params.sendComposing }) : void 0;
\t\ttry { return await params.run(); }
\t\tfinally { if (lease && lease.messageId === messageId) closeAmadeusVoiceReplyLease(lease, "turn-settled"); }
\t}
\tlet releaseSlot;
\tconst slot = new Promise((resolve) => { releaseSlot = resolve; });
\tconst predecessor = previousTail ?? Promise.resolve();
\tconst tail = predecessor.catch(() => {}).then(() => slot);
\tAMADEUS_WHATSAPP_VOICE_INGRESS_TAILS.set(sessionKey, tail);
\tlet lease;
\ttry {
\t\tawait predecessor.catch(() => {});
\t\twhile (true) {
\t\t\tconst current = registry.get(sessionKey);
\t\t\tif (!current || current.messageId === messageId) break;
\t\t\tawait current.settled;
\t\t}
\t\tconst current = registry.get(sessionKey);
\t\tif (params.isVoice) lease = current?.messageId === messageId ? current : startAmadeusVoiceReplyLease({ sessionKey, messageId, chatJid: params.chatJid, sendComposing: params.sendComposing });
\t\treturn await params.run();
\t} finally {
\t\tif (lease && lease.messageId === messageId) closeAmadeusVoiceReplyLease(lease, "turn-settled");
\t\treleaseSlot();
\t\tif (AMADEUS_WHATSAPP_VOICE_INGRESS_TAILS.get(sessionKey) === tail) AMADEUS_WHATSAPP_VOICE_INGRESS_TAILS.delete(sessionKey);
\t}
}
`;

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

if (process.argv[1] === "-" || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  await main();
}
