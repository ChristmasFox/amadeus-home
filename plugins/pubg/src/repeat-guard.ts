import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';

/**
 * A model that is unhappy with a tool result can call the same tool with the same arguments again and again
 * (a 昨日战绩 turn once did 30+ identical pubg_query_stats calls before it answered). The result of an identical call
 * cannot change, so after MAX_IDENTICAL_CALLS in a row the call is not executed and the model is told to answer from
 * the result it already has. A different call (other tool or other arguments) starts a new streak.
 */
export const MAX_IDENTICAL_CALLS = 3;

export const REPEAT_BLOCK_REASON = `This exact ${'`'}tool + arguments${'`'} call already ran ${MAX_IDENTICAL_CALLS} times in a row with the same result, so it was not executed again. Do not call it again: answer the user now from the result you already have (its displayText / replyGuide). If it really does not match the request, say so briefly instead of retrying.`;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export class RepeatTracker {
  private readonly streaks = new Map<string, { signature: string; count: number; callId?: string }>();

  /**
   * Records a call and returns true when it is beyond the allowed identical streak and must be blocked.
   * The hook may run once per plugin registration for the same call, so a repeated toolCallId is not counted again.
   */
  shouldBlock(scope: string, toolName: string, params: unknown, callId?: string): boolean {
    const signature = `${toolName}\u0000${canonical(params)}`;
    const streak = this.streaks.get(scope);
    if (streak && callId && streak.callId === callId) return streak.count > MAX_IDENTICAL_CALLS;
    const count = streak && streak.signature === signature ? streak.count + 1 : 1;
    this.streaks.delete(scope); // re-insert so the oldest scope is the first key
    this.streaks.set(scope, { signature, count, ...(callId ? { callId } : {}) });
    if (this.streaks.size > 200) this.streaks.delete(this.streaks.keys().next().value!);
    return count > MAX_IDENTICAL_CALLS;
  }
}

// Module-level on purpose: the plugin is registered several times per process (see evidence-guard).
const tracker = new RepeatTracker();

export function registerPubgRepeatGuard(api: OpenClawPluginApi): void {
  api.on('before_tool_call', (event, context) => {
    if (!event.toolName.startsWith('pubg_')) return;
    const scope = event.runId ?? context.runId ?? context.sessionKey;
    if (!scope) return;
    if (!tracker.shouldBlock(scope, event.toolName, event.params, event.toolCallId)) return;
    api.logger.warn(`pubg repeat guard: ${event.toolName} called with identical arguments more than ${MAX_IDENTICAL_CALLS} times in a row; not executing`);
    return { block: true, blockReason: REPEAT_BLOCK_REASON };
  });
}
