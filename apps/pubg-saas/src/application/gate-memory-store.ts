import type { Pool } from 'pg';
import type { KookIngressJob } from './kook-ingress-queue.js';

/** This authority is server-derived for each call, never chosen by the model. */
export type GateMemoryScope =
  | { kind: 'dm'; botAccountId: string; actorId: string }
  | { kind: 'channel'; botAccountId: string; channelId: string; tenantId: string; teamId: string; bindingRevision: string };

export interface GateMemoryScopeResolver {
  resolveMemoryScope(job: KookIngressJob): Promise<GateMemoryScope | null>;
}
export interface GateMemoryEntry {
  key: string;
  content: string;
  revision: number;
  updatedAt: string;
}
export interface GateMemoryDraft {
  key: string;
  content: string;
}

const MAX_RESULTS = 24;
const FILTER = `bot_account_id=$1 AND scope_kind=$2 AND actor_id=$3 AND
  channel_id=$4 AND tenant_id=$5 AND team_id=$6 AND binding_revision=$7`;

function boundedText(value: string, max: number): string {
  if (typeof value !== 'string') throw new Error('gate_memory_input_invalid');
  const text = value.normalize('NFC').trim();
  if (!text || text.length > max || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(text))
    throw new Error('gate_memory_input_invalid');
  return text;
}

export function validateGateMemoryDraft(input: GateMemoryDraft): GateMemoryDraft {
  return { key: boundedText(input.key, 96).toLocaleLowerCase('en-US'),
    content: boundedText(input.content, 800) };
}

/** Explicitly lexical-only fallback. No semantic claims without embeddings. */
/** Han bigrams catch partial overlap where Intl word segmentation differs by
 * runtime/locale. This is still lexical, not semantic retrieval. */
export function memorySearchTokens(query: string): string[] {
  const normalized = boundedText(query, 240).toLocaleLowerCase('en-US');
  const tokens: string[] = [];
  for (const match of normalized.matchAll(/[\p{Script=Han}]+|[\p{L}\p{N}]+/gu)) {
    const run = match[0]!;
    if (/^\p{Script=Han}+$/u.test(run)) {
      for (let i = 0; i < run.length - 1; i += 1) tokens.push(run.slice(i, i + 2));
    } else if (run.length > 1) tokens.push(run);
  }
  return [...new Set(tokens)].slice(0, 240);
}

export function rankGateMemories(entries: GateMemoryEntry[], query: string, limit = 8): GateMemoryEntry[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RESULTS)
    throw new Error('gate_memory_limit_invalid');
  const search = boundedText(query, 240).toLocaleLowerCase('en-US');
  const words = memorySearchTokens(search);
  return entries.map((entry, index) => {
    const haystack = (entry.key + ' ' + entry.content).toLocaleLowerCase('en-US');
    const score = haystack.includes(search) ? 1000
      : words.reduce((value, word) => value + (haystack.includes(word) ? 1 : 0), 0);
    return { entry, index, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit).map(item => item.entry);
}

function scopedArgs(scope: GateMemoryScope): (string | number)[] {
  const bot = boundedText(scope.botAccountId, 128);
  if (scope.kind === 'dm') return [bot, 'dm', boundedText(scope.actorId, 256), '', '', '', 0];
  if (!/^[1-9][0-9]{0,17}$/u.test(scope.bindingRevision)) throw new Error('gate_memory_scope_invalid');
  return [bot, 'channel', '', boundedText(scope.channelId, 256),
    boundedText(scope.tenantId, 256), boundedText(scope.teamId, 256), scope.bindingRevision];
}

function entry(row: Record<string, unknown>): GateMemoryEntry {
  return { key: String(row.memory_key), content: String(row.content),
    revision: Number(row.revision),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at) };
}

/** PostgreSQL memory storage only. No automatic promotion or model-facing
 * write tools until consent, untrusted-source and conflict checks exist.
 * GateMemoryScopeResolver must revalidate the durable ingress each operation. */
export class GateMemoryStore {
  constructor(private readonly pool: Pool, private readonly authority: GateMemoryScopeResolver) {}

  private async trustedScope(job: KookIngressJob): Promise<(string | number)[]> {
    const grant = await this.authority.resolveMemoryScope(job);
    if (!grant) throw new Error('gate_memory_scope_unavailable');
    return scopedArgs(grant);
  }

  async listRecent(job: KookIngressJob, limit = 16): Promise<GateMemoryEntry[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RESULTS)
      throw new Error('gate_memory_limit_invalid');
    const scope = await this.trustedScope(job);
    const query = 'SELECT memory_key,content,revision,updated_at FROM gate_memory_entries WHERE '
      + FILTER + ' AND revoked_at IS NULL ORDER BY updated_at DESC,memory_id LIMIT $8';
    const result = await this.pool.query(query, [...scope, limit]);
    return result.rows.map(entry);
  }

  async searchLexical(job: KookIngressJob, query: string, limit = 8): Promise<GateMemoryEntry[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RESULTS)
      throw new Error('gate_memory_limit_invalid');
    const search = boundedText(query, 240).toLocaleLowerCase('en-US');
    const grams = memorySearchTokens(search);
    if (!grams.length) return [];
    const scope = await this.trustedScope(job);
    // SQL ranks *all* rows inside one trusted scope before LIMIT; no 128-row
    // candidate truncation and no cross-tenant scan. Return count is bounded.
    const sql = `WITH candidates AS (
      SELECT memory_key,content,revision,updated_at,
        CASE WHEN position($8 in lower(memory_key))>0 OR position($8 in lower(content))>0
          THEN 1000 ELSE (
            SELECT COUNT(*)::INTEGER FROM unnest($9::TEXT[]) AS gram(token)
            WHERE position(gram.token in lower(memory_key))>0
               OR position(gram.token in lower(content))>0
          ) END AS score
      FROM gate_memory_entries WHERE ` + FILTER + ` AND revoked_at IS NULL
    )
    SELECT memory_key,content,revision,updated_at FROM candidates WHERE score>0
    ORDER BY score DESC,updated_at DESC,memory_key LIMIT $10`;
    const result = await this.pool.query(sql, [...scope, search, grams, limit]);
    return result.rows.map(entry);
  }

  /** Create only if the key never existed. Replays do not overwrite facts. */
  async create(job: KookIngressJob, draft: GateMemoryDraft): Promise<'created' | 'already_exists'> {
    const value = validateGateMemoryDraft(draft);
    const scope = await this.trustedScope(job);
    const sql = `INSERT INTO gate_memory_entries
      (bot_account_id,scope_kind,actor_id,channel_id,tenant_id,team_id,binding_revision,memory_key,content,source_event_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT DO NOTHING RETURNING memory_id`;
    const result = await this.pool.query(sql, [...scope, value.key, value.content, boundedText(job.eventId, 256)]);
    return result.rowCount ? 'created' : 'already_exists';
  }

  /** Explicit compare-and-swap correction; not LLM last-writer-wins. */
  async revise(job: KookIngressJob, draft: GateMemoryDraft, expectedRevision: number): Promise<boolean> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
      throw new Error('gate_memory_revision_invalid');
    const value = validateGateMemoryDraft(draft);
    const scope = await this.trustedScope(job);
    const sql = 'UPDATE gate_memory_entries SET content=$9,source_event_id=$10,revision=revision+1,updated_at=now() WHERE '
      + FILTER + ' AND memory_key=$8 AND revision=$11 AND revoked_at IS NULL';
    const result = await this.pool.query(sql, [...scope, value.key, value.content,
      boundedText(job.eventId, 256), expectedRevision]);
    return !!result.rowCount;
  }

  /** Forget removes the content, retains a revocation tombstone, and refuses
   * later creates of the same key; this is privacy-focused, not restoration. */
  async forget(job: KookIngressJob, key: string): Promise<boolean> {
    const scope = await this.trustedScope(job);
    const sql = `UPDATE gate_memory_entries SET content='',revoked_at=now(),source_event_id=$9,
      revision=revision+1,updated_at=now() WHERE ` + FILTER + ' AND memory_key=$8 AND revoked_at IS NULL';
    const result = await this.pool.query(sql,
      [...scope, boundedText(key, 96).toLocaleLowerCase('en-US'), boundedText(job.eventId, 256)]);
    return !!result.rowCount;
  }
}
