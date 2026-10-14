import { isIP } from 'node:net';

export interface PublicModelConfig {
  baseURL: string;
  modelId: string;
  apiKey: string;
  allowedInternalHosts: readonly string[];
}

const MODEL_ENV_KEYS = ['MODEL_BASE_URL', 'MODEL_ID', 'MODEL_API_KEY'] as const;
const INTERNAL_HOSTS_ENV_KEY = 'MODEL_ALLOWED_INTERNAL_HOSTS';

function clean(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result ? result : undefined;
}

function parseAllowedInternalHosts(value: string | undefined): string[] {
  const raw = clean(value);
  if (!raw) return [];
  const hosts = raw.split(',').map(entry => entry.trim());
  if (hosts.some(host => !host) || new Set(hosts).size !== hosts.length) {
    throw new Error('pubg_saas_model_config_invalid');
  }
  const parsedHosts = hosts.map(host => {
    const match = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*):([1-9][0-9]{0,4})$/iu.exec(host);
    if (!match || match[1]!.length > 253 || isIP(match[1]!) !== 0) {
      throw new Error('pubg_saas_model_config_invalid');
    }
    const port = Number(match[2]);
    if (port > 65535) throw new Error('pubg_saas_model_config_invalid');
    return `${match[1]!.toLowerCase()}:${port}`;
  });
  if (new Set(parsedHosts).size !== parsedHosts.length) throw new Error('pubg_saas_model_config_invalid');
  return parsedHosts;
}

function validBaseURL(value: string, allowedInternalHosts: readonly string[]): boolean {
  if (value.length > 500) return false;
  try {
    const url = new URL(value);
    const explicitlyAllowedHttp = url.protocol === 'http:' && allowedInternalHosts.includes(url.host);
    return (url.protocol === 'https:' || explicitlyAllowedHttp) &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

/** Return null only when the complete optional provider configuration is absent. */
export function readPublicModelConfig(env: NodeJS.ProcessEnv): PublicModelConfig | null {
  const values = MODEL_ENV_KEYS.map(key => clean(env[key]));
  const allowedInternalHosts = parseAllowedInternalHosts(env[INTERNAL_HOSTS_ENV_KEY]);
  if (values.every(value => value === undefined)) {
    if (allowedInternalHosts.length > 0) throw new Error('pubg_saas_model_config_incomplete');
    return null;
  }
  if (values.some(value => value === undefined)) throw new Error('pubg_saas_model_config_incomplete');
  const [baseURL, modelId, apiKey] = values as [string, string, string];
  if (!validBaseURL(baseURL, allowedInternalHosts) || modelId.length > 200 || /[\u0000-\u001f\u007f]/u.test(modelId)
    || apiKey.length > 4096 || /[\u0000-\u001f\u007f]/u.test(apiKey)) {
    throw new Error('pubg_saas_model_config_invalid');
  }
  return { baseURL, modelId, apiKey, allowedInternalHosts };
}
