import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { stableJson, type NormalizedInbound, type ToolExecutionObservation, type ToolResponseStatus } from './contracts.js';

export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting_input'
  | 'waiting_approval'
  | 'waiting_job'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'reconciling'
  | 'blocked';

export interface RunRecord {
  id: string;
  sessionKey: string;
  status: RunStatus;
  checkpoint: Record<string, unknown>;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  externalJobId: string | null;
  lastObservation: string | null;
  nextStep: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobRecord {
  id: string;
  runId: string;
  kind: string;
  status: string;
  externalId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRecord {
  id: string;
  runId: string;
  principalKey: string;
  sessionKey: string;
  action: string;
  argumentsHash: string;
  status: 'pending' | 'used' | 'expired' | 'rejected';
  expiresAt: string;
  usedAt: string | null;
}

export interface DeliveryRecord {
  id: string;
  eventId: string;
  channel: string;
  recipient: string;
  status: 'pending' | 'sending' | 'sent' | 'retryable_failed' | 'unknown' | 'dead';
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
}

export interface TaskStepRecord {
  runId: string;
  stepKey: string;
  status: 'planned' | 'running' | 'succeeded' | 'waiting_job' | 'unknown' | 'blocked' | 'cancelled';
  intent: Record<string, unknown>;
  result: unknown | null;
  externalId: string | null;
  attempts: number;
  updatedAt: string;
}

const transitions: Record<RunStatus, readonly RunStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['waiting_input', 'waiting_approval', 'waiting_job', 'succeeded', 'failed', 'cancelled', 'reconciling'],
  waiting_input: ['running', 'cancelled'],
  waiting_approval: ['running', 'cancelled'],
  waiting_job: ['running', 'succeeded', 'failed', 'cancelled', 'reconciling'],
  reconciling: ['running', 'succeeded', 'failed', 'blocked', 'cancelled'],
  blocked: ['reconciling', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export class KurisuStore {
  readonly db: DatabaseSync;

  constructor(filename = ':memory:') {
    if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA foreign_keys = ON;');
    try {
      this.db.exec('PRAGMA journal_mode = WAL;');
    } catch {
      // SQLite memory databases do not support WAL; the schema remains valid.
    }
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kurisu_schema_meta (
        version INTEGER NOT NULL
      );
      INSERT INTO kurisu_schema_meta(version)
        SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM kurisu_schema_meta);

      CREATE TABLE IF NOT EXISTS kurisu_sessions (
        session_key TEXT PRIMARY KEY,
        principal_key TEXT NOT NULL,
        platform TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        chat_kind TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        thread_id TEXT,
        topic_id TEXT,
        snapshot_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kurisu_messages (
        id TEXT PRIMARY KEY,
        session_key TEXT NOT NULL REFERENCES kurisu_sessions(session_key),
        update_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        reply_to TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(session_key, update_id)
      );
      CREATE TABLE IF NOT EXISTS kurisu_inbound_dedup (
        idempotency_key TEXT PRIMARY KEY,
        session_key TEXT NOT NULL,
        update_id TEXT NOT NULL,
        result_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kurisu_runs (
        id TEXT PRIMARY KEY,
        session_key TEXT NOT NULL REFERENCES kurisu_sessions(session_key),
        status TEXT NOT NULL,
        checkpoint_json TEXT NOT NULL DEFAULT '{}',
        lease_owner TEXT,
        lease_expires_at TEXT,
        external_job_id TEXT,
        last_observation TEXT,
        next_step TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kurisu_jobs (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES kurisu_runs(id),
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        external_id TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kurisu_tool_executions (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES kurisu_runs(id),
        call_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        arguments_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        response_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        UNIQUE(run_id, call_id)
      );
      CREATE TABLE IF NOT EXISTS kurisu_task_steps (
        run_id TEXT NOT NULL REFERENCES kurisu_runs(id),
        step_key TEXT NOT NULL,
        status TEXT NOT NULL,
        intent_json TEXT NOT NULL DEFAULT '{}',
        result_json TEXT,
        external_id TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(run_id, step_key)
      );
      CREATE TABLE IF NOT EXISTS kurisu_approvals (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES kurisu_runs(id),
        principal_key TEXT NOT NULL,
        session_key TEXT NOT NULL,
        action TEXT NOT NULL,
        arguments_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      );
      CREATE TABLE IF NOT EXISTS kurisu_preferences (
        session_key TEXT NOT NULL,
        preference_key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        expires_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(session_key, preference_key)
      );
      CREATE TABLE IF NOT EXISTS kurisu_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        event_key TEXT NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kurisu_deliveries (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES kurisu_events(id),
        channel TEXT NOT NULL,
        recipient TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_error TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(event_id, channel, recipient)
      );
      CREATE INDEX IF NOT EXISTS ix_kurisu_runs_status_lease ON kurisu_runs(status, lease_expires_at);
      CREATE INDEX IF NOT EXISTS ix_kurisu_deliveries_due ON kurisu_deliveries(status, next_attempt_at);
    `);
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const result = fn();
      this.db.exec('COMMIT;');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK;'); } catch { /* preserve original error */ }
      throw error;
    }
  }

  ensureSession(inbound: NormalizedInbound): void {
    const receivedAt = inbound.receivedAt ?? new Date().toISOString();
    this.db.prepare(`
      INSERT INTO kurisu_sessions(session_key, principal_key, platform, bot_id, chat_kind, chat_id, thread_id, topic_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_key) DO UPDATE SET updated_at=excluded.updated_at
    `).run(
      inbound.sessionKey,
      inbound.principalKey,
      inbound.identity.platform,
      inbound.botId,
      inbound.conversation.kind,
      inbound.conversation.chatId,
      inbound.conversation.threadId ?? null,
      inbound.conversation.topicId ?? null,
      receivedAt,
      receivedAt,
    );
  }

  claimInbound(inbound: NormalizedInbound): { claimed: boolean; result: unknown | null } {
    return this.transaction(() => {
      const receivedAt = inbound.receivedAt ?? new Date().toISOString();
      const existing = this.db.prepare('SELECT result_json FROM kurisu_inbound_dedup WHERE idempotency_key = ?').get(inbound.idempotencyKey) as { result_json?: string | null } | undefined;
      if (existing) return { claimed: false, result: parseJson(existing.result_json) };
      this.db.prepare('INSERT INTO kurisu_inbound_dedup(idempotency_key, session_key, update_id, created_at) VALUES (?, ?, ?, ?)').run(
        inbound.idempotencyKey, inbound.sessionKey, inbound.updateId, receivedAt,
      );
      this.ensureSession(inbound);
      this.db.prepare(`
        INSERT INTO kurisu_messages(id, session_key, update_id, message_id, role, text, attachments_json, reply_to, created_at)
        VALUES (?, ?, ?, ?, 'user', ?, ?, ?, ?)
        ON CONFLICT(session_key, update_id) DO NOTHING
      `).run(
        randomUUID(), inbound.sessionKey, inbound.updateId, inbound.messageId, inbound.text,
        JSON.stringify(inbound.attachments), inbound.replyTo?.messageId ?? null, receivedAt,
      );
      return { claimed: true, result: null };
    });
  }

  saveInboundResult(idempotencyKey: string, result: unknown): void {
    this.db.prepare('UPDATE kurisu_inbound_dedup SET result_json = ? WHERE idempotency_key = ?').run(JSON.stringify(result), idempotencyKey);
  }

  createRun(sessionKey: string, id = `run_${randomUUID()}`, now = new Date().toISOString()): RunRecord {
    this.db.prepare('INSERT INTO kurisu_runs(id, session_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, sessionKey, 'queued', now, now);
    return this.getRun(id)!;
  }

  getRun(id: string): RunRecord | null {
    const row = this.db.prepare('SELECT * FROM kurisu_runs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? toRun(row) : null;
  }

  transitionRun(id: string, status: RunStatus, patch: Partial<Pick<RunRecord, 'checkpoint' | 'externalJobId' | 'lastObservation' | 'nextStep'>> = {}, now = new Date().toISOString()): RunRecord {
    const current = this.getRun(id);
    if (!current) throw new Error(`run not found: ${id}`);
    if (current.status !== status && !transitions[current.status].includes(status)) throw new Error(`invalid run transition ${current.status} -> ${status}`);
    this.db.prepare(`
      UPDATE kurisu_runs SET status=?, checkpoint_json=?, external_job_id=?, last_observation=?, next_step=?, updated_at=? WHERE id=?
    `).run(
      status,
      JSON.stringify(patch.checkpoint ?? current.checkpoint),
      patch.externalJobId ?? current.externalJobId,
      patch.lastObservation ?? current.lastObservation,
      patch.nextStep ?? current.nextStep,
      now,
      id,
    );
    return this.getRun(id)!;
  }

  claimRun(id: string, owner: string, leaseMs = 30_000, now = new Date()): RunRecord | null {
    const nowIso = now.toISOString();
    const expires = new Date(now.getTime() + leaseMs).toISOString();
    return this.transaction(() => {
      const current = this.getRun(id);
      if (!current || ['succeeded', 'failed', 'cancelled'].includes(current.status)) return null;
      if (current.leaseExpiresAt && current.leaseExpiresAt > nowIso && current.leaseOwner !== owner) return null;
      const status = current.status === 'queued' ? 'running' : current.status;
      if (status !== current.status && !transitions[current.status].includes(status)) return null;
      this.db.prepare('UPDATE kurisu_runs SET status=?, lease_owner=?, lease_expires_at=?, updated_at=? WHERE id=?').run(status, owner, expires, nowIso, id);
      return this.getRun(id);
    });
  }

  releaseLease(id: string, owner: string, now = new Date().toISOString()): void {
    this.db.prepare('UPDATE kurisu_runs SET lease_owner=NULL, lease_expires_at=NULL, updated_at=? WHERE id=? AND lease_owner=?').run(now, id, owner);
  }

  cancelRun(id: string, now = new Date().toISOString()): RunRecord {
    const current = this.getRun(id);
    if (!current) throw new Error(`run not found: ${id}`);
    if (current.status !== 'cancelled') return this.transitionRun(id, 'cancelled', { lastObservation: 'cancel requested; no later steps allowed' }, now);
    return current;
  }

  recordToolExecution(observation: ToolExecutionObservation, response: unknown): { inserted: boolean; id: string } {
    const id = observation.id;
    const result = this.db.prepare(`
      INSERT INTO kurisu_tool_executions(id, run_id, call_id, tool_name, arguments_hash, status, response_json, started_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, call_id) DO NOTHING
    `).run(
      id, observation.runId, observation.callId, observation.toolName, observation.argumentsHash,
      observation.status, JSON.stringify(response), observation.startedAt, observation.finishedAt,
    );
    return { inserted: Number(result.changes) === 1, id };
  }

  getToolExecution(runId: string, callId: string): { id: string; status: ToolResponseStatus; response: unknown } | null {
    const row = this.db.prepare('SELECT id,status,response_json FROM kurisu_tool_executions WHERE run_id=? AND call_id=?').get(runId, callId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { id: String(row.id), status: String(row.status) as ToolResponseStatus, response: parseJson(String(row.response_json)) };
  }

  createJob(runId: string, kind: string, payload: Record<string, unknown>, id = `job_${randomUUID()}`, now = new Date().toISOString()): JobRecord {
    this.db.prepare('INSERT INTO kurisu_jobs(id,run_id,kind,status,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id, runId, kind, 'accepted', JSON.stringify(payload), now, now);
    return this.getJob(id)!;
  }

  beginTaskStep(runId: string, stepKey: string, intent: Record<string, unknown>, now = new Date().toISOString()): TaskStepRecord {
    this.db.prepare(`
      INSERT INTO kurisu_task_steps(run_id,step_key,status,intent_json,attempts,updated_at) VALUES (?,?,?,?,1,?)
      ON CONFLICT(run_id,step_key) DO UPDATE SET status='running', attempts=attempts+1, updated_at=excluded.updated_at
    `).run(runId, stepKey, 'running', JSON.stringify(intent), now);
    return this.getTaskStep(runId, stepKey)!;
  }

  getTaskStep(runId: string, stepKey: string): TaskStepRecord | null {
    const row = this.db.prepare('SELECT * FROM kurisu_task_steps WHERE run_id=? AND step_key=?').get(runId, stepKey) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      runId: String(row.run_id), stepKey: String(row.step_key), status: String(row.status) as TaskStepRecord['status'],
      intent: (parseJson(String(row.intent_json)) as Record<string, unknown> | null) ?? {},
      result: parseJson(row.result_json ? String(row.result_json) : null), externalId: row.external_id ? String(row.external_id) : null,
      attempts: Number(row.attempts), updatedAt: String(row.updated_at),
    };
  }

  completeTaskStep(runId: string, stepKey: string, status: TaskStepRecord['status'], result: unknown = null, externalId: string | null = null, now = new Date().toISOString()): TaskStepRecord {
    this.db.prepare('UPDATE kurisu_task_steps SET status=?, result_json=?, external_id=?, updated_at=? WHERE run_id=? AND step_key=?').run(status, JSON.stringify(result), externalId, now, runId, stepKey);
    return this.getTaskStep(runId, stepKey)!;
  }

  getJob(id: string): JobRecord | null {
    const row = this.db.prepare('SELECT * FROM kurisu_jobs WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return row ? toJob(row) : null;
  }

  updateJob(id: string, status: string, externalId: string | null = null, now = new Date().toISOString()): JobRecord {
    this.db.prepare('UPDATE kurisu_jobs SET status=?, external_id=?, updated_at=? WHERE id=?').run(status, externalId, now, id);
    return this.getJob(id)!;
  }

  createApproval(input: Omit<ApprovalRecord, 'status' | 'usedAt'>, now = new Date().toISOString()): ApprovalRecord {
    this.db.prepare('INSERT INTO kurisu_approvals(id,run_id,principal_key,session_key,action,arguments_hash,status,expires_at) VALUES (?,?,?,?,?,?,?,?)').run(
      input.id, input.runId, input.principalKey, input.sessionKey, input.action, input.argumentsHash, 'pending', input.expiresAt,
    );
    return this.getApproval(input.id)!;
  }

  getApproval(id: string): ApprovalRecord | null {
    const row = this.db.prepare('SELECT * FROM kurisu_approvals WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return row ? toApproval(row) : null;
  }

  consumeApproval(id: string, principal: string, session: string, action: string, hash: string, now = new Date().toISOString()): ApprovalRecord | null {
    return this.transaction(() => {
      const current = this.getApproval(id);
      if (!current || current.status !== 'pending' || current.principalKey !== principal || current.sessionKey !== session || current.action !== action || current.argumentsHash !== hash || current.expiresAt <= now) return null;
      this.db.prepare('UPDATE kurisu_approvals SET status=?, used_at=? WHERE id=? AND status=?').run('used', now, id, 'pending');
      return this.getApproval(id);
    });
  }

  setPreference(sessionKey: string, key: string, value: unknown, expiresAt: string | null = null, now = new Date().toISOString()): void {
    this.db.prepare(`
      INSERT INTO kurisu_preferences(session_key,preference_key,value_json,expires_at,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(session_key,preference_key) DO UPDATE SET value_json=excluded.value_json, expires_at=excluded.expires_at, updated_at=excluded.updated_at
    `).run(sessionKey, key, JSON.stringify(value), expiresAt, now);
  }

  getPreference(sessionKey: string, key: string, now = new Date().toISOString()): unknown | null {
    const row = this.db.prepare('SELECT value_json,expires_at FROM kurisu_preferences WHERE session_key=? AND preference_key=?').get(sessionKey, key) as { value_json?: string; expires_at?: string | null } | undefined;
    if (!row || (row.expires_at && row.expires_at <= now)) return null;
    return parseJson(row.value_json);
  }

  createEvent(eventType: string, eventKey: string, payload: unknown, id = `evt_${randomUUID()}`, now = new Date().toISOString()): { id: string; inserted: boolean } {
    const result = this.db.prepare('INSERT INTO kurisu_events(id,event_type,event_key,payload_json,created_at) VALUES (?,?,?,?,?) ON CONFLICT(event_key) DO NOTHING').run(id, eventType, eventKey, JSON.stringify(payload), now);
    const existing = this.db.prepare('SELECT id FROM kurisu_events WHERE event_key=?').get(eventKey) as { id?: string } | undefined;
    return { id: String(existing?.id ?? id), inserted: Number(result.changes) === 1 };
  }

  enqueueDelivery(eventId: string, channel: string, recipient: string, id = `delivery_${randomUUID()}`, now = new Date().toISOString()): { id: string; inserted: boolean } {
    const result = this.db.prepare('INSERT INTO kurisu_deliveries(id,event_id,channel,recipient,status,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(event_id,channel,recipient) DO NOTHING').run(id, eventId, channel, recipient, 'pending', now);
    const existing = this.db.prepare('SELECT id FROM kurisu_deliveries WHERE event_id=? AND channel=? AND recipient=?').get(eventId, channel, recipient) as { id?: string } | undefined;
    return { id: String(existing?.id ?? id), inserted: Number(result.changes) === 1 };
  }

  getDelivery(id: string): DeliveryRecord | null {
    const row = this.db.prepare('SELECT * FROM kurisu_deliveries WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id), eventId: String(row.event_id), channel: String(row.channel), recipient: String(row.recipient),
      status: String(row.status) as DeliveryRecord['status'], attempts: Number(row.attempts),
      nextAttemptAt: row.next_attempt_at ? String(row.next_attempt_at) : null, lastError: row.last_error ? String(row.last_error) : null,
    };
  }

  updateDelivery(id: string, status: DeliveryRecord['status'], patch: Partial<Pick<DeliveryRecord, 'nextAttemptAt' | 'lastError'>> = {}, now = new Date().toISOString()): DeliveryRecord {
    this.db.prepare('UPDATE kurisu_deliveries SET status=?, attempts=attempts+1, next_attempt_at=?, last_error=?, updated_at=? WHERE id=?').run(status, patch.nextAttemptAt ?? null, patch.lastError ?? null, now, id);
    return this.getDelivery(id)!;
  }

  snapshotCounts(): Record<string, number> {
    const tables = ['kurisu_sessions', 'kurisu_messages', 'kurisu_inbound_dedup', 'kurisu_runs', 'kurisu_jobs', 'kurisu_tool_executions', 'kurisu_task_steps', 'kurisu_approvals', 'kurisu_preferences', 'kurisu_events', 'kurisu_deliveries'];
    return Object.fromEntries(tables.map((table) => [table, Number((this.db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count)]));
  }

  backupTo(target: string): void {
    const destination = resolve(target);
    if (destination === resolve(String(this.db.location))) throw new Error('backup target must differ from database');
    mkdirSync(dirname(destination), { recursive: true });
    if (String(this.db.location) === ':memory:') {
      throw new Error('memory database cannot be backed up as a file');
    }
    this.db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
  }

  static restore(source: string, target: string): void {
    if (!existsSync(source)) throw new Error('restore source does not exist');
    const sourcePath = resolve(source);
    const targetPath = resolve(target);
    if (sourcePath === targetPath) throw new Error('restore source and target must differ');
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
  }
}

function parseJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function toRun(row: Record<string, unknown>): RunRecord {
  return {
    id: String(row.id), sessionKey: String(row.session_key), status: String(row.status) as RunStatus,
    checkpoint: (parseJson(String(row.checkpoint_json)) as Record<string, unknown> | null) ?? {},
    leaseOwner: row.lease_owner ? String(row.lease_owner) : null, leaseExpiresAt: row.lease_expires_at ? String(row.lease_expires_at) : null,
    externalJobId: row.external_job_id ? String(row.external_job_id) : null, lastObservation: row.last_observation ? String(row.last_observation) : null,
    nextStep: row.next_step ? String(row.next_step) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function toJob(row: Record<string, unknown>): JobRecord {
  return {
    id: String(row.id), runId: String(row.run_id), kind: String(row.kind), status: String(row.status), externalId: row.external_id ? String(row.external_id) : null,
    payload: (parseJson(String(row.payload_json)) as Record<string, unknown> | null) ?? {}, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function toApproval(row: Record<string, unknown>): ApprovalRecord {
  return {
    id: String(row.id), runId: String(row.run_id), principalKey: String(row.principal_key), sessionKey: String(row.session_key), action: String(row.action),
    argumentsHash: String(row.arguments_hash), status: String(row.status) as ApprovalRecord['status'], expiresAt: String(row.expires_at), usedAt: row.used_at ? String(row.used_at) : null,
  };
}

export function approvalArgumentsHash(action: string, args: unknown): string {
  return createHash('sha256').update(stableJson({ action, args })).digest('hex');
}
