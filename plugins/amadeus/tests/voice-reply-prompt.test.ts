import test from 'node:test';
import assert from 'node:assert/strict';
import { hasActiveWhatsAppVoiceLease, REPLY_ENVELOPE_RESOLVER_GLOBAL, WHATSAPP_VOICE_RUNS_GLOBAL, registerVoiceReplyPrompt } from '../src/voice-reply-prompt.js';
import { createReplyDeliveryContext, deliverReplyEnvelope } from '../src/reply-delivery.js';
import { createSilentEnvelope, createTextEnvelope, createVoiceEnvelope, validateReplyEnvelope } from '../src/reply-envelope.js';
import { planTypedReply, resolveReplyEnvelope } from '../src/reply-planner.js';

const context = { runId: 'run-1', deliveryId: 'delivery-1', sessionKey: 'session-1', channel: 'whatsapp', origin: 'external_user' as const };

test('text envelope does not invoke TTS', async () => {
  const envelope = createTextEnvelope(context, '普通文字');
  const calls: string[] = [];
  const result = await deliverReplyEnvelope(envelope, {
    sendText: async (text) => { calls.push(`text:${text}`); },
    synthesize: async () => { calls.push('tts'); return { audio: 'audio' }; },
    sendVoice: async () => { calls.push('voice'); },
  });
  assert.deepEqual(calls, ['text:普通文字']);
  assert.equal(result.final_status, 'text_sent');
});

test('voice envelope only uses speechText and sends one voice plus visible text', async () => {
  const envelope = createVoiceEnvelope(context, '中文：结论。\n\n日本語：結論です。', '結論です。', 'soft');
  const calls: string[] = [];
  const result = await deliverReplyEnvelope(envelope, {
    sendText: async (text) => { calls.push(`text:${text}`); },
    synthesize: async ({ text, emotion }) => { calls.push(`tts:${text}:${emotion}`); return { audio: 'audio', provider: 'test', attempt: 1 }; },
    sendVoice: async () => { calls.push('voice'); },
  });
  assert.deepEqual(calls, ['tts:結論です。:soft', 'voice', 'text:中文：结论。\n\n日本語：結論です。']);
  assert.equal(result.final_status, 'voice_sent');
});

test('silent envelope performs no send and is settled', async () => {
  const envelope = createSilentEnvelope({ ...context, origin: 'heartbeat' });
  const calls: string[] = [];
  const delivery = createReplyDeliveryContext();
  const result = await deliverReplyEnvelope(envelope, {
    sendText: async () => { calls.push('text'); },
    synthesize: async () => { calls.push('tts'); return { audio: 'audio' }; },
    sendVoice: async () => { calls.push('voice'); },
  }, delivery);
  assert.deepEqual(calls, []);
  assert.equal(result.final_status, 'silent');
  assert.equal(delivery.live.size, 0);
  assert.equal(delivery.settled.has(envelope.deliveryId), true);
});

test('inbound voice always resolves to voice and planner failure never enters marker fallback', () => {
  const envelope = resolveReplyEnvelope({ ...context, runId: 'voice-1', deliveryId: 'voice-1:voice', origin: 'inbound_voice' }, {
    visibleText: '中文：收到。\n\n日本語：了解したわ。', speechText: '了解したわ。', modality: 'text', emotion: 'default',
  }, null);
  assert.equal(envelope.modality, 'voice');
  assert.equal(envelope.source, 'inbound_voice_policy');
  const failed = resolveReplyEnvelope(context, '{bad json}', '{bad json}');
  assert.equal(failed.modality, 'text');
  assert.equal(failed.fallbackReason, 'planner_invalid');
});

test('typed planner is strict and invalid plans default to text', () => {
  assert.deepEqual(planTypedReply('{"modality":"voice","answer_plan":"answer_with_voice","emotion":"soft"}'), { modality: 'voice', answer_plan: 'answer_with_voice', emotion: 'soft' });
  assert.deepEqual(planTypedReply('{"modality":"voice","answer_plan":"answer_with_voice","unknown":true}'), { modality: 'text', answer_plan: 'answer_with_text' });
});

test('internal control tokens never leak into visible or spoken reply text', () => {
  const legacyControlToken = '[[amadeus:reply-modality=voice]]';
  const legacyText = `${legacyControlToken} 中文：收到。\n\n日本語：了解したわ。`;
  const textEnvelope = resolveReplyEnvelope(context, legacyText, { modality: 'text', answer_plan: 'answer_with_text' });
  assert.equal(textEnvelope.visibleText, '中文：收到。\n\n日本語：了解したわ。');
  assert.doesNotMatch(textEnvelope.visibleText, /\[\[/u);

  const voiceEnvelope = resolveReplyEnvelope(context, JSON.stringify({
    visibleText: legacyText,
    speechText: `${legacyControlToken}了解したわ。`,
    modality: 'voice',
    emotion: 'default',
  }), { modality: 'voice', answer_plan: 'answer_with_voice' });
  assert.equal(voiceEnvelope.visibleText, '中文：收到。\n\n日本語：了解したわ。');
  assert.equal(voiceEnvelope.speechText, '了解したわ。');
  assert.doesNotMatch(voiceEnvelope.speechText ?? '', /\[\[/u);
});

test('concurrent envelopes are isolated by run and duplicate delivery is suppressed', async () => {
  const delivery = createReplyDeliveryContext();
  const first = createTextEnvelope({ ...context, runId: 'one', deliveryId: 'one:text' }, '一');
  const second = createTextEnvelope({ ...context, runId: 'two', deliveryId: 'two:text' }, '二');
  const sent: string[] = [];
  const adapters = { sendText: async (text: string) => { sent.push(text); }, synthesize: async () => ({ audio: 'a' }), sendVoice: async () => {} };
  await Promise.all([deliverReplyEnvelope(first, adapters, delivery), deliverReplyEnvelope(second, adapters, delivery)]);
  await deliverReplyEnvelope(first, adapters, delivery);
  assert.deepEqual(sent, ['一', '二']);
});

test('concurrent delivery calls with one deliveryId send only once', async () => {
  const delivery = createReplyDeliveryContext();
  const envelope = createVoiceEnvelope({ ...context, runId: 'same', deliveryId: 'same:voice' }, '中文：同一条。', '同じ一件です。');
  const sent: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const adapters = {
    sendText: async (text: string) => { sent.push(`text:${text}`); },
    synthesize: async () => { await gate; return { audio: 'audio' }; },
    sendVoice: async () => { sent.push('voice'); },
  };
  const first = deliverReplyEnvelope(envelope, adapters, delivery);
  const second = deliverReplyEnvelope(envelope, adapters, delivery);
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.final_status, 'voice_sent');
  assert.equal(secondResult.final_status, 'duplicate');
  assert.deepEqual(sent, ['voice', 'text:中文：同一条。']);
});

test('voice lease is independent from ReplyEnvelope state', () => {
  const globals = globalThis as Record<string, unknown>;
  const previous = globals[WHATSAPP_VOICE_RUNS_GLOBAL];
  try {
    globals[WHATSAPP_VOICE_RUNS_GLOBAL] = new Map([['voice-session', { sessionKey: 'voice-session', messageId: 'voice-message', closed: false }]]);
    assert.equal(hasActiveWhatsAppVoiceLease('whatsapp', 'voice-session'), true);
    assert.equal(hasActiveWhatsAppVoiceLease('telegram', 'voice-session'), false);
  } finally {
    if (previous === undefined) delete globals[WHATSAPP_VOICE_RUNS_GLOBAL];
    else globals[WHATSAPP_VOICE_RUNS_GLOBAL] = previous;
  }
});

test('plugin prompt injects structured output contract and never a text control protocol', () => {
  const hooks = new Map<string, Array<(...args: any[]) => unknown>>();
  const api = {
    rootDir: new URL('../', import.meta.url).pathname,
    on(name: string, handler: (...args: any[]) => unknown) { hooks.set(name, [...(hooks.get(name) ?? []), handler]); },
  } as never;
  registerVoiceReplyPrompt(api);
  const before = hooks.get('before_prompt_build')?.[0];
  const prompt = before?.({ prompt: '用语音回答', messages: [] }, { channel: 'whatsapp', runId: 'typed', sessionKey: 'typed', inputProvenance: { kind: 'external_user' } });
  const text = String((prompt as { appendSystemContext?: string })?.appendSystemContext ?? '');
  assert.match(text, /strict JSON object/u);
  assert.match(text, /visibleText/u);
  assert.doesNotMatch(text, /\[\[|legacy/iu);
  const delivery = hooks.get('reply_payload_sending')?.[0];
  const result = delivery?.({ runId: 'typed', sessionKey: 'typed', channel: 'whatsapp', kind: 'final', payload: { amadeusEnvelope: { visibleText: '普通文字', modality: 'text', emotion: 'default' } } }, {});
  assert.equal((result as { payload?: { text?: string } }).payload?.text, '普通文字');
});

test('structured payloads without a run id still normalize at the final boundary', () => {
  const hooks = new Map<string, Array<(...args: any[]) => unknown>>();
  const api = {
    rootDir: new URL('../', import.meta.url).pathname,
    on(name: string, handler: (...args: any[]) => unknown) { hooks.set(name, [...(hooks.get(name) ?? []), handler]); },
  } as never;
  registerVoiceReplyPrompt(api);
  const delivery = hooks.get('reply_payload_sending')?.[0];
  const result = delivery?.({
    sessionKey: 'agent:main:whatsapp:group:test',
    channel: 'whatsapp',
    kind: 'final',
    payload: { text: JSON.stringify({ visibleText: '中文：群聊可见文本。\n\n日本語：グループの返答です。', speechText: 'グループの返答です。', modality: 'voice', emotion: 'soft' }) },
  }, {});
  const payload = (result as { payload?: { text?: string; amadeusEnvelope?: { modality?: string; speechText?: string } } }).payload;
  assert.equal(payload?.text, '中文：群聊可见文本。\n\n日本語：グループの返答です。');
  assert.equal(payload?.amadeusEnvelope?.modality, 'voice');
  assert.equal(payload?.amadeusEnvelope?.speechText, 'グループの返答です。');
});

test('run origin reaches the same resolver and suppresses internal delivery', () => {
  const hooks = new Map<string, Array<(...args: any[]) => unknown>>();
  const runValues = new Map<string, unknown>();
  const api = {
    rootDir: new URL('../', import.meta.url).pathname,
    runContext: {
      setRunContext({ runId, value }: { runId: string; value: unknown }) { runValues.set(runId, value); return true; },
      getRunContext({ runId }: { runId: string }) { return runValues.get(runId); },
    },
    on(name: string, handler: (...args: any[]) => unknown) { hooks.set(name, [...(hooks.get(name) ?? []), handler]); },
  } as never;
  registerVoiceReplyPrompt(api);
  hooks.get('before_prompt_build')?.[0]?.({ prompt: 'heartbeat', messages: [] }, {
    channel: 'whatsapp', runId: 'heartbeat-run', sessionKey: 'heartbeat-session', trigger: 'heartbeat',
  });
  const resolver = (globalThis as Record<string, unknown>)[REPLY_ENVELOPE_RESOLVER_GLOBAL] as (input: unknown) => { origin: string; silent: boolean };
  const envelope = resolver({ runId: 'heartbeat-run', sessionKey: 'heartbeat-session', channel: 'whatsapp', kind: 'final', payload: { text: '内部结果' } });
  assert.equal(envelope.origin, 'heartbeat');
  assert.equal(envelope.silent, true);
  const result = hooks.get('reply_payload_sending')?.[0]?.({
    runId: 'heartbeat-run', sessionKey: 'heartbeat-session', channel: 'whatsapp', kind: 'final', payload: { text: '内部结果' },
  }, {});
  assert.equal((result as { cancel?: boolean }).cancel, true);
});

test('cron, handoff, and system runs resolve to silent without typed voice prompting', () => {
  const hooks = new Map<string, Array<(...args: any[]) => unknown>>();
  const runValues = new Map<string, unknown>();
  const api = {
    rootDir: new URL('../', import.meta.url).pathname,
    runContext: {
      setRunContext({ runId, value }: { runId: string; value: unknown }) { runValues.set(runId, value); return true; },
      getRunContext({ runId }: { runId: string }) { return runValues.get(runId); },
    },
    on(name: string, handler: (...args: any[]) => unknown) { hooks.set(name, [...(hooks.get(name) ?? []), handler]); },
  } as never;
  registerVoiceReplyPrompt(api);
  const before = hooks.get('before_prompt_build')?.[0];
  const resolver = (globalThis as Record<string, unknown>)[REPLY_ENVELOPE_RESOLVER_GLOBAL] as (input: unknown) => { origin: string; silent: boolean };
  for (const [runId, context, expectedOrigin] of [
    ['cron-run', { inputProvenance: { kind: 'cron' } }, 'cron'],
    ['handoff-run', { inputProvenance: { kind: 'inter_session' } }, 'internal_handoff'],
    ['system-run', { inputProvenance: { kind: 'internal_system' } }, 'system'],
  ] as const) {
    const prompt = before?.({ prompt: 'internal', messages: [] }, { channel: 'whatsapp', runId, sessionKey: `${runId}-session`, ...context });
    assert.equal(prompt, undefined);
    const envelope = resolver({ runId, sessionKey: `${runId}-session`, channel: 'whatsapp', kind: 'final', payload: { text: 'internal result' } });
    assert.equal(envelope.origin, expectedOrigin);
    assert.equal(envelope.silent, true);
  }
});

test('envelope validator rejects silent content and invalid voice speech', () => {
  assert.equal(validateReplyEnvelope(createSilentEnvelope({ ...context, origin: 'system' })), true);
  assert.throws(() => createVoiceEnvelope(context, 'visible', '中文')); // speech must be Japanese
});
