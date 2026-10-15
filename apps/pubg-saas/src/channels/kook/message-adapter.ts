/** KOOK-specific message shape and formatting rules live at this boundary. */
export type KookTextPayload = { type: 'text' | 'kmarkdown' | 'card'; content: string };

export interface KookGroupMessageSender {
  send(channelId: string, payload: KookTextPayload, nonce: string, replyToMessageId?: string | null): Promise<string | void>;
  sendDirect?(userId: string, payload: KookTextPayload, nonce: string, replyToMessageId?: string | null): Promise<string | void>;
  verifyWelcomeTarget?(guildId: string, channelId: string): Promise<boolean>;
}

// Official references: https://developer.kookapp.cn/doc/http/message and
// https://developer.kookapp.cn/doc/cardmessage. The message API documents one
// 8,000-character content limit for all message types; String.length is the
// conservative UTF-16 bound. Card elements have separate documented limits.
export const KOOK_MAX_MESSAGE_LENGTH = 8000;
export const KOOK_MAX_CARD_PLAIN_TEXT_LENGTH = 2000;
export const KOOK_MAX_CARD_KMARKDOWN_LENGTH = 5000;

function characterLength(value: string): number {
  return value.length;
}

function visitCardText(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) visitCardText(item);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if ((record.type === 'plain-text' || record.type === 'kmarkdown') && typeof record.content === 'string') {
    const limit = record.type === 'plain-text' ? KOOK_MAX_CARD_PLAIN_TEXT_LENGTH : KOOK_MAX_CARD_KMARKDOWN_LENGTH;
    if (characterLength(record.content) > limit) throw new Error('kook_payload_invalid');
  }
  for (const child of Object.values(record)) visitCardText(child);
}

export function validateKookMessagePayload(value: unknown): KookTextPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('kook_payload_invalid');
  const payload = value as Record<string, unknown>;
  if ((payload.type !== 'text' && payload.type !== 'kmarkdown' && payload.type !== 'card') || typeof payload.content !== 'string'
    || !payload.content.trim() || characterLength(payload.content) > KOOK_MAX_MESSAGE_LENGTH) {
    throw new Error('kook_payload_invalid');
  }
  if (payload.type === 'card') {
    let cards: unknown;
    try { cards = JSON.parse(payload.content); } catch { throw new Error('kook_payload_invalid'); }
    if (!Array.isArray(cards) || cards.length < 1 || cards.length > 5
      || cards.some((card) => !card || typeof card !== 'object' || (card as Record<string, unknown>).type !== 'card'
        || !Array.isArray((card as Record<string, unknown>).modules))) throw new Error('kook_payload_invalid');
    visitCardText(cards);
  }
  return { type: payload.type, content: payload.content };
}

function normalizeMarkdownLines(content: string): string {
  let inFence = false;
  return content.split('\n').map((line) => {
    if (/^\s*```/u.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    let normalized = line
      // KMarkdown does not define ATX headings or list blocks; preserve their
      // meaning using supported inline emphasis and ordinary bullet glyphs.
      .replace(/^(\s{0,3})#{1,6}\s+(.+?)\s*#*\s*$/u, '$1**$2**')
      .replace(/^(\s*)[-*+]\s+(?![-*+])(.+)$/u, '$1• $2')
      // KMarkdown supports HTTP(S) links only. Keep the label and address
      // visible when a Markdown link uses another scheme.
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/gu, (whole, label: string, address: string) =>
        /^https?:\/\//iu.test(address) ? whole : `${label} (${address})`)
      // WhatsApp uses single-star bold, underscore italic and single-tilde
      // strike-through; map those to KMarkdown's double-star, single-star and
      // double-tilde forms respectively.
      .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/gu, '$1**$2**')
      .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?])/gu, '$1*$2*')
      .replace(/(^|[^~])~([^~\n]+)~(?=$|[^~])/gu, '$1~~$2~~');
    // The neutral <@id> spelling used by application replies becomes KOOK's
    // native KMarkdown mention. Only numeric user ids are converted; mass and
    // role mentions must be represented explicitly by trusted KOOK markup.
    normalized = normalized.replace(/<@!?([0-9]{1,32})>/gu, '(met)$1(met)');
    return normalized;
  }).join('\n');
}

function hasKookRichMarkup(content: string): boolean {
  return /<@!?[0-9]{1,32}>|\(met\)[0-9]{1,32}\(met\)|\(emj\)|:[a-z0-9_+-]{1,64}:|\*\*[^*\n]+\*\*|(?:^|\s)\*[^*\n]+\*(?=\s|$)|_[^_\n]+_|~~[^~\n]+~~|(?:^|[^~])~[^~\n]+~(?:$|[^~])|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)]+\)|^\s{0,3}#{1,6}\s|^\s*[-*+]\s+/mu.test(content);
}

/** Convert portable reply formatting to the KOOK message representation. */
function adaptKookMessagePayloadUnchecked(value: unknown): KookTextPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('kook_payload_invalid');
  const candidate = value as Record<string, unknown>;
  if ((candidate.type !== 'text' && candidate.type !== 'kmarkdown' && candidate.type !== 'card')
    || typeof candidate.content !== 'string' || !candidate.content.trim()) throw new Error('kook_payload_invalid');
  if (candidate.type === 'card') return validateKookMessagePayload(value);
  const payload = { type: candidate.type, content: candidate.content } as KookTextPayload;
  const useKmarkdown = payload.type === 'kmarkdown' || hasKookRichMarkup(payload.content);
  if (!useKmarkdown) return payload;
  return {
    type: 'kmarkdown',
    content: normalizeMarkdownLines(payload.content),
  };
}

export function adaptKookMessagePayload(value: unknown): KookTextPayload {
  return validateKookMessagePayload(adaptKookMessagePayloadUnchecked(value));
}

function codeUnitLength(value: string): number {
  return value.length;
}

function protectedRanges(content: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const patterns = [
    /\(met\)[^()\s]{1,128}\(met\)|<@!?[^>]{1,128}>/gu,
    /\(rol\)[^()\s]{1,128}\(rol\)|\(chn\)[^()\s]{1,128}\(chn\)/gu,
    /\(emj\)[^()\s]{1,128}\(emj\)(?:\[[^\]]{1,128}\])?/gu,
    /\[[^\]\n]*\]\((?:https?:\/\/|[^)\s])[^)\n]*\)/giu,
    /\\[`*_~()[\]{}#>+-]/gu,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const start = match.index ?? 0;
      ranges.push({ start, end: start + match[0].length });
    }
  }
  return ranges.sort((a, b) => a.start - b.start || a.end - b.end);
}

function formattingTokens(content: string): Array<{ start: number; end: number; token: string }> {
  const tokens: Array<{ start: number; end: number; token: string }> = [];
  const pattern = /```[^\n]*\n|\*\*\*|\*\*|~~|`+|\*|\(ins\)|\(spl\)/gu;
  for (const match of content.matchAll(pattern)) {
    const start = match.index ?? 0;
    // Fenced code is split by its own routine, so it is never a cross-chunk
    // inline formatting state here.
    if (match[0].startsWith('```')) continue;
    let backslashes = 0;
    for (let i = start - 1; i >= 0 && content[i] === '\\'; i -= 1) backslashes += 1;
    if (backslashes % 2 === 1) continue;
    tokens.push({ start, end: start + match[0].length, token: match[0] });
  }
  return tokens;
}

function activeWrappersAt(tokens: Array<{ start: number; end: number; token: string }>, end: number): string[] {
  const active: string[] = [];
  for (const item of tokens) {
    if (item.start >= end) break;
    if (item.token.startsWith('`')) {
      const top = active.at(-1);
      if (top === item.token) active.pop();
      else active.push(item.token);
      continue;
    }
    if (active.some(wrapper => wrapper.startsWith('`'))) continue;
    const top = active.at(-1);
    if (top === item.token) active.pop();
    else active.push(item.token);
  }
  return active;
}

function isInsideRange(index: number, ranges: Array<{ start: number; end: number }>): { start: number; end: number } | undefined {
  return ranges.find(range => range.start < index && index < range.end);
}

function wrapperLength(wrappers: string[]): number {
  return wrappers.reduce((sum, wrapper) => sum + wrapper.length, 0);
}

function quoteContinuationPrefix(content: string, start: number): string {
  if (start === 0) return '';
  const lastBlankLine = content.lastIndexOf('\n\n', start - 1);
  const blockStart = lastBlankLine < 0 ? 0 : lastBlankLine + 2;
  const blockPrefix = content.slice(blockStart, start);
  if (!/^ {0,3}>/mu.test(blockPrefix)) return '';
  const nextLine = content.slice(start, content.indexOf('\n', start) < 0 ? content.length : content.indexOf('\n', start));
  return /^ {0,3}>/u.test(nextLine) ? '' : '> ';
}

function formattedChunk(content: string, start: number, end: number, startWrappers: string[], endWrappers: string[]): string {
  const quotePrefix = quoteContinuationPrefix(content, start);
  return `${quotePrefix}${startWrappers.join('')}${content.slice(start, end)}${[...endWrappers].reverse().join('')}`;
}

function splitMarkdownSegment(content: string): string[] {
  if (content.length <= KOOK_MAX_MESSAGE_LENGTH) return [content];
  content = content.replace(/\[([^\]\n]*)\]\(([^)\n]*)\)/gu, (whole, label: string, address: string) =>
    whole.length <= KOOK_MAX_MESSAGE_LENGTH - 2 ? whole : `${label} (${address})`);
  const ranges = protectedRanges(content);
  const tokens = formattingTokens(content);
  const chunks: string[] = [];
  let start = 0;
  while (start < content.length) {
    const startWrappers = activeWrappersAt(tokens, start);
    const maxRawEnd = Math.min(content.length, start + KOOK_MAX_MESSAGE_LENGTH);
    const quotePrefix = quoteContinuationPrefix(content, start);
    const candidates: Array<{ end: number; priority: number }> = [];
    for (let end = start + 1; end <= maxRawEnd; end += 1) {
      const boundaryChar = content[end - 1];
      if (boundaryChar !== ' ' && boundaryChar !== '\t' && boundaryChar !== '\n') continue;
      const containing = isInsideRange(end, ranges);
      if (containing) continue;
      const endWrappers = activeWrappersAt(tokens, end);
      if (startWrappers.length + endWrappers.length > 64) continue;
      const finalLength = quotePrefix.length + wrapperLength(startWrappers) + (end - start) + wrapperLength(endWrappers);
      if (finalLength > KOOK_MAX_MESSAGE_LENGTH) continue;
      const priority = boundaryChar === '\n' && content[end] === '\n' ? 3 : boundaryChar === '\n' ? 2 : 1;
      candidates.push({ end, priority });
    }

    const floor = start + Math.floor((maxRawEnd - start) * 0.65);
    const preferred = candidates.filter(candidate => candidate.end >= floor);
    let end = preferred.sort((a, b) => b.priority - a.priority || b.end - a.end)[0]?.end
      ?? candidates.at(-1)?.end;

    if (end === undefined) {
      // A very long unbroken token has no natural boundary. Move to a safe
      // code-unit boundary, outside mentions, links and Markdown delimiters.
      end = maxRawEnd;
      if (end < content.length && /[\uDC00-\uDFFF]/u.test(content[end]!)) end -= 1;
      const containing = isInsideRange(end, ranges);
      if (containing) end = containing.start > start ? containing.start : containing.end;
      const token = tokens.find(item => item.start < end! && end! < item.end);
      if (token) end = token.start > start ? token.start : token.end;
      const endWrappers = activeWrappersAt(tokens, end);
      while (end > start && quotePrefix.length + wrapperLength(startWrappers) + (end - start) + wrapperLength(endWrappers) > KOOK_MAX_MESSAGE_LENGTH) {
        end -= 1;
      }
      if (end <= start) {
        // An overlong Markdown link is rendered as plain visible label/address
        // by the adapter before splitting; other tokens here are bounded.
        end = Math.min(start + KOOK_MAX_MESSAGE_LENGTH, content.length);
        if (end < content.length && /[\uDC00-\uDFFF]/u.test(content[end]!)) end -= 1;
      }
    }

    const endWrappers = activeWrappersAt(tokens, end);
    const chunk = formattedChunk(content, start, end, startWrappers, endWrappers);
    if (codeUnitLength(chunk) > KOOK_MAX_MESSAGE_LENGTH) throw new Error('kook_message_split_failed');
    chunks.push(chunk);
    start = end;
  }
  return chunks;
}

function splitPlainContent(content: string, limit: number, preferLines = false): string[] {
  if (content.length <= limit) return [content];
  const chunks: string[] = [];
  const mentionPattern = /\(met\)[^()\s]{1,128}\(met\)|<@!?[^>]{1,128}>/gu;
  let start = 0;
  while (start < content.length) {
    let end = Math.min(start + limit, content.length);
    if (end < content.length) {
      if (/[\uDC00-\uDFFF]/u.test(content[end]!)) end -= 1;
      mentionPattern.lastIndex = 0;
      for (const match of content.matchAll(mentionPattern)) {
        const tokenStart = match.index ?? 0;
        const tokenEnd = tokenStart + match[0].length;
        if (tokenStart < end && tokenEnd > end) {
          end = tokenStart > start ? tokenStart : tokenEnd;
          break;
        }
      }
      const floor = start + Math.floor((end - start) * 0.65);
      const newline = content.lastIndexOf('\n', end - 1);
      const whitespace = Math.max(content.lastIndexOf(' ', end - 1), content.lastIndexOf('\t', end - 1));
      const boundary = Math.max(newline, whitespace);
      if (preferLines && newline >= floor) end = newline + 1;
      else if (boundary >= floor) end = boundary + 1;
    }
    if (end <= start) end = Math.min(start + limit, content.length);
    if (end < content.length && /[\uDC00-\uDFFF]/u.test(content[end]!)) end -= 1;
    chunks.push(content.slice(start, end));
    start = end;
  }
  return chunks;
}

function splitCodeBlock(opening: string, body: string, fence: string): string[] {
  const limit = KOOK_MAX_MESSAGE_LENGTH - opening.length - fence.length - 2;
  if (limit < 1) throw new Error('kook_message_split_failed');
  return splitPlainContent(body, limit, true).map((part) => {
    const lineBreak = part.endsWith('\n') ? '' : '\n';
    return `${opening}${part}${lineBreak}${fence}`;
  });
}

function splitKmarkdown(content: string): string[] {
  if (content.length <= KOOK_MAX_MESSAGE_LENGTH) return [content];
  const chunks: string[] = [];
  const opener = /^ {0,3}(`{3,})([^\n]*)\n/gmu;
  let cursor = 0;
  while (cursor < content.length) {
    opener.lastIndex = cursor;
    const openMatch = opener.exec(content);
    if (!openMatch) {
      chunks.push(...splitMarkdownSegment(content.slice(cursor)));
      break;
    }
    const openStart = openMatch.index;
    if (openStart > cursor) chunks.push(...splitMarkdownSegment(content.slice(cursor, openStart)));
    const opening = openMatch[0];
    const fence = openMatch[1]!;
    const bodyStart = opener.lastIndex;
    const closePattern = new RegExp(`^ {0,3}\\x60{${fence.length},}[ \\t]*(?:\\n|$)`, 'gmu');
    closePattern.lastIndex = bodyStart;
    const closeMatch = closePattern.exec(content);
    if (!closeMatch) {
      const body = content.slice(bodyStart);
      const syntheticFence = fence;
      chunks.push(...splitCodeBlock(opening, body, syntheticFence));
      cursor = content.length;
      break;
    }
    const body = content.slice(bodyStart, closeMatch.index);
    const fullBlock = content.slice(openStart, closePattern.lastIndex);
    if (fullBlock.length <= KOOK_MAX_MESSAGE_LENGTH) chunks.push(fullBlock);
    else chunks.push(...splitCodeBlock(opening, body, fence));
    cursor = closePattern.lastIndex;
    // closePattern consumes the closing line terminator so following text
    // starts exactly where it did in the source.
  }
  return chunks.filter(chunk => chunk.length > 0);
}

/** Adapt and split a whole reply into complete, ordered KOOK messages. */
export function splitKookMessagePayload(value: unknown): KookTextPayload[] {
  const payload = adaptKookMessagePayloadUnchecked(value);
  if (payload.type === 'card') return [payload];
  const chunks = payload.type === 'kmarkdown' ? splitKmarkdown(payload.content) : splitPlainContent(payload.content, KOOK_MAX_MESSAGE_LENGTH);
  for (let index = 0; index < chunks.length; index += 1) {
    if (chunks[index]!.trim()) continue;
    const empty = chunks[index]!;
    const previous = chunks[index - 1];
    if (previous !== undefined && previous.length + empty.length <= KOOK_MAX_MESSAGE_LENGTH) {
      chunks[index - 1] = previous + empty;
      chunks.splice(index, 1);
      index -= 1;
      continue;
    }
    const next = chunks[index + 1];
    if (next !== undefined && empty.length + next.length <= KOOK_MAX_MESSAGE_LENGTH) {
      chunks[index + 1] = empty + next;
      chunks.splice(index, 1);
      index -= 1;
      continue;
    }
    throw new Error('kook_message_split_failed');
  }
  return chunks.map(content => validateKookMessagePayload({ type: payload.type, content }));
}
