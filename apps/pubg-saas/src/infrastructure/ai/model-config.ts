export interface PublicModelConfig {
  baseURL: string;
  modelId: string;
  apiKey: string;
}

const MODEL_ENV_KEYS = ['MODEL_BASE_URL', 'MODEL_ID', 'MODEL_API_KEY'] as const;

function clean(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result ? result : undefined;
}

function validBaseURL(value: string): boolean {
  if (value.length > 500) return false;
  try {
    const url = new URL(value);
    const localHttp = url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return (url.protocol === 'https:' || localHttp) &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

/** Return null only when the complete optional provider configuration is absent. */
export function readPublicModelConfig(env: NodeJS.ProcessEnv): PublicModelConfig | null {
  const values = MODEL_ENV_KEYS.map(key => clean(env[key]));
  if (values.every(value => value === undefined)) return null;
  if (values.some(value => value === undefined)) throw new Error('pubg_saas_model_config_incomplete');
  const [baseURL, modelId, apiKey] = values as [string, string, string];
  if (!validBaseURL(baseURL) || modelId.length > 200 || /[\u0000-\u001f\u007f]/u.test(modelId)
    || apiKey.length > 4096 || /[\u0000-\u001f\u007f]/u.test(apiKey)) {
    throw new Error('pubg_saas_model_config_invalid');
  }
  return { baseURL, modelId, apiKey };
}
