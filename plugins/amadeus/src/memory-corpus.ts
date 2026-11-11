import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { chatKind } from './remember.js';

/**
 * memory_search / memory_get are built-in OpenClaw tools. Their schema is narrowed to the registered corpus at image
 * build time (scripts/patch-openclaw-memory-corpus.mjs); this is the run-time side: a model that still sends a corpus
 * that is not registered here (wiki, sessions, all) used to get an empty `not-registered` result. It now searches the
 * registered corpus instead. Anything else about the call is left alone, and real errors are not swallowed.
 */
export const MEMORY_TOOLS: readonly string[] = ['memory_search', 'memory_get'];

interface MemoryCorpusConfig {
  memory?: { search?: { sources?: unknown } };
  plugins?: { allow?: unknown };
}

/** The corpora this deployment actually registers: memory always; sessions and wiki only when configured. */
export function registeredCorpora(config: unknown): string[] {
  const cfg = (config ?? {}) as MemoryCorpusConfig;
  const corpora = ['memory'];
  const sources = Array.isArray(cfg.memory?.search?.sources) ? cfg.memory!.search!.sources as unknown[] : ['memory'];
  if (sources.includes('sessions')) corpora.push('sessions');
  const allow = Array.isArray(cfg.plugins?.allow) ? cfg.plugins!.allow as unknown[] : [];
  if (allow.includes('memory-wiki')) corpora.push('wiki');
  return corpora;
}

/** Params with an unregistered `corpus` replaced by `memory`, or undefined when nothing needs to change. */
export function normalizeMemoryCorpus(toolName: string, params: Record<string, unknown> | undefined, registered: readonly string[]): Record<string, unknown> | undefined {
  if (!MEMORY_TOOLS.includes(toolName) || !params) return undefined;
  const corpus = params.corpus;
  if (typeof corpus !== 'string') return undefined;
  const value = corpus.trim().toLowerCase();
  // `all` spans every registered corpus, which is just `memory` when memory is the only one.
  const valid = value === 'all' ? registered.length > 1 : registered.includes(value);
  if (valid) return undefined;
  return { ...params, corpus: 'memory' };
}

export function registerMemoryCorpus(api: OpenClawPluginApi): void {
  api.on('before_tool_call', (event) => {
    const params = normalizeMemoryCorpus(event.toolName, event.params, registeredCorpora(api.config));
    if (!params) return undefined;
    api.logger.info(`amadeus ${event.toolName} corpus ${JSON.stringify(event.params.corpus)} is not registered; searching memory instead`);
    return { params };
  });
}

/**
 * Group and direct chats recall memory the same way; there is no "ask in private" route. Tool behaviour only.
 */
export const MEMORY_RECALL_RULE = [
  '【记忆查询】',
  '群聊和私聊一样，可以正常使用 memory_search / memory_get 查记忆，不要因为在群里就让用户改到私聊再问。',
  '搜索结果为空，或返回 corpus 警告 / not-registered 时，不代表没有记忆：换关键词，或改用 corpus=memory（或省略 corpus）再查一次，再下结论。',
].join('\n');

export function registerMemoryRecallRule(api: OpenClawPluginApi): void {
  api.on('before_prompt_build', (_event, context) => {
    if (chatKind(context.sessionKey) === 'other') return undefined;
    return { appendSystemContext: MEMORY_RECALL_RULE };
  });
}
