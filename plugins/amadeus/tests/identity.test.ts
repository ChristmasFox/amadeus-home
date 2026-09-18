import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import {
  identityAddAlias,
  identityBindChannel,
  identityConfirmCandidate,
  identityLinkAccount,
  identityListCandidates,
  identityResolve,
} from '../src/identity.js';
import type { AmadeusConfig } from '../src/config.js';

function config(databasePath: string, presetsFile: string): AmadeusConfig {
  return { identityDatabasePath: databasePath, identityPresetsFile: presetsFile } as AmadeusConfig;
}

function context(senderIsOwner = true): OpenClawPluginToolContext {
  return {
    messageChannel: 'whatsapp',
    agentAccountId: 'secondary',
    nativeChannelId: 'group-1@g.us',
    requesterSenderId: 'owner-1',
    senderIsOwner,
    deliveryContext: { channel: 'whatsapp', accountId: 'secondary', to: 'group-1@g.us' },
    toolBindings: {
      identity: {
        mentions: [{ platformUserId: 'friend-1' }],
        replySender: { platformUserId: 'reply-1' },
      },
    },
  } as OpenClawPluginToolContext;
}

test('OpenClaw identity tools use trusted metadata and persist owner-confirmed learning', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'amadeus-identity-'));
  const databasePath = join(directory, 'identity.sqlite');
  const presetsFile = join(directory, 'presets.json');
  await writeFile(presetsFile, JSON.stringify({ persons: [{ personId: 'wang', displayName: '小王', aliases: ['王哥'] }] }));
  const runtimeConfig = config(databasePath, presetsFile);
  try {
    const unbound = await identityResolve(runtimeConfig, { reference: 'self' }, context()) as { status: string };
    assert.equal(unbound.status, 'unbound');

    const binding = await identityBindChannel(runtimeConfig, { personId: 'wang', target: 'mention', mentionIndex: 0 }, context()) as { status: string };
    assert.equal(binding.status, 'bound');
    const resolvedMention = await identityResolve(runtimeConfig, { reference: 'mention', mentionIndex: 0 }, context()) as { status: string; person?: { personId: string } };
    assert.equal(resolvedMention.status, 'resolved');
    assert.equal(resolvedMention.person?.personId, 'wang');

    const candidate = await identityAddAlias(runtimeConfig, {
      personId: 'wang', alias: '狗王', scope: 'group', source: 'observed', confidence: 0.7, evidenceSummary: '群内反复使用',
    }, context(false)) as { status: string; alias: { aliasId: string } };
    assert.equal(candidate.status, 'candidate');
    const candidates = await identityListCandidates(runtimeConfig, { scope: 'group' }, context(false)) as { candidates: unknown[] };
    assert.equal(candidates.candidates.length, 1);
    const confirmed = await identityConfirmCandidate(runtimeConfig, { candidateId: candidate.alias.aliasId }, context()) as { status: string };
    assert.equal(confirmed.status, 'confirmed');

    const account = await identityLinkAccount(runtimeConfig, { personId: 'wang', provider: 'pubg', externalId: 'Wang233' }, context()) as { status: string };
    assert.equal(account.status, 'linked');
    const alias = await identityResolve(runtimeConfig, { reference: 'alias', alias: '狗王' }, context(false)) as { status: string; reliable: boolean };
    assert.equal(alias.status, 'resolved');
    assert.equal(alias.reliable, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('identity mutations require owner confirmation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'amadeus-identity-owner-'));
  const databasePath = join(directory, 'identity.sqlite');
  const presetsFile = join(directory, 'presets.json');
  await writeFile(presetsFile, JSON.stringify({ persons: [{ personId: 'wang', displayName: '小王' }] }));
  try {
    await assert.rejects(identityBindChannel(config(databasePath, presetsFile), { personId: 'wang' }, context(false)), /owner_confirmation/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
