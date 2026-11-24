import { chatKind } from './remember.js';

/** OpenClaw status notices must not consume the single reply delivery slot. */
export function isWhatsAppDirectFallbackNotice(channel: unknown, sessionKey: unknown, payload: unknown): boolean {
  if (channel !== 'whatsapp' || chatKind(sessionKey) !== 'direct' || !payload || typeof payload !== 'object') return false;
  const row = payload as { isFallbackNotice?: unknown; text?: unknown };
  return row.isFallbackNotice === true || (typeof row.text === 'string' && /^↪️ Model Fallback(?: cleared)?: /u.test(row.text));
}
