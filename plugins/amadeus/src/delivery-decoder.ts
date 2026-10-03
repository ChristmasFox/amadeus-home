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

function parseWire(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    const repaired = escapeControlCharactersInStrings(raw);
    if (repaired === undefined) throw new Error('invalid_agent_json');
    return JSON.parse(repaired) as unknown;
  }
}

// A model can accidentally prepend a control token to a native silent
// sentinel. Treat that shape as protocol silence before it reaches the
// malformed-output fallback or a channel adapter. The sentinel is deliberately
// recognized by shape so the decoder does not depend on a retired marker name.
const CONTROL_SENTINEL = /^(?:\s*\[\[[^\]\r\n]+\]\]\s*)+[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*\s*$/u;
function isControlSentinel(value: unknown): value is string {
  return typeof value === 'string' && CONTROL_SENTINEL.test(value);
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
  if (!text || /^(?:\s*[\[{`])/u.test(text)
    || /(?:^|\n)\s*\[\[[^\]\r\n]+\]\]/u.test(text)
    || /(?:^|\n)\s*MEDIA\s*:/iu.test(text)
    || /(?:["']?(?:version|silent|parts|deliveryId|assetId|filePath|mimeType|disposition)["']?\s*[:=])/iu.test(text)) return undefined;
  try {
    return { envelope: createTextDelivery(context, text), status: 'structured' };
  } catch {
    return undefined;
  }
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
  const recovered = recoverablePlainText(context, raw);
  if (recovered) return recovered;
  let value: unknown;
  try { value = parseWire(raw); } catch { return fail(); }
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
