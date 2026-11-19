import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { cachedOwnerDigits, isOwnerDirectSession, ownerDigits, workspaceCandidates } from './dm-digest.js';
import { chatKind } from './remember.js';

/**
 * Owner private memory stays in the owner's own direct session.
 * Group chats and everyone else's direct chats still see shared notes.
 * The private preference text itself is not stored here.
 */
export const PRIVATE_MEMORY_TOOLS = ['memory_search', 'memory_get'] as const;
export const PRIVATE_SESSION_TOOLS = ['sessions_history', 'sessions_search', 'sessions_list'] as const;

const HEADER_BYTES = 1800;

export type MemoryVisibility = 'private' | 'shared' | 'unknown';

/** Path-only decision. `unknown` means a session log that has to be classified from its header. */
export function structuralMemoryVisibility(path: string): MemoryVisibility {
  const normalized = path.replaceAll('\\', '/').trim();
  if (!normalized) return 'shared';
  const file = normalized.split('/').pop()?.toLowerCase() ?? '';
  if (file === 'memory.md' || file.startsWith('owner-dm-preferences')) return 'private';
  if (normalized.split('/').includes('.amadeus-private')) return 'private';
  if (normalized.split('/').includes('dreaming')) return 'private';
  if (file === 'user.md' || file.includes('group')) return 'shared';
  if (normalized.split('/').includes('memory') && file.endsWith('.md')) return 'unknown';
  return 'shared';
}

/** Direct-session logs are private; group logs are shared; anything else stays unknown. */
export function visibilityFromHeader(header: string): MemoryVisibility {
  const match = /Session Key\*?\*?\s*:\s*(\S+)/u.exec(header);
  if (!match?.[1]) return 'unknown';
  const kind = chatKind(match[1]);
  if (kind === 'direct') return 'private';
  if (kind === 'group') return 'shared';
  return 'unknown';
}

function readSessionHeader(workspaceDir: string, path: string): string {
  try {
    return readFileSync(join(workspaceDir, path), 'utf8').slice(0, HEADER_BYTES);
  } catch {
    return '';
  }
}

/** True when this path is owner-private. Unreadable session logs fail closed. */
export function createPathClassifier(workspaceDirs: readonly string[]): (path: string) => boolean {
  const cache = new Map<string, boolean>();
  return (path: string) => {
    const normalized = path.replaceAll('\\', '/').replace(/^\.\//u, '');
    const structural = structuralMemoryVisibility(normalized);
    if (structural !== 'unknown') return structural === 'private';
    const cached = cache.get(normalized);
    if (cached !== undefined) return cached;
    let visibility: MemoryVisibility = 'unknown';
    for (const dir of workspaceDirs) {
      const header = readSessionHeader(dir, normalized);
      if (!header) continue;
      visibility = visibilityFromHeader(header);
      if (visibility !== 'unknown') break;
    }
    const isPrivate = visibility !== 'shared';
    cache.set(normalized, isPrivate);
    return isPrivate;
  };
}

export function directPeerDigits(sessionKey: string): string | undefined {
  const match = /:direct:(.+)$/u.exec(sessionKey);
  const digits = match?.[1]?.replace(/\D/gu, '');
  return digits || undefined;
}

/**
 * A direct-session target is hidden unless the caller is the verified owner
 * and the target is that same owner's direct session. `current` is this session.
 */
export function privateSessionTargetHidden(callerKey: unknown, targetKey: string, owner: string | undefined): boolean {
  const target = targetKey.trim();
  if (!target || target === 'current') return false;
  if (chatKind(target) !== 'direct') return false;
  const peer = directPeerDigits(target);
  if (!peer || !owner || peer !== owner) return true;
  return !isOwnerDirectSession(callerKey, owner);
}

export interface Redaction {
  value: unknown;
  removed: number;
}

function referenceHidden(reference: string, pathIsPrivate: (path: string) => boolean, callerKey: unknown, owner: string | undefined): boolean {
  if (reference.includes(':direct:')) return privateSessionTargetHidden(callerKey, reference, owner);
  return pathIsPrivate(reference);
}

/** Drop private hits from a memory or session tool payload. Shared hits stay. */
export function redactPrivateRetrieval(
  value: unknown,
  pathIsPrivate: (path: string) => boolean,
  callerKey: unknown,
  owner: string | undefined,
): Redaction {
  if (!value || typeof value !== 'object') return { value, removed: 0 };
  if (Array.isArray(value)) {
    let removed = 0;
    const items = value.map((item) => {
      const redacted = redactPrivateRetrieval(item, pathIsPrivate, callerKey, owner);
      removed += redacted.removed;
      return redacted.value;
    });
    return { value: items, removed };
  }
  const record = value as Record<string, unknown>;
  let removed = 0;
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (key === 'results' && Array.isArray(entry)) {
      const kept = [];
      for (const item of entry) {
        if (item && typeof item === 'object') {
          const hit = item as Record<string, unknown>;
          const path = typeof hit.path === 'string' ? hit.path : '';
          const sessionKey = typeof hit.sessionKey === 'string' ? hit.sessionKey : '';
          if ((path && referenceHidden(path, pathIsPrivate, callerKey, owner)) || (sessionKey && referenceHidden(sessionKey, pathIsPrivate, callerKey, owner))) {
            removed += 1;
            continue;
          }
        }
        kept.push(item);
      }
      next.results = kept;
      continue;
    }
    next[key] = entry;
  }
  const path = typeof next.path === 'string' ? next.path : '';
  if (path && referenceHidden(path, pathIsPrivate, callerKey, owner) && ('text' in next || 'snippet' in next)) {
    removed += 1;
    if ('text' in next) next.text = '';
    if ('snippet' in next) next.snippet = '';
    next.status = 'unavailable';
    next.privateMemory = 'hidden';
  }
  return { value: next, removed };
}

interface ToolResultMessage {
  content?: unknown;
  details?: unknown;
}

function rewriteJsonText(text: string, pathIsPrivate: (path: string) => boolean, callerKey: unknown, owner: string | undefined): { text: string; removed: number } {
  try {
    const parsed = JSON.parse(text) as unknown;
    const redacted = redactPrivateRetrieval(parsed, pathIsPrivate, callerKey, owner);
    if (!redacted.removed) return { text, removed: 0 };
    return { text: JSON.stringify(redacted.value, null, 2), removed: redacted.removed };
  } catch {
    return { text, removed: 0 };
  }
}

/** Rewrite one persisted tool result. Returns the same object when nothing private was present. */
export function redactToolResultMessage<T extends ToolResultMessage>(
  message: T,
  pathIsPrivate: (path: string) => boolean,
  callerKey: unknown,
  owner: string | undefined,
): { message: T; removed: number } {
  let removed = 0;
  let details = message.details;
  if (details && typeof details === 'object') {
    const redacted = redactPrivateRetrieval(details, pathIsPrivate, callerKey, owner);
    removed += redacted.removed;
    details = redacted.value;
  }
  const content = message.content;
  if (typeof content === 'string') {
    const rewritten = rewriteJsonText(content, pathIsPrivate, callerKey, owner);
    removed += rewritten.removed;
    if (!removed) return { message, removed: 0 };
    return { message: { ...message, content: rewritten.text, details } as T, removed };
  }
  if (!Array.isArray(content)) {
    if (!removed) return { message, removed: 0 };
    return { message: { ...message, details } as T, removed };
  }
  const nextContent = content.map((part) => {
    if (!part || typeof part !== 'object' || typeof (part as { text?: unknown }).text !== 'string') return part;
    const rewritten = rewriteJsonText((part as { text: string }).text, pathIsPrivate, callerKey, owner);
    removed += rewritten.removed;
    return rewritten.removed ? { ...(part as Record<string, unknown>), text: rewritten.text } : part;
  });
  if (!removed) return { message, removed: 0 };
  return { message: { ...message, content: nextContent, details } as T, removed };
}

function targetSessionKey(params: Record<string, unknown> | undefined): string {
  const value = params?.sessionKey;
  return typeof value === 'string' ? value : '';
}

function memoryPath(params: Record<string, unknown> | undefined): string {
  const value = params?.path ?? params?.relPath;
  return typeof value === 'string' ? value : '';
}

export interface PrivateMemoryDependencies {
  ownerDigits?: () => Promise<string | undefined>;
  classifyPath?: (path: string) => boolean;
}

export function registerPrivateMemoryGuard(api: OpenClawPluginApi, dependencies: PrivateMemoryDependencies = {}): void {
  const resolveOwner = dependencies.ownerDigits ?? (() => ownerDigits(api));
  const owner = cachedOwnerDigits(resolveOwner);
  const classify = dependencies.classifyPath ?? createPathClassifier(workspaceCandidates(api, undefined));
  api.on('before_tool_call', async (event, context) => {
    let digits = owner();
    if (!digits) {
      try { digits = await resolveOwner(); } catch { digits = undefined; }
    }
    if (isOwnerDirectSession(context.sessionKey, digits)) return undefined;
    const toolName = event.toolName;
    if (toolName === 'memory_get') {
      const path = memoryPath(event.params);
      if (path && classify(path)) return { block: true, blockReason: 'private memory is not available in this session' };
    }
    if ((PRIVATE_SESSION_TOOLS as readonly string[]).includes(toolName) && privateSessionTargetHidden(context.sessionKey, targetSessionKey(event.params), digits)) {
      return { block: true, blockReason: 'private session history is not available in this session' };
    }
    return undefined;
  });
  api.on('tool_result_persist', (event, context) => {
    const toolName = event.toolName ?? '';
    const watched = (PRIVATE_MEMORY_TOOLS as readonly string[]).includes(toolName) || (PRIVATE_SESSION_TOOLS as readonly string[]).includes(toolName);
    if (!watched) return undefined;
    const digits = owner();
    if (isOwnerDirectSession(context.sessionKey, digits)) return undefined;
    const redacted = redactToolResultMessage(event.message as ToolResultMessage, classify, context.sessionKey, digits);
    if (!redacted.removed) return undefined;
    api.logger.info(`amadeus private memory hidden tool=${toolName} removed=${redacted.removed}`);
    return { message: redacted.message as typeof event.message };
  });
}
