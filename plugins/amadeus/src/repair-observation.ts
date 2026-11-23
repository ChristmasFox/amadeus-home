import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Never copy tool arguments, results, exception messages, sessions or stack traces:
// they may contain private chat data or instructions from untrusted sources.
export function classifyRepairObservation(toolName: string, error: unknown): { tool: string; category: string } | undefined {
  if (!/^[a-z][a-z0-9_]{1,80}$/u.test(toolName) || typeof error !== 'string') return;
  const category = /\bTypeError\b/u.test(error) ? 'type_error'
    : /\bReferenceError\b/u.test(error) ? 'reference_error'
    : /\bSyntaxError\b/u.test(error) ? 'syntax_error'
    : /\bRangeError\b/u.test(error) ? 'range_error'
    : /\bURIError\b/u.test(error) ? 'uri_error'
    : /\b(?:invalid_json_schema|invalid_tool_schema)\b/iu.test(error) ? 'invalid_schema'
    : undefined;
  if (category) return { tool: toolName, category };
}

export function hasPubgRuntimeError(value: unknown, depth = 0): boolean {
  if (depth > 7 || value == null) return false;
  if (typeof value === 'string') {
    if (value.length > 240_000 || !/^[\s]*[\[{]/u.test(value)) return false;
    try { return hasPubgRuntimeError(JSON.parse(value), depth + 1); } catch { return false; }
  }
  if (Array.isArray(value)) return value.slice(0, 100).some(item => hasPubgRuntimeError(item, depth + 1));
  if (typeof value !== 'object') return false;
  const object = value as Record<string, unknown>;
  if (object.code === 'plugin_runtime_error') return true;
  return Object.values(object).slice(0, 100).some(item => hasPubgRuntimeError(item, depth + 1));
}

export async function recordRepairObservation(directory: string, observation: { tool: string; category: string }, error: string, params?: unknown): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // Runtime diagnostics are kept only in the private outbox volume, never in the repository.
  let safeParams: unknown;
  try {
    const encoded = JSON.stringify(params, (key, value) => /token|secret|password|credential|authorization|api.?key|cookie/iu.test(key) ? '[redacted]' : value);
    if (encoded && encoded.length <= 12000) safeParams = JSON.parse(encoded);
  } catch { /* diagnostics never break a chat turn */ }
  const record = { schema: 'lab-repair-incident/v1', ...observation, error: error.slice(0, 12000), ...(safeParams !== undefined ? { params: safeParams } : {}), observedAt: new Date().toISOString() };
  await writeFile(join(directory, `${randomUUID()}.json`), JSON.stringify(record), { mode: 0o600, flag: 'wx' });
}

export function registerRepairObservation(api: OpenClawPluginApi, outboxDirectory = process.env.OWNER_NOTIFICATION_OUTBOX_DIR ?? '/var/lib/openclaw/notifications'): void {
  const record = async (observation: { tool: string; category: string }, error: string, params?: unknown): Promise<void> => {
    try { await recordRepairObservation(join(outboxDirectory, '.repair-incidents'), observation, error, params); }
    catch { api.logger.warn('lab repair observation could not be persisted'); }
  };
  api.on('after_tool_call', async (event) => {
    const observation = classifyRepairObservation(event.toolName, event.error);
    if (observation && event.error) await record(observation, event.error, event.params);
    // The PUBG plugin converts unexpected exceptions into a structured result.
    // Its public result intentionally omits the original exception message.
    if (!observation && /^pubg_[a-z0-9_]{1,80}$/u.test(event.toolName) && hasPubgRuntimeError(event.result))
      await record({ tool: event.toolName, category: 'runtime_error' }, 'plugin_runtime_error', event.params);
  });
  api.on('agent_end', async (event) => {
    if (!event.success && typeof event.error === 'string' && /\b(?:invalid_json_schema|invalid_tool_schema)\b/iu.test(event.error)) {
      await record({ tool: 'model_request', category: 'invalid_schema' }, event.error);
    }
  });
}
