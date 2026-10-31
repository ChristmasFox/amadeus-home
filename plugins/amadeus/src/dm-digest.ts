import { readFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { configFor } from './config.js';
import { readRequiredFile } from './config.js';
import { atomicWriteFile } from './memory-store.js';
import { chatKind } from './remember.js';

/**
 * Digest of the verified owner's recent direct conversations.
 *
 * Runtime data: written outside git and outside the indexed memory corpus
 * (`memory/**` and root MEMORY.md/USER.md), so `memory_search` of any session
 * can never return it. Only owner direct sessions feed it and only owner
 * direct sessions receive it.
 */
export const DIGEST_DIR = '.amadeus-private';
export const DIGEST_FILE = 'dm-digest.md';
export const DIGEST_MAX_CHARS = 1800;
const DIGEST_MAX_LINES = 30;
const TRANSCRIPT_MAX_CHARS = 9000;
const TRANSCRIPT_MAX_MESSAGES = 60;
const MESSAGE_MAX_CHARS = 400;
const MIN_REGENERATE_MS = 20 * 60 * 1000;
const STALE_REFRESH_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 60_000;

export const DIGEST_HEADER = '【近期私聊要点：背景笔记，可能已过时，不要复述，仅在与当前话题相关时参考；最新在前】';

const SECRET_LINE = /(sk-[A-Za-z0-9]{12,}|api[_-]?key|access[_-]?token|bearer\s+[A-Za-z0-9._-]{12,}|password|passwd|密码|口令|私钥|-----BEGIN|\+?\d[\d\s-]{8,}\d)/iu;

const DATE_PATTERN = /\d{4}-\d{2}-\d{2}/gu;

export function digestPath(workspaceDir: string): string {
  return join(workspaceDir, DIGEST_DIR, DIGEST_FILE);
}

export async function readDigest(workspaceDir: string): Promise<string | undefined> {
  try {
    const text = (await readFile(digestPath(workspaceDir), 'utf8')).trim();
    return text || undefined;
  } catch {
    return undefined;
  }
}

/** Newest-first bullet text truncated at a line boundary: the oldest lines are dropped first. */
export function capDigest(text: string, maxChars = DIGEST_MAX_CHARS): string {
  const kept: string[] = [];
  let size = 0;
  for (const line of text.split('\n').map((entry) => entry.trim()).filter((entry) => entry.startsWith('- '))) {
    if (kept.length >= DIGEST_MAX_LINES || size + line.length + 1 > maxChars) break;
    kept.push(line);
    size += line.length + 1;
  }
  return kept.join('\n');
}

/** The model output is accepted only as plain bullets; anything else keeps the previous digest. */
export function validateDigest(output: string): string | undefined {
  const bullets = output.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('- '));
  if (bullets.length === 0 || bullets.some((line) => SECRET_LINE.test(line.replace(DATE_PATTERN, '')))) return undefined;
  const capped = capDigest(bullets.join('\n'));
  return capped || undefined;
}

export function renderDigestContext(digest: string): string {
  return `${DIGEST_HEADER}\n${capDigest(digest)}`;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (part && typeof part === 'object' && (part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''))
    .filter(Boolean)
    .join(' ');
}

/** Plain user/assistant text only (no tool calls or results), bounded per message and in total, oldest first. */
export function buildTranscript(messages: unknown[]): string {
  const lines: string[] = [];
  for (const message of messages.slice(-TRANSCRIPT_MAX_MESSAGES * 3)) {
    if (!message || typeof message !== 'object') continue;
    const role = (message as { role?: unknown }).role;
    if (role !== 'user' && role !== 'assistant') continue;
    const text = textOf((message as { content?: unknown }).content).replace(/\s+/gu, ' ').trim();
    if (!text || text.length < 2) continue;
    lines.push(`${role === 'user' ? '用户' : '助手'}: ${text.slice(0, MESSAGE_MAX_CHARS)}`);
  }
  let transcript = lines.slice(-TRANSCRIPT_MAX_MESSAGES).join('\n');
  if (transcript.length > TRANSCRIPT_MAX_CHARS) transcript = transcript.slice(transcript.length - TRANSCRIPT_MAX_CHARS);
  return transcript;
}

export function buildDigestPrompt(previousDigest: string | undefined, transcript: string, today: string): string {
  return [
    '你在维护“与主人私聊的近期要点”备忘。把【已有备忘】和【最新对话】合并成更新后的备忘。',
    '要求：',
    `- 只输出以“- ”开头的条目，每条一行，格式“- (YYYY-MM-DD) 要点”，最新的在前，共 15 到 30 条，总长不超过 ${DIGEST_MAX_CHARS - 300} 个汉字。`,
    '- 记录：近期聊过的主题、做出的决定、待办、情绪或状态变化、新出现的偏好。合并重复，丢弃过时或琐碎的内容。',
    '- 不要写电话号码、账号、密码、密钥、链接；不要引用原话；不要输出标题、解释或代码块。',
    `- 今天是 ${today}。没有日期可考的新内容用今天的日期。`,
    '',
    '【已有备忘】',
    previousDigest?.trim() || '（无）',
    '',
    '【最新对话】',
    transcript,
  ].join('\n');
}

export type Completer = (prompt: string, signal: AbortSignal) => Promise<string>;

interface NineRouterSettings {
  baseUrl: string;
  model: string;
}

function settingsFor(config: unknown): NineRouterSettings {
  const root = (config ?? {}) as {
    models?: { providers?: Record<string, { baseUrl?: unknown }> };
    agents?: { defaults?: { model?: { primary?: unknown } | string } };
  };
  const baseUrl = root.models?.providers?.nine_router?.baseUrl;
  const primary = typeof root.agents?.defaults?.model === 'string' ? root.agents.defaults.model : root.agents?.defaults?.model?.primary;
  return {
    baseUrl: (typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : 'http://9router:20128/v1').replace(/\/$/u, ''),
    model: process.env.OPENCLAW_DIGEST_MODEL?.trim() || (typeof primary === 'string' && primary.includes('/') ? primary.split('/').slice(1).join('/') : 'arthur-combo'),
  };
}

/** Configured 9router chat model; a plain-text completion with a hard output bound. */
export function nineRouterCompleter(config: unknown, fetchImpl: typeof fetch = fetch): Completer {
  const { baseUrl, model } = settingsFor(config);
  return async (prompt, signal) => {
    const key = process.env.OPENCLAW_9ROUTER_API_KEY;
    if (!key) throw new Error('digest_key_missing');
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, temperature: 0.2, max_tokens: 1400, stream: false, messages: [{ role: 'user', content: prompt }] }),
      signal,
    });
    if (!response.ok) throw new Error(`digest_http_${response.status}`);
    const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('digest_empty');
    return content;
  };
}

export interface DigestUpdate {
  workspaceDir: string;
  messages: unknown[];
  complete: Completer;
  now?: Date;
}

/** Summarise and atomically replace the digest; any failure leaves the previous file untouched. */
export async function updateDigest(update: DigestUpdate): Promise<'updated' | 'skipped' | 'failed'> {
  const transcript = buildTranscript(update.messages);
  if (transcript.length < 40) return 'skipped';
  const previous = await readDigest(update.workspaceDir);
  const today = new Date((update.now ?? new Date()).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const output = await update.complete(buildDigestPrompt(previous, transcript, today), controller.signal);
    const digest = validateDigest(output);
    if (!digest) return 'failed';
    const file = digestPath(update.workspaceDir);
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await atomicWriteFile(file, `${digest}\n`, 0o600);
    return 'updated';
  } catch {
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}

/** Digits of the owner's WhatsApp number, read from the protected owner-target file. */
export async function ownerDigits(api: OpenClawPluginApi): Promise<string | undefined> {
  try {
    const raw = await readRequiredFile(configFor(api).ownerTargetFile, 'WhatsApp owner target');
    const digits = raw.replace(/\D/gu, '');
    return digits.length >= 7 ? digits : undefined;
  } catch {
    return undefined;
  }
}

/** The verified owner's direct WhatsApp session: a direct session whose peer is the owner's number. */
export function isOwnerDirectSession(sessionKey: unknown, owner: string | undefined): boolean {
  if (!owner || typeof sessionKey !== 'string' || chatKind(sessionKey) !== 'direct') return false;
  const match = /:direct:(.+)$/u.exec(sessionKey);
  return match?.[1] !== undefined && match[1].replace(/\D/gu, '') === owner;
}

/** Synchronous accessor over the owner number: loaded asynchronously on first use, retried while unavailable. */
export function cachedOwnerDigits(resolve: () => Promise<string | undefined>): () => string | undefined {
  let cached: string | undefined;
  let loading = false;
  const load = (): void => {
    if (cached || loading) return;
    loading = true;
    void resolve().then((value) => { cached = value; loading = false; }, () => { loading = false; });
  };
  load();
  return () => { load(); return cached; };
}

export interface DigestDependencies {
  complete?: Completer;
  ownerDigits?: () => Promise<string | undefined>;
  now?: () => number;
}

export function registerDmDigest(api: OpenClawPluginApi, dependencies: DigestDependencies = {}): void {
  const now = dependencies.now ?? Date.now;
  const complete = dependencies.complete ?? nineRouterCompleter(api.config);
  const resolveOwner = dependencies.ownerDigits ?? (() => ownerDigits(api));
  const lastRun = new Map<string, number>();
  const inFlight = new Set<string>();

  const refresh = async (sessionKey: string | undefined, workspaceDir: string | undefined, messages: unknown[] | undefined, force: boolean): Promise<void> => {
    if (!sessionKey || !workspaceDir || !messages?.length) return;
    if (!isOwnerDirectSession(sessionKey, await resolveOwner())) return;
    const key = `${workspaceDir}\u0000${sessionKey}`;
    const elapsed = now() - (lastRun.get(key) ?? 0);
    if (inFlight.has(key) || elapsed < (force ? MIN_REGENERATE_MS : STALE_REFRESH_MS)) return;
    inFlight.add(key);
    lastRun.set(key, now());
    try {
      const outcome = await updateDigest({ workspaceDir, messages, complete, now: new Date(now()) });
      api.logger.info(`amadeus dm digest ${outcome}`);
    } catch {
      api.logger.warn('amadeus dm digest failed');
    } finally {
      inFlight.delete(key);
    }
  };

  api.on('before_reset', (event, context) => { void refresh(context.sessionKey, context.workspaceDir, event.messages, true); });
  api.on('before_compaction', (event, context) => { void refresh(context.sessionKey, context.workspaceDir, event.messages, true); });
  api.on('agent_end', (event, context) => {
    if (event.success) void refresh(context.sessionKey, context.workspaceDir, event.messages, false);
  });
  // Synchronous on purpose: the owner number is cached after the first lookup (the first turn after a restart may
  // run without the digest), and the digest is one small local file.
  const owner = cachedOwnerDigits(resolveOwner);
  api.on('before_prompt_build', (_event, context) => {
    if (!context.workspaceDir || !isOwnerDirectSession(context.sessionKey, owner())) return;
    try {
      const digest = readFileSync(digestPath(context.workspaceDir), 'utf8').trim();
      return digest ? { appendSystemContext: renderDigestContext(digest) } : undefined;
    } catch {
      return undefined;
    }
  });
}
