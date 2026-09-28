export type ReplyModality = 'default' | 'voice';

// The Agent emits this marker as the first line of its final payload after
// deciding the user's intent from the whole turn. It is removed by the pinned
// TTS/WhatsApp lifecycle before anything is delivered to the user.
export const REPLY_MODALITY_MARKER_PREFIX = '[[amadeus:reply-modality=';
export const REPLY_MODALITY_MARKER_SUFFIX = ']]';

// This registry is intentionally turn keyed. The runtime patch reads the same
// name when it decides whether marker recovery is allowed for a typed turn.
export const REPLY_MODALITY_RUNS_GLOBAL = '__amadeusReplyModalityRuns20260928';
const REPLY_MODALITY_TTL_MS = 120_000;

type ReplyModalityRecord = {
  modality: ReplyModality;
  runId?: string;
  sessionKey?: string;
  expiresAt: number;
};

type ReplyTurnContext = {
  runId?: unknown;
  sessionKey?: unknown;
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function registry(): Map<string, ReplyModalityRecord> {
  const globals = globalThis as Record<string, unknown>;
  const existing = globals[REPLY_MODALITY_RUNS_GLOBAL];
  if (existing instanceof Map) return existing as Map<string, ReplyModalityRecord>;
  const created = new Map<string, ReplyModalityRecord>();
  globals[REPLY_MODALITY_RUNS_GLOBAL] = created;
  return created;
}

function keysFor(context: ReplyTurnContext): string[] {
  const runId = asString(context.runId);
  const sessionKey = asString(context.sessionKey);
  // A run id is the isolation boundary. Session fallback is only for older
  // runtimes that do not expose run provenance; writing both keys lets one
  // concurrent turn clear or overwrite another turn in the same WhatsApp
  // chat.
  return runId
    ? [`run:${runId}`]
    : sessionKey ? [`session:${sessionKey}`] : [];
}

/**
 * Parse only the model's explicit control marker. User text is never matched
 * here: semantic intent is decided by the Agent under the typed-turn protocol
 * injected by voice-reply-prompt.ts.
 */
export function parseReplyModalityMarker(value: unknown): { modality: ReplyModality; text: string; present: boolean } {
  const text = typeof value === 'string' ? value : '';
  const match = text.match(/\[\[amadeus:reply-modality=(voice|default)\]\]/iu);
  if (!match) return { modality: 'default', text, present: false };
  return {
    modality: match[1]?.toLowerCase() === 'voice' ? 'voice' : 'default',
    text: text.replace(/\[\[amadeus:reply-modality=(?:voice|default)\]\]/giu, '').replace(/^\s+/u, ''),
    present: true,
  };
}

export function setReplyModalityForTurn(context: ReplyTurnContext, modality: ReplyModality): void {
  const runId = asString(context.runId);
  const sessionKey = asString(context.sessionKey);
  const now = Date.now();
  const record: ReplyModalityRecord = {
    modality,
    expiresAt: now + REPLY_MODALITY_TTL_MS,
    ...(runId ? { runId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
  };
  const target = registry();
  for (const key of keysFor(context)) target.set(key, record);
}

export function clearReplyModalityForTurn(context: ReplyTurnContext): void {
  const target = registry();
  for (const key of keysFor(context)) target.delete(key);
}

export function getReplyModalityForTurn(context: ReplyTurnContext): ReplyModality {
  const target = registry();
  for (const key of keysFor(context)) {
    const record = target.get(key);
    if (!record) continue;
    if (record.expiresAt <= Date.now()) {
      target.delete(key);
      continue;
    }
    return record.modality === 'voice' ? 'voice' : 'default';
  }
  return 'default';
}
