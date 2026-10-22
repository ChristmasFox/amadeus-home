import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';

export type RealtimeEvidenceFreshness = 'fresh' | 'stale' | 'unknown';
export interface RealtimeEvidence { source: string | null; observedAt: string | null; validUntil: string | null; freshness: RealtimeEvidenceFreshness; }
export interface SearchAuditRecord {
  schema: 'amadeus-realtime-tool-audit/v1'; session: string; runId: string | null;
  tool: 'web_search' | 'web_fetch'; startedAt: string; endedAt: string; success: boolean;
  timedOut: boolean; httpStatus: number | null; resultSummary: string; errorCode: string | null;
}

const REALTIME_QUERY = /(?:\b(?:latest|today|newest|just released|version|versions|news|current events|price|prices|status)\b|最新|今天|刚(?:刚)?发布|版本(?:号)?|新闻|时事|价格|状态|现在)/iu;
const SEARCH_TOOLS = new Set(['web_search', 'web_fetch']);
const SEARCH_REQUIRED = '实时事实问题必须先调用 web_search；必要时再调用 web_fetch。回答必须给出来源和查询或页面时间。搜索失败、超时或无结果时，明确说明当前事实无法确认，禁止用旧知识、无来源记忆或猜测冒充当前事实。搜索结果拥有更高优先级；记忆只可作为背景，且必须检查来源、observedAt 和 validUntil。';

export function isRealtimeFactQuery(prompt: string): boolean { return typeof prompt === 'string' && REALTIME_QUERY.test(prompt); }
export function realtimeFactInstruction(): string { return SEARCH_REQUIRED; }

export function classifyRealtimeEvidence(evidence: Pick<RealtimeEvidence, 'source' | 'observedAt' | 'validUntil'>, now = new Date()): RealtimeEvidence {
  const source = typeof evidence.source === 'string' && evidence.source.trim() ? evidence.source.trim() : null;
  const observedAt = typeof evidence.observedAt === 'string' && Number.isFinite(Date.parse(evidence.observedAt)) ? new Date(evidence.observedAt).toISOString() : null;
  const validUntil = typeof evidence.validUntil === 'string' && Number.isFinite(Date.parse(evidence.validUntil)) ? new Date(evidence.validUntil).toISOString() : null;
  const freshness: RealtimeEvidenceFreshness = !source || !observedAt ? 'unknown' : validUntil && Date.parse(validUntil) <= now.getTime() ? 'stale' : 'fresh';
  return { source, observedAt, validUntil, freshness };
}

export function realtimeToolMustBeBlocked(realtimeQuery: boolean, searched: boolean, toolName: string): boolean {
  return realtimeQuery && !searched && !SEARCH_TOOLS.has(toolName);
}
function httpStatus(result: unknown): number | null {
  if (!result || typeof result !== 'object') return null;
  const value = result as Record<string, unknown>;
  for (const key of ['httpStatus', 'statusCode', 'status']) if (typeof value[key] === 'number' && Number.isInteger(value[key]) && value[key] >= 100 && value[key] <= 599) return value[key];
  return null;
}
function resultSummary(result: unknown, error?: string): string {
  if (error) return error.slice(0, 160);
  if (result === null || result === undefined) return 'empty';
  if (Array.isArray(result)) return `array:${result.length}`;
  if (typeof result === 'string') return `text:${result.length}`;
  if (typeof result === 'object') return `object:${Object.keys(result as Record<string, unknown>).slice(0, 12).join(',')}`.slice(0, 160);
  return typeof result;
}
function errorCode(error?: string): string | null { if (!error) return null; return /timeout|timed out/iu.test(error) ? 'timeout' : 'tool_error'; }

export class RealtimeToolAudit {
  private readonly pending = new Map<string, { session: string; runId: string | null; tool: 'web_search' | 'web_fetch'; startedAt: string }>();
  constructor(private readonly path = process.env.NEWS_TOOL_AUDIT_PATH?.trim() || '/var/lib/openclaw/telemetry/news-tool-audit.jsonl') {}
  start(input: { session: string; runId?: string; tool: string; toolCallId?: string }): void {
    if (!SEARCH_TOOLS.has(input.tool)) return;
    const key = input.toolCallId || input.runId || `${input.session}:${input.tool}:${Date.now()}`;
    this.pending.set(key, { session: input.session, runId: input.runId ?? null, tool: input.tool as 'web_search' | 'web_fetch', startedAt: new Date().toISOString() });
  }
  async finish(input: { session: string; runId?: string; tool: string; toolCallId?: string; result?: unknown; error?: string; durationMs?: number }): Promise<SearchAuditRecord | null> {
    if (!SEARCH_TOOLS.has(input.tool)) return null;
    const key = input.toolCallId || input.runId || `${input.session}:${input.tool}`;
    const pending = this.pending.get(key) ?? { session: input.session, runId: input.runId ?? null, tool: input.tool as 'web_search' | 'web_fetch', startedAt: new Date(Date.now() - Math.max(0, input.durationMs ?? 0)).toISOString() };
    this.pending.delete(key);
    const record: SearchAuditRecord = { schema: 'amadeus-realtime-tool-audit/v1', session: pending.session, runId: pending.runId, tool: pending.tool, startedAt: pending.startedAt, endedAt: new Date().toISOString(), success: !input.error, timedOut: errorCode(input.error) === 'timeout', httpStatus: httpStatus(input.result), resultSummary: resultSummary(input.result, input.error), errorCode: errorCode(input.error) };
    try { await mkdir(dirname(this.path), { recursive: true, mode: 0o700 }); await appendFile(this.path, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 }); } catch { /* audit failure never hides native tool result */ }
    return record;
  }
}

export function registerRealtimeFacts(api: OpenClawPluginApi): void {
  const audit = new RealtimeToolAudit();
  const realtimeRuns = new Set<string>(); const searchedRuns = new Set<string>(); const revisionRequested = new Set<string>();
  api.on('before_prompt_build', (event, context) => { if (context.runId && isRealtimeFactQuery(event.prompt)) realtimeRuns.add(context.runId); return { appendSystemContext: SEARCH_REQUIRED }; });
  api.on('before_tool_call', (event, context) => {
    const runId = event.runId ?? context.runId;
    if (runId && realtimeToolMustBeBlocked(realtimeRuns.has(runId), searchedRuns.has(runId), event.toolName)) {
      api.logger.warn(JSON.stringify({ event: 'realtime_search_gate_blocked', runId, tool: event.toolName }));
      return { block: true, blockReason: 'realtime_fact_requires_web_search_first' };
    }
    if (SEARCH_TOOLS.has(event.toolName)) audit.start({ session: context.sessionKey ?? 'unknown', ...(runId ? { runId } : {}), tool: event.toolName, ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}) });
    return undefined;
  });
  api.on('after_tool_call', async (event, context) => {
    if (!SEARCH_TOOLS.has(event.toolName)) return;
    const record = await audit.finish({ session: context.sessionKey ?? 'unknown', ...(event.runId ? { runId: event.runId } : {}), tool: event.toolName, ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}), ...(event.result !== undefined ? { result: event.result } : {}), ...(event.error ? { error: event.error } : {}), ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}) });
    api.logger.info(JSON.stringify({ event: 'realtime_tool_audit', ...(record ?? { tool: event.toolName, success: false }) }));
    if (event.toolName === 'web_search' && !event.error && event.runId) searchedRuns.add(event.runId);
  });
  api.on('before_agent_finalize', (event) => {
    if (!event.runId || !realtimeRuns.has(event.runId) || searchedRuns.has(event.runId)) return;
    if (!revisionRequested.has(event.runId)) { revisionRequested.add(event.runId); api.logger.warn(JSON.stringify({ event: 'realtime_search_missing_before_finalize', runId: event.runId })); return { action: 'revise', reason: 'realtime_fact_search_required', retry: { instruction: SEARCH_REQUIRED, idempotencyKey: `realtime-search:${event.runId}`, maxAttempts: 1 } }; }
    api.logger.error(JSON.stringify({ event: 'realtime_search_missing_after_retry', runId: event.runId }));
    return undefined;
  });
  api.on('agent_end', (event) => { if (!event.runId) return; realtimeRuns.delete(event.runId); searchedRuns.delete(event.runId); revisionRequested.delete(event.runId); });
}
