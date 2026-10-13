import assert from 'node:assert/strict';
import test from 'node:test';
import { createConfirmationCard, parseTrustedKookButtonClick } from '../src/index.js';

const token = 'a'.repeat(43);

test('builds a fixed return-val confirmation card and rejects malformed tokens', () => {
  const payload = createConfirmationCard({
    title: '解散队伍',
    detail: '确认后将移除队伍和绑定数据。',
    confirmText: '确认解散',
    confirmationToken: token,
  });
  assert.equal(payload.type, 'card');
  const card = JSON.parse(payload.content) as Array<{ modules: Array<{ elements?: Array<Record<string, unknown>> }> }>;
  const button = card[0]?.modules[2]?.elements?.[0];
  assert.equal(button?.click, 'return-val');
  assert.equal(button?.value, token);
  assert.throws(() => createConfirmationCard({ title: 'x', detail: 'y', confirmText: 'z', confirmationToken: 'bad' }), /kook_card_token_invalid/u);
});

test('parses only KOOK message button system events and preserves their original target', () => {
  const event = {
    s: 0,
    d: {
      type: 255,
      channel_type: 'PERSON',
      author_id: 'bot-author',
      msg_timestamp: 1_760_000_000_000,
      extra: {
        type: 'message_btn_click',
        body: { msg_id: 'card-message', user_id: 'clicker', value: token, target_id: 'bound-channel' },
      },
    },
  };
  const parsed = parseTrustedKookButtonClick(event, 'configured-bot');
  assert.ok(parsed);
  assert.equal(parsed.botAccountId, 'configured-bot');
  assert.equal(parsed.userId, 'clicker');
  assert.equal(parsed.sourceMessageId, 'card-message');
  assert.equal(parsed.sourceTargetId, 'bound-channel');
  assert.equal(parsed.value, token);

  assert.equal(parseTrustedKookButtonClick({ ...event, d: { ...event.d, type: 1 } }, 'configured-bot'), null);
  assert.equal(parseTrustedKookButtonClick({ ...event, d: { ...event.d, extra: { ...event.d.extra, type: 'not_a_click' } } }, 'configured-bot'), null);
  assert.equal(parseTrustedKookButtonClick({ ...event, d: { ...event.d, extra: { ...event.d.extra, body: { ...event.d.extra.body, user_id: 'configured-bot' } } } }, 'configured-bot'), null);
});
