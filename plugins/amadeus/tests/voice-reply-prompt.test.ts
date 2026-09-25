import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceReplyTurnTracker, VOICE_RUN_MAX, VOICE_RUN_TTL_MS } from '../src/voice-reply-prompt.js';

test('voice-reply Skill injection is scoped to exact WhatsApp audio run id', () => {
  const tracker = new VoiceReplyTurnTracker();
  assert.equal(tracker.record('whatsapp', 'voice-run', [{ contentType: 'audio/ogg; codecs=opus' }], 100), true);
  assert.equal(tracker.shouldInject('whatsapp', 'voice-run', 101), true);
  assert.equal(tracker.shouldInject('whatsapp', 'typed-run', 101), false);
  assert.equal(tracker.shouldInject('telegram', 'voice-run', 101), false);
});

test('voice-reply tracker recognizes audio kind and ignores text/image/unknown channels', () => {
  const tracker = new VoiceReplyTurnTracker();
  assert.equal(tracker.record('whatsapp', 'audio-kind', [{ kind: 'audio' }], 100), true);
  assert.equal(tracker.record('whatsapp', 'image', [{ contentType: 'image/jpeg' }], 100), false);
  assert.equal(tracker.record('whatsapp', 'text', [{ contentType: 'text/plain' }], 100), false);
  assert.equal(tracker.record('telegram', 'other-channel', [{ kind: 'audio' }], 100), false);
  assert.equal(tracker.record('whatsapp', undefined, [{ kind: 'audio' }], 100), false);
});

test('voice-reply run tracking has bounded retention', () => {
  const tracker = new VoiceReplyTurnTracker();
  tracker.record('whatsapp', 'expired', [{ kind: 'audio' }], 100);
  assert.equal(tracker.shouldInject('whatsapp', 'expired', 100 + VOICE_RUN_TTL_MS), false);
  for (let i = 0; i < VOICE_RUN_MAX + 12; i++) tracker.record('whatsapp', `run-${i}`, [{ kind: 'audio' }], 200);
  assert.equal(tracker.shouldInject('whatsapp', 'run-0', 201), false);
  assert.equal(tracker.shouldInject('whatsapp', `run-${VOICE_RUN_MAX + 11}`, 201), true);
});
