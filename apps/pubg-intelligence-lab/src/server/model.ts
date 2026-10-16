import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

export function createResearchModel(environment: NodeJS.ProcessEnv = process.env): Exclude<LanguageModel, string> | undefined {
  const baseURL = environment.PUBG_INTELLIGENCE_AI_BASE_URL?.trim();
  const apiKey = environment.PUBG_INTELLIGENCE_AI_API_KEY?.trim();
  const modelId = environment.PUBG_INTELLIGENCE_AI_MODEL?.trim() || 'google/gemini-2.5-flash';
  if (!baseURL || !apiKey) return undefined;
  const provider = createOpenAICompatible({ name: 'pubg-intelligence-lab', baseURL, apiKey });
  return provider.chatModel(modelId);
}
