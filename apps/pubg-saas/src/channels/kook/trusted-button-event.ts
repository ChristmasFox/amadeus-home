const verifiedButtonClick = Symbol('verified-kook-button-click');

export interface TrustedKookButtonClick {
  readonly [verifiedButtonClick]: true;
  platform: 'kook';
  botAccountId: string;
  userId: string;
  eventId: string | null;
  sourceMessageId: string;
  sourceTargetId: string | null;
  value: string;
  timestamp: number;
}

function text(value: unknown, maxLength = 256): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

/** Parses KOOK's system event for a card button click. The opaque return-val is
 * preserved for an application handler to resolve against actor-bound state. */
export function parseTrustedKookButtonClick(value: unknown, botAccountIdInput: string): TrustedKookButtonClick | null {
  const botAccountId = text(botAccountIdInput, 128);
  if (!botAccountId || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (envelope.s !== 0 || !envelope.d || typeof envelope.d !== 'object' || Array.isArray(envelope.d)) return null;
  const data = envelope.d as Record<string, unknown>;
  if (data.type !== 255 || (data.channel_type !== 'GROUP' && data.channel_type !== 'PERSON')) return null;
  const extra = data.extra;
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return null;
  const extraData = extra as Record<string, unknown>;
  if (extraData.type !== 'message_btn_click' || !extraData.body || typeof extraData.body !== 'object' || Array.isArray(extraData.body)) return null;
  const body = extraData.body as Record<string, unknown>;
  const userId = text(body.user_id, 128);
  const sourceMessageId = text(body.msg_id, 256);
  const valueToken = text(body.value, 512);
  const sourceTargetId = text(body.target_id, 128);
  const timestamp = data.msg_timestamp;
  if (!userId || userId === botAccountId || !sourceMessageId || !valueToken) return null;
  if (typeof timestamp !== 'number' || !Number.isSafeInteger(timestamp) || timestamp <= 0) return null;
  return {
    [verifiedButtonClick]: true,
    platform: 'kook',
    botAccountId,
    userId,
    eventId: text(data.msg_id, 256),
    sourceMessageId,
    sourceTargetId,
    value: valueToken,
    timestamp,
  };
}
