import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import { IdentityStore } from '@agent/identity';
import { PubgDomainService, SqlitePubgRepository, type TeamConfig } from '@agent/pubg-domain';
import { prepareIdentitySubject, type PluginConfig } from '../src/index.js';

const TEAM: TeamConfig = {
  id: 'identity-team',
  label: 'Identity Team',
  platform: 'steam',
  players: [
    { id: 'p1', name: 'Wang233', aliases: ['小王'] },
    { id: 'p2', name: 'Other', aliases: [] },
  ],
};

function toolContext(senderId = 'telegram-user-1'): OpenClawPluginToolContext {
  return {
    messageChannel: 'telegram',
    agentAccountId: 'default',
    nativeChannelId: '-1001',
    requesterSenderId: senderId,
    deliveryContext: { channel: 'telegram', accountId: 'default', to: '-1001' },
  } as OpenClawPluginToolContext;
}

test('PUBG boundary maps canonical Person to PUBG account and never falls back to team', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pubg-identity-boundary-'));
  const identityPath = join(directory, 'identity.sqlite');
  const presetsPath = join(directory, 'presets.json');
  await writeFile(presetsPath, JSON.stringify({ persons: [{ personId: 'wang', displayName: '小王', externalAccounts: [{ provider: 'pubg', externalId: 'p1' }] }] }));
  const config = { identityDatabasePath: identityPath, identityPresetsFile: presetsPath } as PluginConfig;
  const service = new PubgDomainService({ team: TEAM, repository: new SqlitePubgRepository(join(directory, 'pubg.sqlite')) });
  try {
    const beforeBinding = await prepareIdentitySubject(service, config, {}, toolContext(), 'telegram-turn');
    assert.equal('status' in beforeBinding && beforeBinding.status, 'error');
    if ('status' in beforeBinding) assert.equal(beforeBinding.error?.code, 'identity_sender_unbound');

    const store = new IdentityStore(identityPath, { presetsFile: presetsPath });
    store.bindChannel({ personId: 'wang', identity: { channel: 'telegram', accountId: 'default', conversationId: '-1001', platformUserId: 'telegram-user-1' }, source: 'confirmed' });
    store.close();

    const prepared = await prepareIdentitySubject(service, config, {}, toolContext(), 'telegram-turn');
    assert.deepEqual(prepared, { playerIds: ['p1'] });
    assert.deepEqual(await prepareIdentitySubject(service, config, { team: true }, toolContext(), 'telegram-turn'), { playerIds: ['p1', 'p2'] });
  } finally {
    service.repository.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('PUBG boundary refreshes presets after its cached IdentityStore was created', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pubg-identity-refresh-'));
  const identityPath = join(directory, 'identity.sqlite');
  const presetsPath = join(directory, 'presets.json');
  await writeFile(presetsPath, JSON.stringify({ persons: [] }));
  const config = { identityDatabasePath: identityPath, identityPresetsFile: presetsPath } as PluginConfig;
  const service = new PubgDomainService({ team: TEAM, repository: new SqlitePubgRepository(join(directory, 'pubg.sqlite')) });
  try {
    const beforePreset = await prepareIdentitySubject(service, config, {}, toolContext(), 'telegram-refresh-turn');
    assert.equal('status' in beforePreset && beforePreset.status, 'error');
    if ('status' in beforePreset) assert.equal(beforePreset.error?.code, 'identity_sender_unbound');

    await writeFile(presetsPath, JSON.stringify({ persons: [{ personId: 'wang', displayName: '小王', externalAccounts: [{ provider: 'pubg', externalId: 'p1' }] }] }));
    const store = new IdentityStore(identityPath, { presetsFile: presetsPath });
    store.bindChannel({
      personId: 'wang',
      identity: { channel: 'telegram', accountId: 'default', conversationId: '-1001', platformUserId: 'telegram-user-1' },
      source: 'confirmed',
    });
    store.close();

    const afterPreset = await prepareIdentitySubject(service, config, {}, toolContext(), 'telegram-refresh-turn');
    assert.deepEqual(afterPreset, { playerIds: ['p1'] });
  } finally {
    service.repository.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('PUBG boundary maps multiple canonical Persons to explicit compare subjects', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pubg-identity-compare-'));
  const identityPath = join(directory, 'identity.sqlite');
  const presetsPath = join(directory, 'presets.json');
  await writeFile(presetsPath, JSON.stringify({ persons: [
    { personId: 'wang', displayName: '小王', externalAccounts: [{ provider: 'pubg', externalId: 'p1' }] },
    { personId: 'other', displayName: '另一位', externalAccounts: [{ provider: 'pubg', externalId: 'p2' }] },
  ] }));
  const config = { identityDatabasePath: identityPath, identityPresetsFile: presetsPath } as PluginConfig;
  const service = new PubgDomainService({ team: TEAM, repository: new SqlitePubgRepository(join(directory, 'pubg.sqlite')) });
  try {
    const prepared = await prepareIdentitySubject(
      service,
      config,
      { personIds: ['wang', 'other'] },
      toolContext(),
      'telegram-compare-turn',
    );
    assert.deepEqual(prepared, { playerIds: ['p1', 'p2'] });
  } finally {
    service.repository.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
