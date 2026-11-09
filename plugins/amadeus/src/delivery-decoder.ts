import { createDeliveryEnvelope, createTextDelivery, createSilentDelivery, type DeliveryContext, type DeliveryEnvelope, type DeliveryPart } from './delivery-envelope.js';

export type AgentReplyDecode = Readonly<{ envelope: DeliveryEnvelope; status: 'structured' | 'silent' | 'malformed' }>;

/** Bounded user-facing fallback for malformed model protocol output. */
export const INVALID_STRUCTURED_OUTPUT_MESSAGE = '回复格式异常，已记录，请稍后重试。';

/**
 * Some model responses contain literal control characters inside a JSON string
 * value (most commonly a newline in the text part). JSON requires those
 * characters to be escaped, but repairing only this syntax defect is safe:
 * the result still goes through JSON parsing and the strict envelope validator.
 * We never repair quotes, braces, fields, or arbitrary prose.
 */
function escapeControlCharactersInStrings(raw: string): string | undefined {
  let inString = false;
  let escaped = false;
  let changed = false;
  const output: string[] = [];

  for (const character of raw) {
    if (!inString) {
      output.push(character);
      if (character === '"') inString = true;
      continue;
    }
    if (escaped) {
      output.push(character);
      escaped = false;
      continue;
    }
    if (character === '\\') {
      output.push(character);
      escaped = true;
      continue;
    }
    if (character === '"') {
      output.push(character);
      inString = false;
      continue;
    }
    const code = character.charCodeAt(0);
    if (code <= 0x1f) {
      changed = true;
      output.push(code === 0x08 ? '\\b'
        : code === 0x09 ? '\\t'
          : code === 0x0a ? '\\n'
            : code === 0x0c ? '\\f'
              : code === 0x0d ? '\\r'
                : `\\u${code.toString(16).padStart(4, '0')}`);
      continue;
    }
    output.push(character);
  }

  return changed ? output.join('') : undefined;
}

/**
 * Models occasionally drop the key of a text part and write
 * `{"kind":"text":"..."}`. Insert only that missing `,"text"` key; the result
 * is still parsed and checked by the strict envelope validator.
 */
function restoreMissingTextKey(raw: string): string | undefined {
  const repaired = raw.replace(/("kind"\s*:\s*"text")\s*:\s*(?=")/gu, '$1,"text":');
  return repaired === raw ? undefined : repaired;
}

function parseWire(raw: string): unknown {
  const attempts: Array<(value: string) => string | undefined> = [(value) => value, escapeControlCharactersInStrings, restoreMissingTextKey];
  for (const attempt of attempts) {
    const candidate = attempt(raw);
    if (candidate === undefined) continue;
    try { return JSON.parse(candidate) as unknown; } catch { /* try the next narrow repair */ }
  }
  const stacked = restoreMissingTextKey(raw);
  const escaped = stacked === undefined ? undefined : escapeControlCharactersInStrings(stacked);
  if (escaped !== undefined) {
    try { return JSON.parse(escaped) as unknown; } catch { /* fall through */ }
  }
  throw new Error('invalid_agent_json');
}

/**
 * Older image turns sometimes prepend the native media path before the v2
 * envelope. The path is not an authority and must be discarded; the durable
 * asset attachment is already owned by the run. Accept only a following JSON
 * object so ordinary user text beginning with `MEDIA:` stays fail-closed.
 */
function legacyMediaPrefixedWire(raw: string): string | undefined {
  const match = /^\s*MEDIA:[^\r\n]*\r?\n([\s\S]*)$/u.exec(raw);
  const candidate = match?.[1]?.trimStart();
  return candidate?.startsWith('{') ? candidate : undefined;
}

// A model can accidentally prepend a control token to a native silent
// sentinel. Treat that shape as protocol silence before it reaches the
// malformed-output fallback or a channel adapter. The sentinel is deliberately
// recognized by shape so the decoder does not depend on a retired marker name.
const CONTROL_SENTINEL = /^(?:\s*\[\[[^\]\r\n]+\]\]\s*)+[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*\s*$/u;
// A message that is only a snake_case protocol token (the native silent sentinel) is never chat text.
const BARE_PROTOCOL_TOKEN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/iu;
function isControlSentinel(value: unknown): value is string {
  return typeof value === 'string' && CONTROL_SENTINEL.test(value);
}

/** Fail-closed shape check shared by plain-text recovery and truncated-envelope salvage. */
function looksLikeProtocolText(text: string): boolean {
  return BARE_PROTOCOL_TOKEN.test(text) || /^(?:\s*[\[{`])/u.test(text)
    || /(?:^|\n)\s*\[\[[^\]\r\n]+\]\]/u.test(text)
    || /(?:^|\n)\s*MEDIA\s*:/iu.test(text)
    || /(?:["']?(?:version|silent|parts|deliveryId|assetId|filePath|mimeType|disposition)["']?\s*[:=])/iu.test(text);
}

/**
 * A model can emit a nearly-complete v2 envelope and then stop before closing the
 * text string / object (observed as raw beginning with `{"version":2` … `"text":"…`
 * and ending mid-value, often with positive provider usage). Guessing closing
 * braces is unsafe; extracting the unterminated text value and re-wrapping it
 * through createTextDelivery is a narrow, fail-closed salvage.
 */
function salvageTruncatedEnvelopeText(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') || !/"version"\s*:\s*2/u.test(trimmed)) return undefined;
  if (!/"kind"\s*:\s*"text"/u.test(trimmed)) return undefined;
  const match = /"kind"\s*:\s*"text"\s*,\s*"text"\s*:\s*"/u.exec(trimmed);
  if (!match) return undefined;
  const body = trimmed.slice(match.index + match[0].length);
  let escaped = false;
  let complete = false;
  const chars: string[] = [];
  for (const character of body) {
    if (escaped) {
      chars.push(character);
      escaped = false;
      continue;
    }
    if (character === '\\') {
      chars.push(character);
      escaped = true;
      continue;
    }
    if (character === '"') {
      complete = true;
      break;
    }
    chars.push(character);
  }
  // A trailing lone backslash means the cut landed inside an escape — drop it.
  if (!complete && escaped) chars.pop();
  // If the string already closed cleanly, ordinary JSON.parse should have worked;
  // refuse to salvage a fully-terminated value so we do not bypass the validator.
  if (complete) return undefined;
  if (chars.length === 0) return undefined;
  let text: string;
  try {
    text = JSON.parse(`"${chars.join('')}"`) as string;
  } catch {
    return undefined;
  }
  if (typeof text !== 'string') return undefined;
  const value = text.trim();
  if (!value || looksLikeProtocolText(value)) return undefined;
  return value;
}

/**
 * A normal external turn can occasionally arrive as plain assistant text when
 * the model ignores the JSON-only instruction. Recover that text as a typed
 * part, but keep protocol-looking output fail-closed so serialized objects,
 * paths, and fenced payloads never become user-visible text.
 */
function recoverablePlainText(context: DeliveryContext, raw: string): AgentReplyDecode | undefined {
  if (context.origin !== 'external_user') return undefined;
  const text = raw.trim();
  if (!text || looksLikeProtocolText(text)) return undefined;
  try {
    return { envelope: createTextDelivery(context, text), status: 'structured' };
  } catch {
    return undefined;
  }
}

/** The bounded failure notice as a decode result, for runs whose model output is known to be a cut-off fragment. */
export function malformedReply(context: DeliveryContext): AgentReplyDecode {
  return {
    envelope: createTextDelivery(context, INVALID_STRUCTURED_OUTPUT_MESSAGE, { source: 'agent_structured_output', fallbackReason: 'invalid_structured_output' }),
    status: 'malformed',
  };
}

/** Sole Agent protocol decoder. The wire object cannot supply asset ids/paths. */
export function decodeAgentReply(context: DeliveryContext, raw: unknown): AgentReplyDecode {
  // External turns must receive a typed response even when the model violates
  // the wire contract. Keep the message bounded and deterministic; never echo
  // or stringify the malformed model output. Trusted internal turns are
  // handled above and remain silent.
  const fail = (): AgentReplyDecode => ({
    envelope: createTextDelivery(context, INVALID_STRUCTURED_OUTPUT_MESSAGE, {
      source: 'agent_structured_output',
      fallbackReason: 'invalid_structured_output',
    }),
    status: 'malformed',
  });
  if (['heartbeat', 'cron', 'internal_handoff', 'system'].includes(context.origin)) return { envelope: createSilentDelivery(context), status: 'silent' };
  if (typeof raw !== 'string') return fail();
  if (isControlSentinel(raw)) return { envelope: createSilentDelivery(context), status: 'silent' };
  const legacyWire = legacyMediaPrefixedWire(raw);
  if (legacyWire === undefined) {
    const recovered = recoverablePlainText(context, raw);
    if (recovered) return recovered;
  }
  const wireRaw: string = legacyWire ?? raw;
  let value: unknown;
  try {
    value = parseWire(wireRaw);
  } catch {
    if (context.origin === 'external_user') {
      const salvaged = salvageTruncatedEnvelopeText(wireRaw);
      if (salvaged) {
        try {
          return { envelope: createTextDelivery(context, salvaged), status: 'structured' };
        } catch { /* fall through to fail */ }
      }
    }
    return fail();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const wire = value as Record<string, unknown>;
  if (Object.keys(wire).some((key) => !['version', 'silent', 'parts'].includes(key))
    || wire.version !== 2 || typeof wire.silent !== 'boolean' || !Array.isArray(wire.parts)
    || wire.parts.some((part) => !part || typeof part !== 'object' || Array.isArray(part))) return fail();
  if (wire.parts.some((part: Record<string, unknown>) => part.kind === 'text'
    ? Object.keys(part).some((key) => !['kind', 'text'].includes(key))
    : part.kind === 'voice'
      ? Object.keys(part).some((key) => !['kind', 'speechText', 'emotion'].includes(key))
      : true)) return fail();
  if (wire.parts.length === 1) {
    const part = wire.parts[0] as Record<string, unknown>;
    const text = part.kind === 'text' ? part.text : part.kind === 'voice' ? part.speechText : undefined;
    if (isControlSentinel(text)) return { envelope: createSilentDelivery(context), status: 'silent' };
  }
  try {
    const envelope = createDeliveryEnvelope({
      ...context, deliveryId: context.deliveryId ?? `${context.runId}:delivery`,
      silent: wire.silent, parts: wire.parts as DeliveryPart[],
      source: wire.silent ? 'system_silent' : context.origin === 'inbound_voice' ? 'inbound_voice_policy' : 'agent_structured_output',
    });
    if (context.origin === 'inbound_voice' && !envelope.silent && !envelope.parts.some((part) => part.kind === 'voice')) return fail();
    // Only typed parts escape this function; `raw`/`wire` are not retained.
    return { envelope, status: envelope.silent ? 'silent' : 'structured' };
  } catch { return fail(); }
}
