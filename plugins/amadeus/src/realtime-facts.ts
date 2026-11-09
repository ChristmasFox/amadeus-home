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

const SEARCH_TOOLS = new Set(['web_search', 'web_fetch']);
// Soft guidance only: the model decides whether a turn needs the web. No keyword
// classifier, tool block or finalize revision (those misfired on changelogs and
// the revise hook fails with a transcript-projection error → ❌ and no reply).
const SEARCH_HINT = '当问题依赖当前事实（最新版本、新闻、价格、服务状态等）且你无法确定时，可调用 web_search，必要时再调用 web_fetch，并在回答里给出来源和查询或页面时间。搜索失败、超时或无结果时，明确说明当前事实无法确认，不要用旧知识或猜测冒充当前事实。不依赖当前事实的问题不必搜索。';

// Same soft-guidance rule: the model picks between finding an existing picture and creating a new one.
const IMAGE_HINT = '用户要网上已有的真实图片（"找一张…的图/照片发我""搜图"）时调用 amadeus_web_image，不要用 image_generate 生成；只有用户明确要"画""生成""做一张"新图时才用 image_generate。';

export function classifyRealtimeEvidence(evidence: Pick<RealtimeEvidence, 'source' | 'observedAt' | 'validUntil'>, now = new Date()): RealtimeEvidence {
  const source = typeof evidence.source === 'string' && evidence.source.trim() ? evidence.source.trim() : null;
  const observedAt = typeof evidence.observedAt === 'string' && Number.isFinite(Date.parse(evidence.observedAt)) ? new Date(evidence.observedAt).toISOString() : null;
  const validUntil = typeof evidence.validUntil === 'string' && Number.isFinite(Date.parse(evidence.validUntil)) ? new Date(evidence.validUntil).toISOString() : null;
  const freshness: RealtimeEvidenceFreshness = !source || !observedAt ? 'unknown' : validUntil && Date.parse(validUntil) <= now.getTime() ? 'stale' : 'fresh';
  return { source, observedAt, validUntil, freshness };
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

/** Two web failures in a row end the web attempts of that turn: the model then tells or asks the user instead of trying yet another entry point. */
export const WEB_FAILURE_LIMIT = 2;
export const WEB_FAILURE_BLOCK_REASON = '联网查询已经连续失败 2 次，这一轮不要再调用 web_search / web_fetch，也不要换入口重试。直接告诉用户现在查不到，并问他要不要换个说法、给个链接或稍后再试。';

/** Consecutive failures of the web tools per turn (keyed by run, else session); a success resets the count. */
export class WebFailureGuard {
  private readonly failures = new Map<string, number>();
  blocked(key: string): boolean { return (this.failures.get(key) ?? 0) >= WEB_FAILURE_LIMIT; }
  record(key: string, failed: boolean): void {
    if (!failed) { this.failures.delete(key); return; }
    this.failures.set(key, (this.failures.get(key) ?? 0) + 1);
    // Bounded: old turns are forgotten first.
    if (this.failures.size > 500) this.failures.delete(this.failures.keys().next().value!);
  }
}

function webResultFailed(result: unknown, error?: string): boolean {
  if (error) return true;
  if (!result || typeof result !== 'object') return false;
  const value = result as Record<string, unknown>;
  const details = value.details && typeof value.details === 'object' ? value.details as Record<string, unknown> : {};
  return value.isError === true || details.status === 'error' || value.status === 'error' || typeof value.error === 'string' || typeof details.error === 'string';
}

export function registerRealtimeFacts(api: OpenClawPluginApi): void {
  const audit = new RealtimeToolAudit();
  const webGuard = new WebFailureGuard();
  api.on('before_prompt_build', () => ({ appendSystemContext: `${SEARCH_HINT}\n\n${IMAGE_HINT}` }));
  api.on('before_tool_call', (event, context) => {
    if (SEARCH_TOOLS.has(event.toolName) && webGuard.blocked(event.runId ?? context.runId ?? context.sessionKey ?? 'unknown')) {
      api.logger.warn('web tools failed twice in this turn; blocking further web calls');
      return { block: true, blockReason: WEB_FAILURE_BLOCK_REASON };
    }
    if (SEARCH_TOOLS.has(event.toolName)) audit.start({ session: context.sessionKey ?? 'unknown', ...((event.runId ?? context.runId) ? { runId: (event.runId ?? context.runId)! } : {}), tool: event.toolName, ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}) });
    return undefined;
  });
  api.on('after_tool_call', async (event, context) => {
    if (!SEARCH_TOOLS.has(event.toolName)) return;
    webGuard.record(event.runId ?? context.runId ?? context.sessionKey ?? 'unknown', webResultFailed(event.result, event.error));
    const record = await audit.finish({ session: context.sessionKey ?? 'unknown', ...(event.runId ? { runId: event.runId } : {}), tool: event.toolName, ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}), ...(event.result !== undefined ? { result: event.result } : {}), ...(event.error ? { error: event.error } : {}), ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}) });
    api.logger.info(JSON.stringify({ event: 'realtime_tool_audit', ...(record ?? { tool: event.toolName, success: false }) }));
  });
}
