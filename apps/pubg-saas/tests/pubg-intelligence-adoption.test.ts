import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { MockLanguageModelV4 } from 'ai/test';
import type { NormalizedMatch, TeamContext } from '@agent/pubg-domain/core';
import { DEFAULT_REVIEW_FEATURE_VERSION, DEFAULT_TELEMETRY_PARSER_VERSION } from '@agent/pubg-domain/core';
import { adaptKookMessagePayload } from '../src/channels/kook/message-adapter.js';
import { readGatePubgIntelligence } from '../src/application/gate-pubg-intelligence.js';
import { gatePubgIntelligenceEnabledForTenant, readGatePubgIntelligenceCanary } from '../src/application/pubg-intelligence-canary.js';
import { createKookPublicQueryHandler } from '../src/application/kook-public-query-handler.js';

const now = new Date('2026-10-17T00:00:00.000Z');

function match(matchId: string, timestamp: number): NormalizedMatch {
  return {
    schemaVersion: 3, matchId, shard: 'steam', createdAt: new Date(timestamp).toISOString(), timestamp,
    matchType: 'competitive', gameMode: 'squad-fpp', isCompetitive: true, mapName: 'Erangel', duration: 900,
    patchVersion: 'fixture', players: [{ accountId: 'authorized-player', playerName: 'Fixture', displayName: 'Fixture', rank: null,
      kills: 0, assists: 0, damage: 0, dbnos: 0, revives: 0, headshotKills: 0, survivalTime: 0, longestKill: 0, deaths: null, deathSemantics: 'unknown' }],
  };
}

function authorizedFixture(store = 'postgres') {
  const calls: Array<{ method: string; value?: unknown }> = [];
  const authorizedQuery = {
    teamContext: { tenantId: 'tenant-canary', teamId: 'team-canary', team: { id: 'team-canary', label: 'fixture', platform: 'steam', players: [{ id: 'authorized-player', name: 'Fixture', aliases: [] }] } } as TeamContext,
    repository: {
      store,
      listMatches: async (options: unknown) => { calls.push({ method: 'listMatches', value: options }); return [match('match-a', now.getTime() - 1000), match('match-b', now.getTime() - 2000)]; },
      get: async (key: unknown) => { calls.push({ method: 'get', value: key }); return null; },
    },
  };
  return { authorizedQuery, calls };
}

test('Gate canary is off by default and requires an exact valid tenant allowlist', () => {
  assert.equal(readGatePubgIntelligenceCanary({}).status, 'disabled_unconfigured');
  assert.equal(readGatePubgIntelligenceCanary({ GATE_PUBG_INTELLIGENCE_ENABLED: '1' }).status, 'misconfigured');
  assert.equal(readGatePubgIntelligenceCanary({ GATE_PUBG_INTELLIGENCE_ENABLED: 'true', GATE_PUBG_INTELLIGENCE_CANARY_TENANT_IDS: 'tenant-canary' }).enabled, false);
  const enabled = readGatePubgIntelligenceCanary({ GATE_PUBG_INTELLIGENCE_ENABLED: '1', GATE_PUBG_INTELLIGENCE_CANARY_TENANT_IDS: 'tenant-canary' });
  assert.equal(enabled.status, 'enabled_canary');
  assert.equal(gatePubgIntelligenceEnabledForTenant(enabled, 'tenant-canary'), true);
  assert.equal(gatePubgIntelligenceEnabledForTenant(enabled, 'tenant-other'), false);
  assert.equal(readGatePubgIntelligenceCanary({ GATE_PUBG_INTELLIGENCE_ENABLED: '1', GATE_PUBG_INTELLIGENCE_CANARY_TENANT_IDS: 'tenant-canary,tenant-canary' }).enabled, false);
});

test('Gate adoption reads only the authorized Postgres repository, with bounded versions and partial coverage', async () => {
  const { authorizedQuery, calls } = authorizedFixture();
  const summary = await readGatePubgIntelligence({ authorizedQuery, windowDays: 7, now });
  assert.deepEqual(calls[0], { method: 'listMatches', value: { fromMs: now.getTime() - 7 * 86_400_000, toMs: now.getTime(), limit: 30 } });
  assert.equal(calls.filter((call) => call.method === 'get').length, 2);
  assert.ok(calls.filter((call) => call.method === 'get').every((call) => JSON.stringify(call.value) === JSON.stringify({
    matchId: call.value && (call.value as { matchId: string }).matchId,
    parserVersion: DEFAULT_TELEMETRY_PARSER_VERSION,
    featureVersion: DEFAULT_REVIEW_FEATURE_VERSION,
  })));
  assert.equal(summary.source, 'compact-team-telemetry-features');
  assert.equal(summary.coverage.requestedMatches, 2);
  assert.equal(summary.coverage.currentFeatureMatches, 0);
  assert.equal(summary.coverage.freshness, 'no_current_version_features');
  assert.equal(summary.rawEventStreamAvailable, false);
  assert.equal(JSON.stringify(summary).includes('match-a'), false);
  const payload = adaptKookMessagePayload({ type: 'text', content: '摘要\n' + (await import('../src/application/gate-pubg-intelligence.js')).renderGatePubgIntelligenceKook(summary, 7) });
  assert.equal(payload.type, 'kmarkdown');
  assert.match(payload.content, /缺失或旧版本 2 场/u);
  assert.match(payload.content, /不代表没有发生团战/u);
});

test('Gate adapter rejects a non-Postgres repository before it reads anything', async () => {
  const { authorizedQuery, calls } = authorizedFixture('sqlite');
  await assert.rejects(readGatePubgIntelligence({ authorizedQuery, windowDays: 7, now }), /postgres_repository_required/u);
  assert.deepEqual(calls, []);
});

test('typed KOOK tool reads only an authorized canary tenant and returns its bounded renderer', async () => {
  const { authorizedQuery, calls } = authorizedFixture();
  const usage = {
    inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 8, text: 8, reasoning: undefined },
  };
  const toolCall = {
    content: [{ type: 'tool-call' as const, toolCallId: randomUUID(), toolName: 'pubg_intelligence_summary', input: JSON.stringify({ windowDays: '7' }) }],
    finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' }, usage, warnings: [],
  };
  const finalText = {
    content: [{ type: 'text' as const, text: '我按当前授权小队的覆盖情况整理了摘要。' }],
    finishReason: { unified: 'stop' as const, raw: 'stop' }, usage, warnings: [],
  };
  const model = new MockLanguageModelV4({ doGenerate: [toolCall, finalText] });
  const authorizer = {
    async authorize() { return { kind: 'authorized', query: authorizedQuery }; },
    async loadAgentConversation() { return { turns: [], currentSpeakerLabel: '当前成员', currentQuoteContext: null }; },
    async recordAgentRun() {},
  };
  const canary = readGatePubgIntelligenceCanary({ GATE_PUBG_INTELLIGENCE_ENABLED: '1', GATE_PUBG_INTELLIGENCE_CANARY_TENANT_IDS: 'tenant-canary' });
  const handler = createKookPublicQueryHandler({
    authorizer: authorizer as never,
    claims: {} as never,
    agent: { model, provider: 'fixture', modelId: 'fixture' },
    pubgIntelligenceCanary: canary,
    now: () => now,
  });
  const job = {
    botAccountId: 'fixture-bot', eventId: randomUUID(), leaseToken: randomUUID(), attemptCount: 1,
    request: { kind: 'group', event: { content: '最近七天团战结果和队友伤害怎么样？', channelId: 'fixture-channel', guildId: 'fixture-guild', userId: 'fixture-user' } },
    boundTeam: { tenantId: 'tenant-canary', teamId: 'team-canary' },
  };
  const reply = await handler(job as never, new AbortController().signal);
  assert.equal(reply?.content, '我按当前授权小队的覆盖情况整理了摘要。');
  assert.equal(calls.filter((call) => call.method === 'get').length, 2);
  const toolPrompt = JSON.stringify(model.doGenerateCalls[1]?.prompt);
  assert.match(toolPrompt, /Gate Intelligence 1\.0\.0/u);
  assert.match(toolPrompt, /缺失或旧版本 2 场/u);

  const deniedFixture = authorizedFixture();
  const deniedModel = new MockLanguageModelV4({ doGenerate: [toolCall, finalText] });
  const deniedHandler = createKookPublicQueryHandler({
    authorizer: { ...authorizer, async authorize() { return { kind: 'authorized', query: deniedFixture.authorizedQuery }; } } as never,
    claims: {} as never,
    agent: { model: deniedModel, provider: 'fixture', modelId: 'fixture' },
    pubgIntelligenceCanary: readGatePubgIntelligenceCanary({ GATE_PUBG_INTELLIGENCE_ENABLED: '1', GATE_PUBG_INTELLIGENCE_CANARY_TENANT_IDS: 'different-tenant' }),
    now: () => now,
  });
  const deniedReply = await deniedHandler({ ...job, eventId: randomUUID() } as never, new AbortController().signal);
  assert.ok(deniedReply);
  assert.deepEqual(deniedFixture.calls, []);
  assert.match(JSON.stringify(deniedModel.doGenerateCalls[1]?.prompt), /未对这支已授权小队开启/u);
});
