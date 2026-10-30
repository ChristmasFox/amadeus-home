import assert from 'node:assert/strict';
import test from 'node:test';
import { getToolPluginMetadata } from 'openclaw/plugin-sdk/tool-plugin';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import entry from '../src/index.js';
import { registerPubgEvidenceGuard } from '../src/evidence-guard.js';
import { enforceRecentMatches, parseRecentMatchCount, statsSelector } from '../src/recent-matches.js';

test('last-N requests are recognised; periods and unrelated numbers are not', () => {
  const cases: Array<[string, number | null]> = [
    ['近5场战绩', 5], ['最近10场', 10], ['最近三局战绩', 3], ['@Kurisu 近 5 场战绩', 5], ['前5把', 5], ['最近二十场', 20],
    ['最近十五局', 15], ['过去两场', 2], ['最近100场', 100], ['近1场战绩', 1],
    ['近5天战绩', null], ['最近一周战绩', null], ['今日战绩', null], ['昨天战绩', null], ['最近101场', null], ['最近0场', null], ['我有5个朋友', null],
  ];
  for (const [text, expected] of cases) assert.equal(parseRecentMatchCount(text), expected, text);
  assert.equal(parseRecentMatchCount(undefined), null);
});

test('recentMatches is the whole selector: a date range sent with it is ignored, and it is the only way to omit a selector', () => {
  const today = { type: 'relative_period', value: 'today' };
  assert.deepEqual(statsSelector(today, 5), { type: 'last_n_matches', count: 5 });
  assert.deepEqual(statsSelector(undefined, 7), { type: 'last_n_matches', count: 7 });
  assert.equal(statsSelector(today, undefined), today);
  assert.throws(() => statsSelector(undefined, undefined), /selector or recentMatches/);
  assert.equal(statsSelector(today, 0), today, 'an out-of-range count is not honoured');
});

test('the tool schema exposes recentMatches as a bounded integer and keeps selector optional', () => {
  const tool = getToolPluginMetadata(entry)!.tools.find((item) => item.name === 'pubg_query_stats')!;
  const properties = tool.parameters.properties as Record<string, { type?: string; minimum?: number; maximum?: number; description?: string }>;
  assert.equal(properties.recentMatches?.type, 'integer');
  assert.equal(properties.recentMatches?.minimum, 1);
  assert.equal(properties.recentMatches?.maximum, 100);
  assert.match(properties.recentMatches?.description ?? '', /NO date/);
  assert.ok(!(tool.parameters.required as string[] | undefined)?.includes('selector'));
  assert.match(tool.description, /recentMatches=N and no date/);
});

test('enforceRecentMatches replaces a model-chosen date range and leaves a correct call alone', () => {
  const wrong = { team: true, metrics: ['matches'], selector: { type: 'time_range', start: '2026-10-30T00:00:00+08:00', end: '2026-10-30T17:23:00+08:00' } };
  assert.deepEqual(enforceRecentMatches(wrong, 5), { team: true, metrics: ['matches'], recentMatches: 5 });
  assert.deepEqual(enforceRecentMatches({ ...wrong, selector: { type: 'relative_period', value: 'today' } }, 5)?.recentMatches, 5);
  assert.equal('selector' in (enforceRecentMatches(wrong, 5) ?? {}), false);
  assert.deepEqual(enforceRecentMatches({ team: true, recentMatches: 5 }, 5), null);
});

test('the guard rewrites the tool call only on a turn that asked for the last N matches', () => {
  const hooks = new Map<string, (event: any, context: any) => any>();
  const warnings: string[] = [];
  registerPubgEvidenceGuard({
    on: (name: string, handler: (event: any, context: any) => any) => { hooks.set(name, handler); },
    logger: { warn: (message: string) => warnings.push(message) },
  } as unknown as OpenClawPluginApi);
  const dispatch = hooks.get('before_dispatch')!;
  const beforeTool = hooks.get('before_tool_call')!;
  const todayCall = { toolName: 'pubg_query_stats', params: { team: true, metrics: ['matches', 'kills'], selector: { type: 'relative_period', value: 'today' } } };
  const context = { sessionKey: 'wa-session' };

  dispatch({ body: '近5场战绩' }, context);
  const rewritten = beforeTool(todayCall, context) as { params: Record<string, unknown> };
  assert.equal(rewritten.params.recentMatches, 5);
  assert.equal('selector' in rewritten.params, false);
  assert.match(warnings.join('\n'), /last-5-matches/);

  assert.equal(beforeTool({ toolName: 'pubg_search_matches', params: todayCall.params }, context), undefined, 'other tools are untouched');
  dispatch({ body: '今日战绩' }, context);
  const bare = beforeTool(todayCall, context) as { params: Record<string, unknown> } | undefined;
  assert.ok(!bare || bare.params.recentMatches === undefined, 'a today request keeps its date selector');
  assert.deepEqual((bare?.params.selector ?? todayCall.params.selector), todayCall.params.selector);
  dispatch({ body: '近3场' }, { sessionKey: 'other-session' });
  assert.equal(beforeTool(todayCall, context) === undefined || (beforeTool(todayCall, context) as any).params.recentMatches === undefined, true, 'sessions do not leak into each other');
});
