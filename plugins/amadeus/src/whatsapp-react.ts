import { createDeliveryEnvelope, createSilentDelivery, type DeliveryEnvelope, type DeliveryPart } from './delivery-envelope.js';

/**
 * Kurisu ends a WhatsApp reply with `[react:<emoji>]`. The delivery boundary
 * strips the tag before any sender sees text and reacts once on the inbound
 * message after the typed reply settles. No extra model call, no message tool.
 */
const TAG = /\s*\[\s*react\s*[:：]\s*([^\]\r\n]{1,24}?)\s*\]\s*/giu;
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const FORBIDDEN = /[A-Za-z0-9<>`"'\\]/u;

export function normalizeReactEmoji(value: string): string | undefined {
  const emoji = value.trim();
  if (!emoji || emoji.length > 16 || FORBIDDEN.test(emoji) || !PICTOGRAPHIC.test(emoji)) return undefined;
  return emoji;
}

/** Remove every react tag; the last valid one wins. */
export function extractReactTag(text: string): { text: string; emoji?: string } {
  let emoji: string | undefined;
  let found = false;
  const stripped = text.replace(TAG, (match, candidate: string, offset: number, whole: string) => {
    found = true;
    emoji = normalizeReactEmoji(candidate) ?? emoji;
    const atEdge = offset === 0 || offset + match.length === whole.length;
    return atEdge ? '' : (/\n/u.test(match) ? '\n' : ' ');
  });
  if (!found) return { text };
  return { text: stripped.trim(), ...(emoji ? { emoji } : {}) };
}

export function stripReactFromEnvelope(envelope: DeliveryEnvelope): { envelope: DeliveryEnvelope; emoji?: string } {
  let emoji: string | undefined;
  let changed = false;
  const parts = envelope.parts.map((part): DeliveryPart => {
    if (part.kind === 'text') {
      const out = extractReactTag(part.text);
      if (out.text === part.text) return part;
      changed = true; emoji = out.emoji ?? emoji;
      return { ...part, text: out.text };
    }
    if (part.kind === 'voice') {
      const out = extractReactTag(part.speechText);
      if (out.text === part.speechText) return part;
      changed = true; emoji = out.emoji ?? emoji;
      return { ...part, speechText: out.text };
    }
    return part;
  }).filter((part) => !(part.kind === 'text' && !part.text) && !(part.kind === 'voice' && !part.speechText));
  if (!changed) return { envelope };
  const { version: _version, ...rest } = envelope;
  // A react-only reply ("[react:😂]" alone) settles silently and still reacts.
  if (!parts.length) return { envelope: createSilentDelivery({ runId: envelope.runId, sessionKey: envelope.sessionKey, channel: envelope.channel, origin: envelope.origin, ...(envelope.deliveryId ? { deliveryId: envelope.deliveryId } : {}) }), ...(emoji ? { emoji } : {}) };
  return { envelope: createDeliveryEnvelope({ ...rest, parts }), ...(emoji ? { emoji } : {}) };
}

/** One reaction per run, consumed exactly once. */
export class RunReactions {
  private emojis = new Map<string, { emoji: string; expiresAt: number }>();
  constructor(private ttlMs = 10 * 60_000, private now: () => number = Date.now) {}
  set(runId: string, emoji: string): void {
    this.emojis.set(runId, { emoji, expiresAt: this.now() + this.ttlMs });
    if (this.emojis.size > 512) this.emojis.delete(this.emojis.keys().next().value!);
  }
  take(runId: string): string | undefined {
    const row = this.emojis.get(runId); this.emojis.delete(runId);
    return row && row.expiresAt > this.now() ? row.emoji : undefined;
  }
}
export const runReactions = new RunReactions();

export async function reactAfterDelivery(
  runId: string,
  sendReaction: ((emoji: string) => Promise<unknown>) | undefined,
  log: { info(message: string): void; warn(message: string): void },
): Promise<void> {
  const emoji = runReactions.take(runId);
  if (!emoji || !sendReaction) return;
  try {
    await sendReaction(emoji);
    log.info(`amadeus whatsapp react ${JSON.stringify({ event: 'react_sent', run_id: runId, emoji })}`);
  } catch (error) {
    log.warn(`amadeus whatsapp react ${JSON.stringify({ event: 'react_failed', run_id: runId, error: error instanceof Error ? error.message : String(error) })}`);
  }
}
