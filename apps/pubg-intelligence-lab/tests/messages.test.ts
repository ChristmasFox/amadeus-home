import assert from 'node:assert/strict';
import test from 'node:test';
import { researchRecoveryMessage, shortConversationReply } from '../src/server/messages.js';

test('short greetings and out-of-scope prompts get a useful next step without a research intent', () => {
  assert.match(shortConversationReply('你好！') ?? '', /伤害趋势/u);
  assert.match(shortConversationReply('谢谢') ?? '', /复盘某场团战/u);
  assert.match(shortConversationReply('今天的天气怎么样？') ?? '', /只研究当前选定小队的 PUBG 对局/u);
  assert.equal(shortConversationReply('最近比赛的平均伤害趋势'), undefined);
  assert.equal(shortConversationReply('按地图比较前十率'), undefined);
  assert.equal(shortConversationReply('为什么我们第三圈经常团灭？'), undefined);
  assert.equal(shortConversationReply('我和 B 谁救谁更多？'), undefined);
});

test('evidence validation failure gives an actionable user-facing recovery message', () => {
  const message = researchRecoveryMessage('invalid_grounded_output');
  assert.match(message ?? '', /证据编号或数字未通过本机校验/u);
  assert.match(message ?? '', /缩小到一项统计或一场比赛后重试/u);
});
