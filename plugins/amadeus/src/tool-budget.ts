import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';

/**
 * A single turn that keeps calling tools re-sends the whole conversation every time, so its prompt grows by every
 * tool result (a 昨日战绩 loop went 47K → 311K tokens in 30 calls and burned the 5-hour Codex allowance).
 * Both preferred models (gpt-6-luna, gpt-6.1-terra) bill the whole request at the higher long-context rate once the
 * input passes 272K tokens (https://developers.openai.com/api/docs/pricing). A turn starts at most around the 100K
 * contextTokens the model is configured with; the budget below adds at most ~85K tokens of tool results
 * (measured: 26 KB of PUBG JSON ≈ 9.2K tokens, so ~2.8 bytes per token) and so stays near 185K, with ~87K of margin.
 * Past either limit the call is not run and the model is told to answer now.
 */
export const MAX_TOOL_CALLS_PER_RUN = 20;
export const MAX_TOOL_RESULT_BYTES_PER_RUN = 240_000;

export const TOOL_BUDGET_REASON = `This turn already used its tool budget (${MAX_TOOL_CALLS_PER_RUN} calls or ${Math.round(MAX_TOOL_RESULT_BYTES_PER_RUN / 1000)} KB of tool results). Do not call more tools: answer the user now from the results you already have, and say briefly what is still missing.`;

interface RunUsage { calls: number; bytes: number; seen: Set<string> }

export function resultBytes(result: unknown): number {
  if (result === undefined || result === null) return 0;
  if (typeof result === 'string') return result.length;
  try { return JSON.stringify(result)?.length ?? 0; } catch { return 0; }
}

export class ToolBudget {
  private readonly runs = new Map<string, RunUsage>();

  private usage(run: string): RunUsage {
    let entry = this.runs.get(run);
    if (!entry) {
      entry = { calls: 0, bytes: 0, seen: new Set() };
      this.runs.set(run, entry);
      if (this.runs.size > 200) this.runs.delete(this.runs.keys().next().value!);
    }
    return entry;
  }

  /** Counts a call (once per toolCallId) and says whether it may run. */
  admit(run: string, callId?: string): boolean {
    const entry = this.usage(run);
    if (callId && entry.seen.has(callId)) return entry.calls <= MAX_TOOL_CALLS_PER_RUN && entry.bytes <= MAX_TOOL_RESULT_BYTES_PER_RUN;
    if (callId) entry.seen.add(callId);
    entry.calls += 1;
    return entry.calls <= MAX_TOOL_CALLS_PER_RUN && entry.bytes <= MAX_TOOL_RESULT_BYTES_PER_RUN;
  }

  record(run: string, callId: string | undefined, bytes: number): void {
    const entry = this.usage(run);
    if (callId) { const key = `r:${callId}`; if (entry.seen.has(key)) return; entry.seen.add(key); }
    entry.bytes += bytes;
  }
}

const budget = new ToolBudget();

export function registerToolBudget(api: OpenClawPluginApi): void {
  api.on('before_tool_call', (event, context) => {
    const run = event.runId ?? context.runId;
    if (!run) return;
    if (budget.admit(run, event.toolCallId)) return;
    api.logger.warn(`tool budget exhausted for this turn; not running ${event.toolName}`);
    return { block: true, blockReason: TOOL_BUDGET_REASON };
  });
  api.on('after_tool_call', (event, context) => {
    const run = event.runId ?? context.runId;
    if (!run || event.error) return;
    budget.record(run, event.toolCallId, resultBytes(event.result));
  });
}
