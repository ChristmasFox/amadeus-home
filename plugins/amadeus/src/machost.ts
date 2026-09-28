import type { OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import type { AmadeusConfig } from './config.js';
import { readOptionalFile } from './config.js';
import { requestJson } from './http.js';
import { isTrustedOwnerContext } from './owner.js';

export function isGroupContext(context: OpenClawPluginToolContext): boolean {
  const conversationId = typeof context.nativeChannelId === 'string' ? context.nativeChannelId : '';
  const sessionKey = context.sessionKey ?? '';
  return /@g\.us$/u.test(conversationId) || /^-\d+$/u.test(conversationId) || /:group[:/]/u.test(sessionKey);
}

export function assertMacHostQueryContext(context: OpenClawPluginToolContext): void {
  if (!isTrustedOwnerContext(context) && !isGroupContext(context)) {
    throw new Error('macOS host telemetry requires owner or group query authorization');
  }
}

async function headers(config: AmadeusConfig): Promise<Record<string, string>> {
  const token = await readOptionalFile(config.macHostAgentTokenFile);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function requestMacHost(config: AmadeusConfig, path: string, signal?: AbortSignal): Promise<unknown> {
  try {
    return await requestJson(`${config.macHostAgentBaseUrl}${path}`, { headers: await headers(config), signal, timeoutMs: 8_000, includeErrorDetail: false });
  } catch {
    return { status: 'unavailable', error: 'host telemetry unavailable', host: 'Amadeus-M204' };
  }
}

export async function macHostStatus(config: AmadeusConfig, context: OpenClawPluginToolContext, signal?: AbortSignal): Promise<unknown> {
  assertMacHostQueryContext(context);
  return requestMacHost(config, '/v1/status', signal);
}

export async function macHostHistory(config: AmadeusConfig, context: OpenClawPluginToolContext, signal?: AbortSignal): Promise<unknown> {
  assertMacHostQueryContext(context);
  return requestMacHost(config, '/v1/history', signal);
}

export async function macHostProcesses(config: AmadeusConfig, context: OpenClawPluginToolContext, signal?: AbortSignal): Promise<unknown> {
  assertMacHostQueryContext(context);
  return requestMacHost(config, '/v1/processes', signal);
}

export async function macHostAnomalies(config: AmadeusConfig, signal?: AbortSignal): Promise<unknown> {
  return requestMacHost(config, '/v1/anomalies', signal);
}
