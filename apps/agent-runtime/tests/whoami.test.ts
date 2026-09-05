import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryContextStore } from '../src/context/context-store.js';
import { identityMappingsFromEnvironment } from '../src/config/identity.js';
import type { DataProvider } from '../src/data/provider.js';
import { IdentityRegistry } from '../src/platform/core/identity.js';
import { KookAdapter } from '../src/platform/kook/adapter.js';
import { TelegramAdapter } from '../src/platform/telegram/adapter.js';
import { buildWhoAmIPresentation, isWhoAmICommand, resolveWhoAmI } from '../src/platform/core/whoami.js';
import { PubgMastraRuntime } from '../src/runtime/workflow.js';

function telegramMessage(userId: number, chatId: number, chatType: 'private' | 'group', displayName: string) {
  return new TelegramAdapter().normalize({
    update_id: 1,
    message: {
      message_id: 1,
      date: 1_788_326_400,
      text: '/whoami',
      from: { id: userId, first_name: displayName },
      chat: {
        id: chatId,
        type: chatType,
        ...(chatType === 'group' ? { title: 'HomeHub' } : {}),
      },
    },
  });
}

function kookMessage(userId: string, chatId: string, channelType: 'PERSON' | 'GROUP', displayName: string) {
  return new KookAdapter().normalize({
    channel_type: channelType,
    target_id: chatId,
    author_id: userId,
    sender_name: displayName,
    msg_id: `message-${userId}`,
    content: '/whoami',
    timestamp: '2026-09-05T00:00:00.000Z',
  });
}

class CountingContextStore extends InMemoryContextStore {
  getContextCalls = 0;
  setContextCalls = 0;
  getResultSetCalls = 0;
  setResultSetCalls = 0;

  override async getContext(id: string) {
    this.getContextCalls += 1;
    return super.getContext(id);
  }

  override async setContext(value: Parameters<InMemoryContextStore['setContext']>[0]) {
    this.setContextCalls += 1;
    return super.setContext(value);
  }

  override async getResultSet(session: string, id: string) {
    this.getResultSetCalls += 1;
    return super.getResultSet(session, id);
  }

  override async setResultSet(value: Parameters<InMemoryContextStore['setResultSet']>[0]) {
    this.setResultSetCalls += 1;
    return super.setResultSet(value);
  }
}

const provider: DataProvider = {
  async ensureData() {
    throw new Error('the /whoami path must not call the data provider');
  },
};

test('/whoami command matching accepts the command and Telegram bot suffix only', () => {
  assert.equal(isWhoAmICommand('/whoami'), true);
  assert.equal(isWhoAmICommand('/whoami@homehub_bot'), true);
  assert.equal(isWhoAmICommand(' /whoami '), true);
  assert.equal(isWhoAmICommand('/whoami guess'), false);
  assert.equal(isWhoAmICommand('whoami'), false);
});

test('Telegram private /whoami uses the real sender ID and explicit unbound values', () => {
  const message = telegramMessage(123456789, 123456789, 'private', 'Arthur');
  const info = resolveWhoAmI(message);

  assert.deepEqual(info, {
    platform: 'telegram',
    platformUserId: '123456789',
    chatId: '123456789',
    chatType: 'private',
    displayName: 'Arthur',
    internalUser: 'unbound',
    role: 'unbound',
  });
  assert.match(buildWhoAmIPresentation(message).fallbackText, /platformUserId: 123456789/u);
});

test('Telegram group /whoami keeps chat ID separate from the real sender ID', () => {
  const message = telegramMessage(123456789, -100123456789, 'group', 'Arthur');
  const info = resolveWhoAmI(message);

  assert.equal(info.platform, 'telegram');
  assert.equal(info.platformUserId, '123456789');
  assert.equal(info.chatId, '-100123456789');
  assert.equal(info.chatType, 'group');
  assert.notEqual(info.platformUserId, info.chatId);
});

test('KOOK private and channel /whoami are both normalized without using names as identity', () => {
  const privateMessage = kookMessage('kook-user-private', 'kook-user-private', 'PERSON', 'Arthur');
  const channelMessage = kookMessage('kook-user-channel', 'kook-channel', 'GROUP', 'Arthur');

  assert.deepEqual(resolveWhoAmI(privateMessage), {
    platform: 'kook',
    platformUserId: 'kook-user-private',
    chatId: 'kook-user-private',
    chatType: 'private',
    displayName: 'Arthur',
    internalUser: 'unbound',
    role: 'unbound',
  });
  assert.deepEqual(resolveWhoAmI(channelMessage), {
    platform: 'kook',
    platformUserId: 'kook-user-channel',
    chatId: 'kook-channel',
    chatType: 'group',
    displayName: 'Arthur',
    internalUser: 'unbound',
    role: 'unbound',
  });
});

test('same display name with different platform IDs never shares an identity mapping', () => {
  const registry = new IdentityRegistry([{
    internalUserId: 'arthur-internal',
    roles: ['ADMIN'],
    identities: { telegram: ['1001'] },
  }]);
  const bound = telegramMessage(1001, -100, 'group', 'Arthur');
  const unbound = telegramMessage(1002, -100, 'group', 'Arthur');

  assert.deepEqual(resolveWhoAmI(bound, registry), {
    platform: 'telegram',
    platformUserId: '1001',
    chatId: '-100',
    chatType: 'group',
    displayName: 'Arthur',
    internalUser: 'arthur-internal',
    role: 'ADMIN',
  });
  assert.deepEqual(resolveWhoAmI(unbound, registry), {
    platform: 'telegram',
    platformUserId: '1002',
    chatId: '-100',
    chatType: 'group',
    displayName: 'Arthur',
    internalUser: 'unbound',
    role: 'unbound',
  });
});

test('startup environment maps both configured administrator platform IDs to arthur/ADMIN', () => {
  const mappings = identityMappingsFromEnvironment({
    TELEGRAM_ADMIN_USER_ID: 'telegram-admin-fixture',
    KOOK_ADMIN_USER_ID: 'kook-admin-fixture',
  });
  const registry = new IdentityRegistry(mappings);

  assert.deepEqual(mappings, [{
    internalUserId: 'arthur',
    roles: ['ADMIN'],
    identities: {
      telegram: ['telegram-admin-fixture'],
      kook: ['kook-admin-fixture'],
    },
  }]);
  assert.equal(resolveWhoAmI(telegramMessage(1, 1, 'private', 'Arthur'), registry).internalUser, 'unbound');
  assert.equal(resolveWhoAmI(telegramMessage(1, 1, 'private', 'Arthur'), new IdentityRegistry([
    ...mappings,
  ])).role, 'unbound');
  const mappedTelegram = telegramMessage(1, 1, 'private', 'Arthur');
  const mappedKook = kookMessage('kook-admin-fixture', 'kook-user', 'PERSON', 'Arthur');
  mappedTelegram.user.platformUserId = 'telegram-admin-fixture';
  assert.equal(resolveWhoAmI(mappedTelegram, registry).internalUser, 'arthur');
  assert.equal(resolveWhoAmI(mappedTelegram, registry).role, 'ADMIN');
  assert.equal(resolveWhoAmI(mappedKook, registry).internalUser, 'arthur');
  assert.equal(resolveWhoAmI(mappedKook, registry).role, 'ADMIN');
});

test('missing or placeholder admin IDs do not create an identity binding', () => {
  assert.deepEqual(identityMappingsFromEnvironment({
    TELEGRAM_ADMIN_USER_ID: '',
    KOOK_ADMIN_USER_ID: 'unknown',
  }), []);
});

test('/whoami does not read or write context or call the data provider', async () => {
  const contextStore = new CountingContextStore();
  const runtime = new PubgMastraRuntime({ provider, contextStore });
  const message = telegramMessage(9001, -9002, 'group', 'Read Only User');

  const response = await runtime.whoami({ text: '/whoami', message, queryId: 'whoami-test' });

  assert.equal(response.status, 'success');
  assert.equal(response.domain, 'homehub');
  assert.deepEqual(response.data, {
    platform: 'telegram',
    platformUserId: '9001',
    chatId: '-9002',
    chatType: 'group',
    displayName: 'Read Only User',
    internalUser: 'unbound',
    role: 'unbound',
  });
  assert.equal(response.presentation.metadata.readOnly, true);
  assert.equal(response.presentation.metadata.mutatesState, false);
  assert.equal(response.presentation.metadata.executesAction, false);
  assert.equal(response.presentation.metadata.callsDangerousTool, false);
  assert.equal(contextStore.getContextCalls, 0);
  assert.equal(contextStore.setContextCalls, 0);
  assert.equal(contextStore.getResultSetCalls, 0);
  assert.equal(contextStore.setResultSetCalls, 0);
  assert.match(response.response, /platformUserId: 9001/u);
});

test('missing platform IDs are rejected instead of replaced with a display name', () => {
  const message = telegramMessage(1, 1, 'private', 'Arthur');
  const invalid = { ...message, user: { ...message.user, platformUserId: 'unknown' } };
  assert.throws(() => resolveWhoAmI(invalid), /real platform user ID/u);
});
