import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import {
  assessPubgEvidence,
  BARE_RECORD_TTL_MS,
  droppedReplyFacts,
  FACT,
  forceTeamScope,
  isBareRecordRequest,
  SAFE_REPLY,
} from '@rine-kit/pubg-reply';
import { enforceRecentMatches, parseRecentMatchCount } from './recent-matches.js';

// This is an outbound evidence policy, not an intent router: it neither chooses a tool nor answers a PUBG question.
// The checks themselves are shared (moved unchanged to @rine-kit/pubg-reply); only the OpenClaw hooks stay here.
export {
  assessPubgEvidence,
  droppedReplyFacts,
  forceTeamScope,
  isBareRecordRequest,
  type EvidenceVerdict,
} from '@rine-kit/pubg-reply';

// Session key -> when the latest inbound message was a bare record request. Module-level on purpose: the plugin is
// registered several times per process and the dispatch and tool-call hooks may run in different registrations.
const bareRecordTurns = new Map<string, number>();
// Session key -> the N of the latest inbound "last N matches" request (same lifetime rules as bare record turns).
const recentMatchTurns = new Map<string, { count: number; at: number }>();

export function registerPubgEvidenceGuard(api: OpenClawPluginApi): void {
  api.on('before_dispatch', (event, context) => {
    const sessionKey = context.sessionKey ?? event.sessionKey;
    if (!sessionKey) return;
    if (isBareRecordRequest(event.body ?? event.content)) bareRecordTurns.set(sessionKey, Date.now());
    else bareRecordTurns.delete(sessionKey);
    const recent = parseRecentMatchCount(event.body ?? event.content);
    if (recent === null) recentMatchTurns.delete(sessionKey);
    else recentMatchTurns.set(sessionKey, { count: recent, at: Date.now() });
  });
  api.on('before_tool_call', (event, context) => {
    if (event.toolName !== 'pubg_query_stats') return;
    const sessionKey = context.sessionKey;
    let params: Record<string, unknown> | null | undefined = event.params as Record<string, unknown> | undefined;
    let changed = false;
    // "近N场战绩" is a count, not a period: a model-chosen date range (today) must not replace it.
    const recent = sessionKey ? recentMatchTurns.get(sessionKey) : undefined;
    if (recent && Date.now() - recent.at <= BARE_RECORD_TTL_MS) {
      const enforced = enforceRecentMatches(params, recent.count);
      if (enforced) {
        api.logger.warn(`pubg last-${recent.count}-matches request: replacing the model-chosen selector with recentMatches=${recent.count}`);
        params = enforced;
        changed = true;
      }
    }
    const at = sessionKey ? bareRecordTurns.get(sessionKey) : undefined;
    if (at !== undefined && Date.now() - at <= BARE_RECORD_TTL_MS) {
      const forced = params ? forceTeamScope(params) : null;
      if (forced) {
        api.logger.warn('pubg bare record request: forcing team=true over a model-chosen person subject');
        params = forced;
        changed = true;
      }
    }
    return changed && params ? { params } : undefined;
  }, { matcher: ['pubg_query_stats'] });
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
