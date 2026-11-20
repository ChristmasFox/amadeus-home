import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { onceLogger } from './dm-digest.js';
import { chatKind } from './remember.js';

/** Retry incomplete final output once before it reaches the delivery decoder. */
export const RETRY_INSTRUCTION = '你上一次的结构化回复没有完整输出。请重新回答用户最后那条消息，并完整输出 DeliveryEnvelope v2 JSON。';
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

/**
 * Detect an incomplete JSON object without trying to repair it. DeliveryEnvelope
 * is an object, so an unfinished object/string is a retry candidate even when
 * the provider reports output usage for reasoning tokens.
 */
export function isIncompleteJsonText(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  const value = text.trim();
  if (!value.startsWith('{')) return false;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const character of value) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{' || character === '[') stack.push(character);
    else if (character === '}' || character === ']') {
      const open = stack.pop();
      if (open !== (character === '}' ? '{' : '[')) return false;
    }
  }
  return inString || escaped || stack.length > 0;
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
 * Incomplete JSON always retries once, regardless of provider usage. Other
 * 1-3 character replies retry only when usage is absent or zero, preserving
 * deliberate short answers that the provider reports as complete.
 */
export function decideFinalize(event: FinalizeEventLike, attempts: Map<string, number>): FinalizeDecision {
  const incompleteJson = isIncompleteJsonText(event.lastAssistantMessage);
  if (chatKind(event.sessionKey) === 'other' || (!incompleteJson && !isFragmentText(event.lastAssistantMessage))) return { action: 'continue' };
  const output = lastAssistantUsageOutput(event.messages);
  if (!incompleteJson && output !== undefined && output > 0) return { action: 'continue' };
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
