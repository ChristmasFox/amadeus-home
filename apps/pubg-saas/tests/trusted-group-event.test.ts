import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTrustedKookGroupMessage } from '../src/index.js';

const event = {
  s: 0,
  d: {
    channel_type: 'GROUP',
    type: 1,
    target_id: 'channel-1',
    author_id: 'user-1',
    content: 'create squad',
    msg_id: 'message-1',
    msg_timestamp: 1_760_000_000_000,
    extra: {
      type: 1,
      guild_id: 'guild-1',
      channel_type: 1,
      author: { id: 'user-1', username: 'same nickname', nickname: 'same nickname', roles: [1], bot: false },
    },
  },
};

test('creates trusted scope from KOOK server/channel/actor fields and drops cached roles', () => {
  const parsed = parseTrustedKookGroupMessage(event, 'configured-bot');
  assert.deepEqual(parsed, {
    platform: 'kook',
    botAccountId: 'configured-bot',
    guildId: 'guild-1',
    channelId: 'channel-1',
    userId: 'user-1',
    messageId: 'message-1',
    timestamp: 1_760_000_000_000,
    content: 'create squad',
    [Object.getOwnPropertySymbols(parsed ?? {})[0]!]: true,
  });
  assert.equal(Object.hasOwn(parsed ?? {}, 'roles'), false);
});

test('rejects direct messages, spoofed actor identity, bots, malformed metadata, and oversized content', () => {
  assert.equal(parseTrustedKookGroupMessage({ ...event, d: { ...event.d, channel_type: 'PERSON' } }, 'configured-bot'), null);
  assert.equal(parseTrustedKookGroupMessage({ ...event, d: { ...event.d, author_id: 'other-user' } }, 'configured-bot'), null);
  assert.equal(parseTrustedKookGroupMessage({ ...event, d: { ...event.d, extra: { ...event.d.extra, author: { ...event.d.extra.author, bot: true } } } }, 'configured-bot'), null);
  assert.equal(parseTrustedKookGroupMessage({ ...event, d: { ...event.d, extra: { ...event.d.extra, channel_type: 2 } } }, 'configured-bot'), null);
  assert.equal(parseTrustedKookGroupMessage({ ...event, d: { ...event.d, content: 'x'.repeat(8193) } }, 'configured-bot'), null);
  assert.equal(parseTrustedKookGroupMessage(event, ' '), null);
});
