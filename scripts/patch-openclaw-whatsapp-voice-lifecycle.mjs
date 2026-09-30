#!/usr/bin/env node
// Transport lifecycle only: ingress admission, leases, typing and queue drain.
// Delivery semantics belong to the version-pinned typed channel boundary.
import { chmod, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVoiceFollowup, whatsappHelpers, whatsappIngressQueueHelpers } from './openclaw-voice-lease.mjs';
import { VOICE_RUNS_GLOBAL, CORE_MARKER, WHATSAPP_MARKER, WHATSAPP_INGRESS_QUEUE_MARKER, WHATSAPP_TYPING_INDICATOR_MARKER } from './openclaw-voice-markers.mjs';

export { resolveVoiceFollowup, whatsappHelpers, whatsappIngressQueueHelpers };
export { VOICE_RUNS_GLOBAL, CORE_MARKER, WHATSAPP_MARKER, WHATSAPP_INGRESS_QUEUE_MARKER, WHATSAPP_TYPING_INDICATOR_MARKER } from './openclaw-voice-markers.mjs';

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

export function patchWhatsAppSource(original) {
  let result = original;
  if (!result.includes(WHATSAPP_MARKER)) {
    result = replaceOnce(result, 'function createWhatsAppReplyPlan(params) {', `${whatsappHelpers}\nfunction createWhatsAppReplyPlan(params) {`, 'voice lease helper insertion');
    result = replaceOnce(result, '\t\tconst sendComposing = async () => {\n\t\t\tconst currentSock = getCurrentSock();\n\t\t\tif (!currentSock) return;\n\t\t\ttry {\n\t\t\t\tawait assertCanSendToJid(chatJid, currentSock);\n\t\t\t\tawait socketOperations.sendPresenceUpdate("composing", chatJid);\n\t\t\t} catch (err) {\n\t\t\t\tlogWhatsAppVerbose$1(options.verbose, `Presence update failed: ${String(err)}`);\n\t\t\t}\n\t\t};', '\t\tconst sendComposing = async () => {\n\t\t\tconst currentSock = getCurrentSock();\n\t\t\tif (!currentSock) { clearAmadeusVoiceReplyLeasesForChat(chatJid); return; }\n\t\t\ttry {\n\t\t\t\tawait assertCanSendToJid(chatJid, currentSock);\n\t\t\t\tawait socketOperations.sendPresenceUpdate("composing", chatJid);\n\t\t\t} catch (err) {\n\t\t\t\tclearAmadeusVoiceReplyLeasesForChat(chatJid);\n\t\t\t\tlogWhatsAppVerbose$1(options.verbose, `Presence update failed: ${String(err)}`);\n\t\t\t}\n\t\t};', 'voice presence failure cleanup');
    result = replaceOnce(result, '\t\t\tif (update.connection === "close") {', '\t\t\tif (update.connection === "close") {\n\t\t\t\tclearAmadeusVoiceReplyLeases();', 'WhatsApp disconnect cleanup');
    result = replaceOnce(result, '\t});\n\tconst didSendReply = turnResult.dispatched ? finalizeReply?.(turnResult.dispatchResult) ?? false : false;', '\t}).finally(() => closeAmadeusVoiceReplyLeaseForTurn(params.route.sessionKey, params.msg.event.id));\n\tconst didSendReply = turnResult.dispatched ? finalizeReply?.(turnResult.dispatchResult) ?? false : false;', 'voice inbound turn settlement');
  }
  return result;
}

export function patchWhatsAppIngressQueueSource(original) {
  if (original.includes(WHATSAPP_INGRESS_QUEUE_MARKER)) return original;
  if (!original.includes(WHATSAPP_MARKER)) throw new Error('WhatsApp lifecycle base patch must be applied first');
  let result = replaceOnce(original, 'function createWebOnMessageHandler(params) {', `${whatsappIngressQueueHelpers}\nfunction createWebOnMessageHandler(params) {`, 'voice-scoped ingress queue helper insertion');
  result = replaceOnce(result, '\t\treturn processMessage(processParams);', '\t\tconst admission = requireWhatsAppInboundAdmission(msg);\n\t\tconst media = msg.payload.media;\n\t\tconst isVoice = admission.ingress.admission === "dispatch" && (media?.kind === "audio" || String(media?.type ?? "").toLowerCase().startsWith("audio/"));\n\t\treturn runAmadeusWhatsAppVoiceScopedIngress({ sessionKey: route.sessionKey, messageId: msg.event.id, isVoice, chatJid: msg.platform.chatJid, sendComposing: msg.platform.sendComposing, run: () => processMessage(processParams) });', 'voice-scoped WhatsApp ingress dispatch');
  return result;
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
  }
  if (options['whatsapp-root']) {
    const path = await findFile(options['whatsapp-root'], /^monitor-.*\.js$/u, 'function createWhatsAppReplyPlan(params) {');
    if (!path) throw new Error('pinned WhatsApp monitor module missing');
    console.log(`WHATSAPP_VOICE_TYPING_PATCH=${await patchFile(path, patchWhatsAppSource)}`);
    console.log(`WHATSAPP_VOICE_INGRESS_QUEUE_PATCH=${await patchFile(path, patchWhatsAppIngressQueueSource)}`);
  }
}

if (process.argv[1] === '-' || (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]))) await main();
