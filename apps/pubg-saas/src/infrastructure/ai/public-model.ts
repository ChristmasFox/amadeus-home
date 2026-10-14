import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { NaturalLanguageQueryPlanner } from '../../application/nl-query-planner.js';
import { KookGroupWriteIntentParser } from '../../application/kook-group-write-intent.js';
import { readPublicModelConfig } from './model-config.js';
import { createPublicModelFetch } from './model-fetch.js';

export interface ConfiguredPublicQueryPlanner {
  planner: NaturalLanguageQueryPlanner;
  provider: 'saas-combo';
  modelId: string;
}

export interface ConfiguredPublicGroupWriteIntentParser {
  parser: KookGroupWriteIntentParser;
  provider: 'saas-combo';
  modelId: string;
}

function createPublicChatModel(env: NodeJS.ProcessEnv): { model: Exclude<LanguageModel, string>; modelId: string } | null {
  const config = readPublicModelConfig(env);
  if (!config) return null;
  const provider = createOpenAICompatible({
    name: 'saas-combo',
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    fetch: createPublicModelFetch(config.allowedInternalHosts),
    // 9Router's OpenAI-compatible endpoint may stream when this field is omitted.
    transformRequestBody: body => ({ ...body, stream: body.stream ?? false }),
  });
  return { model: provider.chatModel(config.modelId), modelId: config.modelId };
}

/** Creates an inference-only model client; this module has no tools or domain access. */
export function createPublicQueryPlanner(env: NodeJS.ProcessEnv): ConfiguredPublicQueryPlanner | null {
  const configured = createPublicChatModel(env);
  if (!configured) return null;
  return {
    planner: new NaturalLanguageQueryPlanner(configured.model),
    provider: 'saas-combo',
    modelId: configured.modelId,
  };
}

export function createPublicGroupWriteIntentParser(env: NodeJS.ProcessEnv): ConfiguredPublicGroupWriteIntentParser | null {
  const configured = createPublicChatModel(env);
  if (!configured) return null;
  return {
    parser: new KookGroupWriteIntentParser(configured.model),
    provider: 'saas-combo',
    modelId: configured.modelId,
  };
}
