import { createHmac, timingSafeEqual } from 'node:crypto';

export const WHATSAPP_SIGNATURE_HEADER = 'x-hub-signature-256';

function asBytes(value: string | Uint8Array): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Validate Meta's `sha256=<hex HMAC>` header against the exact raw body bytes. */
export function verifyWhatsAppSignature(
  rawBody: string | Uint8Array,
  signature: string | null | undefined,
  appSecret: string,
): boolean {
  if (!appSecret || !signature) return false;
  const match = String(signature).trim().match(/^sha256=([a-f0-9]{64})$/iu);
  if (!match?.[1]) return false;
  const expected = createHmac('sha256', appSecret).update(asBytes(rawBody)).digest('hex');
  return safeEqual(expected, match[1].toLowerCase());
}

/** Return the challenge for Meta's GET verification, or null when invalid. */
export function verifyWhatsAppWebhook(
  mode: unknown,
  verifyToken: unknown,
  challenge: unknown,
  expectedToken: string,
): string | null {
  if (mode !== 'subscribe' || !expectedToken || typeof challenge !== 'string') return null;
  if (!safeEqual(String(verifyToken ?? ''), expectedToken)) return null;
  return challenge;
}

export const verifyWhatsAppWebhookSignature = verifyWhatsAppSignature;
export const verifyWhatsAppChallenge = verifyWhatsAppWebhook;
