import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { DEFAULT_TEAM } from '../src/config/team.js';
import { getPlatformCapabilities } from '../src/platform/core/capabilities.js';
import { InMemoryContextStore } from '../src/context/context-store.js';
import { FixtureDataProvider } from '../src/data/provider.js';
import { buildPresentation } from '../src/renderers/renderers.js';
import { sessionIdForMessage } from '../src/context/context-store.js';
import { renderForPlatform } from '../src/platform/core/renderer.js';
import { IdentityRegistry } from '../src/platform/core/identity.js';
import { KookAdapter } from '../src/platform/kook/adapter.js';
import { KookRenderer } from '../src/platform/kook/renderer.js';
import { TelegramAdapter } from '../src/platform/telegram/adapter.js';
import { TelegramRenderer } from '../src/platform/telegram/renderer.js';
import { WhatsAppAdapter } from '../src/platform/whatsapp/adapter.js';
import { WhatsAppCloudApiClient, whatsappTextPayload } from '../src/platform/whatsapp/graph-api.js';
import { verifyWhatsAppSignature, verifyWhatsAppWebhook } from '../src/platform/whatsapp/webhook.js';
import { PubgMastraRuntime } from '../src/runtime/workflow.js';
import { FIXTURE_RECORDS, TEST_NOW } from './fixtures.js';

const coverage = {
  status: 'OK' as const,
  complete: true,
  coverageStart: '2026-08-01T00:00:00.000Z',
  coverageEnd: TEST_NOW.toISOString(),
  checkedAt: TEST_NOW.toISOString(),
  failedMatchIds: [],
  sourceUnavailable: false,
  freshness: 'fresh' as const,
};
const source = { store: 'fixture', syncInvoked: false, playerApiCalls: 0, matchApiCalls: 0, localMatchCount: FIXTURE_RECORDS.length };

function fixtureProvider(): FixtureDataProvider {
  return new FixtureDataProvider(FIXTURE_RECORDS, coverage, source);
}

function telegramMessage(userId: number, chatId: number, text: string) {
  return new TelegramAdapter().normalize({
    update_id: 1,
    message: {
      message_id: 99,
      date: Math.floor(TEST_NOW.getTime() / 1000),
      text,
      from: { id: userId, first_name: 'Test', last_name: 'User' },
      chat: { id: chatId, type: 'group', title: 'PUBG group' },
    },
  });
}

test('KOOK adapter normalizes private and group messages without raw platform fields', () => {
  const adapter = new KookAdapter('test-kook');
  const group = adapter.normalize({
    channel_type: 'GROUP',
    target_id: 'kook-group',
    author_id: 'kook-user',
    msg_id: 'kook-message',
    content: '昨日战绩',
    timestamp: TEST_NOW.toISOString(),
  });
  assert.deepEqual(group, {
    version: 1,
    platform: 'kook',
    botId: 'test-kook',
    user: { platform: 'kook', platformUserId: 'kook-user', internalUserId: null, displayName: null },
    chat: { type: 'group', id: 'kook-group', name: null },
    message: { id: 'kook-message', text: '昨日战绩', replyToMessageId: null },
    mentions: [],
    attachments: [],
    timestamp: TEST_NOW.toISOString(),
  });
  const privateMessage = adapter.normalize({
    channel_type: 'PERSON',
    target_id: 'kook-user',
    author_id: 'kook-user',
    msg_id: 'private-message',
    content: '谁最强',
  });
  assert.equal(privateMessage.chat.type, 'private');
  assert.equal('raw' in privateMessage, false);
});

test('Telegram mock adapter normalizes private and group messages without network access', () => {
  const adapter = new TelegramAdapter('mock-telegram');
  const privateMessage = adapter.normalize({
    message: {
      message_id: 1,
      date: Math.floor(TEST_NOW.getTime() / 1000),
      text: '昨日战绩',
      from: { id: 1001, first_name: 'A' },
      chat: { id: 1001, type: 'private' },
    },
  });
  assert.equal(privateMessage.platform, 'telegram');
  assert.equal(privateMessage.chat.type, 'private');
  assert.equal(privateMessage.user.platformUserId, '1001');
  const groupMessage = telegramMessage(1001, -2001, '谁最强');
  assert.equal(groupMessage.chat.type, 'group');
  assert.equal(groupMessage.chat.id, '-2001');
  assert.notEqual(groupMessage.user.platformUserId, groupMessage.chat.id);
});

test('WhatsApp adapter accepts text messages and ignores phase-two message types', () => {
  const adapter = new WhatsAppAdapter({ botId: 'phone-number-id' });
  assert.throws(() => adapter.normalizeAll({ entry: [] }), /unsupported whatsapp webhook object/u);
  const messages = adapter.normalizeAll({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-id',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'phone-number-id' },
          contacts: [{ wa_id: '8613800138000', profile: { name: 'Alice' } }],
          messages: [
            {
              id: 'wamid.text-1',
              from: '8613800138000',
              timestamp: '1788326400',
              type: 'text',
              text: { body: '昨日战绩' },
              context: { id: 'wamid.previous' },
            },
            { id: 'wamid.interactive-1', from: '8613800138000', type: 'interactive' },
            { id: 'wamid.image-1', from: '8613800138000', type: 'image' },
          ],
        },
      }],
    }],
  });

  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], {
    version: 1,
    platform: 'whatsapp',
    botId: 'phone-number-id',
    user: { platform: 'whatsapp', platformUserId: '8613800138000', internalUserId: null, displayName: 'Alice' },
    chat: { type: 'private', id: '8613800138000', name: 'Alice' },
    message: { id: 'wamid.text-1', text: '昨日战绩', replyToMessageId: 'wamid.previous' },
    mentions: [],
    attachments: [],
    timestamp: '2026-09-02T05:20:00.000Z',
  });
});

test('WhatsApp webhook verification uses the exact raw body and challenge token', () => {
  const body = '{"object":"whatsapp_business_account"}';
  const signature = `sha256=${createHmac('sha256', 'app-secret').update(body).digest('hex')}`;
  assert.equal(verifyWhatsAppSignature(body, signature, 'app-secret'), true);
  assert.equal(verifyWhatsAppSignature(`${body} `, signature, 'app-secret'), false);
  assert.equal(verifyWhatsAppSignature(body, 'sha256=bad', 'app-secret'), false);
  assert.equal(verifyWhatsAppWebhook('subscribe', 'verify-me', 'challenge-value', 'verify-me'), 'challenge-value');
  assert.equal(verifyWhatsAppWebhook('subscribe', 'wrong', 'challenge-value', 'verify-me'), null);
});

test('WhatsApp Graph API sender emits text-only Cloud API requests', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.out-1' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const client = new WhatsAppCloudApiClient({
    accessToken: 'access-token',
    phoneNumberId: '12345',
    baseUrl: 'https://graph.test',
    apiVersion: 'v23.0',
    fetch: fakeFetch,
  });

  await client.send('8613800138000', {
    messages: [{ type: 'text', text: '回复内容' }],
    replyTo: 'wamid.in-1',
    metadata: {},
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, 'https://graph.test/v23.0/12345/messages');
  assert.equal(requests[0]?.init.headers instanceof Headers ? requests[0].init.headers.get('authorization') : (requests[0]?.init.headers as Record<string, string>).authorization, 'Bearer access-token');
  assert.deepEqual(JSON.parse(String(requests[0]?.init.body)), {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '8613800138000',
    type: 'text',
    text: { preview_url: false, body: '回复内容' },
    context: { message_id: 'wamid.in-1' },
  });
  assert.throws(() => whatsappTextPayload('8613800138000', { type: 'image', url: 'https://example.test/a.png' }), /text outbound/u);
  assert.throws(() => whatsappTextPayload('8613800138000', { type: 'text', text: 'x', buttons: [{ text: 'Next', callbackData: 'next' }] }), /does not support buttons/u);
  assert.equal(getPlatformCapabilities('whatsapp').supportsImages, false);
  assert.equal(getPlatformCapabilities('whatsapp').supportsButtons, false);
});

test('WhatsApp Graph API sender splits text without data loss', async () => {
  const requests: RequestInit[] = [];
  const fakeFetch: typeof fetch = async (_input, init) => {
    requests.push(init ?? {});
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.out' }] }), { status: 200 });
  };
  const client = new WhatsAppCloudApiClient({
    accessToken: 'access-token',
    phoneNumberId: '12345',
    fetch: fakeFetch,
  });
  const text = 'a'.repeat(4096) + '🙂';

  await client.send('8613800138000', {
    messages: [{ type: 'text', text }],
    replyTo: 'wamid.in-1',
    metadata: {},
  });

  assert.equal(requests.length, 2);
  const payloads = requests.map((request) => JSON.parse(String(request.body)));
  assert.equal(payloads.map((payload) => payload.text.body).join(''), text);
  assert.deepEqual(payloads[0].context, { message_id: 'wamid.in-1' });
  assert.equal(payloads[1].context, undefined);
  assert.throws(
    () => whatsappTextPayload('8613800138000', { type: 'text', text: 'x'.repeat(4097) }),
    /exceeds 4096 characters/u,
  );
});

test('KOOK and Telegram mock produce equivalent PUBG domain queries', async () => {
  const runtime = new PubgMastraRuntime({ provider: fixtureProvider(), contextStore: new InMemoryContextStore(), team: DEFAULT_TEAM });
  const kook = new KookAdapter().normalize({
    channel_type: 'GROUP',
    target_id: 'kook-group',
    author_id: 'same-user',
    msg_id: 'kook-message',
    content: '昨日战绩',
    timestamp: TEST_NOW.toISOString(),
  });
  const telegram = telegramMessage(1001, -2001, '昨日战绩');
  const kookResult = await runtime.handle({ text: kook.message.text, message: kook, now: TEST_NOW.toISOString() });
  const telegramResult = await runtime.handle({ text: telegram.message.text, message: telegram, now: TEST_NOW.toISOString() });
  assert.equal(kookResult.query?.domain, 'pubg');
  assert.equal(telegramResult.query?.domain, 'pubg');
  assert.equal(kookResult.query?.operation, telegramResult.query?.operation);
  assert.deepEqual(kookResult.query?.subject, telegramResult.query?.subject);
  assert.deepEqual(kookResult.resolvedQuery?.selector, telegramResult.resolvedQuery?.selector);
});

test('structured PUBG context isolates senders and platforms', async () => {
  const store = new InMemoryContextStore();
  const runtime = new PubgMastraRuntime({ provider: fixtureProvider(), contextStore: store, team: DEFAULT_TEAM });
  const kookA = new KookAdapter().normalize({ channel_type: 'GROUP', target_id: 'shared', author_id: 'a', msg_id: 'a1', content: '昨日战绩', timestamp: TEST_NOW.toISOString() });
  const kookB = new KookAdapter().normalize({ channel_type: 'GROUP', target_id: 'shared', author_id: 'b', msg_id: 'b1', content: '谁最菜', timestamp: TEST_NOW.toISOString() });
  const telegramA = telegramMessage(10, -20, '昨日战绩');
  const telegramB = telegramMessage(11, -20, '谁最菜');
  await runtime.handle({ text: kookA.message.text, message: kookA, now: TEST_NOW.toISOString() });
  const kookFollowUp = await runtime.handle({ text: kookB.message.text, message: kookB, now: TEST_NOW.toISOString() });
  assert.equal(kookFollowUp.query?.reference.inheritedFromContext, false);
  await runtime.handle({ text: telegramA.message.text, message: telegramA, now: TEST_NOW.toISOString() });
  const telegramFollowUp = await runtime.handle({ text: telegramB.message.text, message: telegramB, now: TEST_NOW.toISOString() });
  assert.equal(telegramFollowUp.query?.reference.inheritedFromContext, false);
  const telegramSameSender = await runtime.handle({ text: '谁最菜', message: { ...telegramA, message: { ...telegramA.message, id: 'telegram-follow-up', text: '谁最菜' } }, now: TEST_NOW.toISOString() });
  assert.equal(telegramSameSender.query?.reference.inheritedFromContext, true);
  assert.equal(telegramSameSender.resolvedQuery?.selector.type, 'time_range');
});

test('platform renderers preserve PUBG data and split at message boundaries', async () => {
  const runtime = new PubgMastraRuntime({ provider: fixtureProvider(), contextStore: new InMemoryContextStore(), team: DEFAULT_TEAM });
  const message = telegramMessage(1001, -2001, '昨日战绩');
  const result = await runtime.handle({ text: message.message.text, message, now: TEST_NOW.toISOString() });
  assert.ok(result.presentation);
  assert.ok(result.messages.length >= 1);
  assert.match(result.response, /🔥 KD 排名/u);
  assert.match(result.response, /SG_LabmemNo007/u);
  assert.match(result.response, /👥 小队总览/u);
  const presentation = buildPresentation(result.data ? {
    queryId: result.query?.queryId ?? 'test',
    sessionId: 'test',
    status: result.status,
    data: result.data,
    coverage: result.coverage!,
    source: result.source!,
    evidence: result.evidence!,
    diagnostics: {},
  } : (() => { throw new Error('missing result data'); })(), result.resolvedQuery!);
  const response = renderForPlatform(presentation, message);
  assert.ok(response.messages.every((item) => item.type === 'text'));
  assert.equal(response.metadata.platform, 'telegram');
  assert.equal(new KookRenderer().platform, 'kook');
  assert.equal(new TelegramRenderer().platform, 'telegram');
});

test('identity registry maps stable platform IDs and never authorizes by display name', () => {
  const message = new KookAdapter().normalize({
    channel_type: 'GROUP',
    target_id: 'group-1',
    author_id: 'stable-user-id',
    msg_id: 'message-1',
    content: '状态',
  });
  message.user.displayName = 'Admin Nickname';
  const registry = new IdentityRegistry([{
    internalUserId: 'admin',
    roles: ['ADMIN'],
    identities: { kook: ['stable-user-id'], telegram: [] },
  }]);
  const resolved = registry.resolve(message);
  assert.equal(resolved.internalUserId, 'admin');
  assert.equal(resolved.platformIdentity.internalUserId, 'admin');
  assert.equal(registry.hasRole(message, 'ADMIN'), true);
  const unknown = { ...message, user: { ...message.user, platformUserId: 'other-user', displayName: 'Admin Nickname' } };
  assert.equal(registry.hasRole(unknown, 'ADMIN'), false);
  assert.equal(sessionIdForMessage(message), 'kook:group:group-1:stable-user-id:pubg');
});
