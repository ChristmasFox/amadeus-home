import { createDeliveryEnvelope, type DeliveryEnvelope, type DeliveryPart } from './delivery-envelope.js';

/**
 * Tool-declared reply links. A native tool may return `replyLink: {kind: 'share', url}` with a successful result; the
 * delivery boundary then guarantees that exact link ends the reply even when the agent retold the answer in its own
 * words. The tool, not keywords, decides which answers carry a link. Share-shaped links the model wrote itself are
 * never delivered unless they are the tool's link.
 */
const SHARE_PATH = /^\/s\/[A-Za-z0-9_-]{22}$/u;
const SHARE_URL = /https?:\/\/[^\s<>"'）)】]+\/s\/[A-Za-z0-9_-]{22}(?![A-Za-z0-9_-])/gu;

type Message = { role?: string; content?: unknown; toolName?: string };

function messageText(message: Message): string {
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content
    .filter((part): part is { type?: string; text?: string } => Boolean(part && typeof part === 'object'))
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n');
}

/** The link is accepted only on a configured origin and in the share-page shape. */
export function trustedReplyLink(value: unknown, origins: readonly string[]): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.search || url.hash || url.username || url.password) return undefined;
    if (!origins.includes(url.origin) || !SHARE_PATH.test(url.pathname)) return undefined;
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

/** The link declared by the current turn's last successful tool result, if any. */
export function turnReplyLink(messages: unknown, origins: readonly string[]): string | undefined {
  if (!Array.isArray(messages) || !origins.length) return undefined;
  let link: string | undefined;
  for (const entry of messages) {
    if (!entry || typeof entry !== 'object') continue;
    const message = entry as Message;
    if (message.role === 'user') link = undefined;
    if (message.role !== 'toolResult') continue;
    try {
      const result = JSON.parse(messageText(message)) as { status?: unknown; replyLink?: { kind?: unknown; url?: unknown } };
      if (result.status === 'error' || result.replyLink?.kind !== 'share') continue;
      link = trustedReplyLink(result.replyLink.url, origins) ?? link;
    } catch { /* not a structured tool result */ }
  }
  return link;
}

function withoutForeignLinks(text: string, link: string | undefined): string {
  if (!text.includes('/s/')) return text;
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    const kept = line.replace(SHARE_URL, (url) => (url === link ? url : ''));
    // A line that only carried a foreign link (with its 🔗 or label) disappears entirely.
    if (kept !== line && /^[\s🔗:：-]*$/u.test(kept)) continue;
    lines.push(kept);
  }
  return lines.join('\n').replace(/\n{3,}/gu, '\n\n').trim();
}

/** Removes share links the tool did not issue, then makes sure the tool's link is the reply's last line. */
export function applyReplyLink(envelope: DeliveryEnvelope, link: string | undefined): DeliveryEnvelope {
  if (envelope.silent) return envelope;
  const parts: DeliveryPart[] = envelope.parts.map((part) => (part.kind === 'text' ? { ...part, text: withoutForeignLinks(part.text, link) } : part));
  const present = Boolean(link) && parts.some((part) => part.kind === 'text' && part.text.includes(link!));
  if (link && !present) {
    let last = -1;
    parts.forEach((part, index) => { if (part.kind === 'text') last = index; });
    const line = `🔗 ${link}`;
    if (last >= 0) {
      const part = parts[last] as Extract<DeliveryPart, { kind: 'text' }>;
      parts[last] = { ...part, text: part.text ? `${part.text}\n\n${line}` : line };
    } else parts.push({ kind: 'text', text: line });
  }
  const kept = parts.filter((part) => part.kind !== 'text' || part.text.length > 0);
  if (JSON.stringify(kept) === JSON.stringify(envelope.parts)) return envelope;
  // A reply whose text was nothing but an invented link still never delivers it (and a voice part keeps its text).
  if (!kept.some((part) => part.kind === 'text')) kept.push({ kind: 'text', text: '这个分享链接无法确认，已省略。' });
  return createDeliveryEnvelope({ ...envelope, parts: kept });
}
