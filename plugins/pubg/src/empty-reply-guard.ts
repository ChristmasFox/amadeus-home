import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';

/**
 * A run that times out or fails over can end with a reply that is only markup (a lone "**" was once delivered to a
 * group after 30 tool calls). Such a payload says nothing, so it is never sent: when a PUBG result was already
 * obtained in the same run its own displayText is sent instead (answering from what is already known), otherwise
 * the empty payload is dropped.
 */
export function isDegenerateReply(text: unknown): boolean {
  if (typeof text !== 'string') return true;
  return !/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(text);
}

function pubgDisplayText(result: unknown): string | null {
  const candidates: unknown[] = [result];
  if (result && typeof result === 'object') {
    const record = result as { details?: unknown; content?: unknown };
    candidates.push(record.details);
    if (Array.isArray(record.content)) {
      for (const block of record.content) {
        const text = (block as { text?: unknown } | null)?.text;
        if (typeof text === 'string') { try { candidates.push(JSON.parse(text)); } catch { /* not JSON */ } }
      }
    }
  }
  for (const candidate of candidates) {
    const value = (candidate as { status?: unknown; displayText?: unknown } | null)?.displayText;
    if (candidate && (candidate as { status?: unknown }).status === 'ok' && typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

// Run/session key -> the last successful PUBG displayText of that run. Module-level for the same reason as evidence-guard.
const obtained = new Map<string, { text: string; at: number }>();
const REMEMBER_MS = 10 * 60_000;

export function registerEmptyReplyGuard(api: OpenClawPluginApi): void {
  api.on('after_tool_call', (event, context) => {
    if (!event.toolName.startsWith('pubg_') || event.error) return;
    const text = pubgDisplayText(event.result);
    if (!text) return;
    for (const key of [event.runId, context.runId, context.sessionKey]) {
      if (!key) continue;
      obtained.delete(key);
      obtained.set(key, { text, at: Date.now() });
    }
    while (obtained.size > 200) obtained.delete(obtained.keys().next().value!);
  });
  api.on('reply_payload_sending', (event, context) => {
    const payload = event.payload;
    if (payload.mediaUrl || payload.mediaUrls?.length || payload.audioAsVoice || !isDegenerateReply(payload.text)) return;
    const keys = [event.runId, context.runId, event.sessionKey, context.sessionKey].filter((value): value is string => typeof value === 'string' && value.length > 0);
    const found = keys.map((key) => obtained.get(key)).find((entry) => entry && Date.now() - entry.at <= REMEMBER_MS);
    if (found) {
      api.logger.warn('empty reply replaced by the PUBG result already obtained in this run');
      return { payload: { ...payload, text: found.text } };
    }
    api.logger.warn('empty reply (markup only) not sent');
    return { cancel: true, reason: 'empty_reply' };
  });
}
