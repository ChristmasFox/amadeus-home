import { createHash, randomBytes } from 'node:crypto';
import { chown, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type MemoryScope = 'private' | 'public';
export type MemoryAction = 'add' | 'forget';
export type ProvenanceStatus = 'recorded' | 'unavailable';

export const SECTION_TITLE = '## 近期记住（由 remember 写入）';
export const SECTION_START = '<!-- amadeus-remember:start -->';
export const SECTION_END = '<!-- amadeus-remember:end -->';
export const MAX_ENTRY_CHARS = 300;
/** Managed section budget per file; older bullets compact into one digest line beyond it. */
export const SECTION_BUDGET: Record<MemoryScope, number> = { private: 3000, public: 1200 };
/** Whole-file ceiling, below agents.defaults.bootstrapMaxChars (20000) so the file is never truncated at injection. */
export const FILE_BUDGET: Record<MemoryScope, number> = { private: 16000, public: 6000 };
const COMPACT_LINE_MAX = 500;
const COMPACT_PREFIX = '- (较早，已压缩) ';

export const FILE_FOR_SCOPE: Record<MemoryScope, string> = { private: 'MEMORY.md', public: 'USER.md' };

/** Host provenance recorder; the patched runtime exposes it, tests inject a model of the store. */
export type ProvenanceMarker = (params: {
  workspaceDir: string;
  relativePath: string;
  contentAfter: string;
  observedAt: number;
  sessionId?: string;
  sessionKey?: string;
}) => Promise<(() => Promise<void>) | undefined>;

export interface RememberRequest {
  workspaceDir: string;
  scope: MemoryScope;
  action: MemoryAction;
  text: string;
  now?: Date;
  sessionId?: string;
  sessionKey?: string;
  markProvenance?: ProvenanceMarker | undefined;
}

export type RememberResult =
  | { ok: true; status: 'added' | 'duplicate' | 'forgotten'; file: string; scope: MemoryScope; compacted?: boolean; removed?: number; provenance: ProvenanceStatus }
  | { ok: false; status: 'refused'; reason: RefusalReason; message: string };

export type RefusalReason =
  | 'empty_text'
  | 'text_too_long'
  | 'text_unsafe'
  | 'public_text_unsafe'
  | 'not_found'
  | 'file_too_large'
  | 'concurrent_edit';

const refusals: Record<RefusalReason, string> = {
  empty_text: '没有可记录的内容。',
  text_too_long: `单条记忆不能超过 ${MAX_ENTRY_CHARS} 个字，请先概括再记。`,
  text_unsafe: '内容含有密钥、凭据或疑似指令格式，不能写入记忆。',
  public_text_unsafe: '公开记忆不能包含号码、邮箱、链接、群或账号标识，请改为私有或去掉这些信息。',
  not_found: '没有找到匹配的已记录内容，没有改动。',
  file_too_large: '记忆文件已接近容量上限，需要先清理旧内容，这次没有写入。',
  concurrent_edit: '记忆文件正在被同时修改，这次没有写入，请稍后重试。',
};

export function refuse(reason: RefusalReason): RememberResult {
  return { ok: false, status: 'refused', reason, message: refusals[reason] };
}

const SECRET_PATTERN = /(sk-[A-Za-z0-9]{12,}|api[_-]?key|access[_-]?token|bearer\s+[A-Za-z0-9._-]{12,}|password|passwd|密码|口令|私钥|-----BEGIN)/iu;
const MARKUP_PATTERN = /(<!--|-->|<\/?[a-z][^>]*>|^\s*#{1,6}\s)/iu;
const PUBLIC_UNSAFE_PATTERN = /(\+?\d[\d\s-]{6,}\d|[\w.+-]+@[\w-]+\.[\w.-]+|https?:\/\/|www\.|@g\.us|@s\.whatsapp\.net|whatsapp:|telegram:|kook)/iu;

/** One-line, markup-free text; returns the cleaned text or the refusal reason. */
export function sanitizeEntry(raw: string, scope: MemoryScope): { text: string } | { reason: RefusalReason } {
  // eslint-disable-next-line no-control-regex
  const flat = raw.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/gu, ' ').replace(/\s+/gu, ' ').trim().replace(/^[-*>•]+\s*/u, '');
  if (!flat) return { reason: 'empty_text' };
  if (flat.length > MAX_ENTRY_CHARS) return { reason: 'text_too_long' };
  if (SECRET_PATTERN.test(flat) || MARKUP_PATTERN.test(flat)) return { reason: 'text_unsafe' };
  if (scope === 'public' && PUBLIC_UNSAFE_PATTERN.test(flat.replace(/\d{4}-\d{2}-\d{2}/gu, ''))) return { reason: 'public_text_unsafe' };
  return { text: flat };
}

function normalizeForCompare(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function bigrams(value: string): Set<string> {
  const grams = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) grams.add(value.slice(index, index + 2));
  return grams;
}

export function isNearDuplicate(a: string, b: string): boolean {
  const left = normalizeForCompare(a);
  const right = normalizeForCompare(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  if (short.length >= 6 && long.includes(short)) return true;
  const gramsA = bigrams(left);
  const gramsB = bigrams(right);
  if (gramsA.size === 0 || gramsB.size === 0) return false;
  let shared = 0;
  for (const gram of gramsA) if (gramsB.has(gram)) shared += 1;
  return shared / (gramsA.size + gramsB.size - shared) >= 0.8;
}

interface Section {
  before: string;
  bullets: string[];
  after: string;
  exists: boolean;
}

function splitSection(content: string): Section {
  const start = content.indexOf(SECTION_START);
  const end = content.indexOf(SECTION_END);
  if (start === -1 || end === -1 || end < start) return { before: content, bullets: [], after: '', exists: false };
  const titleIndex = content.lastIndexOf(SECTION_TITLE, start);
  const headStart = titleIndex !== -1 && content.slice(titleIndex + SECTION_TITLE.length, start).trim() === '' ? titleIndex : start;
  const body = content.slice(start + SECTION_START.length, end);
  const bullets = body.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('- '));
  return { before: content.slice(0, headStart), bullets, after: content.slice(end + SECTION_END.length), exists: true };
}

function renderSection(bullets: string[]): string {
  return `${SECTION_TITLE}\n${SECTION_START}\n${bullets.join('\n')}${bullets.length ? '\n' : ''}${SECTION_END}`;
}

function assemble(section: Section, bullets: string[]): string {
  if (section.exists) return `${section.before}${renderSection(bullets)}${section.after}`;
  const base = section.before.replace(/\s+$/u, '');
  return `${base}${base ? '\n\n' : ''}${renderSection(bullets)}\n`;
}

function bulletText(bullet: string): string {
  return bullet.replace(/^- (?:\([^)]*\)\s*)?/u, '');
}

function sectionSize(bullets: string[]): number {
  return bullets.reduce((total, bullet) => total + bullet.length + 1, 0);
}

/** Fold the oldest dated bullets into one compressed line until the section fits; returns whether it did. */
export function compactBullets(bullets: string[], budget: number): { bullets: string[]; compacted: boolean } {
  let list = [...bullets];
  let compacted = false;
  while (sectionSize(list) > budget && list.length > 1) {
    compacted = true;
    const hasDigest = list[0]?.startsWith(COMPACT_PREFIX) === true;
    const digest = hasDigest ? list.shift()!.slice(COMPACT_PREFIX.length) : '';
    const oldest = list.shift()!;
    let merged = [digest, bulletText(oldest)].filter(Boolean).join('；');
    if (merged.length > COMPACT_LINE_MAX - COMPACT_PREFIX.length) merged = merged.slice(merged.length - (COMPACT_LINE_MAX - COMPACT_PREFIX.length));
    list = [`${COMPACT_PREFIX}${merged}`, ...list];
  }
  return { bullets: list, compacted };
}

function dateStamp(now: Date): string {
  // Asia/Shanghai calendar date (the owner's timezone), independent of the host clock zone.
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function removeMatching(bullets: string[], query: string): { bullets: string[]; removed: number } {
  const needle = normalizeForCompare(query);
  if (needle.length < 2) return { bullets, removed: 0 };
  let removed = 0;
  const next: string[] = [];
  for (const bullet of bullets) {
    if (bullet.startsWith(COMPACT_PREFIX)) {
      const parts = bullet.slice(COMPACT_PREFIX.length).split('；');
      const kept = parts.filter((part) => !normalizeForCompare(part).includes(needle));
      removed += parts.length - kept.length;
      if (kept.length) next.push(`${COMPACT_PREFIX}${kept.join('；')}`);
    } else if (normalizeForCompare(bulletText(bullet)).includes(needle)) {
      removed += 1;
    } else {
      next.push(bullet);
    }
  }
  return { bullets: next, removed };
}

const queues = new Map<string, Promise<unknown>>();

function serialized<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(task, task);
  queues.set(key, next.catch(() => undefined));
  return next;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

async function readIfExists(file: string): Promise<{ content: string; mode: number; uid: number; gid: number } | undefined> {
  try {
    const [content, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
    return { content, mode: info.mode & 0o777, uid: info.uid, gid: info.gid };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Temp file in the same directory, fsync, then rename: readers never see a partial file. Preserves mode/owner. */
export async function atomicWriteFile(file: string, content: string, mode: number, owner?: { uid: number; gid: number }): Promise<void> {
  const temporary = join(dirname(file), `.${file.split('/').pop()}.amadeus-${process.pid}-${randomBytes(4).toString('hex')}.tmp`);
  const handle = await open(temporary, 'wx', mode);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (owner) await chown(temporary, owner.uid, owner.gid).catch(() => undefined);
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Add/forget one fact in the managed section of MEMORY.md (private) or USER.md (public).
 * The caller has already proven the verified-owner/session scope; this module owns format,
 * budget, atomicity and provenance only. Memory text is never logged or thrown in errors.
 */
export function rememberFact(request: RememberRequest): Promise<RememberResult> {
  const file = join(request.workspaceDir, FILE_FOR_SCOPE[request.scope]);
  return serialized(file, async () => {
    const cleaned = sanitizeEntry(request.text, request.scope);
    if ('reason' in cleaned) return refuse(cleaned.reason);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = await readIfExists(file);
      const before = existing?.content ?? '';
      const section = splitSection(before);
      let bullets = section.bullets;
      let compacted = false;
      let removed: number | undefined;
      if (request.action === 'forget') {
        const outcome = removeMatching(bullets, cleaned.text);
        if (outcome.removed === 0) return refuse('not_found');
        bullets = outcome.bullets;
        removed = outcome.removed;
      } else {
        if (bullets.some((bullet) => isNearDuplicate(bulletText(bullet), cleaned.text))) {
          return { ok: true, status: 'duplicate', file: FILE_FOR_SCOPE[request.scope], scope: request.scope, provenance: 'recorded' };
        }
        bullets = [...bullets, `- (${dateStamp(request.now ?? new Date())}) ${cleaned.text}`];
        const fitted = compactBullets(bullets, SECTION_BUDGET[request.scope]);
        bullets = fitted.bullets;
        compacted = fitted.compacted;
      }
      const after = assemble(section, bullets);
      if (request.action === 'add' && after.length > FILE_BUDGET[request.scope]) return refuse('file_too_large');
      if (after === before) return refuse('not_found');

      let rollback: (() => Promise<void>) | undefined;
      let provenance: ProvenanceStatus = 'unavailable';
      if (request.markProvenance) {
        try {
          rollback = await request.markProvenance({
            workspaceDir: request.workspaceDir,
            relativePath: FILE_FOR_SCOPE[request.scope],
            contentAfter: after,
            observedAt: (request.now ?? new Date()).getTime(),
            ...(request.sessionId ? { sessionId: request.sessionId } : {}),
            ...(request.sessionKey ? { sessionKey: request.sessionKey } : {}),
          });
          provenance = 'recorded';
        } catch {
          provenance = 'unavailable';
        }
      }
      // Detect an external edit between our read and the rename; retry on the fresh content instead of clobbering it.
      const current = await readIfExists(file);
      if ((current?.content ?? '') !== before) {
        await rollback?.();
        continue;
      }
      try {
        await atomicWriteFile(file, after, existing?.mode ?? 0o644, existing ? { uid: existing.uid, gid: existing.gid } : undefined);
      } catch (error) {
        await rollback?.();
        throw error;
      }
      return {
        ok: true,
        status: request.action === 'forget' ? 'forgotten' : 'added',
        file: FILE_FOR_SCOPE[request.scope],
        scope: request.scope,
        provenance,
        ...(compacted ? { compacted: true } : {}),
        ...(removed !== undefined ? { removed } : {}),
      };
    }
    return refuse('concurrent_edit');
  });
}

export { sha256 as contentHash };
