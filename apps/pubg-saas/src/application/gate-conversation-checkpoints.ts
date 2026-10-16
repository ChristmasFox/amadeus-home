import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { estimateGateTokens } from './gate-context-builder.js';

export interface KookConversationCheckpointScope {
  botAccountId: string;
  channelId: string;
  kind: 'direct' | 'group';
  tenantId: string | null;
  teamId: string | null;
  bindingRevision: string | null;
}

export interface KookConversationCheckpoint {
  text: string;
  generation: number;
  coverageFrom: string;
  coverageThrough: string;
  coveredMessageCount: number;
  sourceEventIds: string[];
}

export const MAX_AGENT_CONVERSATION_ROWS = 80;
export const MAX_CHECKPOINT_SOURCE_ROWS = 100;
export const MAX_CHECKPOINT_TOKENS = 1_000;

const CHECKPOINT_SOURCE_LIMIT = 48;
const MESSAGE_SCOPE_FILTER = `bot_account_id=$1 AND channel_id=$2 AND context_scope_kind=$3
  AND context_tenant_id IS NOT DISTINCT FROM $4::TEXT
  AND context_team_id IS NOT DISTINCT FROM $5::TEXT
  AND context_binding_revision IS NOT DISTINCT FROM $6::BIGINT`;

interface CheckpointRow {
  source_event_id: unknown;
  speaker_kind: unknown;
  created_at: unknown;
  content: unknown;
}

function scopeArgs(scope: KookConversationCheckpointScope): (string | null)[] {
  if (!scope.botAccountId || !scope.channelId
    || (scope.kind === 'group' && (!scope.bindingRevision || !/^(0|[1-9][0-9]*)$/u.test(scope.bindingRevision)))
    || (scope.kind === 'direct' && (scope.tenantId !== null || scope.teamId !== null || scope.bindingRevision !== null))
    || ((scope.tenantId === null) !== (scope.teamId === null))) {
    throw new Error('kook_conversation_checkpoint_scope_invalid');
  }
  return [scope.botAccountId, scope.channelId, scope.kind, scope.tenantId, scope.teamId, scope.bindingRevision];
}

export function kookConversationCheckpointScopeDigest(scope: KookConversationCheckpointScope): string {
  return createHash('sha256').update(JSON.stringify(scopeArgs(scope))).digest('hex');
}

function contentWithBudget(value: string, budget: number): string {
  if (estimateGateTokens(value) <= budget) return value;
  const marker = ' …[对话摘录截断]';
  const markerTokens = estimateGateTokens(marker);
  const textBudget = Math.max(0, budget - markerTokens);
  let text = '';
  let tokens = 0;
  for (const character of value) {
    const cost = estimateGateTokens(character);
    if (tokens + cost > textBudget) break;
    text += character;
    tokens += cost;
  }
  return `${text.trimEnd()}${budget >= markerTokens ? marker : ''}`;
}

/**
 * Rebuilds a small extractive checkpoint from raw transcript rows on every
 * completed event. The fixed 80-row offset and 100-row page keep work bounded;
 * this never calls a model and is safe to retry inside the completion txn.
 */
export async function refreshKookConversationCheckpoint(
  client: PoolClient,
  scope: KookConversationCheckpointScope,
): Promise<void> {
  const args = scopeArgs(scope);
  const digest = kookConversationCheckpointScopeDigest(scope);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`kook-context-checkpoint:${digest}`]);

  const boundary = await client.query<{ created_at: unknown; message_id: unknown }>(
    `SELECT created_at,message_id FROM kook_conversation_messages
     WHERE ${MESSAGE_SCOPE_FILTER}
     ORDER BY created_at DESC,message_id DESC OFFSET $7::INTEGER LIMIT 1`,
    [...args, MAX_AGENT_CONVERSATION_ROWS - 1],
  );
  const cutoff = boundary.rows[0];
  if (!cutoff) return;

  const rows = await client.query<CheckpointRow>(
    `SELECT source_event_id,speaker_kind,created_at,content
     FROM kook_conversation_messages
     WHERE ${MESSAGE_SCOPE_FILTER}
       AND (created_at,message_id) < ($7::TIMESTAMPTZ,$8::TEXT)
     ORDER BY created_at DESC,message_id DESC LIMIT $9::INTEGER`,
    [...args, cutoff.created_at, String(cutoff.message_id), MAX_CHECKPOINT_SOURCE_ROWS],
  );
  if (!rows.rows.length) return;

  const chronologicalRows = [...rows.rows].reverse();
  const digestMaterial = chronologicalRows.map(row => [
    String(row.source_event_id ?? ''), String(row.speaker_kind),
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    String(row.content),
  ]);
  const sourceDigest = createHash('sha256').update(JSON.stringify(digestMaterial)).digest('hex');
  const selected: Array<{ sourceEventId: string; speakerKind: 'human' | 'assistant'; line: string }> = [];
  let usedTokens = 0;
  for (const row of rows.rows) {
    const sourceEventId = typeof row.source_event_id === 'string' ? row.source_event_id : '';
    if (!sourceEventId || (row.speaker_kind !== 'human' && row.speaker_kind !== 'assistant')) continue;
    if (selected.length >= CHECKPOINT_SOURCE_LIMIT || usedTokens >= MAX_CHECKPOINT_TOKENS) break;
    const speakerKind = row.speaker_kind;
    const prefix = speakerKind === 'assistant' ? '助手说：' : '成员说：';
    const remaining = MAX_CHECKPOINT_TOKENS - usedTokens - estimateGateTokens(prefix);
    if (remaining <= 0) break;
    const excerpt = contentWithBudget(String(row.content), remaining);
    const line = `${prefix}${excerpt}`;
    const cost = estimateGateTokens(line);
    if (cost <= 0 || cost > remaining) continue;
    selected.push({ sourceEventId, speakerKind, line });
    usedTokens += cost;
  }
  selected.reverse();

  const first = chronologicalRows[0]!;
  const last = chronologicalRows.at(-1)!;
  const coverageFrom = first.created_at instanceof Date ? first.created_at.toISOString() : String(first.created_at);
  const coverageThrough = last.created_at instanceof Date ? last.created_at.toISOString() : String(last.created_at);
  const sourceEvents = [...new Set(selected.map(item => item.sourceEventId))];
  const text = selected.map(item => item.line).join('\n');
  await client.query(
    `INSERT INTO kook_conversation_checkpoints(
       bot_account_id,channel_id,scope_digest,context_scope_kind,context_tenant_id,context_team_id,
       context_binding_revision,generation,coverage_from,coverage_through,covered_message_count,
       source_event_ids,checkpoint_text,source_digest,rebuildable,updated_at
     ) VALUES ($1,$2,$7,$3,$4,$5,$6,1,$8::TIMESTAMPTZ,$9::TIMESTAMPTZ,$10,$11::TEXT[],$12,$13,true,now())
     ON CONFLICT (bot_account_id,channel_id,scope_digest) DO UPDATE SET
       context_scope_kind=EXCLUDED.context_scope_kind,
       context_tenant_id=EXCLUDED.context_tenant_id,context_team_id=EXCLUDED.context_team_id,
       context_binding_revision=EXCLUDED.context_binding_revision,
       generation=CASE WHEN kook_conversation_checkpoints.source_digest IS DISTINCT FROM EXCLUDED.source_digest
         THEN kook_conversation_checkpoints.generation+1 ELSE kook_conversation_checkpoints.generation END,
       coverage_from=EXCLUDED.coverage_from,coverage_through=EXCLUDED.coverage_through,
       covered_message_count=EXCLUDED.covered_message_count,source_event_ids=EXCLUDED.source_event_ids,
       checkpoint_text=EXCLUDED.checkpoint_text,source_digest=EXCLUDED.source_digest,
       rebuildable=true,updated_at=CASE WHEN kook_conversation_checkpoints.source_digest IS DISTINCT FROM EXCLUDED.source_digest
         THEN now() ELSE kook_conversation_checkpoints.updated_at END`,
    [scope.botAccountId, scope.channelId, scope.kind, scope.tenantId, scope.teamId,
      scope.bindingRevision, digest, coverageFrom, coverageThrough, chronologicalRows.length,
      sourceEvents, text, sourceDigest],
  );
}
