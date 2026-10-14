import assert from 'node:assert/strict';
import test from 'node:test';
import { MockLanguageModelV4 } from 'ai/test';
import { KookGroupWriteIntentParser } from '../src/application/kook-group-write-intent.js';

const usage = {
  inputTokens: { total: 12, noCache: 12, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 8, text: 8, reasoning: undefined },
};

function modelFor(output: unknown): MockLanguageModelV4 {
  return new MockLanguageModelV4({ doGenerate: {
    content: [{ type: 'tool-call', toolCallId: 'write-intent-call', toolName: 'submit_group_write_intent', input: JSON.stringify(output) }],
    finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [],
  } });
}

test('classifies only the bounded account-declaration and team-rename intents', async () => {
  const accountModel = modelFor({ action: 'declare_pubg_account', target: 'mentioned_member', pubgName: 'Player One', teamName: null });
  const accountParser = new KookGroupWriteIntentParser(accountModel);
  assert.deepEqual(await accountParser.parse('他的 PUBG 账号是 Player One'), {
    action: 'declare_pubg_account', target: 'mentioned_member', pubgName: 'Player One',
  });
  assert.equal(accountModel.doGenerateCalls.length, 1);

  const renameParser = new KookGroupWriteIntentParser(modelFor({ action: 'rename_team', target: null, pubgName: null, teamName: '夜猫小队' }));
  assert.deepEqual(await renameParser.parse('我们的队名是 夜猫小队'), { action: 'rename_team', teamName: '夜猫小队' });
});

test('rejects hallucinated slots, extra identity fields, and unsupported writes', async () => {
  assert.equal(await new KookGroupWriteIntentParser(modelFor({
    action: 'declare_pubg_account', target: 'self', pubgName: 'InventedPlayer', teamName: null,
  })).parse('我的 PUBG 账号是 RealPlayer'), null);
  assert.equal(await new KookGroupWriteIntentParser(modelFor({
    action: 'declare_pubg_account', target: 'mentioned_member', pubgName: 'RealPlayer', teamName: null, userId: 'attacker-picked-id',
  })).parse('他的 PUBG 账号是 RealPlayer'), null);
  assert.deepEqual(await new KookGroupWriteIntentParser(modelFor({
    action: 'unsupported', target: null, pubgName: null, teamName: null,
  })).parse('帮我查询今天的比赛'), { action: 'unsupported' });
});

