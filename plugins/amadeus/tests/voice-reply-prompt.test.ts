import test from 'node:test';
import assert from 'node:assert/strict';
import { hasActiveWhatsAppVoiceLease, WHATSAPP_VOICE_RUNS_GLOBAL, registerVoiceReplyPrompt } from '../src/voice-reply-prompt.js';
import {
  classifyTypedReplyModality,
  clearReplyModalityForTurn,
  getReplyModalityForTurn,
  REPLY_MODALITY_RUNS_GLOBAL,
  setReplyModalityForTurn,
} from '../src/reply-modality.js';

test('typed voice intent is semantic and turn scoped', () => {
  assert.equal(classifyTypedReplyModality('用语音回答我'), 'voice');
  assert.equal(classifyTypedReplyModality('今天纳指怎么样，用语音告诉我'), 'voice');
  assert.equal(classifyTypedReplyModality('发语音告诉我今天西安天气'), 'voice');
  assert.equal(classifyTypedReplyModality('你的语音怎么实现的？'), 'default');
  assert.equal(classifyTypedReplyModality('把你好翻译成中文和日文'), 'default');
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

test('typed voice prompt injects the existing voice-reply Skill without creating an inbound lease', () => {
  const hooks = new Map<string, Array<(...args: any[]) => unknown>>();
  const api = {
    rootDir: new URL('../', import.meta.url).pathname,
    on(name: string, handler: (...args: any[]) => unknown) { hooks.set(name, [...(hooks.get(name) ?? []), handler]); },
  } as never;
  registerVoiceReplyPrompt(api);
  const beforePrompt = hooks.get('before_prompt_build')?.[0];
  const context = { channel: 'whatsapp', runId: 'typed-voice', sessionKey: 'typed-session' };
  const voice = beforePrompt?.({ prompt: '用语音回答我', messages: [] }, context) as { appendSystemContext?: string };
  assert.match(voice?.appendSystemContext ?? '', /replyModality=voice/u);
  assert.match(voice?.appendSystemContext ?? '', /\[\[tts:text\]\]/u);
  assert.equal(hasActiveWhatsAppVoiceLease('whatsapp', 'typed-session'), false);
  const ordinary = beforePrompt?.({ prompt: '把你好翻译成中文和日文', messages: [] }, context);
  assert.equal(ordinary, undefined, 'translation remains the default text modality');
  hooks.get('agent_end')?.[0]?.({}, context);
  assert.equal(getReplyModalityForTurn(context), 'default', 'agent_end clears the turn state');
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
