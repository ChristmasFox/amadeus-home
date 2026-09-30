import { createDeliveryEnvelope, createSilentDelivery, type DeliveryContext, type DeliveryEnvelope, type DeliveryPart } from './delivery-envelope.js';

export type AgentReplyDecode = Readonly<{ envelope: DeliveryEnvelope; status: 'structured' | 'silent' | 'malformed' }>;

/** Sole Agent protocol decoder. The wire object cannot supply asset ids/paths. */
export function decodeAgentReply(context: DeliveryContext, raw: unknown): AgentReplyDecode {
  const fail = (): AgentReplyDecode => ({ envelope: createSilentDelivery(context, 'invalid_structured_output'), status: 'malformed' });
  if (['heartbeat', 'cron', 'internal_handoff', 'system'].includes(context.origin)) return { envelope: createSilentDelivery(context), status: 'silent' };
  if (typeof raw !== 'string') return fail();
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; } catch { return fail(); }
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
