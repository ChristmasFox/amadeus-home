import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';

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
  // explicitly ask for the team; nickname resolution remains owned by the Skills.
  if (!TEAM.test(request) && calls.some((call) => {
    const args = call.arguments;
    return Boolean(args && typeof args === 'object' && (args as { team?: unknown }).team === true);
  })) return 'wrong_scope';
  return 'verified';
}

export function registerPubgEvidenceGuard(api: OpenClawPluginApi): void {
  const pending = new Map<string, { at: number; delivered: boolean }>();
  api.on('before_agent_finalize', (event, context) => {
    if (context.trigger && context.trigger !== 'user') return; // scheduled prefetch/report has its own contract
    const key = context.sessionKey ?? event.sessionKey;
    const reply = event.lastAssistantMessage ?? '';
    const verdict = assessPubgEvidence(event.messages, reply);
    if (key) {
      if (verdict === 'missing_data' || verdict === 'wrong_scope') pending.set(key, { at: Date.now(), delivered: false });
      else pending.delete(key);
    }
    if (verdict !== 'missing_data' && verdict !== 'wrong_scope') return;
    api.logger.warn(`pubg evidence guard will block unsupported outbound claim: ${verdict}`);
    // Pinned OpenClaw 2026.9.4 can fail transcript projection on a finalize
    // revision. Do not ask the harness to retry; fail closed at delivery.
    return;
  });
  api.on('message_sending', (event, context) => {
    const key = context.sessionKey;
    if (!key) return;
    const guard = pending.get(key);
    if (!guard || Date.now() - guard.at > 120_000) { pending.delete(key); return; }
    if (!FACT.test(event.content)) return;
    if (guard.delivered) return { cancel: true, cancelReason: 'pubg_unverified_followup_chunk' };
    guard.delivered = true;
    api.logger.warn('pubg evidence guard replaced unverified outbound match claim');
    return { content: SAFE_REPLY };
  });
}
