import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { RealtimeToolAudit, classifyRealtimeEvidence, isRealtimeFactQuery, realtimeToolMustBeBlocked, registerRealtimeFacts } from '../src/realtime-facts.js';

test('realtime query classifier covers version and latest-news wording', () => {
  assert.equal(isRealtimeFactQuery('Claude Opus 最新版本是多少？'), true);
  assert.equal(isRealtimeFactQuery('今天有什么新闻？'), true);
  assert.equal(isRealtimeFactQuery('解释一下 TypeScript 泛型'), false);
});

test('realtime gate requires web_search before other tools', () => {
  assert.equal(realtimeToolMustBeBlocked(true, false, 'memory_search'), true);
  assert.equal(realtimeToolMustBeBlocked(true, false, 'web_fetch'), false);
  assert.equal(realtimeToolMustBeBlocked(true, true, 'memory_search'), false);
});

test('evidence without provenance is unknown and expired evidence is stale', () => {
  const now = new Date('2026-10-22T00:00:00.000Z');
  assert.equal(classifyRealtimeEvidence({ source: null, observedAt: null, validUntil: null }, now).freshness, 'unknown');
  assert.equal(classifyRealtimeEvidence({ source: 'https://example.test', observedAt: '2026-10-21T00:00:00Z', validUntil: '2026-10-21T12:00:00Z' }, now).freshness, 'stale');
  assert.equal(classifyRealtimeEvidence({ source: 'https://example.test', observedAt: '2026-10-21T00:00:00Z', validUntil: '2026-10-23T00:00:00Z' }, now).freshness, 'fresh');
});

test('search audit records success, timeout and bounded result summary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'realtime-audit-'));
  const path = join(directory, 'audit.jsonl');
  const audit = new RealtimeToolAudit(path);
  audit.start({ session: 'wa:owner', runId: 'run-1', tool: 'web_search', toolCallId: 'call-1' });
  const success = await audit.finish({ session: 'wa:owner', runId: 'run-1', tool: 'web_search', toolCallId: 'call-1', result: { statusCode: 200, results: [{ title: 'one' }] } });
  assert.equal(success?.success, true);
  assert.equal(success?.httpStatus, 200);
  audit.start({ session: 'wa:owner', runId: 'run-2', tool: 'web_fetch', toolCallId: 'call-2' });
  const failure = await audit.finish({ session: 'wa:owner', runId: 'run-2', tool: 'web_fetch', toolCallId: 'call-2', error: 'request timed out' });
  assert.equal(failure?.timedOut, true);
  const lines = (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
  assert.equal(lines.length, 2);
  assert.equal(lines[0]?.schema, 'amadeus-realtime-tool-audit/v1');
  assert.equal(lines[1]?.errorCode, 'timeout');
  assert.equal(Object.hasOwn(lines[0]!, 'result'), false);
});

test('registered hooks inject the rule and gate a realtime run before audit completion', async () => {
  const hooks = new Map<string, (...args: any[]) => any>();
  const logs: string[] = [];
  const api = {
    on(name: string, handler: (...args: any[]) => any) { hooks.set(name, handler); },
    logger: { info(value: string) { logs.push(value); }, warn(value: string) { logs.push(value); }, error(value: string) { logs.push(value); } },
  } as any;
  registerRealtimeFacts(api);
  const context = { runId: 'run-hook', sessionKey: 'session-hook' };
  const prompt = await hooks.get('before_prompt_build')!({ prompt: 'Claude Opus 最新版本？', messages: [] }, context);
  assert.match(prompt.appendSystemContext, /web_search/u);
  const blocked = await hooks.get('before_tool_call')!({ toolName: 'memory_search', params: {}, runId: 'run-hook' }, context);
  assert.equal(blocked.block, true);
  const allowed = await hooks.get('before_tool_call')!({ toolName: 'web_search', params: {}, runId: 'run-hook', toolCallId: 'call-hook' }, context);
  assert.equal(allowed, undefined);
  await hooks.get('after_tool_call')!({ toolName: 'web_search', params: {}, runId: 'run-hook', toolCallId: 'call-hook', result: { statusCode: 200 } }, context);
  const afterSearch = await hooks.get('before_tool_call')!({ toolName: 'memory_search', params: {}, runId: 'run-hook' }, context);
  assert.equal(afterSearch, undefined);
  assert.ok(logs.some(value => value.includes('realtime_tool_audit')));
});
