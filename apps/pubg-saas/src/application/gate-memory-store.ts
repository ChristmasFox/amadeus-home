import type { Pool } from 'pg';
import type { KookIngressJob } from './kook-ingress-queue.js';
import type { GateMemoryEmbeddingClient, GateMemoryEmbeddingContract } from './gate-memory-embedding.js';
import { estimateGateEmbeddingTokens } from './gate-memory-embedding.js';
import { reserveGateMemoryEmbeddingBudget, settleGateMemoryEmbeddingBudget } from './gate-memory-embedding-budget.js';
import { KOOK_CHANNEL_BINDING_JOIN, KOOK_CHANNEL_VERSION_JOIN } from './kook-channel-binding-sql.js';

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
  sourceEventId: string;
  sourceKind: 'trusted_ingress' | 'user_confirmed' | 'system_verified' | 'unknown';
  sourceReliability: number;
  validUntil: string | null;
  semanticSimilarity?: number;
}
export interface GateMemoryDraft {
  key: string;
  content: string;
}
export interface GateMemoryWriteMetadata {
  sourceKind?: GateMemoryEntry['sourceKind'];
  sourceReliability?: number;
  validUntil?: string | null;
}
export interface GateMemoryWriteState extends GateMemoryEntry {
  revoked: boolean;
}
export interface GateMemoryStoreOptions {
  lexicalSearchTimeoutMs?: number;
  onSearchMetric?: (metric: GateMemorySearchMetric) => void;
}

const MAX_RESULTS = 24;
const DEFAULT_LEXICAL_SEARCH_TIMEOUT_MS = 500;
const FILTER = `bot_account_id=$1 AND scope_kind=$2 AND actor_id=$3 AND
  channel_id=$4 AND tenant_id=$5 AND team_id=$6 AND binding_revision=$7`;
const EMBEDDING_MEMORY_FILTER = `memory.bot_account_id=$1 AND memory.scope_kind=$2 AND memory.actor_id=$3 AND
  memory.channel_id=$4 AND memory.tenant_id=$5 AND memory.team_id=$6 AND memory.binding_revision=$7`;

export interface GateMemorySearchResult {
  entries: GateMemoryEntry[];
  mode: 'semantic' | 'lexical_only';
  reason: 'semantic_unconfigured' | 'vector_index_unavailable' | 'semantic_unavailable'
    | 'semantic_timeout' | 'embedding_budget_exhausted' | 'embedding_budget_unavailable' | null;
}
export interface GateMemorySearchMetric {
  durationMs: number;
  mode: GateMemorySearchResult['mode'];
  reason: GateMemorySearchResult['reason'];
}
export interface GateMemorySemanticSearchResult {
  matches: GateMemoryEntry[];
  reason: GateMemorySearchResult['reason'];
}
export interface GateMemoryAuthorizedSearch {
  exact(query: string, limit?: number): Promise<GateMemoryEntry[]>;
  lexical(query: string, limit?: number): Promise<GateMemoryEntry[]>;
  semantic(query: string, provider: GateMemoryEmbeddingClient | null, limit?: number): Promise<GateMemorySemanticSearchResult>;
}

function vectorLiteral(values: readonly number[]): string {
  if (!values.length || values.some(value => !Number.isFinite(value))) throw new Error('gate_memory_embedding_vector_invalid');
  return `[${values.map(String).join(',')}]`;
}

function boundedText(value: string, max: number, emojiSequence = false): string {
  if (typeof value !== 'string') throw new Error('gate_memory_input_invalid');
  const text = value.normalize('NFC').trim();
  if (!text || text.length > max || /[\p{Cc}\p{Cs}]/u.test(text))
    throw new Error('gate_memory_input_invalid');
  for (let i = 0; i < text.length; i += 1) {
    if (!/\p{Cf}/u.test(text[i]!)) continue;
    // ZWJ is legitimate between emoji pictographs, not in keys or words.
    if (!emojiSequence || text[i] !== '\u200d'
      || !/\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F)?$/u.test(text.slice(0, i))
      || !/^\p{Extended_Pictographic}/u.test(text.slice(i + 1)))
      throw new Error('gate_memory_input_invalid');
  }
  return text;
}

export function validateGateMemoryDraft(input: GateMemoryDraft): GateMemoryDraft {
  return { key: canonicalizeGateMemoryKey(input.key),
    content: boundedText(input.content, 800, true) };
}

export function canonicalizeGateMemoryKey(value: string): string {
  const normalized = boundedText(value, 96).normalize('NFKC').toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/gu, '');
  if (!normalized || normalized.length > 96) throw new Error('gate_memory_input_invalid');
  return normalized;
}

function validatedWriteMetadata(input: GateMemoryWriteMetadata = {}): {
  sourceKind: NonNullable<GateMemoryWriteMetadata['sourceKind']>;
  sourceReliability: number;
  validUntil: string | null;
} {
  const sourceKind = input.sourceKind ?? 'trusted_ingress';
  if (!['trusted_ingress', 'user_confirmed', 'system_verified', 'unknown'].includes(sourceKind)) {
    throw new Error('gate_memory_source_kind_invalid');
  }
  const sourceReliability = input.sourceReliability ?? (sourceKind === 'user_confirmed' ? 95 : 80);
  if (!Number.isSafeInteger(sourceReliability) || sourceReliability < 0 || sourceReliability > 100) {
    throw new Error('gate_memory_source_reliability_invalid');
  }
  let validUntil: string | null = null;
  if (input.validUntil != null) {
    const timestamp = Date.parse(input.validUntil);
    if (!Number.isFinite(timestamp)) throw new Error('gate_memory_valid_until_invalid');
    validUntil = new Date(timestamp).toISOString();
  }
  return { sourceKind, sourceReliability, validUntil };
}

/** A bounded lexical fallback, not an embedding or a semantic model. */
export function memorySearchTokens(query: string): string[] {
  const normalized = boundedText(query, 240, true).toLocaleLowerCase('en-US');
  const tokens: string[] = [];
  // Split a mixed Latin/Han run by script; Han characters are also \p{L}.
  for (const match of normalized.matchAll(/[\p{L}\p{N}]+/gu)) {
    for (const chunk of match[0]!.match(/\p{Script=Han}+|[^\p{Script=Han}]+/gu) ?? []) {
      if (/^\p{Script=Han}+$/u.test(chunk)) {
        const chars = Array.from(chunk);
        for (let index = 0; index + 1 < chars.length; index += 1)
          tokens.push(chars[index]! + chars[index + 1]!);
      } else if (chunk.length > 1) tokens.push(chunk);
    }
  }
  return [...new Set(tokens)].slice(0, 240);
}

export function rankGateMemories(entries: GateMemoryEntry[], query: string, limit = 8): GateMemoryEntry[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RESULTS) throw new Error('gate_memory_limit_invalid');
  const search = boundedText(query, 240, true).toLocaleLowerCase('en-US');
  const words = memorySearchTokens(search);
  return entries.map((item, index) => {
    const haystack = (item.key + ' ' + item.content).toLocaleLowerCase('en-US');
    const score = haystack.includes(search) ? 1000
      : words.reduce((value, word) => value + (haystack.includes(word) ? 1 : 0), 0);
    return { item, index, score };
  }).filter(match => match.score > 0).sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit).map(match => match.item);
}

function scopedArgs(scope: GateMemoryScope): (string | number)[] {
  const bot = boundedText(scope.botAccountId, 128);
  if (scope.kind === 'dm') return [bot, 'dm', boundedText(scope.actorId, 256), '', '', '', 0];
  if (!/^[1-9][0-9]{0,17}$/u.test(scope.bindingRevision)) throw new Error('gate_memory_scope_invalid');
  return [bot, 'channel', '', boundedText(scope.channelId, 256),
    boundedText(scope.tenantId, 256), boundedText(scope.teamId, 256), scope.bindingRevision];
}

function project(row: Record<string, unknown>): GateMemoryEntry {
  return { key: String(row.memory_key), content: String(row.content),
    revision: Number(row.revision),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    sourceEventId: String(row.source_event_id),
    sourceKind: row.source_kind === 'user_confirmed' || row.source_kind === 'system_verified' || row.source_kind === 'unknown'
      ? row.source_kind : 'trusted_ingress',
    sourceReliability: Number(row.source_reliability),
    validUntil: row.valid_until == null ? null
      : row.valid_until instanceof Date ? row.valid_until.toISOString() : String(row.valid_until),
    ...(row.semantic_similarity == null ? {} : { semanticSimilarity: Number(row.semantic_similarity) }),
  };
}

const ACTIVE_MEMORY_FILTER = `revoked_at IS NULL AND superseded_at IS NULL
  AND (valid_until IS NULL OR valid_until>now()) AND source_kind<>'unknown'`;
const ACTIVE_JOINED_MEMORY_FILTER = `memory.revoked_at IS NULL AND memory.superseded_at IS NULL
  AND (memory.valid_until IS NULL OR memory.valid_until>now()) AND memory.source_kind<>'unknown'`;

/** The statement-level live check denies stale scopes after a channel rebind. */
function liveFence(eventIndex: number, tokenIndex: number): string {
  const eventSlot = '$' + eventIndex;
  const tokenSlot = '$' + tokenIndex;
  return ` AND EXISTS (
    SELECT 1 FROM kook_ingress_events ingress
    WHERE ingress.bot_account_id=$1 AND ingress.event_id=` + eventSlot
    + ` AND ingress.lease_token=` + tokenSlot + `
      AND ingress.status='processing' AND ingress.lease_until>now() AND ingress.expires_at>now()
      AND (
        ($2='dm' AND ingress.event_kind='direct' AND ingress.user_id=$3)
        OR ($2='channel' AND ingress.event_kind='group'
          AND ingress.channel_id=$4 AND ingress.tenant_id=$5 AND ingress.team_id=$6
          AND ingress.binding_revision=$7::BIGINT
          AND EXISTS (
            SELECT 1 FROM tenants tenant
            ${KOOK_CHANNEL_BINDING_JOIN}
            ${KOOK_CHANNEL_VERSION_JOIN}
            WHERE tenant.bot_account_id=$1 AND binding.channel_id=$4
              AND binding.tenant_id=$5 AND binding.team_id=$6
              AND tenant.platform='kook' AND tenant.guild_id=ingress.guild_id
              AND version.revision=$7::BIGINT
          )
        )
      )
  )`;
}

export class GateMemoryStore {
  private readonly lexicalSearchTimeoutMs: number;
  private readonly onSearchMetric: ((metric: GateMemorySearchMetric) => void) | undefined;
  constructor(
    private readonly pool: Pool,
    private readonly authority: GateMemoryScopeResolver,
    options: GateMemoryStoreOptions = {},
  ) {
    this.lexicalSearchTimeoutMs = options.lexicalSearchTimeoutMs ?? DEFAULT_LEXICAL_SEARCH_TIMEOUT_MS;
    this.onSearchMetric = options.onSearchMetric;
    if (!Number.isSafeInteger(this.lexicalSearchTimeoutMs) || this.lexicalSearchTimeoutMs < 10 || this.lexicalSearchTimeoutMs > 10_000) {
      throw new Error('gate_memory_lexical_timeout_invalid');
    }
  }

  private observedSearch(startedAt: number, result: GateMemorySearchResult): GateMemorySearchResult {
    try {
      this.onSearchMetric?.({ durationMs: Math.max(0, Date.now() - startedAt),
        mode: result.mode, reason: result.reason });
    } catch { /* metrics must not change recall behavior */ }
    return result;
  }

  private async trustedScope(job: KookIngressJob): Promise<(string | number)[]> {
    const trusted = await this.authority.resolveMemoryScope(job);
    if (!trusted) throw new Error('gate_memory_scope_unavailable');
    return scopedArgs(trusted);
  }

  /** Resolve the remote KOOK membership once, then expose only scoped reads.
   * Every SQL operation still rechecks the active lease and binding revision. */
  async withAuthorizedSearch<T>(
    job: KookIngressJob,
    work: (search: GateMemoryAuthorizedSearch) => Promise<T>,
  ): Promise<T> {
    const scope = await this.trustedScope(job);
    return work({
      exact: (query, limit = 8) => this.searchExactScoped(job, query, limit, scope),
      lexical: (query, limit = 8) => this.searchLexicalScoped(job, query, limit, scope),
      semantic: (query, provider, limit = 8) => this.searchSemanticScoped(job, query, provider, limit, scope),
    });
  }

  async listRecent(job: KookIngressJob, limit = 16): Promise<GateMemoryEntry[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RESULTS) throw new Error('gate_memory_limit_invalid');
    const scope = await this.trustedScope(job);
    const sql = `SELECT memory_key,content,revision,updated_at,source_event_id,source_kind,
        source_reliability,valid_until
      FROM gate_memory_entries WHERE ` + FILTER + ` AND ` + ACTIVE_MEMORY_FILTER
      + liveFence(9, 10) + ` ORDER BY updated_at DESC,memory_id LIMIT $8`;
    const result = await this.pool.query(sql, [...scope, limit, job.eventId, job.leaseToken]);
    return result.rows.map(project);
  }

  async searchExact(job: KookIngressJob, query: string, limit = 8): Promise<GateMemoryEntry[]> {
    return this.withAuthorizedSearch(job, search => search.exact(query, limit));
  }

  async getWriteState(job: KookIngressJob, key: string): Promise<GateMemoryWriteState | null> {
    const canonicalKey = canonicalizeGateMemoryKey(key);
    const scope = await this.trustedScope(job);
    const sql = `SELECT memory_key,content,revision,updated_at,source_event_id,source_kind,
        source_reliability,valid_until,(revoked_at IS NOT NULL) AS revoked
      FROM gate_memory_entries WHERE ` + FILTER + ` AND memory_key=$8`
      + liveFence(9, 10) + ` LIMIT 1`;
    const result = await this.pool.query(sql, [...scope, canonicalKey, job.eventId, job.leaseToken]);
    const row = result.rows[0];
    return row ? { ...project(row), revoked: row.revoked === true } : null;
  }

  async searchLexical(job: KookIngressJob, query: string, limit = 8): Promise<GateMemoryEntry[]> {
    return this.withAuthorizedSearch(job, search => search.lexical(query, limit));
  }

  private async searchExactScoped(
    job: KookIngressJob,
    rawQuery: string,
    limit: number,
    scope: (string | number)[],
  ): Promise<GateMemoryEntry[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RESULTS) throw new Error('gate_memory_limit_invalid');
    const search = boundedText(rawQuery, 240, true).toLocaleLowerCase('en-US');
    let canonicalKey = '';
    if (search.length <= 96) {
      try { canonicalKey = canonicalizeGateMemoryKey(search); } catch { /* Non-key queries still use exact content matching. */ }
    }
    const sql = `SELECT memory_key,content,revision,updated_at,source_event_id,source_kind,
        source_reliability,valid_until
      FROM gate_memory_entries WHERE ` + FILTER + ` AND ` + ACTIVE_MEMORY_FILTER
      + ` AND (memory_key=$8 OR lower(content)=$9)` + liveFence(11, 12)
      + ` ORDER BY (memory_key=$8) DESC,updated_at DESC,memory_key LIMIT $10`;
    const result = await this.pool.query(sql, [...scope, canonicalKey, search, limit, job.eventId, job.leaseToken]);
    return result.rows.map(project);
  }

  private async searchLexicalScoped(
    job: KookIngressJob,
    rawQuery: string,
    limit: number,
    scope: (string | number)[],
  ): Promise<GateMemoryEntry[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RESULTS) throw new Error('gate_memory_limit_invalid');
    const search = boundedText(rawQuery, 240, true).toLocaleLowerCase('en-US');
    const grams = memorySearchTokens(search);
    // Filter candidates before expensive scoring; never discard old matches by age.
    const terms = [...new Set([search, ...grams])].slice(0, 32);
    const patterns = terms.map(term => '%' + term.replace(/[#%_]/gu, char => '#' + char) + '%');
    const candidates = terms.map((_, i) =>
      "(lower(memory_key) LIKE $" + (13 + i) + " ESCAPE '#' OR lower(content) LIKE $" + (13 + i) + " ESCAPE '#')"
    ).join(' OR ');
    const sql = `WITH candidates AS (
      SELECT memory_key,content,revision,updated_at,source_event_id,source_kind,source_reliability,valid_until,
        CASE WHEN position($8 in lower(memory_key))>0 OR position($8 in lower(content))>0
          THEN 1000 ELSE (
            SELECT COUNT(*)::INTEGER FROM unnest($9::TEXT[]) AS gram(token)
            WHERE position(gram.token in lower(memory_key))>0
               OR position(gram.token in lower(content))>0
          ) END AS score
      FROM gate_memory_entries WHERE ` + FILTER + ' AND ' + ACTIVE_MEMORY_FILTER + ' AND (' + candidates + ')' + liveFence(11, 12) + `
    )
    SELECT memory_key,content,revision,updated_at,source_event_id,source_kind,source_reliability,valid_until FROM candidates WHERE score>0
    ORDER BY score DESC,updated_at DESC,memory_key LIMIT $10`;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('statement_timeout',$1,true)", [`${this.lexicalSearchTimeoutMs}ms`]);
      const result = await client.query(sql, [...scope, search, grams, limit, job.eventId, job.leaseToken, ...patterns]);
      await client.query('COMMIT');
      return result.rows.map(project);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error && typeof error === 'object' && 'code' in error && error.code === '57014') {
        throw new Error('gate_memory_lexical_timeout');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async searchVector(
    job: KookIngressJob,
    vector: readonly number[],
    contract: GateMemoryEmbeddingContract,
    limit: number,
    scope: (string | number)[],
  ): Promise<GateMemoryEntry[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RESULTS
      || vector.length !== contract.dimensions || !Number.isSafeInteger(contract.indexVersion)
      || contract.indexVersion < 1 || contract.indexVersion > 1_000_000
      || contract.normalization !== 'l2_unit') {
      throw new Error('gate_memory_embedding_contract_invalid');
    }
    const sql = `SELECT memory.memory_key,memory.content,memory.revision,memory.updated_at,
        memory.source_event_id,memory.source_kind,memory.source_reliability,memory.valid_until,
        1-(embedded.embedding <=> $9::vector) AS semantic_similarity
      FROM gate_memory_embeddings embedded
      JOIN gate_memory_entries memory ON memory.memory_id=embedded.memory_id
      WHERE ` + EMBEDDING_MEMORY_FILTER + ` AND ` + ACTIVE_JOINED_MEMORY_FILTER + `
        AND memory.revision=embedded.source_revision
        AND embedded.bot_account_id=$1 AND embedded.scope_kind=$2 AND embedded.actor_id=$3
        AND embedded.channel_id=$4 AND embedded.tenant_id=$5 AND embedded.team_id=$6
        AND embedded.binding_revision=$7::BIGINT AND embedded.provider_id=$10 AND embedded.model_id=$11
        AND embedded.dimensions=$12 AND embedded.index_version=$13 AND embedded.normalization='l2_unit'`
      + liveFence(14, 15) + `
      ORDER BY embedded.embedding <=> $9::vector,memory.updated_at DESC,memory.memory_key LIMIT $8`;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('statement_timeout',$1,true)", [`${this.lexicalSearchTimeoutMs}ms`]);
      const result = await client.query(sql, [
        ...scope, limit, vectorLiteral(vector), contract.providerId, contract.modelId,
        contract.dimensions, contract.indexVersion, job.eventId, job.leaseToken,
      ]);
      await client.query('COMMIT');
      return result.rows.map(project);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error && typeof error === 'object' && 'code' in error && error.code === '57014') {
        throw new Error('gate_memory_semantic_timeout');
      }
      throw error;
    } finally { client.release(); }
  }

  private async searchSemanticScoped(
    job: KookIngressJob,
    rawQuery: string,
    provider: GateMemoryEmbeddingClient | null,
    limit: number,
    scope: (string | number)[],
  ): Promise<GateMemorySemanticSearchResult> {
    const search = boundedText(rawQuery, 240, true);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RESULTS)
      throw new Error('gate_memory_limit_invalid');
    if (!provider) return { matches: [], reason: 'semantic_unconfigured' };
    try {
      const available = await this.pool.query<{ available: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector')
           AND to_regclass('gate_memory_embeddings') IS NOT NULL AS available`,
      );
      if (available.rows[0]?.available !== true) return { matches: [], reason: 'vector_index_unavailable' };
    } catch {
      return { matches: [], reason: 'vector_index_unavailable' };
    }

    const estimatedTokens = estimateGateEmbeddingTokens([search]);
    let budgetDay: string | null;
    try {
      budgetDay = await reserveGateMemoryEmbeddingBudget(this.pool, String(scope[0]), estimatedTokens, provider);
    } catch {
      return { matches: [], reason: 'embedding_budget_unavailable' };
    }
    if (!budgetDay) return { matches: [], reason: 'embedding_budget_exhausted' };

    let budgetSettled = false;
    try {
      const batch = await provider.embedMany([search]);
      await settleGateMemoryEmbeddingBudget(this.pool, String(scope[0]), budgetDay, estimatedTokens, batch.inputTokens);
      budgetSettled = true;
      const vector = batch.vectors[0];
      const norm = vector?.reduce((sum, value) => sum + value * value, 0) ?? 0;
      if (!vector || batch.vectors.length !== 1 || vector.length !== provider.contract.dimensions
        || vector.some(value => !Number.isFinite(value))
        || !Number.isFinite(norm) || Math.abs(Math.sqrt(norm) - 1) > 1e-3
        || batch.contract.providerId !== provider.contract.providerId
        || batch.contract.modelId !== provider.contract.modelId
        || batch.contract.dimensions !== provider.contract.dimensions
        || batch.contract.normalization !== 'l2_unit'
        || batch.contract.indexVersion !== provider.contract.indexVersion) {
        throw new Error('gate_memory_embedding_contract_invalid');
      }
      return { matches: await this.searchVector(job, vector, provider.contract, limit, scope), reason: null };
    } catch (error) {
      if (!budgetSettled) {
        await settleGateMemoryEmbeddingBudget(this.pool, String(scope[0]), budgetDay, estimatedTokens, null).catch(() => undefined);
      }
      const reason = error instanceof Error
        && (error.message === 'gate_memory_embedding_timeout' || error.message === 'gate_memory_semantic_timeout')
        ? 'semantic_timeout' : 'semantic_unavailable';
      return { matches: [], reason };
    }
  }

  /** Exact scope-filtered cosine search. No provider call occurs unless the
   * live request has authority and the separately applied vector schema exists. */
  async searchWithFallback(
    job: KookIngressJob,
    query: string,
    provider: GateMemoryEmbeddingClient | null,
    limit = 8,
  ): Promise<GateMemorySearchResult> {
    const startedAt = Date.now();
    const search = boundedText(query, 240, true);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RESULTS) throw new Error('gate_memory_limit_invalid');
    return this.withAuthorizedSearch(job, async sources => {
      const semantic = await sources.semantic(search, provider, limit);
      if (semantic.reason === null) return this.observedSearch(startedAt, {
        entries: semantic.matches, mode: 'semantic', reason: null,
      });
      return this.observedSearch(startedAt, {
        entries: await sources.lexical(search, limit), mode: 'lexical_only', reason: semantic.reason,
      });
    });
  }

  /** New key only; a conflicting revision/tombstone is never overwritten. */
  async create(job: KookIngressJob, draft: GateMemoryDraft, metadata: GateMemoryWriteMetadata = {}): Promise<'created' | 'already_exists'> {
    const value = validateGateMemoryDraft(draft);
    const source = validatedWriteMetadata(metadata);
    const scope = await this.trustedScope(job);
    const sql = `WITH allowed AS (SELECT 1 WHERE TRUE` + liveFence(14, 15) + `),
      inserted AS (
        INSERT INTO gate_memory_entries
        (bot_account_id,scope_kind,actor_id,channel_id,tenant_id,team_id,binding_revision,memory_key,content,source_event_id,
         source_kind,source_reliability,valid_until)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13 FROM allowed
        ON CONFLICT DO NOTHING RETURNING memory_id
      ), queued AS (
        INSERT INTO gate_memory_embedding_jobs(memory_id,source_revision,operation)
        SELECT memory_id,1,'upsert' FROM inserted ON CONFLICT DO NOTHING RETURNING job_id
      )
      SELECT EXISTS(SELECT 1 FROM allowed) AS allowed,
             EXISTS(SELECT 1 FROM inserted) AS inserted,
             EXISTS(SELECT 1 FROM queued) AS queued`;
    const result = await this.pool.query(sql, [...scope, value.key, value.content,
      boundedText(job.eventId, 256), source.sourceKind, source.sourceReliability, source.validUntil,
      job.eventId, job.leaseToken]);
    if (result.rows[0]?.allowed !== true) throw new Error('gate_memory_scope_unavailable');
    return result.rows[0]?.inserted === true ? 'created' : 'already_exists';
  }

  async revise(job: KookIngressJob, draft: GateMemoryDraft, expectedRevision: number, metadata: GateMemoryWriteMetadata = {}): Promise<boolean> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error('gate_memory_revision_invalid');
    const value = validateGateMemoryDraft(draft);
    const source = validatedWriteMetadata(metadata);
    const scope = await this.trustedScope(job);
    const sql = `WITH updated AS (
      UPDATE gate_memory_entries SET content=$9,source_event_id=$10,source_kind=$11,source_reliability=$12,
        valid_until=$13,revision=revision+1,updated_at=now() WHERE `
      + FILTER + ' AND memory_key=$8 AND revision=$14 AND revoked_at IS NULL' + liveFence(10, 15) + `
      RETURNING memory_id,revision
    ), queued AS (
      INSERT INTO gate_memory_embedding_jobs(memory_id,source_revision,operation)
      SELECT memory_id,revision,'upsert' FROM updated ON CONFLICT DO NOTHING RETURNING job_id
    ) SELECT EXISTS(SELECT 1 FROM updated) AS updated,EXISTS(SELECT 1 FROM queued) AS queued`;
    const result = await this.pool.query(sql, [...scope, value.key, value.content,
      boundedText(job.eventId, 256), source.sourceKind, source.sourceReliability, source.validUntil,
      expectedRevision, job.leaseToken]);
    return result.rows[0]?.updated === true;
  }


  /** Only an event received after revocation can restore a tombstone. */
  async rememberAgain(job: KookIngressJob, draft: GateMemoryDraft, expectedRevision: number, metadata: GateMemoryWriteMetadata = {}): Promise<boolean> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error('gate_memory_revision_invalid');
    const value = validateGateMemoryDraft(draft);
    const source = validatedWriteMetadata(metadata);
    const scope = await this.trustedScope(job);
    const sql = `WITH updated AS (UPDATE gate_memory_entries
      SET content=$9,source_event_id=$10,source_kind=$11,source_reliability=$12,valid_until=$13,
        revoked_at=NULL,revision=revision+1,updated_at=now()
      WHERE ` + FILTER + ` AND memory_key=$8 AND revision=$14
      AND revoked_at IS NOT NULL AND source_event_id<>$10
      AND revoked_at < (
        SELECT ingress.received_at FROM kook_ingress_events ingress
        WHERE ingress.bot_account_id=$1 AND ingress.event_id=$10 AND ingress.lease_token=$15
          AND ingress.status='processing' AND ingress.lease_until>now()
          AND ingress.expires_at>now()
      )` + liveFence(10, 15) + ` RETURNING memory_id,revision), queued AS (
        INSERT INTO gate_memory_embedding_jobs(memory_id,source_revision,operation)
        SELECT memory_id,revision,'upsert' FROM updated ON CONFLICT DO NOTHING RETURNING job_id
      ) SELECT EXISTS(SELECT 1 FROM updated) AS updated,EXISTS(SELECT 1 FROM queued) AS queued`;
    const result = await this.pool.query(sql, [...scope, value.key, value.content,
      boundedText(job.eventId, 256), source.sourceKind, source.sourceReliability, source.validUntil,
      expectedRevision, job.leaseToken]);
    return result.rows[0]?.updated === true;
  }

  /** Tombstone removes stored text and blocks replayed creates. */
  async forget(job: KookIngressJob, key: string): Promise<boolean> {
    const scope = await this.trustedScope(job);
    const sql = `WITH updated AS (UPDATE gate_memory_entries SET content='',revoked_at=now(),source_event_id=$9,
      revision=revision+1,updated_at=now() WHERE ` + FILTER + ' AND memory_key=$8 AND revoked_at IS NULL'
      + liveFence(9, 10) + ` RETURNING memory_id,revision), queued AS (
        INSERT INTO gate_memory_embedding_jobs(memory_id,source_revision,operation)
        SELECT memory_id,revision,'delete' FROM updated ON CONFLICT DO NOTHING RETURNING job_id
      ) SELECT EXISTS(SELECT 1 FROM updated) AS updated,EXISTS(SELECT 1 FROM queued) AS queued`;
    const result = await this.pool.query(sql, [...scope,
      canonicalizeGateMemoryKey(key), boundedText(job.eventId, 256), job.leaseToken]);
    return result.rows[0]?.updated === true;
  }
}
