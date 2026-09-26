// Pure follow-up decision and compiled-bundle bridge helpers.
import { VOICE_RUNS_GLOBAL, WHATSAPP_MARKER, WHATSAPP_INGRESS_QUEUE_MARKER } from "./openclaw-voice-markers.mjs";
export function resolveVoiceFollowup(lease, currentMessageId) {
  return Boolean(lease && lease.messageId !== currentMessageId);
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
