import { strict as assert } from 'node:assert';
import test from 'node:test';
import { openClawConversationAdapter } from '../src/adapters/openclaw.js';

test('normalizes Telegram and WhatsApp through the same OpenClaw adapter', () => {
  const telegram = openClawConversationAdapter.adapt({
    sessionId: 'telegram-turn',
    sessionKey: 'agent:main:telegram:default:chat-1',
    messageChannel: 'telegram',
    deliveryContext: { channel: 'telegram', accountId: 'default', to: 'chat-1' },
    nativeChannelId: 'chat-1',
    requesterSenderId: 'user-1',
  });
  const whatsapp = openClawConversationAdapter.adapt({
    sessionId: 'whatsapp-turn',
    sessionKey: 'agent:main:whatsapp:default:group-1',
    messageChannel: 'whatsapp',
    deliveryContext: { channel: 'whatsapp', accountId: 'default', to: 'group-1@g.us' },
    nativeChannelId: 'group-1@g.us',
    requesterSenderId: 'user-2',
  });

  assert.equal(telegram.channel, 'telegram');
  assert.equal(telegram.conversationId, 'chat-1');
  assert.equal(telegram.senderId, 'user-1');
  assert.equal(whatsapp.channel, 'whatsapp');
  assert.equal(whatsapp.conversationId, 'group-1@g.us');
  assert.equal(whatsapp.senderId, 'user-2');
  assert.notEqual(telegram.sessionId, whatsapp.sessionId);
});

test('keeps OpenClaw reset/session precedence and has a safe fallback', () => {
  assert.equal(
    openClawConversationAdapter.adapt({
      sessionId: 'ephemeral-session',
      sessionKey: 'stable-session',
      messageChannel: 'WhatsApp',
    }, 'tool-input-session').sessionId,
    'ephemeral-session',
  );
  assert.equal(
    openClawConversationAdapter.adapt({
      messageChannel: 'future-channel',
    }, 'tool-input-session').sessionId,
    'tool-input-session',
  );
});
