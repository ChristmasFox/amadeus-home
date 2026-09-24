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
  forgetTrustedInboundReply,
  identityGetPerson,
  identityLinkAccount,
  identityListCandidates,
  identityResolve,
  rememberTrustedInboundReply,
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

    const presetAlias = await identityResolve(runtimeConfig, { reference: 'alias', alias: '王哥' }, context(false)) as { status: string; person?: { personId: string } };
    assert.equal(presetAlias.status, 'resolved');
    assert.equal(presetAlias.person?.personId, 'wang');

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

test('cached plugin stores refresh presets written after OpenClaw startup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'amadeus-identity-refresh-'));
  const databasePath = join(directory, 'identity.sqlite');
  const presetsFile = join(directory, 'presets.json');
  await writeFile(presetsFile, JSON.stringify({ persons: [] }));
  const runtimeConfig = config(databasePath, presetsFile);
  try {
    const before = await identityResolve(runtimeConfig, { reference: 'person', personId: 'wang' }, context()) as { status: string };
    assert.equal(before.status, 'not_found');
    await writeFile(presetsFile, JSON.stringify({ persons: [{ personId: 'wang', displayName: '小王', aliases: ['狗王'], externalAccounts: [{ provider: 'pubg', externalId: 'Wang233' }] }] }));
    const after = await identityGetPerson(runtimeConfig, { personId: 'wang' }) as { status: string; person?: { aliases: Array<{ alias: string }>; externalAccounts: Array<{ externalId: string }> } };
    assert.equal(after.status, 'resolved');
    assert.equal(after.person?.aliases.some((alias) => alias.alias === '狗王'), true);
    assert.equal(after.person?.externalAccounts[0]?.externalId, 'Wang233');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('typed inbound reply metadata is session-scoped and never inferred from text', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'amadeus-identity-reply-'));
  const databasePath = join(directory, 'identity.sqlite');
  const presetsFile = join(directory, 'presets.json');
  await writeFile(presetsFile, JSON.stringify({ persons: [{ personId: 'wang', displayName: '小王' }] }));
  const runtimeConfig = config(databasePath, presetsFile);
  const replyContext = { ...context(), sessionKey: 'agent:main:reply-session' };
  delete (replyContext as unknown as { toolBindings?: unknown }).toolBindings;
  try {
    rememberTrustedInboundReply({
      sessionKey: replyContext.sessionKey,
      channel: 'whatsapp',
      accountId: 'secondary',
      conversationId: 'group-1@g.us',
      replyToSender: 'reply-1',
    });
    const bound = await identityBindChannel(runtimeConfig, { personId: 'wang', target: 'reply_sender' }, replyContext) as { status: string };
    assert.equal(bound.status, 'bound');
    const resolved = await identityResolve(runtimeConfig, { reference: 'reply_sender' }, replyContext) as { status: string; person?: { personId: string } };
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.person?.personId, 'wang');

    const otherSession = { ...replyContext, sessionKey: 'agent:main:other-session' } as OpenClawPluginToolContext;
    const isolated = await identityResolve(runtimeConfig, { reference: 'reply_sender' }, otherSession) as { status: string; reason?: string };
    assert.equal(isolated.status, 'unbound');
    assert.equal(isolated.reason, 'trusted_reply_sender_metadata_unavailable');
  } finally {
    forgetTrustedInboundReply(replyContext.sessionKey);
    await rm(directory, { recursive: true, force: true });
  }
});

test('typed inbound sender metadata bridges current-sender mutations when tool context omits requesterSenderId', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'amadeus-identity-sender-'));
  const databasePath = join(directory, 'identity.sqlite');
  const presetsFile = join(directory, 'presets.json');
  await writeFile(presetsFile, JSON.stringify({ persons: [{ personId: 'wang', displayName: '小王' }] }));
  const runtimeConfig = config(databasePath, presetsFile);
  const senderContext = { ...context(), sessionKey: 'agent:main:sender-session' } as OpenClawPluginToolContext;
  delete (senderContext as unknown as { requesterSenderId?: unknown }).requesterSenderId;
  try {
    rememberTrustedInboundReply({
      sessionKey: senderContext.sessionKey,
      channel: 'whatsapp',
      accountId: 'secondary',
      conversationId: 'direct-1',
      senderId: 'owner-1',
    });
    const bound = await identityBindChannel(runtimeConfig, { personId: 'wang', target: 'current_sender' }, senderContext) as { status: string };
    assert.equal(bound.status, 'bound');
    const resolved = await identityResolve(runtimeConfig, { reference: 'self' }, senderContext) as { status: string; person?: { personId: string } };
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.person?.personId, 'wang');
  } finally {
    forgetTrustedInboundReply(senderContext.sessionKey);
    await rm(directory, { recursive: true, force: true });
  }
});

test('WhatsApp direct session identity bridges runtimes that omit sender metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'amadeus-identity-whatsapp-direct-'));
  const databasePath = join(directory, 'identity.sqlite');
  const presetsFile = join(directory, 'presets.json');
  await writeFile(presetsFile, JSON.stringify({ persons: [{ personId: 'wang', displayName: '小王' }] }));
  const runtimeConfig = config(databasePath, presetsFile);
  const senderContext = {
    ...context(),
    sessionKey: 'agent:main:whatsapp:secondary:direct:+8613279112887',
  } as OpenClawPluginToolContext;
  delete (senderContext as unknown as { requesterSenderId?: unknown }).requesterSenderId;
  delete (senderContext as unknown as { requesterSenderE164?: unknown }).requesterSenderE164;
  try {
    const bound = await identityBindChannel(runtimeConfig, { personId: 'wang', target: 'current_sender' }, senderContext) as { status: string };
    assert.equal(bound.status, 'bound');
    const resolved = await identityResolve(runtimeConfig, { reference: 'self' }, senderContext) as { status: string; person?: { personId: string } };
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.person?.personId, 'wang');
  } finally {
    forgetTrustedInboundReply(senderContext.sessionKey);
    await rm(directory, { recursive: true, force: true });
  }
});
