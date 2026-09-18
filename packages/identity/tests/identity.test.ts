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

test('a preset file added after startup is imported without replacing confirmed data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'identity-refresh-'));
  const database = join(directory, 'identity.sqlite');
  const presets = join(directory, 'presets.json');
  const store = new IdentityStore(database, { presetsFile: presets });
  try {
    assert.equal(store.refreshPresets(presets), false);
    store.seedPresets([{ personId: 'wang', displayName: '小王' }]);
    store.bindChannel({
      personId: 'wang',
      identity: { channel: 'whatsapp', accountId: 'secondary', platformUserId: '551' },
      source: 'confirmed',
    });
    await writeFile(presets, JSON.stringify({ persons: [{ personId: 'wang', displayName: '小王', aliases: ['狗王'], externalAccounts: [{ provider: 'pubg', externalId: 'Wang233' }] }] }));
    assert.equal(store.refreshPresets(presets), true);
    const person = store.getPerson('wang');
    assert.equal(person?.aliases.some((alias) => alias.alias === '狗王' && alias.source === 'preset'), true);
    assert.equal(person?.channelIdentities[0]?.source, 'confirmed');
    assert.equal(person?.externalAccounts[0]?.externalId, 'Wang233');
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('group aliases take precedence over global aliases and observed candidates stay unreliable', () => {
  const store = new IdentityStore();
  store.seedPresets([
    { personId: 'global', displayName: '全局胖子' },
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

test('group-scoped lookup falls back to preloaded global aliases', () => {
  const store = new IdentityStore();
  store.seedPresets([{ personId: 'jiao', displayName: '胶', aliases: ['胶'] }]);

  const resolved = store.resolve(
    { type: 'alias', alias: '胶', scope: 'group' },
    { conversationId: 'group-1@g.us' },
  );
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.person?.personId, 'jiao');
  assert.equal(resolved.resolutionPath, 'global-alias');
  store.close();
});

test('authoritative global aliases are not shadowed by group observations', () => {
  const store = new IdentityStore();
  store.seedPresets([
    { personId: 'global', displayName: '全局小王' },
    { personId: 'group', displayName: '群内候选' },
  ]);
  store.addAlias({ personId: 'global', alias: '胖子', scope: 'global', source: 'confirmed' });
  store.addAlias({ personId: 'group', alias: '胖子', scope: 'group', scopeId: 'group-1@g.us', source: 'observed', confidence: 0.9 });

  const resolved = store.resolve({ type: 'alias', alias: '胖子' }, { conversationId: 'group-1@g.us' });
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.person?.personId, 'global');
  assert.equal(resolved.resolutionPath, 'global-alias');
  store.close();
});

test('candidate confirmation only upgrades observed aliases', () => {
  const store = new IdentityStore();
  store.seedPresets([{ personId: 'wang', displayName: '小王', aliases: ['王哥'] }]);
  const presetAlias = store.resolve({ type: 'alias', alias: '王哥' });
  assert.equal(presetAlias.status, 'resolved');
  const aliasId = presetAlias.person?.aliases.find((alias) => alias.alias === '王哥')?.aliasId;
  assert.ok(aliasId);
  assert.throws(() => store.confirmCandidate(aliasId), /identity_candidate_not_observed/u);
  store.close();
});

test('confirmed channel and external bindings are not downgraded by preset writes', () => {
  const store = new IdentityStore();
  store.seedPresets([{ personId: 'wang', displayName: '小王', externalAccounts: [{ provider: 'pubg', externalId: 'Wang233' }] }]);

  const confirmedChannel = store.bindChannel({
    personId: 'wang',
    identity: { channel: 'whatsapp', accountId: 'secondary', platformUserId: '551', conversationId: 'group-1@g.us' },
    source: 'confirmed',
  });
  const presetChannel = store.bindChannel({
    personId: 'wang',
    identity: { channel: 'whatsapp', accountId: 'secondary', platformUserId: '551' },
    source: 'preset',
  });
  assert.equal(confirmedChannel.source, 'confirmed');
  assert.equal(presetChannel.source, 'confirmed');
  assert.equal(presetChannel.conversationId, 'group-1@g.us');

  const confirmedAccount = store.linkAccount({ personId: 'wang', provider: 'pubg', externalId: 'Wang233', source: 'confirmed' });
  const presetAccount = store.linkAccount({ personId: 'wang', provider: 'pubg', externalId: 'Wang233', source: 'preset' });
  assert.equal(confirmedAccount.source, 'confirmed');
  assert.equal(presetAccount.source, 'confirmed');
  store.close();
});

test('confirmed identity bindings, aliases, and external accounts survive restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'identity-restart-'));
  const database = join(directory, 'identity.sqlite');
  try {
    const first = new IdentityStore(database);
    first.seedPresets([{ personId: 'wang', displayName: '小王' }]);
    first.bindChannel({
      personId: 'wang',
      identity: { channel: 'telegram', accountId: 'default', platformUserId: '991', conversationId: '-1001' },
      source: 'confirmed',
    });
    const observed = first.addAlias({
      personId: 'wang',
      alias: '胖子',
      scope: 'group',
      scopeId: '-1001',
      source: 'observed',
      confidence: 0.8,
      evidenceSummary: '群聊中反复出现',
    });
    first.confirmCandidate(observed.aliasId);
    first.linkAccount({ personId: 'wang', provider: 'pubg', externalId: 'Wang233', source: 'confirmed' });
    first.close();

    const second = new IdentityStore(database);
    const self = second.resolve({ type: 'self' }, { channel: 'telegram', accountId: 'default', conversationId: '-1001', senderId: '991' });
    assert.equal(self.status, 'resolved');
    assert.equal(self.channelIdentity?.source, 'confirmed');
    assert.equal(self.channelIdentity?.conversationId, '-1001');
    const alias = second.resolve({ type: 'alias', alias: '胖子' }, { conversationId: '-1001' });
    assert.equal(alias.status, 'resolved');
    assert.equal(alias.person?.personId, 'wang');
    assert.equal(alias.person?.aliases.find((item) => item.alias === '胖子')?.source, 'confirmed');
    assert.equal(alias.person?.externalAccounts.find((item) => item.provider === 'pubg')?.externalId, 'Wang233');
    second.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('one canonical Person resolves through confirmed Telegram and WhatsApp identities', () => {
  const store = new IdentityStore();
  store.seedPresets([{ personId: 'wang', displayName: '小王', externalAccounts: [{ provider: 'pubg', externalId: 'Wang233' }] }]);
  store.bindChannel({
    personId: 'wang',
    identity: { channel: 'telegram', accountId: 'default', platformUserId: 'tg-991' },
    source: 'confirmed',
  });
  store.bindChannel({
    personId: 'wang',
    identity: { channel: 'whatsapp', accountId: 'secondary', platformUserId: '+8613800000000' },
    source: 'confirmed',
  });

  const telegram = store.resolve({ type: 'self' }, { channel: 'telegram', accountId: 'default', senderId: 'tg-991' });
  const whatsapp = store.resolve({ type: 'self' }, { channel: 'whatsapp', accountId: 'secondary', senderId: '+8613800000000' });
  assert.equal(telegram.person?.personId, 'wang');
  assert.equal(whatsapp.person?.personId, 'wang');
  assert.equal(telegram.person?.externalAccounts[0]?.externalId, 'Wang233');
  assert.equal(whatsapp.person?.externalAccounts[0]?.externalId, 'Wang233');
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
