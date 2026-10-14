import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectKookRequest, parseKookRequest } from '../src/index.js';

function group(content: string, mention: unknown[] = [], channelId = 'channel-1', authorId = 'actor-1', bot = false) {
  return {
    type: 1,
    channel_type: 'GROUP',
    target_id: channelId,
    author_id: authorId,
    content,
    msg_id: `message-${content.length}-${channelId}`,
    msg_timestamp: Date.now(),
    extra: { guild_id: 'guild-1', channel_type: 1, author: { id: authorId, bot }, mention },
  };
}

test('group admission accepts unmentioned account/team writes and explicit commands, but excludes unrelated chatter', () => {
  assert.equal(parseKookRequest(group('普通聊天'), 'bot-1'), null);
  assert.equal(parseKookRequest(group('我的 PUBG 账号是 PlayerOne'), 'bot-1')?.request.kind, 'group');
  assert.equal(parseKookRequest(group('我们的队名是 夜猫小队'), 'bot-1')?.request.kind, 'group');
  assert.equal(parseKookRequest(group('查一下今天击杀'), 'bot-1')?.request.kind, 'group');
  assert.equal(parseKookRequest(group('这周队友伤害谁最多？'), 'bot-1')?.request.kind, 'group');
  assert.equal(parseKookRequest(group('/pubg me PlayerOne'), 'bot-1')?.request.kind, 'group');
  assert.equal(parseKookRequest(group('@bot 你今天好吗？'), 'bot-1'), null);
  assert.equal(parseKookRequest(group('PUBG挺好玩'), 'bot-1'), null);
});

test('both the existing and newly added KOOK text channels admit the same relevant unmentioned query', () => {
  for (const channelId of ['6115211415447433', '6521538183595713']) {
    const parsed = parseKookRequest(group('查一下今天击杀', [], channelId), 'bot-1');
    assert.ok(parsed?.request.kind === 'group');
    assert.equal(parsed.channelId, channelId);
    assert.equal(parsed.targetId, channelId);
  }
});

test('structured discard inspection reports only a reason and safe channel metadata', () => {
  const event = group('private raw text must never be logged', [], '6115211415447433', 'actor-1');
  event.extra.author.id = 'spoofed-actor';
  const inspection = inspectKookRequest(event, 'bot-1');
  assert.deepEqual(inspection, {
    kind: 'dropped', stage: 'trusted_group', reason: 'actor_id_mismatch', channelId: '6115211415447433',
  });
  assert.equal(JSON.stringify(inspection).includes('private raw text'), false);
  assert.equal(JSON.stringify(inspection).includes('spoofed-actor'), false);
});

test('preserves only validated mention IDs in the stored envelope for delegated binding', () => {
  const parsed = parseKookRequest(group('<@member-1> 他的 PUBG 账号是 PlayerOne', ['member-1', 'bot-1', 77]), 'bot-1');
  assert.ok(parsed?.request.kind === 'group');
  assert.deepEqual(parsed.request.event.mentionedUserIds, ['member-1']);
  assert.deepEqual((parsed.envelope.d as { extra: { mention: string[] } }).extra.mention, ['member-1', 'bot-1']);
});
