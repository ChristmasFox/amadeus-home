import assert from 'node:assert/strict';
import test from 'node:test';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { MEMORY_RECALL_RULE, normalizeMemoryCorpus, registerMemoryCorpus, registerMemoryRecallRule, registeredCorpora } from '../src/memory-corpus.js';

test('only the corpora the deployment registers count: memory always, sessions and wiki only when configured', () => {
  assert.deepEqual(registeredCorpora({ memory: { search: { sources: ['memory'] } }, plugins: { allow: ['memory-core'] } }), ['memory']);
  assert.deepEqual(registeredCorpora(undefined), ['memory']);
  assert.deepEqual(registeredCorpora({ memory: { search: { sources: ['memory', 'sessions'] } } }), ['memory', 'sessions']);
  assert.deepEqual(registeredCorpora({ plugins: { allow: ['memory-core', 'memory-wiki'] } }), ['memory', 'wiki']);
});

test('an unregistered corpus becomes memory instead of an empty not-registered result', () => {
  for (const tool of ['memory_search', 'memory_get']) {
    for (const corpus of ['wiki', 'sessions', 'all', 'WIKI', ' wiki ', 'anything']) {
      assert.deepEqual(normalizeMemoryCorpus(tool, { query: 'q', path: 'p', corpus }, ['memory']), { query: 'q', path: 'p', corpus: 'memory' }, `${tool} ${corpus}`);
    }
  }
  assert.deepEqual(normalizeMemoryCorpus('memory_search', { query: 'q', maxResults: 3, corpus: 'wiki' }, ['memory']), { query: 'q', maxResults: 3, corpus: 'memory' }, 'other params are kept');
});

test('registered or absent corpus, other tools and non-string values are left alone', () => {
  assert.equal(normalizeMemoryCorpus('memory_search', { query: 'q', corpus: 'memory' }, ['memory']), undefined);
  assert.equal(normalizeMemoryCorpus('memory_search', { query: 'q' }, ['memory']), undefined);
  assert.equal(normalizeMemoryCorpus('memory_search', { query: 'q', corpus: 'wiki' }, ['memory', 'wiki']), undefined, 'wiki is valid when registered');
  assert.equal(normalizeMemoryCorpus('memory_search', { query: 'q', corpus: 'all' }, ['memory', 'wiki']), undefined, 'all is valid when more than one corpus exists');
  assert.equal(normalizeMemoryCorpus('web_search', { query: 'q', corpus: 'wiki' }, ['memory']), undefined);
  assert.equal(normalizeMemoryCorpus('memory_search', { query: 'q', corpus: 3 }, ['memory']), undefined);
  assert.equal(normalizeMemoryCorpus('memory_search', undefined, ['memory']), undefined);
});

function setup(config: unknown) {
  const hooks: Record<string, (event: any, context: any) => any> = {};
  const logger = { warn() {}, info() {}, error() {}, debug() {} };
  const api = { logger, config, on: (name: string, handler: (event: any, context: any) => any) => { hooks[name] = handler; } } as unknown as OpenClawPluginApi;
  return { api, hooks };
}

test('the before_tool_call hook rewrites the params with the deployment config', () => {
  const { api, hooks } = setup({ memory: { search: { sources: ['memory'] } } });
  registerMemoryCorpus(api);
  assert.deepEqual(hooks.before_tool_call!({ toolName: 'memory_search', params: { query: 'q', corpus: 'wiki' } }, {}), { params: { query: 'q', corpus: 'memory' } });
  assert.equal(hooks.before_tool_call!({ toolName: 'memory_search', params: { query: 'q', corpus: 'memory' } }, {}), undefined);
});

test('chat sessions, groups included, are told memory recall works there and empty results mean retry; internal sessions get nothing', () => {
  const { api, hooks } = setup({});
  registerMemoryRecallRule(api);
  const group = hooks.before_prompt_build!({}, { sessionKey: 'agent:main:whatsapp:group:fixture@g.us:thread:whatsapp-account-secondary' });
  assert.equal(group.appendSystemContext, MEMORY_RECALL_RULE);
  assert.ok(hooks.before_prompt_build!({}, { sessionKey: 'agent:main:whatsapp:secondary:direct:+10000000000' }));
  assert.equal(hooks.before_prompt_build!({}, { sessionKey: 'agent:main:cron:job' }), undefined);
  assert.match(MEMORY_RECALL_RULE, /群聊和私聊一样/u);
  assert.match(MEMORY_RECALL_RULE, /换关键词/u);
  assert.match(MEMORY_RECALL_RULE, /corpus=memory/u);
  assert.doesNotMatch(MEMORY_RECALL_RULE, /Arthur|Kurisu|MEMORY\.md|SOUL/u, 'neutral tool-behaviour wording only');
});
