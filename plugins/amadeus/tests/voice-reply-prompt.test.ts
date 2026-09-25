import test from 'node:test';
import assert from 'node:assert/strict';
import { hasActiveWhatsAppVoiceLease, WHATSAPP_VOICE_RUNS_GLOBAL } from '../src/voice-reply-prompt.js';

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
