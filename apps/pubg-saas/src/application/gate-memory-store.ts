import type { Pool } from 'pg';
import type { KookIngressJob } from './kook-ingress-queue.js';

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

/** A bounded lexical fallback, not an embedding or a semantic model. */
export function memorySearchTokens(query: string): string[] {
  const normalized = boundedText(query, 240).toLocaleLowerCase('en-US');
  const tokens: string[] = [];
  for (const match of normalized.matchAll(/[\p{Script=Han}]+|[\p{L}\p{N}]+/gu)) {
    const run = match[0]!;
    if (/^\p{Script=Han}+$/u.test(run)) {
      for (let index = 0; index < run.length - 1; index += 1) tokens.push(run.slice(index, index + 2));
    } else if (run.length > 1) tokens.push(run);
  }
  return [...new Set(tokens)].slice(0, 240);
}

export function rankGateMemories(entries: GateMemoryEntry[], query: string, limit = 8): GateMemoryEntry[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RESULTS) throw new Error('gate_memory_limit_invalid');
  const search = boundedText(query, 240).toLocaleLowerCase('en-US');
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
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at) };
}

/** The live ingress and current binding are checked in the *same SQL statement*
 * as each memory operation, closing the gap after external membership checks.
 * No session creation, advisory locks, lease extension, or FOR UPDATE. */
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
            SELECT 1 FROM channel_bindings binding
            JOIN tenants tenant ON tenant.tenant_id=binding.tenant_id
              AND tenant.platform=binding.platform AND tenant.bot_account_id=binding.bot_account_id
            JOIN channel_binding_versions version ON version.bot_account_id=binding.bot_account_id
              AND version.channel_id=binding.channel_id
            WHERE binding.bot_account_id=$1 AND binding.channel_id=$4
              AND binding.tenant_id=$5 AND binding.team_id=$6
              AND tenant.platform='kook' AND tenant.guild_id=ingress.guild_id
              AND version.revision=$7::BIGINT
          )
        )
      )
  )`;
}

export class GateMemoryStore {
  constructor(private readonly pool: Pool, private readonly authority: GateMemoryScopeResolver) {}

  private async trustedScope(job: KookIngressJob): Promise<(string | number)[]> {
    const trusted = await this.authority.resolveMemoryScope(job);
    if (!trusted) throw new Error('gate_memory_scope_unavailable');
    return scopedArgs(trusted);
  }

  async listRecent(job: KookIngressJob, limit = 16): Promise<GateMemoryEntry[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RESULTS) throw new Error('gate_memory_limit_invalid');
    const scope = await this.trustedScope(job);
    const sql = `SELECT memory_key,content,revision,updated_at
      FROM gate_memory_entries WHERE ` + FILTER + ` AND revoked_at IS NULL`
      + liveFence(9, 10) + ` ORDER BY updated_at DESC,memory_id LIMIT $8`;
    const result = await this.pool.query(sql, [...scope, limit, job.eventId, job.leaseToken]);
    return result.rows.map(project);
  }

  async searchLexical(job: KookIngressJob, query: string, limit = 8): Promise<GateMemoryEntry[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RESULTS) throw new Error('gate_memory_limit_invalid');
    const search = boundedText(query, 240).toLocaleLowerCase('en-US');
    const grams = memorySearchTokens(search);
    if (!grams.length) return [];
    const scope = await this.trustedScope(job);
    // Rank every row in this *one* trusted scope, then return a bounded result.
    // There is no 128-most-recent window that can hide older relevant entries.
    const sql = `WITH candidates AS (
      SELECT memory_key,content,revision,updated_at,
        CASE WHEN position($8 in lower(memory_key))>0 OR position($8 in lower(content))>0
          THEN 1000 ELSE (
            SELECT COUNT(*)::INTEGER FROM unnest($9::TEXT[]) AS gram(token)
            WHERE position(gram.token in lower(memory_key))>0
               OR position(gram.token in lower(content))>0
          ) END AS score
      FROM gate_memory_entries WHERE ` + FILTER + ` AND revoked_at IS NULL` + liveFence(11, 12) + `
    )
    SELECT memory_key,content,revision,updated_at FROM candidates WHERE score>0
    ORDER BY score DESC,updated_at DESC,memory_key LIMIT $10`;
    const result = await this.pool.query(sql, [...scope, search, grams, limit, job.eventId, job.leaseToken]);
    return result.rows.map(project);
  }

  /** New key only; a conflicting revision/tombstone is never overwritten. */
  async create(job: KookIngressJob, draft: GateMemoryDraft): Promise<'created' | 'already_exists'> {
    const value = validateGateMemoryDraft(draft);
    const scope = await this.trustedScope(job);
    const sql = `WITH allowed AS (SELECT 1 WHERE TRUE` + liveFence(10, 11) + `),
      inserted AS (
        INSERT INTO gate_memory_entries
        (bot_account_id,scope_kind,actor_id,channel_id,tenant_id,team_id,binding_revision,memory_key,content,source_event_id)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10 FROM allowed
        ON CONFLICT DO NOTHING RETURNING memory_id
      )
      SELECT EXISTS(SELECT 1 FROM allowed) AS allowed,
             EXISTS(SELECT 1 FROM inserted) AS inserted`;
    const result = await this.pool.query(sql, [...scope, value.key, value.content,
      boundedText(job.eventId, 256), job.leaseToken]);
    if (result.rows[0]?.allowed !== true) throw new Error('gate_memory_scope_unavailable');
    return result.rows[0]?.inserted === true ? 'created' : 'already_exists';
  }

  async revise(job: KookIngressJob, draft: GateMemoryDraft, expectedRevision: number): Promise<boolean> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error('gate_memory_revision_invalid');
    const value = validateGateMemoryDraft(draft);
    const scope = await this.trustedScope(job);
    const sql = 'UPDATE gate_memory_entries SET content=$9,source_event_id=$10,revision=revision+1,updated_at=now() WHERE '
      + FILTER + ' AND memory_key=$8 AND revision=$11 AND revoked_at IS NULL' + liveFence(10, 12);
    const result = await this.pool.query(sql, [...scope, value.key, value.content,
      boundedText(job.eventId, 256), expectedRevision, job.leaseToken]);
    return !!result.rowCount;
  }


  /** Explicit re-remembering requires a *newly admitted* message after the
   * tombstone, plus CAS revision. A pre-revocation lease cannot revive it.
   * Not exposed as an unrestricted model-facing tool. */
  async rememberAgain(job: KookIngressJob, draft: GateMemoryDraft, expectedRevision: number): Promise<boolean> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error('gate_memory_revision_invalid');
    const value = validateGateMemoryDraft(draft);
    const scope = await this.trustedScope(job);
    const sql = `UPDATE gate_memory_entries
      SET content=$9,source_event_id=$10,revoked_at=NULL,revision=revision+1,updated_at=now()
      WHERE ` + FILTER + ` AND memory_key=$8 AND revision=$11
      AND revoked_at IS NOT NULL AND source_event_id<>$10
      AND revoked_at < (
        SELECT ingress.received_at FROM kook_ingress_events ingress
        WHERE ingress.bot_account_id=$1 AND ingress.event_id=$10 AND ingress.lease_token=$12
          AND ingress.status='processing' AND ingress.lease_until>now()
          AND ingress.expires_at>now()
      )` + liveFence(10, 12);
    const result = await this.pool.query(sql, [...scope, value.key, value.content,
      boundedText(job.eventId, 256), expectedRevision, job.leaseToken]);
    return !!result.rowCount;
  }

  /** Tombstone removes stored text and blocks replayed creates. */
  async forget(job: KookIngressJob, key: string): Promise<boolean> {
    const scope = await this.trustedScope(job);
    const sql = `UPDATE gate_memory_entries SET content='',revoked_at=now(),source_event_id=$9,
      revision=revision+1,updated_at=now() WHERE ` + FILTER + ' AND memory_key=$8 AND revoked_at IS NULL'
      + liveFence(9, 10);
    const result = await this.pool.query(sql, [...scope,
      boundedText(key, 96).toLocaleLowerCase('en-US'), boundedText(job.eventId, 256), job.leaseToken]);
    return !!result.rowCount;
  }
}
