import assert from 'node:assert/strict';
import test from 'node:test';
import { parseKookRequest } from '../src/index.js';

function group(content: string, mention: unknown[] = []) {
  return {
    type: 1,
    channel_type: 'GROUP',
    target_id: 'channel-1',
    author_id: 'actor-1',
    content,
    msg_id: `message-${content.length}`,
    msg_timestamp: Date.now(),
    extra: { guild_id: 'guild-1', channel_type: 1, author: { id: 'actor-1', bot: false }, mention },
  };
}

test('group admission includes only addressed messages and narrow account/team write phrases', () => {
  assert.equal(parseKookRequest(group('普通聊天'), 'bot-1'), null);
  assert.equal(parseKookRequest(group('我的 PUBG 账号是 PlayerOne'), 'bot-1')?.request.kind, 'group');
  assert.equal(parseKookRequest(group('我们的队名是 夜猫小队'), 'bot-1')?.request.kind, 'group');
  assert.equal(parseKookRequest(group('查一下今天击杀'), 'bot-1'), null);
  assert.equal(parseKookRequest(group('/pubg me PlayerOne'), 'bot-1')?.request.kind, 'group');
});

test('preserves only validated mention IDs in the stored envelope for delegated binding', () => {
  const parsed = parseKookRequest(group('<@member-1> 他的 PUBG 账号是 PlayerOne', ['member-1', 'bot-1', 77]), 'bot-1');
  assert.ok(parsed?.request.kind === 'group');
  assert.deepEqual(parsed.request.event.mentionedUserIds, ['member-1']);
  assert.deepEqual((parsed.envelope.d as { extra: { mention: string[] } }).extra.mention, ['member-1', 'bot-1']);
});
