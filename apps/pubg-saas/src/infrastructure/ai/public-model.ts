import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { NaturalLanguageQueryPlanner } from '../../application/nl-query-planner.js';
import { readPublicModelConfig } from './model-config.js';

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
  });
  return {
    planner: new NaturalLanguageQueryPlanner(provider.chatModel(config.modelId)),
    provider: 'saas-combo',
    modelId: config.modelId,
  };
}
