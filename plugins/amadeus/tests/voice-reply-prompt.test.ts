import test from 'node:test';
import assert from 'node:assert/strict';
import { hasActiveWhatsAppVoiceLease, WHATSAPP_VOICE_RUNS_GLOBAL, registerVoiceReplyPrompt } from '../src/voice-reply-prompt.js';
import {
  clearReplyModalityForTurn,
  getReplyModalityForTurn,
  parseReplyModalityMarker,
  REPLY_MODALITY_RUNS_GLOBAL,
  setReplyModalityForTurn,
} from '../src/reply-modality.js';

test('same-turn model metadata carries semantic voice/default decisions without text classification', () => {
  const cases = [
    ['用语音回答我', 'voice'],
    ['今天纳指怎么样，用语音告诉我', 'voice'],
    ['你的语音怎么实现的？', 'default'],
    ['把你好翻译成中文和日文', 'default'],
  ] as const;
  for (const [request, modality] of cases) {
    // The request is interpreted by the Agent. This fixture represents that
    // model decision and verifies only the transport metadata parser.
    const parsed = parseReplyModalityMarker(`[[amadeus:reply-modality=${modality}]]\n${request}`);
    assert.equal(parsed.present, true, request);
  assert.equal(parsed.modality, modality, request);
  assert.equal(parsed.text, request, 'control metadata is stripped before delivery');
  }
  const leakedLine = parseReplyModalityMarker(`回答内容\n[[amadeus:reply-modality=default]]\n补充内容`);
  assert.equal(leakedLine.modality, 'default');
  assert.equal(leakedLine.text, '回答内容\n\n补充内容', 'metadata is stripped even when the model places it mid-payload');
  const ordinary = parseReplyModalityMarker('中文：你好。\n\n日本語：こんにちは。');
  assert.equal(ordinary.present, false, 'a bilingual translation without model voice metadata is not TTS input');
  assert.equal(ordinary.modality, 'default');
});

test('replyModality is initialized per turn and cleared after completion', () => {
  const context = { runId: 'voice-run', sessionKey: 'same-session' };
  const globals = globalThis as Record<string, unknown>;
  const previous = globals[REPLY_MODALITY_RUNS_GLOBAL];
  try {
    clearReplyModalityForTurn(context);
    assert.equal(getReplyModalityForTurn(context), 'default');
    setReplyModalityForTurn(context, 'voice');
    assert.equal(getReplyModalityForTurn(context), 'voice');
    clearReplyModalityForTurn(context);
    assert.equal(getReplyModalityForTurn(context), 'default');
  } finally {
    if (previous === undefined) delete globals[REPLY_MODALITY_RUNS_GLOBAL];
    else globals[REPLY_MODALITY_RUNS_GLOBAL] = previous;
  }
});

test('concurrent turns in one WhatsApp session keep modality state isolated by run id', () => {
  const first = { runId: 'voice-one', sessionKey: 'same-session' };
  const second = { runId: 'voice-two', sessionKey: 'same-session' };
  const globals = globalThis as Record<string, unknown>;
  const previous = globals[REPLY_MODALITY_RUNS_GLOBAL];
  try {
    clearReplyModalityForTurn(first);
    clearReplyModalityForTurn(second);
    setReplyModalityForTurn(first, 'voice');
    setReplyModalityForTurn(second, 'default');
    assert.equal(getReplyModalityForTurn(first), 'voice');
    assert.equal(getReplyModalityForTurn(second), 'default');
    clearReplyModalityForTurn(first);
    assert.equal(getReplyModalityForTurn(first), 'default');
    assert.equal(getReplyModalityForTurn(second), 'default', 'ending one run must not clear its sibling');
  } finally {
    if (previous === undefined) delete globals[REPLY_MODALITY_RUNS_GLOBAL];
    else globals[REPLY_MODALITY_RUNS_GLOBAL] = previous;
  }
});

test('typed WhatsApp prompt delegates modality to the model and provisions the sole voice-reply Skill', () => {
  const hooks = new Map<string, Array<(...args: any[]) => unknown>>();
  const api = {
    rootDir: new URL('../', import.meta.url).pathname,
    on(name: string, handler: (...args: any[]) => unknown) { hooks.set(name, [...(hooks.get(name) ?? []), handler]); },
  } as never;
  registerVoiceReplyPrompt(api);
  const beforePrompt = hooks.get('before_prompt_build')?.[0];
  const context = {
    channel: 'whatsapp',
    runId: 'typed-run',
    sessionKey: 'typed-session',
    inputProvenance: { kind: 'external_user' },
  };
  const prompt = beforePrompt?.({ prompt: '今天纳指怎么样，用语音告诉我', messages: [] }, context) as { appendSystemContext?: string };
  assert.match(prompt?.appendSystemContext ?? '', /turn-scoped replyModality to default/u);
  assert.match(prompt?.appendSystemContext ?? '', /semantically classify the user's requested reply modality/u);
  assert.match(prompt?.appendSystemContext ?? '', /Do not classify by matching fixed trigger words/u);
  assert.match(prompt?.appendSystemContext ?? '', /\[\[amadeus:reply-modality=voice\]\]/u);
  assert.match(prompt?.appendSystemContext ?? '', /\[\[amadeus:reply-modality=default\]\]/u);
  assert.match(prompt?.appendSystemContext ?? '', /\[\[tts:text\]\]/u);
  assert.equal(getReplyModalityForTurn(context), 'default', 'typed turn starts fail-closed');
  assert.equal(hasActiveWhatsAppVoiceLease('whatsapp', 'typed-session'), false);
  hooks.get('agent_end')?.[0]?.({}, context);
  assert.equal(getReplyModalityForTurn(context), 'default', 'agent_end clears the turn state');
  const delivery = hooks.get('reply_payload_sending')?.[0];
  const cleaned = delivery?.({
    payload: { text: '[[amadeus:reply-modality=default]]\n群聊里的普通文字。' },
  }, context) as { payload?: { text?: string } } | undefined;
  assert.equal(cleaned?.payload?.text, '群聊里的普通文字。', 'final plugin delivery hook strips modality markers');
  const noReply = delivery?.({
    payload: { text: '[[amadeus:reply-modality=default]]\nNO_REPLY' },
  }, context) as { payload?: { text?: string } } | undefined;
  assert.equal(noReply?.payload, undefined, 'marked NO_REPLY remains silent');
});

test('heartbeat and internal WhatsApp turns do not receive typed reply modality metadata', () => {
  const hooks = new Map<string, Array<(...args: any[]) => unknown>>();
  const api = {
    rootDir: new URL('../', import.meta.url).pathname,
    on(name: string, handler: (...args: any[]) => unknown) { hooks.set(name, [...(hooks.get(name) ?? []), handler]); },
  } as never;
  registerVoiceReplyPrompt(api);
  const beforePrompt = hooks.get('before_prompt_build')?.[0];
  const context = {
    channel: 'whatsapp',
    trigger: 'user',
    runId: 'heartbeat-run',
    sessionKey: 'heartbeat-session',
    inputProvenance: { kind: 'internal_system', sourceTool: 'heartbeat' },
  };
  const prompt = beforePrompt?.({ prompt: '[OpenClaw heartbeat poll]', messages: [] }, context);
  assert.equal(prompt, undefined);
  assert.equal(getReplyModalityForTurn(context), 'default');
});

test('voice-reply Skill follows the verified WhatsApp audio lease, not message_received opt-in', () => {
  const globals = globalThis as Record<string, unknown>;
  const previous = globals[WHATSAPP_VOICE_RUNS_GLOBAL];
  const lease = { sessionKey: 'voice-session', messageId: 'voice-message', closed: false };
  try {
    globals[WHATSAPP_VOICE_RUNS_GLOBAL] = new Map([['voice-session', lease]]);
    assert.equal(hasActiveWhatsAppVoiceLease('whatsapp', 'voice-session'), true);
    assert.equal(hasActiveWhatsAppVoiceLease('WhatsApp', 'voice-session'), true);
    assert.equal(hasActiveWhatsAppVoiceLease('whatsapp', 'typed-session'), false);
    assert.equal(hasActiveWhatsAppVoiceLease('telegram', 'voice-session'), false);
    lease.closed = true;
    assert.equal(hasActiveWhatsAppVoiceLease('whatsapp', 'voice-session'), false);
    lease.closed = false;
    (globals[WHATSAPP_VOICE_RUNS_GLOBAL] as Map<string, unknown>).delete('voice-session');
    assert.equal(hasActiveWhatsAppVoiceLease('whatsapp', 'voice-session'), false);
  } finally {
    if (previous === undefined) delete globals[WHATSAPP_VOICE_RUNS_GLOBAL];
    else globals[WHATSAPP_VOICE_RUNS_GLOBAL] = previous;
  }
});
