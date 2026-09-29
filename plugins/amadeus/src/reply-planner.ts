import {
  createSilentEnvelope,
  createTextEnvelope,
  createVoiceEnvelope,
  parseStructuredReplyJson,
  type ReplyContext,
  type ReplyEmotion,
  type ReplyEnvelope,
  type ReplyModality,
} from './reply-envelope.js';

export type TypedReplyPlan = Readonly<{
  modality: ReplyModality;
  answer_plan: 'answer_with_voice' | 'answer_with_text';
  emotion?: ReplyEmotion;
}>;

function isTypedReplyPlan(value: unknown): value is TypedReplyPlan {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => !['modality', 'answer_plan', 'emotion'].includes(key))) return false;
  return (candidate.modality === 'voice' || candidate.modality === 'text')
    && (candidate.answer_plan === 'answer_with_voice' || candidate.answer_plan === 'answer_with_text')
    && (candidate.emotion === undefined
      || ['default', 'irritated', 'embarrassed', 'angry', 'sarcastic', 'soft', 'sad'].includes(String(candidate.emotion)));
}

export function parseTypedReplyPlan(value: unknown): TypedReplyPlan | null {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return null; }
  }
  if (!isTypedReplyPlan(parsed)) return null;
  return Object.freeze({
    modality: parsed.modality,
    answer_plan: parsed.answer_plan,
    ...(parsed.emotion ? { emotion: parsed.emotion } : {}),
  });
}

export function planTypedReply(value: unknown): TypedReplyPlan {
  return parseTypedReplyPlan(value) ?? { modality: 'text', answer_plan: 'answer_with_text' };
}

export function resolveReplyEnvelope(
  context: ReplyContext,
  agentOutput: unknown,
  plan?: TypedReplyPlan | unknown,
): ReplyEnvelope {
  if (context.origin === 'heartbeat' || context.origin === 'cron'
    || context.origin === 'internal_handoff' || context.origin === 'system') {
    return createSilentEnvelope(context);
  }

  const structured = typeof agentOutput === 'string'
    ? parseStructuredReplyJson(agentOutput)
    : parseStructuredReplyJson(agentOutput);
  const selectedPlan = context.origin === 'inbound_voice'
    ? { modality: 'voice' as const, answer_plan: 'answer_with_voice' as const }
    : planTypedReply(plan);

  if (!structured || structured.silent === true) {
    // A plain Agent answer is still safe as a text result. It never upgrades
    // itself to voice based on shape, language, or channel.
    const text = typeof agentOutput === 'string' ? agentOutput.trim() : '';
    return text
      ? createTextEnvelope(context, text, { source: 'agent_structured_output', fallbackReason: 'planner_invalid' })
      : createSilentEnvelope(context);
  }

  const modality = context.origin === 'inbound_voice' ? 'voice' : selectedPlan.modality;
  if (modality === 'voice' && structured.speechText?.trim()) {
    return createVoiceEnvelope(
      context,
      structured.visibleText,
      structured.speechText,
      structured.emotion ?? selectedPlan.emotion ?? 'default',
      context.origin === 'inbound_voice' ? 'inbound_voice_policy' : 'agent_structured_output',
    );
  }
  return createTextEnvelope(context, structured.visibleText, {
    source: 'agent_structured_output',
    ...(modality === 'voice' ? { fallbackReason: 'speech_missing' } : {}),
  });
}
