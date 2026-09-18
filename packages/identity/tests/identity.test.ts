import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { IdentityStore } from '../src/index.js';

const context = {
  channel: 'whatsapp',
  accountId: 'secondary',
  conversationId: 'group-1@g.us',
  senderId: '551',
};

test('presets persist persons, aliases, and provider-neutral accounts across reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'identity-'));
  const database = join(directory, 'identity.sqlite');
  const presets = join(directory, 'presets.json');
  await writeFile(presets, JSON.stringify({ persons: [{ personId: 'wang', displayName: '小王', aliases: ['王哥', '狗王', '老王'], externalAccounts: [{ provider: 'pubg', externalId: 'Wang233' }] }] }));
  try {
    const first = new IdentityStore(database, { presetsFile: presets });
    const resolved = first.resolve({ type: 'alias', alias: '狗王' }, context);
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.person?.personId, 'wang');
    assert.equal(resolved.person?.externalAccounts[0]?.provider, 'pubg');
    first.close();

    const second = new IdentityStore(database);
    const reopened = second.getPerson('wang');
    assert.equal(reopened?.displayName, '小王');
    assert.deepEqual(reopened?.externalAccounts.map((account) => account.externalId), ['Wang233']);
    second.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('group aliases take precedence over global aliases and observed candidates stay unreliable', () => {
  const store = new IdentityStore();
  store.seedPresets([
    { personId: 'global', displayName: '全局胖子', aliases: ['胖子'] },
    { personId: 'group', displayName: '群内胖子' },
  ]);
  store.addAlias({ personId: 'group', alias: '胖子', scope: 'group', scopeId: 'group-1@g.us', source: 'confirmed' });
  const group = store.resolve({ type: 'alias', alias: '胖子' }, { conversationId: 'group-1@g.us' });
  assert.equal(group.status, 'resolved');
  assert.equal(group.person?.personId, 'group');

  store.addAlias({ personId: 'global', alias: '可能是胖子', scope: 'group', scopeId: 'group-1@g.us', source: 'observed', confidence: 0.6, evidenceSummary: '群聊中反复出现' });
  const candidate = store.resolve({ type: 'alias', alias: '可能是胖子' }, { conversationId: 'group-1@g.us' });
  assert.equal(candidate.status, 'candidate');
  assert.equal(candidate.reliable, false);
  const aliasId = candidate.candidates?.[0]?.alias.aliasId;
  assert.ok(aliasId);
  store.confirmCandidate(aliasId);
  const confirmed = store.resolve({ type: 'alias', alias: '可能是胖子' }, { conversationId: 'group-1@g.us' });
  assert.equal(confirmed.status, 'resolved');
  assert.equal(confirmed.reliable, true);
  store.close();
});

test('self and mention resolve only trusted channel metadata, never display names', () => {
  const store = new IdentityStore();
  store.seedPresets([{ personId: 'wang', displayName: '小王', externalAccounts: [{ provider: 'pubg', externalId: 'Wang233' }] }]);
  const selfBefore = store.resolve({ type: 'self' }, context);
  assert.equal(selfBefore.status, 'unbound');
  store.bindChannel({ personId: 'wang', identity: { channel: context.channel, accountId: context.accountId, conversationId: context.conversationId, platformUserId: context.senderId }, source: 'confirmed' });
  const self = store.resolve({ type: 'self' }, context);
  assert.equal(self.status, 'resolved');
  assert.equal(self.person?.externalAccounts[0]?.externalId, 'Wang233');
  const mention = store.resolve({ type: 'mention', index: 0 }, {
    channel: 'telegram',
    accountId: 'default',
    conversationId: '-1001',
    mentions: [{ channel: 'telegram', accountId: 'default', platformUserId: '991' }],
  });
  assert.equal(mention.status, 'unbound');
  assert.equal(mention.person, undefined);
  store.close();
});
