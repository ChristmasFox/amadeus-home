import type { KookAgentConversationWindow, KookAgentConversationTurn } from './public-query-authorizer.js';

export interface GateContextBudgetPolicy {
  recentTurnsTokens: number;
  quotedMessageTokens: number;
  episodicSummaryTokens: number;
  longTermRecallTokens: number;
}

export const DEFAULT_GATE_CONTEXT_BUDGET_POLICY: Readonly<GateContextBudgetPolicy> = Object.freeze({
  recentTurnsTokens: 4_000,
  quotedMessageTokens: 1_000,
  episodicSummaryTokens: 1_000,
  longTermRecallTokens: 1_000,
});

export interface BuiltGateWorkingContext {
  turns: KookAgentConversationTurn[];
  currentQuoteContext: string | null;
  currentMessage: string;
  estimateMethod: 'conservative_unicode_char_v1';
  estimatedRecentTokens: number;
  estimatedQuoteTokens: number;
  estimatedCurrentMessageTokens: number;
}

/**
 * Conservative planning estimate: ASCII code points cost one third of a token;
 * every non-ASCII code point costs one. This is deliberately labeled as an
 * estimate because the configured provider tokenizer is not available here.
 */
export function estimateGateTokens(text: string): number {
  let units = 0;
  for (const character of text) units += character.codePointAt(0)! <= 0x7f ? 1 / 3 : 1;
  return Math.ceil(units);
}

function fitText(text: string, budget: number): string {
  if (estimateGateTokens(text) <= budget) return text;
  const marker = ' …[正文按上下文预算截断]';
  const markerCost = estimateGateTokens(marker);
  const suffix = budget >= markerCost ? marker : '';
  const prefixBudget = suffix ? budget - markerCost : budget;
  let prefix = '';
  let used = 0;
  for (const character of text) {
    const cost = estimateGateTokens(character);
    if (used + cost > prefixBudget) break;
    prefix += character;
    used += cost;
  }
  return `${prefix.trimEnd()}${suffix}`;
}

export function buildGateWorkingContext(
  window: KookAgentConversationWindow,
  currentMessage: string,
  policy: Readonly<GateContextBudgetPolicy> = DEFAULT_GATE_CONTEXT_BUDGET_POLICY,
): BuiltGateWorkingContext {
  for (const [name, limit] of Object.entries(policy)) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new Error(`gate_context_budget_${name}_invalid`);
  }

  const selected: KookAgentConversationTurn[] = [];
  let recentTokens = 0;
  for (let index = window.turns.length - 1; index >= 0; index -= 1) {
    const turn = window.turns[index]!;
    const cost = estimateGateTokens(turn.content);
    if (cost > policy.recentTurnsTokens || recentTokens + cost > policy.recentTurnsTokens) continue;
    selected.push(turn);
    recentTokens += cost;
  }
  selected.reverse();

  const quote = window.currentQuoteContext === null
    ? null
    : fitText(window.currentQuoteContext, policy.quotedMessageTokens);
  return {
    turns: selected,
    currentQuoteContext: quote,
    currentMessage,
    estimateMethod: 'conservative_unicode_char_v1',
    estimatedRecentTokens: recentTokens,
    estimatedQuoteTokens: quote === null ? 0 : estimateGateTokens(quote),
    estimatedCurrentMessageTokens: estimateGateTokens(currentMessage),
  };
}
