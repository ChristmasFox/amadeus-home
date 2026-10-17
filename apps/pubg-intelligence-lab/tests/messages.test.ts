import assert from 'node:assert/strict';
import test from 'node:test';
import { researchRecoveryMessage, shortConversationReply } from '../src/server/messages.js';

test('short greetings and out-of-scope prompts get a useful next step without a research intent', () => {
  assert.match(shortConversationReply('你好！') ?? '', /伤害趋势/u);
  assert.match(shortConversationReply('谢谢') ?? '', /复盘某场团战/u);
  assert.match(shortConversationReply('今天的天气怎么样？') ?? '', /只研究当前选定小队的 PUBG 对局/u);
  assert.equal(shortConversationReply('最近比赛的平均伤害趋势'), undefined);
  assert.equal(shortConversationReply('按地图比较前十率'), undefined);
  assert.equal(shortConversationReply('SG_LabmemNo007 近 10 场打法'), undefined);
  assert.equal(shortConversationReply('为什么我们第三圈经常团灭？'), undefined);
  assert.equal(shortConversationReply('我和 B 谁救谁更多？'), undefined);
});

test('evidence validation failure gives an actionable user-facing recovery message', () => {
  const message = researchRecoveryMessage('invalid_grounded_output');
  assert.match(message ?? '', /已保留通过校验的结论/u);
  assert.match(message ?? '', /缺少可核验的比赛或事件依据/u);
  assert.doesNotMatch(message ?? '', /已丢弃|恐吓/u);
  assert.equal(researchRecoveryMessage(null), null);
});
