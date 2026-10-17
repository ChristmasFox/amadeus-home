import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { lstatSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

interface ExternalResearchModelConfig {
  baseURL: string;
  apiKey: string;
  modelId?: string;
}

function safeExternalConfig(pathValue: string): ExternalResearchModelConfig | undefined {
  try {
    const path = resolve(pathValue);
    const file = lstatSync(path);
    const parent = statSync(dirname(path));
    if (!file.isFile() || file.isSymbolicLink() || file.uid !== process.getuid?.()
      || (file.mode & 0o777) !== 0o600 || parent.uid !== process.getuid?.() || (parent.mode & 0o077) !== 0) return undefined;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const baseURL = typeof parsed.baseURL === 'string' ? parsed.baseURL.trim() : '';
    const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '';
    const modelId = typeof parsed.modelId === 'string' ? parsed.modelId.trim() : undefined;
    const url = new URL(baseURL);
    if (!apiKey || (url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return undefined;
    return { baseURL, apiKey, ...(modelId ? { modelId } : {}) };
  } catch {
    return undefined;
  }
}

export function createResearchModel(environment: NodeJS.ProcessEnv = process.env): Exclude<LanguageModel, string> | undefined {
  let baseURL = environment.PUBG_INTELLIGENCE_AI_BASE_URL?.trim();
  let apiKey = environment.PUBG_INTELLIGENCE_AI_API_KEY?.trim();
  const externalPath = environment.PUBG_INTELLIGENCE_AI_CONFIG_FILE?.trim()
    || resolve(homedir(), '.config', 'amadeus', 'pubg-intelligence-ai.json');
  const external = safeExternalConfig(externalPath);
  baseURL ||= external?.baseURL;
  apiKey ||= external?.apiKey;
  const modelId = environment.PUBG_INTELLIGENCE_AI_MODEL?.trim() || external?.modelId || 'google/gemini-2.5-flash';
  if (!baseURL || !apiKey) return undefined;
  const provider = createOpenAICompatible({
    name: 'pubg-intelligence-lab',
    baseURL,
    apiKey,
    // 9Router may default to SSE when `stream` is omitted. generateText uses
    // non-streaming doGenerate calls, so make the OpenAI-compatible contract
    // explicit while preserving `stream: true` for any actual streaming call.
    transformRequestBody: body => 'stream' in body ? body : { ...body, stream: false },
  });
  return provider.chatModel(modelId);
}
