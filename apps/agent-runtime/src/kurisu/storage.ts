import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { stableJson, type CallbackReference, type NormalizedInbound, type ToolExecutionObservation, type ToolResponseStatus } from './contracts.js';

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

export type CodexJobStatus = 'queued' | 'running' | 'waiting_approval' | 'waiting_input' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';

export interface CodexPendingRequest {
  requestId: string;
  method: string;
  itemId: string | null;
  reason: string | null;
  callback: string | null;
  receivedAt: string;
}

export interface CodexJobRecord {
  jobId: string;
  runId: string;
  principalKey: string;
  sessionKey: string;
  idempotencyKey: string;
  projectId: string;
  workspaceRef: string;
  threadId: string | null;
  turnId: string | null;
  goal: string;
  constraints: string[];
  status: CodexJobStatus;
  evidence: Array<{
    source: string;
    observedAt: string;
    summary: string;
    ref?: string;
  }>;
  lastMessage: string | null;
  pendingRequest: CodexPendingRequest | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageTaskLinkRecord {
  sessionKey: string;
  updateId: string;
  runId: string;
  relation: string;
  createdAt: string;
}

export interface ApprovalRecord {
  id: string;
  runId: string;
  principalKey: string;
  sessionKey: string;
  action: string;
  argumentsHash: string;
  arguments: unknown;
  status: 'pending' | 'used' | 'expired' | 'rejected';
  expiresAt: string;
  usedAt: string | null;
}

export interface CallbackBindingRecord {
  value: string;
  reference: CallbackReference;
  principalKey: string;
  sessionKey: string;
  runId: string;
  createdAt: string;
  consumedAt: string | null;
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
  platformMessageId: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
}

export interface NotificationEventRecord {
  id: string;
  eventType: string;
  eventKey: string;
  payload: unknown;
  createdAt: string;
  deliveries: DeliveryRecord[];
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

function restrictDatabaseFilePermissions(filename: string): void {
  for (const path of [filename, `${filename}-wal`, `${filename}-shm`]) {
    try {
      chmodSync(path, 0o600);
    } catch {
      // SQLite may not have created a journal sidecar yet.
    }
  }
}

export class KurisuStore {
  readonly db: DatabaseSync;
  private readonly filename: string;

  constructor(filename = ':memory:') {
    this.filename = filename;
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
    if (filename !== ':memory:') restrictDatabaseFilePermissions(filename);
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
      CREATE TABLE IF NOT EXISTS kurisu_message_task_links (
        session_key TEXT NOT NULL REFERENCES kurisu_sessions(session_key),
        update_id TEXT NOT NULL,
        run_id TEXT NOT NULL REFERENCES kurisu_runs(id),
        relation TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(session_key, update_id, run_id)
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
        arguments_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      );
      CREATE TABLE IF NOT EXISTS kurisu_callbacks (
        callback_value TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        kind TEXT NOT NULL,
        action TEXT NOT NULL,
        callback_id TEXT NOT NULL,
        principal_key TEXT NOT NULL,
        session_key TEXT NOT NULL,
        run_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        consumed_at TEXT
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
        platform_message_id TEXT,
        lease_owner TEXT,
        lease_expires_at TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(event_id, channel, recipient)
      );
      CREATE INDEX IF NOT EXISTS ix_kurisu_runs_status_lease ON kurisu_runs(status, lease_expires_at);
      CREATE INDEX IF NOT EXISTS ix_kurisu_deliveries_due ON kurisu_deliveries(status, next_attempt_at);
    `);
    try { this.db.exec("ALTER TABLE kurisu_approvals ADD COLUMN arguments_json TEXT NOT NULL DEFAULT '{}'"); } catch { /* already migrated */ }
    try { this.db.exec('ALTER TABLE kurisu_deliveries ADD COLUMN platform_message_id TEXT'); } catch { /* already migrated */ }
    try { this.db.exec('ALTER TABLE kurisu_deliveries ADD COLUMN lease_owner TEXT'); } catch { /* already migrated */ }
    try { this.db.exec('ALTER TABLE kurisu_deliveries ADD COLUMN lease_expires_at TEXT'); } catch { /* already migrated */ }
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const result = fn();
      this.db.exec('COMMIT;');
      if (this.filename !== ':memory:') restrictDatabaseFilePermissions(this.filename);
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

  linkMessageToRun(
    message: Pick<NormalizedInbound, 'sessionKey' | 'updateId'>,
    runId: string,
    relation = 'primary',
    now = new Date().toISOString(),
  ): MessageTaskLinkRecord {
    this.db.prepare(`
      INSERT INTO kurisu_message_task_links(session_key,update_id,run_id,relation,created_at)
      VALUES (?,?,?,?,?) ON CONFLICT(session_key,update_id,run_id) DO UPDATE SET relation=excluded.relation
    `).run(message.sessionKey, message.updateId, runId, relation, now);
    return this.getMessageTaskLink(message.sessionKey, message.updateId, runId)!;
  }

  getMessageTaskLink(sessionKey: string, updateId: string, runId: string): MessageTaskLinkRecord | null {
    const row = this.db.prepare('SELECT * FROM kurisu_message_task_links WHERE session_key=? AND update_id=? AND run_id=?').get(sessionKey, updateId, runId) as Record<string, unknown> | undefined;
    return row ? toMessageTaskLink(row) : null;
  }

  listRunsForMessage(sessionKey: string, updateId: string): RunRecord[] {
    const rows = this.db.prepare(`
      SELECT r.* FROM kurisu_runs r
      INNER JOIN kurisu_message_task_links l ON l.run_id=r.id
      WHERE l.session_key=? AND l.update_id=?
      ORDER BY l.created_at ASC
    `).all(sessionKey, updateId) as Array<Record<string, unknown>>;
    return rows.map(toRun);
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
    if (['succeeded', 'failed', 'cancelled'].includes(current.status)) return current;
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

  listTaskSteps(runId: string): TaskStepRecord[] {
    const rows = this.db.prepare('SELECT * FROM kurisu_task_steps WHERE run_id=? ORDER BY updated_at ASC, step_key ASC').all(runId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      runId: String(row.run_id), stepKey: String(row.step_key), status: String(row.status) as TaskStepRecord['status'],
      intent: (parseJson(String(row.intent_json)) as Record<string, unknown> | null) ?? {},
      result: parseJson(row.result_json ? String(row.result_json) : null), externalId: row.external_id ? String(row.external_id) : null,
      attempts: Number(row.attempts), updatedAt: String(row.updated_at),
    }));
  }

  completeTaskStep(runId: string, stepKey: string, status: TaskStepRecord['status'], result: unknown = null, externalId: string | null = null, now = new Date().toISOString()): TaskStepRecord {
    this.db.prepare('UPDATE kurisu_task_steps SET status=?, result_json=?, external_id=?, updated_at=? WHERE run_id=? AND step_key=?').run(status, JSON.stringify(result), externalId, now, runId, stepKey);
    return this.getTaskStep(runId, stepKey)!;
  }

  getJob(id: string): JobRecord | null {
    const row = this.db.prepare('SELECT * FROM kurisu_jobs WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return row ? toJob(row) : null;
  }

  listJobs(runId: string): JobRecord[] {
    const rows = this.db.prepare('SELECT * FROM kurisu_jobs WHERE run_id=? ORDER BY created_at ASC').all(runId) as Array<Record<string, unknown>>;
    return rows.map(toJob);
  }

  updateJob(id: string, status: string, externalId: string | null = null, now = new Date().toISOString()): JobRecord {
    this.db.prepare('UPDATE kurisu_jobs SET status=?, external_id=?, updated_at=? WHERE id=?').run(status, externalId, now, id);
    return this.getJob(id)!;
  }

  createCodexJob(input: Omit<CodexJobRecord, 'jobId' | 'createdAt' | 'updatedAt' | 'status' | 'threadId' | 'turnId' | 'evidence' | 'lastMessage' | 'pendingRequest'> & { jobId?: string }, now = new Date().toISOString()): CodexJobRecord {
    const jobId = input.jobId ?? `job_${randomUUID()}`;
    const payload = {
      principalKey: input.principalKey,
      sessionKey: input.sessionKey,
      idempotencyKey: input.idempotencyKey,
      projectId: input.projectId,
      workspaceRef: input.workspaceRef,
      threadId: null,
      turnId: null,
      goal: input.goal,
      constraints: [...input.constraints],
      evidence: [],
      lastMessage: null,
      pendingRequest: null,
    } satisfies Record<string, unknown>;
    this.db.prepare('INSERT INTO kurisu_jobs(id,run_id,kind,status,external_id,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(
      jobId, input.runId, 'codex', 'queued', null, JSON.stringify(payload), now, now,
    );
    return this.getCodexJob(jobId)!;
  }

  getCodexJob(jobId: string): CodexJobRecord | null {
    const job = this.getJob(jobId);
    return job?.kind === 'codex' ? toCodexJob(job) : null;
  }

  listCodexJobs(): CodexJobRecord[] {
    const rows = this.db.prepare('SELECT * FROM kurisu_jobs WHERE kind=? ORDER BY created_at ASC').all('codex') as Array<Record<string, unknown>>;
    return rows.map((row) => toCodexJob(toJob(row)));
  }

  findCodexJobByIdempotencyKey(idempotencyKey: string): CodexJobRecord | null {
    const jobs = this.listCodexJobs();
    return jobs.find((job) => job.idempotencyKey === idempotencyKey) ?? null;
  }

  updateCodexJob(
    jobId: string,
    patch: Partial<Pick<CodexJobRecord, 'status' | 'threadId' | 'turnId' | 'evidence' | 'lastMessage' | 'pendingRequest' | 'workspaceRef'>>,
    now = new Date().toISOString(),
  ): CodexJobRecord {
    const current = this.getCodexJob(jobId);
    if (!current) throw new Error(`codex job not found: ${jobId}`);
    const payload: Record<string, unknown> = {
      principalKey: current.principalKey,
      sessionKey: current.sessionKey,
      idempotencyKey: current.idempotencyKey,
      projectId: current.projectId,
      workspaceRef: patch.workspaceRef ?? current.workspaceRef,
      threadId: 'threadId' in patch ? patch.threadId ?? null : current.threadId,
      turnId: 'turnId' in patch ? patch.turnId ?? null : current.turnId,
      goal: current.goal,
      constraints: current.constraints,
      evidence: patch.evidence ?? current.evidence,
      lastMessage: patch.lastMessage ?? current.lastMessage,
      pendingRequest: patch.pendingRequest === undefined ? current.pendingRequest : patch.pendingRequest,
    };
    this.db.prepare('UPDATE kurisu_jobs SET status=?, external_id=?, payload_json=?, updated_at=? WHERE id=? AND kind=?').run(
      patch.status ?? current.status,
      typeof payload.threadId === 'string' ? payload.threadId : null,
      JSON.stringify(payload),
      now,
      jobId,
      'codex',
    );
    return this.getCodexJob(jobId)!;
  }

  listEvents(eventType?: string, limit = 100): Array<{ id: string; eventType: string; eventKey: string; payload: unknown; createdAt: string }> {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const rows = eventType
      ? this.db.prepare('SELECT id,event_type,event_key,payload_json,created_at FROM kurisu_events WHERE event_type=? ORDER BY created_at ASC LIMIT ?').all(eventType, boundedLimit)
      : this.db.prepare('SELECT id,event_type,event_key,payload_json,created_at FROM kurisu_events ORDER BY created_at ASC LIMIT ?').all(boundedLimit);
    return (rows as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      eventType: String(row.event_type),
      eventKey: String(row.event_key),
      payload: parseJson(String(row.payload_json)),
      createdAt: String(row.created_at),
    }));
  }

  createApproval(input: Omit<ApprovalRecord, 'status' | 'usedAt'>, now = new Date().toISOString()): ApprovalRecord {
    this.db.prepare('INSERT INTO kurisu_approvals(id,run_id,principal_key,session_key,action,arguments_hash,arguments_json,status,expires_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
      input.id, input.runId, input.principalKey, input.sessionKey, input.action, input.argumentsHash, JSON.stringify(input.arguments), 'pending', input.expiresAt,
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

  bindCallback(value: string, reference: CallbackReference, context: { principalKey: string; sessionKey: string; runId: string }, now = new Date().toISOString()): void {
    this.db.prepare(`
      INSERT INTO kurisu_callbacks(callback_value,namespace,kind,action,callback_id,principal_key,session_key,run_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(callback_value) DO NOTHING
    `).run(value, reference.namespace, reference.kind, reference.action, reference.id, context.principalKey, context.sessionKey, context.runId, now);
  }

  getCallbackBinding(value: string): CallbackBindingRecord | null {
    const row = this.db.prepare('SELECT * FROM kurisu_callbacks WHERE callback_value=?').get(value) as Record<string, unknown> | undefined;
    return row ? toCallbackBinding(row) : null;
  }

  consumeCallbackBinding(value: string, principalKey: string, sessionKey: string, now = new Date().toISOString()): CallbackBindingRecord | null {
    return this.transaction(() => {
      const current = this.getCallbackBinding(value);
      if (!current || current.consumedAt || current.principalKey !== principalKey || current.sessionKey !== sessionKey) return null;
      this.db.prepare('UPDATE kurisu_callbacks SET consumed_at=? WHERE callback_value=? AND consumed_at IS NULL').run(now, value);
      return this.getCallbackBinding(value);
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

  deletePreference(sessionKey: string, key: string): boolean {
    const result = this.db.prepare('DELETE FROM kurisu_preferences WHERE session_key=? AND preference_key=?').run(sessionKey, key);
    return Number(result.changes) === 1;
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
    return toDelivery(row);
  }

  getNotificationEvent(id: string): NotificationEventRecord | null {
    const row = this.db.prepare('SELECT id,event_type,event_key,payload_json,created_at FROM kurisu_events WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      eventType: String(row.event_type),
      eventKey: String(row.event_key),
      payload: parseJson(String(row.payload_json)),
      createdAt: String(row.created_at),
      deliveries: this.listDeliveries(String(row.id)),
    };
  }

  listDeliveries(eventId?: string, limit = 500): DeliveryRecord[] {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 1_000);
    const rows = eventId
      ? this.db.prepare('SELECT * FROM kurisu_deliveries WHERE event_id=? ORDER BY updated_at ASC LIMIT ?').all(eventId, boundedLimit)
      : this.db.prepare('SELECT * FROM kurisu_deliveries ORDER BY updated_at ASC LIMIT ?').all(boundedLimit);
    return (rows as Array<Record<string, unknown>>).map(toDelivery);
  }

  listDueDeliveries(now = new Date().toISOString(), limit = 50): DeliveryRecord[] {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const rows = this.db.prepare(`
      SELECT * FROM kurisu_deliveries
      WHERE (status IN ('pending','retryable_failed') AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
         OR (status='sending' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
      ORDER BY updated_at ASC, id ASC LIMIT ?
    `).all(now, now, boundedLimit);
    return (rows as Array<Record<string, unknown>>).map(toDelivery);
  }

  claimDelivery(id: string, owner: string, now = new Date(), leaseMs = 30_000): DeliveryRecord | null {
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + Math.max(1_000, leaseMs)).toISOString();
    return this.transaction(() => {
      const current = this.getDelivery(id);
      if (!current) return null;
      const due = (current.status === 'pending' || current.status === 'retryable_failed')
        && (!current.nextAttemptAt || current.nextAttemptAt <= nowIso);
      const expired = current.status === 'sending' && Boolean(current.leaseExpiresAt && current.leaseExpiresAt <= nowIso);
      if (!due && !expired) return null;
      this.db.prepare('UPDATE kurisu_deliveries SET status=?, lease_owner=?, lease_expires_at=?, updated_at=? WHERE id=?').run(
        'sending', owner, expiresAt, nowIso, id,
      );
      return this.getDelivery(id);
    });
  }

  /** Read notification evidence only for events explicitly owned by a principal. */
  listNotificationEvents(
    eventType: string | undefined,
    channel: string,
    principalKey: string,
    limit = 20,
  ): NotificationEventRecord[] {
    if (!principalKey) return [];
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const rows = eventType
      ? this.db.prepare('SELECT id,event_type,event_key,payload_json,created_at FROM kurisu_events WHERE event_type=? ORDER BY created_at DESC LIMIT ?').all(eventType, boundedLimit * 4)
      : this.db.prepare('SELECT id,event_type,event_key,payload_json,created_at FROM kurisu_events ORDER BY created_at DESC LIMIT ?').all(boundedLimit * 4);
    const result: NotificationEventRecord[] = [];
    for (const row of rows as Array<Record<string, unknown>>) {
      const payload = parseJson(String(row.payload_json));
      if (!notificationBelongsTo(payload, principalKey)) continue;
      const deliveries = (this.db.prepare(
        channel === 'all'
          ? 'SELECT * FROM kurisu_deliveries WHERE event_id=? ORDER BY updated_at DESC'
          : 'SELECT * FROM kurisu_deliveries WHERE event_id=? AND channel=? ORDER BY updated_at DESC',
      ).all(...(channel === 'all' ? [String(row.id)] : [String(row.id), channel])) as Array<Record<string, unknown>>).map(toDelivery);
      result.push({
        id: String(row.id),
        eventType: String(row.event_type),
        eventKey: String(row.event_key),
        payload,
        createdAt: String(row.created_at),
        deliveries,
      });
      if (result.length >= boundedLimit) break;
    }
    return result;
  }

  updateDelivery(id: string, status: DeliveryRecord['status'], patch: Partial<Pick<DeliveryRecord, 'nextAttemptAt' | 'lastError'>> = {}, now = new Date().toISOString()): DeliveryRecord {
    this.db.prepare('UPDATE kurisu_deliveries SET status=?, attempts=attempts+1, next_attempt_at=?, last_error=?, platform_message_id=NULL, lease_owner=NULL, lease_expires_at=NULL, updated_at=? WHERE id=?').run(status, patch.nextAttemptAt ?? null, patch.lastError ?? null, now, id);
    return this.getDelivery(id)!;
  }

  markDelivery(
    id: string,
    status: DeliveryRecord['status'],
    patch: Partial<Pick<DeliveryRecord, 'nextAttemptAt' | 'lastError' | 'platformMessageId'>> = {},
    now = new Date().toISOString(),
  ): DeliveryRecord {
    this.db.prepare('UPDATE kurisu_deliveries SET status=?, attempts=attempts+1, next_attempt_at=?, last_error=?, platform_message_id=?, lease_owner=NULL, lease_expires_at=NULL, updated_at=? WHERE id=?').run(
      status, patch.nextAttemptAt ?? null, patch.lastError ?? null, patch.platformMessageId ?? null, now, id,
    );
    return this.getDelivery(id)!;
  }

  /** Requeue only a terminal/uncertain delivery owned by the event principal. */
  retryDelivery(id: string, principalKey: string, now = new Date().toISOString()): DeliveryRecord | null {
    return this.transaction(() => {
      const current = this.getDelivery(id);
      if (!current || !['dead', 'unknown', 'retryable_failed'].includes(current.status)) return null;
      const event = this.getNotificationEvent(current.eventId);
      if (!event || !notificationBelongsTo(event.payload, principalKey)) return null;
      this.db.prepare('UPDATE kurisu_deliveries SET status=?, next_attempt_at=NULL, last_error=NULL, platform_message_id=NULL, lease_owner=NULL, lease_expires_at=NULL, updated_at=? WHERE id=?').run('pending', now, id);
      return this.getDelivery(id);
    });
  }

  snapshotCounts(): Record<string, number> {
    const tables = ['kurisu_sessions', 'kurisu_messages', 'kurisu_message_task_links', 'kurisu_inbound_dedup', 'kurisu_runs', 'kurisu_jobs', 'kurisu_tool_executions', 'kurisu_task_steps', 'kurisu_approvals', 'kurisu_callbacks', 'kurisu_preferences', 'kurisu_events', 'kurisu_deliveries'];
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

function toCodexJob(job: JobRecord): CodexJobRecord {
  const payload = job.payload;
  const evidenceItems = Array.isArray(payload.evidence) ? payload.evidence : [];
  const pending = payload.pendingRequest && typeof payload.pendingRequest === 'object' && !Array.isArray(payload.pendingRequest)
    ? payload.pendingRequest as Record<string, unknown>
    : null;
  return {
    jobId: job.id,
    runId: job.runId,
    principalKey: String(payload.principalKey ?? ''),
    sessionKey: String(payload.sessionKey ?? ''),
    idempotencyKey: String(payload.idempotencyKey ?? ''),
    projectId: String(payload.projectId ?? ''),
    workspaceRef: String(payload.workspaceRef ?? ''),
    threadId: typeof payload.threadId === 'string' ? payload.threadId : null,
    turnId: typeof payload.turnId === 'string' ? payload.turnId : null,
    goal: String(payload.goal ?? ''),
    constraints: Array.isArray(payload.constraints) ? payload.constraints.filter((value): value is string => typeof value === 'string') : [],
    status: job.status as CodexJobStatus,
    evidence: evidenceItems.filter((value): value is CodexJobRecord['evidence'][number] => (
      Boolean(value) && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).source === 'string' && typeof (value as Record<string, unknown>).observedAt === 'string' && typeof (value as Record<string, unknown>).summary === 'string'
    )),
    lastMessage: typeof payload.lastMessage === 'string' ? payload.lastMessage : null,
    pendingRequest: pending && typeof pending.requestId === 'string' && typeof pending.method === 'string' && typeof pending.receivedAt === 'string'
      ? {
          requestId: pending.requestId,
          method: pending.method,
          itemId: typeof pending.itemId === 'string' ? pending.itemId : null,
          reason: typeof pending.reason === 'string' ? pending.reason : null,
          callback: typeof pending.callback === 'string' ? pending.callback : null,
          receivedAt: pending.receivedAt,
        }
      : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function toMessageTaskLink(row: Record<string, unknown>): MessageTaskLinkRecord {
  return {
    sessionKey: String(row.session_key),
    updateId: String(row.update_id),
    runId: String(row.run_id),
    relation: String(row.relation),
    createdAt: String(row.created_at),
  };
}

function toApproval(row: Record<string, unknown>): ApprovalRecord {
  return {
    id: String(row.id), runId: String(row.run_id), principalKey: String(row.principal_key), sessionKey: String(row.session_key), action: String(row.action),
    argumentsHash: String(row.arguments_hash), arguments: parseJson(String(row.arguments_json ?? '{}')), status: String(row.status) as ApprovalRecord['status'], expiresAt: String(row.expires_at), usedAt: row.used_at ? String(row.used_at) : null,
  };
}

function toCallbackBinding(row: Record<string, unknown>): CallbackBindingRecord {
  return {
    value: String(row.callback_value),
    reference: {
      namespace: 'ku1',
      kind: String(row.kind) as CallbackReference['kind'],
      action: String(row.action),
      id: String(row.callback_id),
    },
    principalKey: String(row.principal_key),
    sessionKey: String(row.session_key),
    runId: String(row.run_id),
    createdAt: String(row.created_at),
    consumedAt: row.consumed_at ? String(row.consumed_at) : null,
  };
}

function toDelivery(row: Record<string, unknown>): DeliveryRecord {
  return {
    id: String(row.id), eventId: String(row.event_id), channel: String(row.channel), recipient: String(row.recipient),
    status: String(row.status) as DeliveryRecord['status'], attempts: Number(row.attempts),
    nextAttemptAt: row.next_attempt_at ? String(row.next_attempt_at) : null, lastError: row.last_error ? String(row.last_error) : null,
    platformMessageId: row.platform_message_id ? String(row.platform_message_id) : null,
    leaseOwner: row.lease_owner ? String(row.lease_owner) : null,
    leaseExpiresAt: row.lease_expires_at ? String(row.lease_expires_at) : null,
  };
}

function notificationBelongsTo(payload: unknown, principalKey: string): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const owner = (payload as Record<string, unknown>).principalKey;
  return typeof owner === 'string' && owner === principalKey;
}

export function approvalArgumentsHash(action: string, args: unknown): string {
  return createHash('sha256').update(stableJson({ action, args })).digest('hex');
}
