import type { OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import type { AmadeusConfig } from './config.js';
import { readOptionalFile } from './config.js';
import { requestJson } from './http.js';
import { isTrustedOwnerContext } from './owner.js';

function assertOwner(context: OpenClawPluginToolContext): void {
  if (!isTrustedOwnerContext(context)) throw new Error('macOS host telemetry requires owner authorization');
  const conversationId = typeof context.nativeChannelId === 'string' ? context.nativeChannelId : '';
  const sessionKey = context.sessionKey ?? '';
  if (/@g\.us$/u.test(conversationId) || /^-\d+$/u.test(conversationId) || /:group[:/]/u.test(sessionKey)) {
    throw new Error('macOS host telemetry is private and unavailable in group conversations');
  }
}

async function headers(config: AmadeusConfig): Promise<Record<string, string>> {
  const token = await readOptionalFile(config.macHostAgentTokenFile);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function macHostStatus(config: AmadeusConfig, context: OpenClawPluginToolContext, signal?: AbortSignal): Promise<unknown> {
  assertOwner(context);
  return requestJson(`${config.macHostAgentBaseUrl}/v1/status`, { headers: await headers(config), signal, timeoutMs: 8_000, includeErrorDetail: false });
}

export async function macHostProcesses(config: AmadeusConfig, context: OpenClawPluginToolContext, signal?: AbortSignal): Promise<unknown> {
  assertOwner(context);
  return requestJson(`${config.macHostAgentBaseUrl}/v1/processes`, { headers: await headers(config), signal, timeoutMs: 8_000, includeErrorDetail: false });
}
