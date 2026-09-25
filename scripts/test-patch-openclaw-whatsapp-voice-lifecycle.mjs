#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  CORE_MARKER,
  WHATSAPP_MARKER,
  patchCoreSource,
  patchWhatsAppSource,
  resolveVoiceFollowup,
  whatsappHelpers,
} from './patch-openclaw-whatsapp-voice-lifecycle.mjs';
import vm from 'node:vm';

const coreFixture = `const resolveActiveRunQueueAction = () => "run-now";
const scheduleFollowupDrain = () => {};
const scheduleFollowupDrainAfterReplyOperationClear = () => {};
const queueKey = "session";
const queuedRunFollowupTurn = () => {};
const sessionKey = "session";
const sessionCtx = { MessageSid: "voice-message" };
const isHeartbeat = false;
const effectiveResetTriggered = false;
const shouldSteer = true;
const shouldFollowup = false;
const queueAdmissionState = "empty";
const isActive = true;
const activeRunQueueMode = "steer";
const replyOperationRunState = null;
const activeReplyOperation = {};
const opts = {};
	const effectiveShouldSteer = !isHeartbeat && !effectiveResetTriggered && shouldSteer;
	const effectiveShouldFollowup = !effectiveResetTriggered && shouldFollowup;
	const questionInput = await runReplyQuestionInput(params);
if (messageInjectionDisposition === "accepted") { throw new Error("accepted injection"); }
const activeRunQueueAction = resolveActiveRunQueueAction({
  queueAdmissionState,
  isActive,
  isHeartbeat,
  shouldFollowup: effectiveShouldFollowup || false,
  queueMode: activeRunQueueMode,
  resetTriggered: effectiveResetTriggered
});
if (activeRunQueueAction === "enqueue-followup") {
  const queuedOperationOwner = activeReplyOperation;
  if (queuedOperationOwner) scheduleFollowupDrainAfterReplyOperationClear({ operation: queuedOperationOwner, queueKey, runFollowup: queuedRunFollowupTurn });
		else scheduleFollowupDrain(queueKey, queuedRunFollowupTurn);
}
//#region src/auto-reply/reply/agent-runner-run.ts
`;

const whatsappFixture = `async function enqueueInboundMessage(chatJid) {
		const sendComposing = async () => {
			const currentSock = getCurrentSock();
			if (!currentSock) return;
			try {
				await assertCanSendToJid(chatJid, currentSock);
				await socketOperations.sendPresenceUpdate("composing", chatJid);
			} catch (err) {
				logWhatsAppVerbose$1(options.verbose, \`Presence update failed: \${String(err)}\`);
			}
		};
}
function createWhatsAppReplyPlan(params) {
	const mediaOnlyCoalescer = createWhatsAppMediaOnlyReplyCoalescer({ deliver: async (pending) => {
		return await deliverNormalizedPayload(pending.payload, pending.info);
	} });
	return {
		dispatcherOptions: {
			onSettled: async () => {
				const flushResult = await mediaOnlyCoalescer.flushAll();
				logWhatsAppMediaOnlyFlushResult(flushResult);
				return whatsAppReplyDeliveryVisibility(didSendReply || flushResult.delivered > 0);
			},
			onReplyStart: params.transport.sendComposing
		}
	};
}
async function processMessage(params) {
	const turnResult = await runChannelInboundEvent({
		adapter: {}
	});
	const didSendReply = turnResult.dispatched ? finalizeReply?.(turnResult.dispatchResult) ?? false : false;
	return didSendReply;
}
function handleConnectionUpdate(update) {
			if (update.connection === "close") {
				resolveClose({ status: 0, isLoggedOut: false, error: "closed" });
			}
}
`;

assert.equal(resolveVoiceFollowup(undefined, 'typed-message'), false, 'typed turns are unaffected when no voice lease exists');
assert.equal(resolveVoiceFollowup({ messageId: 'voice-message' }, 'voice-message'), false, 'voice owner is not queued behind itself');
assert.equal(resolveVoiceFollowup({ messageId: 'voice-message' }, 'typed-message'), true, 'same-session concurrent turn is recognized as a voice followup');

const patchedCore = patchCoreSource(coreFixture);
assert.ok(patchedCore.includes(CORE_MARKER));
assert.ok(patchedCore.includes('amadeusVoiceFollowup ? "enqueue-followup"'));
assert.ok(patchedCore.includes('amadeusVoiceLease?.settled'));
assert.ok(patchedCore.includes('scheduleFollowupDrainAfterReplyOperationClear'), 'active same-session work drains queued messages only after the active operation clears');
assert.ok(patchedCore.includes('amadeusVoiceLease.settled.then(() => scheduleFollowupDrain(queueKey, queuedRunFollowupTurn))'), 'voice-scoped queue also waits for lease settlement when no operation owner is registered');
assert.ok(patchedCore.includes('amadeusVoiceFollowup ? { handled: false } : await runReplyQuestionInput(params);'), 'pending voice replies cannot be consumed as steering/question input');
assert.ok(patchedCore.includes('messageInjectionDisposition === "accepted" && !amadeusVoiceFollowup'), 'accepted steering injection is bypassed only for the active voice lock');
assert.equal(patchCoreSource(patchedCore), patchedCore, 'core patch is idempotent');

const patchedWhatsApp = patchWhatsAppSource(whatsappFixture);
assert.ok(patchedWhatsApp.includes(WHATSAPP_MARKER));
assert.ok(patchedWhatsApp.includes('AMADEUS_VOICE_REPLY_TIMEOUT_MS = 120000'));
assert.ok(patchedWhatsApp.includes('AMADEUS_VOICE_REPLY_REFRESH_MS = 3000'));
assert.ok(patchedWhatsApp.includes('finally(() => closeAmadeusVoiceReplyLeaseForTurn(params.route.sessionKey, params.msg.event.id))'), 'the lease is held until the whole inbound dispatcher settles');
assert.ok(patchedWhatsApp.includes('clearAmadeusVoiceReplyLeases();'));
assert.ok(patchedWhatsApp.includes('clearAmadeusVoiceReplyLeasesForChat(chatJid);'), 'presence errors close the active lease');
assert.ok(patchedWhatsApp.includes('if (!isAmadeusVoiceInbound) return await params.transport.sendComposing?.();'), 'typed replies retain their existing typing behavior');
assert.ok(patchedWhatsApp.includes('onSettled: async () => {\n\t\t\t\tconst flushResult = await mediaOnlyCoalescer.flushAll();'), 'the final dispatcher flush remains awaited');
assert.equal(patchWhatsAppSource(patchedWhatsApp), patchedWhatsApp, 'WhatsApp patch is idempotent');

// Exercise the exact injected lease helper with deterministic fake timers.
const timerCallbacks = new Map();
let nextTimer = 0;
const clearedTimers = [];
const sandbox = {
  Map,
  Promise,
  setInterval(callback, delay) { const id = ++nextTimer; timerCallbacks.set(id, { callback, delay, kind: 'interval' }); return { id, unref() {} }; },
  setTimeout(callback, delay) { const id = ++nextTimer; timerCallbacks.set(id, { callback, delay, kind: 'timeout' }); return { id, unref() {} }; },
  clearInterval(timer) { clearedTimers.push(timer.id); },
  clearTimeout(timer) { clearedTimers.push(timer.id); },
};
sandbox.globalThis = sandbox;
vm.runInNewContext(`${whatsappHelpers}\nglobalThis.testApi = { getAmadeusVoiceReplyRegistry, startAmadeusVoiceReplyLease, closeAmadeusVoiceReplyLease, clearAmadeusVoiceReplyLeases, clearAmadeusVoiceReplyLeasesForChat };`, sandbox);
const sends = [];
const lease = sandbox.testApi.startAmadeusVoiceReplyLease({
  sessionKey: 'whatsapp:group:test',
  chatJid: 'group@g.us',
  messageId: 'voice-message',
  sendComposing: async () => sends.push('composing'),
});
assert.ok(lease);
assert.equal(sandbox.testApi.getAmadeusVoiceReplyRegistry().get('whatsapp:group:test'), lease);
await Promise.resolve();
assert.equal(sends.length, 1, 'composing starts immediately');
const interval = [...timerCallbacks.entries()].find(([, timer]) => timer.kind === 'interval');
assert.equal(interval[1].delay, 3000, 'composing refresh cadence is 3 seconds');
await interval[1].callback();
await Promise.resolve();
assert.equal(sends.length, 2, 'composing refreshes during TTS and send');
const timeout = [...timerCallbacks.entries()].find(([, timer]) => timer.kind === 'timeout');
assert.equal(timeout[1].delay, 120000, 'lease has a hard 120 second cap');
sandbox.testApi.closeAmadeusVoiceReplyLease(lease, 'settled');
assert.equal(sandbox.testApi.getAmadeusVoiceReplyRegistry().has('whatsapp:group:test'), false, 'settlement releases queue lock');
assert.ok(clearedTimers.length >= 2, 'settlement clears both timers');
await lease.settled;

const timedLease = sandbox.testApi.startAmadeusVoiceReplyLease({
  sessionKey: 'whatsapp:direct:timeout',
  chatJid: '+15550000000@s.whatsapp.net',
  messageId: 'timeout-voice',
  sendComposing: async () => {},
});
const timeoutTimer = [...timerCallbacks.values()].filter((timer) => timer.kind === 'timeout').at(-1);
assert.equal(timeoutTimer.delay, 120000);
timeoutTimer.callback();
assert.equal(sandbox.testApi.getAmadeusVoiceReplyRegistry().has('whatsapp:direct:timeout'), false, 'hard cap releases a stuck voice run');
await timedLease.settled;

const presenceErrorLease = sandbox.testApi.startAmadeusVoiceReplyLease({
  sessionKey: 'whatsapp:group:presence-error',
  chatJid: 'presence-error@g.us',
  messageId: 'presence-error-voice',
  sendComposing: async () => {},
});
const unrelatedLease = sandbox.testApi.startAmadeusVoiceReplyLease({
  sessionKey: 'whatsapp:group:unrelated',
  chatJid: 'unrelated@g.us',
  messageId: 'unrelated-voice',
  sendComposing: async () => {},
});
sandbox.testApi.clearAmadeusVoiceReplyLeasesForChat('presence-error@g.us');
assert.equal(sandbox.testApi.getAmadeusVoiceReplyRegistry().has('whatsapp:group:presence-error'), false, 'presence failure clears only that chat voice lease');
assert.equal(sandbox.testApi.getAmadeusVoiceReplyRegistry().get('whatsapp:group:unrelated'), unrelatedLease, 'presence failure does not clear another session');
await presenceErrorLease.settled;
sandbox.testApi.closeAmadeusVoiceReplyLease(unrelatedLease, 'test-cleanup');
await unrelatedLease.settled;

const disconnectedLease = sandbox.testApi.startAmadeusVoiceReplyLease({
  sessionKey: 'whatsapp:group:disconnect',
  chatJid: 'another-group@g.us',
  messageId: 'disconnect-voice',
  sendComposing: async () => {},
});
sandbox.testApi.clearAmadeusVoiceReplyLeases();
assert.equal(sandbox.testApi.getAmadeusVoiceReplyRegistry().size, 0, 'WhatsApp disconnect clears all voice leases');
await disconnectedLease.settled;

const root = await mkdtemp(join(tmpdir(), 'amadeus-voice-lifecycle-'));
try {
  const corePath = join(root, 'patched-core.mjs');
  const whatsappPath = join(root, 'patched-whatsapp.mjs');
  await writeFile(corePath, patchedCore);
  await writeFile(whatsappPath, patchedWhatsApp);
  for (const path of [corePath, whatsappPath]) {
    const check = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    assert.equal(check.status, 0, `${path} syntax: ${check.stderr || check.stdout}`);
  }

  let settleInbound;
  let rejectInbound;
  const pendingSandbox = {
    Map,
    Promise,
    setInterval: sandbox.setInterval,
    setTimeout: sandbox.setTimeout,
    clearInterval: sandbox.clearInterval,
    clearTimeout: sandbox.clearTimeout,
    globalThis: null,
    runChannelInboundEvent: () => new Promise((resolve, reject) => { settleInbound = resolve; rejectInbound = reject; }),
    finalizeReply: () => true,
  };
  pendingSandbox.globalThis = pendingSandbox;
  vm.runInNewContext(`${patchedWhatsApp}\nglobalThis.testApi = { getAmadeusVoiceReplyRegistry, startAmadeusVoiceReplyLease, closeAmadeusVoiceReplyLeaseForTurn };`, pendingSandbox);
  const finalSendLease = pendingSandbox.testApi.startAmadeusVoiceReplyLease({
    sessionKey: 'whatsapp:group:final-sends',
    chatJid: 'final-sends@g.us',
    messageId: 'voice-with-summary',
    sendComposing: async () => {},
  });
  const fullTurn = pendingSandbox.processMessage({
    route: { sessionKey: 'whatsapp:group:final-sends' },
    msg: { event: { id: 'voice-with-summary' } },
  });
  await Promise.resolve();
  const delivered = [];
  delivered.push('japanese-ptt');
  assert.equal(pendingSandbox.testApi.getAmadeusVoiceReplyRegistry().has('whatsapp:group:final-sends'), true, 'lease remains through PTT delivery');
  delivered.push('chinese-summary');
  assert.equal(pendingSandbox.testApi.getAmadeusVoiceReplyRegistry().has('whatsapp:group:final-sends'), true, 'lease remains through Chinese summary delivery');
  settleInbound({ dispatched: false });
  await fullTurn;
  assert.deepEqual(delivered, ['japanese-ptt', 'chinese-summary']);
  assert.equal(pendingSandbox.testApi.getAmadeusVoiceReplyRegistry().has('whatsapp:group:final-sends'), false, 'successful full-turn settlement releases the queue lock');
  await finalSendLease.settled;

  const failedLease = pendingSandbox.testApi.startAmadeusVoiceReplyLease({
    sessionKey: 'whatsapp:direct:failure',
    chatJid: '+15550000001@s.whatsapp.net',
    messageId: 'failed-voice',
    sendComposing: async () => {},
  });
  const failedTurn = pendingSandbox.processMessage({
    route: { sessionKey: 'whatsapp:direct:failure' },
    msg: { event: { id: 'failed-voice' } },
  });
  await Promise.resolve();
  rejectInbound(new Error('fixture send canceled/failed'));
  await assert.rejects(failedTurn, /fixture send canceled\/failed/);
  assert.equal(pendingSandbox.testApi.getAmadeusVoiceReplyRegistry().has('whatsapp:direct:failure'), false, 'failed or canceled full turns release the queue lock');
  await failedLease.settled;
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('OPENCLAW_VOICE_LIFECYCLE_PATCH=passed');
