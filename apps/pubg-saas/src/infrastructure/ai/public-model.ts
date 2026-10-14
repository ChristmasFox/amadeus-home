import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { NaturalLanguageQueryPlanner } from '../../application/nl-query-planner.js';
import { readPublicModelConfig } from './model-config.js';
import { createPublicModelFetch } from './model-fetch.js';

export interface ConfiguredPublicQueryPlanner {
  planner: NaturalLanguageQueryPlanner;
  provider: 'saas-combo';
  modelId: string;
}

/** Creates an inference-only model client; this module has no tools or domain access. */
export function createPublicQueryPlanner(env: NodeJS.ProcessEnv): ConfiguredPublicQueryPlanner | null {
  const config = readPublicModelConfig(env);
  if (!config) return null;
  const provider = createOpenAICompatible({
    name: 'saas-combo',
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    fetch: createPublicModelFetch(config.allowedInternalHosts),
    // 9Router's OpenAI-compatible endpoint may stream when this field is omitted.
    // AI SDK generateText expects the non-streaming JSON response from doGenerate.
    transformRequestBody: body => ({ ...body, stream: body.stream ?? false }),
  });
  return {
    planner: new NaturalLanguageQueryPlanner(provider.chatModel(config.modelId)),
    provider: 'saas-combo',
    modelId: config.modelId,
  };
}
