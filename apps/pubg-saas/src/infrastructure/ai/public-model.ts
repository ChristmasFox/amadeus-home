import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { NaturalLanguageQueryPlanner } from '../../application/nl-query-planner.js';
import { readPublicModelConfig } from './model-config.js';
import { createPublicModelFetch } from './model-fetch.js';

export interface ConfiguredPublicQueryPlanner {
  planner: NaturalLanguageQueryPlanner;
  provider: 'saas-combo';
  modelId: string;
}

export interface ConfiguredPublicAgentModel {
  model: Exclude<LanguageModel, string>;
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

/** Shared public chat model. Tools are bound per trusted ingress request by
 * the application layer; this infrastructure module has no domain access. */
export function createPublicAgentModel(env: NodeJS.ProcessEnv): ConfiguredPublicAgentModel | null {
  const configured = createPublicChatModel(env);
  if (!configured) return null;
  return {
    model: configured.model,
    provider: 'saas-combo',
    modelId: configured.modelId,
  };
}
