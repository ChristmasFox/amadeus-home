import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { missingReplyFacts, type PubgPresentation } from '@agent/presentation';

// This is an outbound evidence policy, not an intent router: it neither chooses
// a tool nor answers a PUBG question. It only prevents unsupported match facts
// from being delivered when the agent ignored the native tool contract.
type Message = { role?: string; content?: unknown; toolName?: string };
type Part = { type?: string; text?: string; name?: string; arguments?: unknown };
const FACT_TOOLS = new Set([
  'pubg_search_matches', 'pubg_query_stats', 'pubg_compare_stats', 'pubg_get_match',
  'pubg_get_review_facts', 'pubg_get_period_review', 'pubg_query_team_damage',
]);
const REQUEST = /PUBG|绝地求生|吃鸡|战绩|对局|几局|击杀|KD|K\/D/u;
const FACT = /PUBG|绝地求生|吃鸡|战绩|对局|击杀|伤害|KD|K\/D|no_matches|\d+\s*(?:局|杀|场|次)|一局都没有|没有.{0,8}战绩/u;
const TEAM = /全队|整队|队伍|小队|我们|咱们|大家|所有人|全员|team|squad/iu;
// A bare record request names no one ("昨日战绩", "@Kurisu 今天战绩"); in the squad it means the whole team.
const BARE_RECORD = /^(?:\s|@\S+\s*)*(?:今天|今日|昨天|昨日|前天|本周|这周|上周|最近)?\s*(?:的)?\s*(?:PUBG|吃鸡)?\s*(?:战绩|战况)\s*[?？!！。.~]*\s*$/iu;
const FOLLOW_UP = /^(?:\s|@\S+\s*)*(?:刷新|更新|再查|查最新|最新|重新查)/u;
const SAFE_REPLY = '这次 PUBG 战绩没有完成本轮数据核验，我不能确认结果。请再试一次。';

function parts(message: Message): Part[] {
  return Array.isArray(message.content) ? message.content.filter((part): part is Part => Boolean(part && typeof part === 'object')) : [];
}
function text(message: Message): string {
  if (typeof message.content === 'string') return message.content;
  return parts(message).filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n');
}
function resultStatus(message: Message): string | undefined {
  try {
    const value = JSON.parse(text(message)) as { status?: unknown };
    return typeof value.status === 'string' ? value.status : undefined;
  } catch { return undefined; }
}

export type EvidenceVerdict = 'not_applicable' | 'verified' | 'missing_data' | 'wrong_scope';
export function assessPubgEvidence(messages: unknown, finalText: string): EvidenceVerdict {
  if (!Array.isArray(messages) || !finalText || !FACT.test(finalText)) return 'not_applicable';
  const entries = messages.filter((value): value is Message => Boolean(value && typeof value === 'object'));
  let lastUser = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]?.role === 'user') { lastUser = i; break; }
  }
  if (lastUser < 0) return 'not_applicable';
  let request = text(entries[lastUser]!);
  if (!REQUEST.test(request) && FOLLOW_UP.test(request)) {
    for (let i = lastUser - 1; i >= Math.max(0, lastUser - 8); i--) {
      if (entries[i]?.role === 'user' && REQUEST.test(text(entries[i]!))) {
        request = text(entries[i]!);
        break;
      }
    }
  }
  if (!REQUEST.test(request)) return 'not_applicable';
  const calls = entries.slice(lastUser + 1).flatMap((message) => message.role === 'assistant'
    ? parts(message).filter((part) => part.type === 'toolCall' && FACT_TOOLS.has(part.name ?? ''))
    : []);
  const success = entries.slice(lastUser + 1).some((message) => message.role === 'toolResult'
    && FACT_TOOLS.has(message.toolName ?? '') && ['ok', 'partial', 'no_matches'].includes(resultStatus(message) ?? ''));
  if (!calls.length || !success) return 'missing_data';
  // A squad query cannot substantiate a person-specific request. The user must
  // ask for the team explicitly or name no one at all (a bare 战绩 request);
  // nickname resolution remains owned by the Skills.
  if (!TEAM.test(request) && !BARE_RECORD.test(request) && calls.some((call) => {
    const args = call.arguments;
    return Boolean(args && typeof args === 'object' && (args as { team?: unknown }).team === true);
  })) return 'wrong_scope';
  return 'verified';
}

/** Facts the final reply dropped from this turn's last PUBG result block (战绩 cards, 误伤账本); empty otherwise. */
export function droppedReplyFacts(messages: unknown, finalText: string): string[] {
  if (!Array.isArray(messages) || !finalText) return [];
  const entries = messages.filter((value): value is Message => Boolean(value && typeof value === 'object'));
  for (let i = entries.length - 1; i >= 0; i--) {
    const message = entries[i]!;
    if (message.role === 'user') return [];
    if (message.role !== 'toolResult' || !FACT_TOOLS.has(message.toolName ?? '')) continue;
    try {
      const presentation = (JSON.parse(text(message)) as { presentation?: unknown }).presentation;
      return presentation && typeof presentation === 'object' ? missingReplyFacts(presentation as PubgPresentation, finalText) : [];
    } catch { return []; }
  }
  return [];
}

export function registerPubgEvidenceGuard(api: OpenClawPluginApi): void {
  const shapeRevised = new Set<string>();
  const pending = new Map<string, { at: number; delivered: boolean }>();
  api.on('before_agent_finalize', (event, context) => {
    if (context.trigger && context.trigger !== 'user') return; // scheduled prefetch/report has its own contract
    // The outbound hook may see a different session-key spelling (or none), so the verdict is also filed under the run id.
    const keys = [context.sessionKey ?? event.sessionKey, event.runId].filter((value): value is string => Boolean(value));
    const reply = event.lastAssistantMessage ?? '';
    const verdict = assessPubgEvidence(event.messages, reply);
    if (verdict === 'missing_data' || verdict === 'wrong_scope') {
      const entry = { at: Date.now(), delivered: false };
      for (const key of keys) pending.set(key, entry);
    } else {
      for (const key of keys) pending.delete(key);
    }
    if (verdict === 'verified' && event.runId && !shapeRevised.has(event.runId)) {
      const dropped = droppedReplyFacts(event.messages, reply);
      if (dropped.length) {
        // One rewrite per run: a second miss is delivered as is rather than looping.
        shapeRevised.add(event.runId);
        if (shapeRevised.size > 200) shapeRevised.delete(shapeRevised.values().next().value!);
        api.logger.warn(`pubg reply dropped ${dropped.length} fact(s) from the result block; asking for one rewrite`);
        return {
          action: 'revise',
          reason: 'pubg_reply_incomplete',
          retry: {
            instruction: `The draft dropped facts from the PUBG result block: ${dropped.slice(0, 8).join('；')}. Rewrite the whole reply following the result's replyGuide, keeping every card/direction line of displayText with its numbers and titles. Do not call any tool again.`,
            idempotencyKey: `pubg-shape:${event.runId}`,
            maxAttempts: 1,
          },
        };
      }
    }
    if (verdict !== 'missing_data' && verdict !== 'wrong_scope') return;
    api.logger.warn(`pubg evidence guard will block unsupported outbound claim: ${verdict}`);
    // Ask the pinned harness for one fresh model pass. This gives the Agent a
    // chance to call the native PUBG tool after a stale-context answer. The
    // outbound hook below remains the final fail-closed boundary if the retry
    // still has no verified result.
    return {
      action: 'revise',
      reason: `pubg_${verdict}`,
      retry: {
        instruction: 'The previous draft contains PUBG facts without a successful native PUBG tool result for the current user request. Call the relevant native PUBG tool now, using the current sender/mention identity and a fresh selector, then answer only from that result. Do not use web_fetch or an earlier answer as a substitute.',
        idempotencyKey: event.runId ? `pubg-evidence:${event.runId}` : undefined,
        maxAttempts: 1,
      },
    };
  });
  api.on('reply_payload_sending', (event, context) => {
    // WhatsApp's inbound delivery runs this hook with the canonical session key.
    // Its legacy message_sending hook may omit that key, so it cannot correlate
    // the current-turn verdict and must not be used for this safety boundary.
    const keys = [event.sessionKey, context.sessionKey, event.runId, context.runId]
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    const guard = keys.map((key) => pending.get(key)).find((entry) => entry !== undefined);
    if (!guard || Date.now() - guard.at > 120_000) {
      for (const key of keys) pending.delete(key);
      return;
    }
    const content = event.payload.text ?? '';
    if (!FACT.test(content)) return;
    if (guard.delivered) return { cancel: true, reason: 'pubg_unverified_followup_chunk' };
    guard.delivered = true;
    api.logger.warn('pubg evidence guard replaced unverified outbound match claim');
    return {
      payload: {
        ...event.payload,
        text: SAFE_REPLY,
        mediaUrl: undefined,
        mediaUrls: undefined,
        audioAsVoice: false,
        spokenText: undefined,
      },
    };
  });
}
