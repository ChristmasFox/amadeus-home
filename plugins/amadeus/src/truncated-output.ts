import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { onceLogger } from './dm-digest.js';
import { chatKind } from './remember.js';

/**
 * Guard against a model answer that the provider path cut off after a character or two (observed as a final
 * assistant message of 1-3 characters with no token usage at all, on turns that carry a very large tool list).
 * Such a fragment is never a real reply: the first time it is seen the run is sent back for one more model pass,
 * and if it still ends that way the fragment is replaced by the bounded failure notice instead of being posted.
 */
export const RETRY_INSTRUCTION = '你上一次的回复被截断，只输出了几个字。请针对用户最后那条消息重新给出完整的回复。';
const MAX_FRAGMENT_CHARS = 3;
const MARKED_MAX = 512;

/** Runs whose final answer was a truncated fragment (bounded; entries age out oldest first). */
const degenerateRuns = new Set<string>();

export function markDegenerateRun(runId: string): void {
  degenerateRuns.delete(runId);
  degenerateRuns.add(runId);
  while (degenerateRuns.size > MARKED_MAX) degenerateRuns.delete(degenerateRuns.values().next().value!);
}

export const isDegenerateRun = (runId: string): boolean => degenerateRuns.has(runId);

/**
 * True for a 1-3 character cut-off answer. Whitespace and the trailing reaction tag do not count.
 * Short JSON/protocol openers such as `{"` are included: providers sometimes stop after opening the
 * envelope, leaving nothing recoverable for the decoder, so the finalize guard should retry once.
 */
export function isFragmentText(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  const trimmed = text.replace(/\[react:[^\]\r\n]*\]/gu, '').trim();
  if (trimmed.length === 0 || [...trimmed].length > MAX_FRAGMENT_CHARS) return false;
  // Anything else in this length band (plain chars or `{`/`[`/`\`` stubs) counts as a fragment.
  return true;
}

/** The usage the provider reported for the last assistant message in the history, when it is there. */
function lastAssistantUsageOutput(messages: unknown): number | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: unknown; usage?: { output?: unknown } } | null;
    if (message && typeof message === 'object' && message.role === 'assistant') {
      return typeof message.usage?.output === 'number' ? message.usage.output : undefined;
    }
  }
  return undefined;
}

export interface FinalizeEventLike {
  // Optional with explicit undefined: hook events and contexts both may omit them.
  runId?: string | undefined;
  sessionKey?: string | undefined;
  lastAssistantMessage?: string | undefined;
  messages?: unknown[] | undefined;
}

export type FinalizeDecision = { action: 'revise'; reason: string; retry: { instruction: string; maxAttempts: number } } | { action: 'continue' };

/**
 * Only a whole-conversation turn (direct or group) whose final answer is a fragment AND whose provider usage is
 * zero or absent counts; a deliberate short answer from a model that reports usage is left alone.
 */
export function decideFinalize(event: FinalizeEventLike, attempts: Map<string, number>): FinalizeDecision {
  if (chatKind(event.sessionKey) === 'other' || !isFragmentText(event.lastAssistantMessage)) return { action: 'continue' };
  const output = lastAssistantUsageOutput(event.messages);
  if (output !== undefined && output > 0) return { action: 'continue' };
  const key = event.runId ?? event.sessionKey!;
  const seen = attempts.get(key) ?? 0;
  if (event.runId) markDegenerateRun(event.runId);
  if (seen >= 1) return { action: 'continue' };
  attempts.set(key, seen + 1);
  if (attempts.size > MARKED_MAX) attempts.delete(attempts.keys().next().value!);
  return { action: 'revise', reason: 'truncated_final_answer', retry: { instruction: RETRY_INSTRUCTION, maxAttempts: 1 } };
}

export function registerTruncatedOutputGuard(api: OpenClawPluginApi): void {
  const attempts = new Map<string, number>();
  const logOnce = onceLogger(api);
  api.on('before_agent_finalize', (event, context) => {
    try {
      const decision = decideFinalize({
        runId: event.runId ?? context.runId,
        sessionKey: event.sessionKey ?? context.sessionKey,
        lastAssistantMessage: event.lastAssistantMessage,
        messages: event.messages,
      }, attempts);
      if (decision.action === 'revise') {
        api.logger.warn('amadeus truncated final answer detected; requesting one more model pass');
        return decision;
      }
      if (event.runId && isDegenerateRun(event.runId)) logOnce('amadeus truncated final answer persisted after retry; it will not be posted');
      return undefined;
    } catch {
      return undefined;
    }
  });
}
