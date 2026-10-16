import { Pool } from 'pg';
import { DEFAULT_TIMEZONE } from '@agent/pubg-domain/core';
import type { GateMemoryConsolidationWorker } from './gate-memory-consolidation.js';

export interface GateMemoryDreamingRunIdentity {
  botAccountId: string;
  timezone: string;
  localDate: string;
  scheduledAt: Date;
}

export interface GateMemoryDreamingRunStore {
  claim(identity: GateMemoryDreamingRunIdentity): Promise<string | null>;
  finish(identity: GateMemoryDreamingRunIdentity, runId: string,
    status: 'succeeded' | 'failed'): Promise<void>;
}

export class PostgresGateMemoryDreamingRunStore implements GateMemoryDreamingRunStore {
  constructor(private readonly pool: Pool) {}

  async claim(identity: GateMemoryDreamingRunIdentity): Promise<string | null> {
    const result = await this.pool.query<{ run_id: string }>(
      `INSERT INTO gate_memory_dreaming_runs(bot_account_id,timezone,scheduled_date,scheduled_at)
       VALUES ($1,$2,$3::DATE,$4::TIMESTAMPTZ)
       ON CONFLICT (bot_account_id,timezone,scheduled_date) DO NOTHING
       RETURNING run_id::TEXT`,
      [identity.botAccountId, identity.timezone, identity.localDate, identity.scheduledAt],
    );
    return result.rows[0]?.run_id ?? null;
  }

  async finish(identity: GateMemoryDreamingRunIdentity, runId: string,
    status: 'succeeded' | 'failed'): Promise<void> {
    const result = await this.pool.query(
      `UPDATE gate_memory_dreaming_runs SET status=$5,completed_at=now(),
         error_code=CASE WHEN $5='failed' THEN 'dreaming_run_failed' ELSE NULL END
       WHERE bot_account_id=$1 AND timezone=$2 AND scheduled_date=$3::DATE
         AND run_id=$4::UUID AND status='running'`,
      [identity.botAccountId, identity.timezone, identity.localDate, runId, status],
    );
    if (result.rowCount !== 1) throw new Error('gate_memory_dreaming_run_state_lost');
  }
}

export interface GateMemoryDreamingSchedulerOptions {
  timezone?: string;
  now?: () => number;
  sleepUntil?: (timestamp: number, signal: AbortSignal) => Promise<void>;
  maxLightBatches?: number;
  maxRemBatches?: number;
}

type LocalDateTime = { year: number; month: number; day: number; hour: number; minute: number; second: number };
type Workflow = 'light' | 'rem';

function localParts(timestamp: number, timezone: string): LocalDateTime {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, calendar: 'iso8601', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  const values = new Map(formatter.formatToParts(new Date(timestamp))
    .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  const result = {
    year: values.get('year'), month: values.get('month'), day: values.get('day'),
    hour: values.get('hour'), minute: values.get('minute'), second: values.get('second'),
  };
  if (Object.values(result).some(value => value === undefined || !Number.isSafeInteger(value))) {
    throw new Error('gate_memory_dreaming_timezone_invalid');
  }
  return result as LocalDateTime;
}

function wallClockToTimestamp(value: LocalDateTime, timezone: string): number {
  const target = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second);
  let timestamp = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = localParts(timestamp, timezone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const delta = target - represented;
    if (delta === 0) return timestamp;
    timestamp += delta;
  }
  throw new Error('gate_memory_dreaming_local_time_unresolvable');
}

function addLocalDays(value: LocalDateTime, days: number): LocalDateTime {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
    hour: value.hour, minute: value.minute, second: value.second };
}

function dateKey(value: LocalDateTime): string {
  return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
}

/** Returns the next strictly future 03:00 wall-clock instant; startup never catches up a missed run. */
export function nextGateMemoryDreamingAt(now: number, timezone = DEFAULT_TIMEZONE): number {
  if (!Number.isFinite(now)) throw new Error('gate_memory_dreaming_clock_invalid');
  const localNow = localParts(now, timezone);
  const todayAtThree = wallClockToTimestamp({ ...localNow, hour: 3, minute: 0, second: 0 }, timezone);
  if (todayAtThree > now) return todayAtThree;
  return wallClockToTimestamp({ ...addLocalDays(localNow, 1), hour: 3, minute: 0, second: 0 }, timezone);
}

function localDateAt(timestamp: number, timezone: string): string {
  return dateKey(localParts(timestamp, timezone));
}

async function defaultSleepUntil(timestamp: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  const delay = Math.max(0, timestamp - Date.now());
  await new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, delay);
    signal.addEventListener('abort', finish, { once: true });
  });
}

function failureStatus(status: string): boolean {
  return status === 'retry' || status === 'dead' || status === 'timed_out';
}

async function drainWorkflow(worker: GateMemoryConsolidationWorker, workflow: Workflow,
  limit: number, signal: AbortSignal): Promise<{ batches: number; admitted: number; candidates: number }> {
  let batches = 0, admitted = 0, candidates = 0;
  for (let attempt = 0; attempt < limit && !signal.aborted; attempt += 1) {
    const result = await worker.processNext(workflow, signal);
    if (result.status === 'SKIPPED_NO_ELIGIBLE_CORPUS') break;
    if (failureStatus(result.status)) throw new Error('gate_memory_dreaming_workflow_failed');
    batches += 1;
    if ('admitted' in result) admitted += result.admitted;
    if ('candidates' in result) candidates += result.candidates;
  }
  if (signal.aborted) throw new Error('gate_memory_dreaming_aborted');
  return { batches, admitted, candidates };
}

async function runDreamingPass(worker: GateMemoryConsolidationWorker, signal: AbortSignal,
  maxLightBatches: number, maxRemBatches: number): Promise<Record<string, unknown>> {
  const light = await drainWorkflow(worker, 'light', maxLightBatches, signal);
  const rem = await drainWorkflow(worker, 'rem', maxRemBatches, signal);
  const deep = await worker.processDeep();
  if (signal.aborted) throw new Error('gate_memory_dreaming_aborted');
  return { light, rem, deep };
}

/** Runs one durable, single-shot daily Light -> REM -> Deep schedule. */
export async function runMemoryLearningScheduler(
  worker: GateMemoryConsolidationWorker,
  store: GateMemoryDreamingRunStore,
  botAccountId: string,
  signal: AbortSignal,
  onRun: (value: Record<string, unknown>) => void,
  options: GateMemoryDreamingSchedulerOptions = {},
): Promise<void> {
  const now = options.now ?? Date.now;
  const sleepUntil = options.sleepUntil ?? defaultSleepUntil;
  const timezone = options.timezone?.trim() || DEFAULT_TIMEZONE;
  const maxLightBatches = options.maxLightBatches ?? 8;
  const maxRemBatches = options.maxRemBatches ?? 8;
  if (!Number.isSafeInteger(maxLightBatches) || maxLightBatches < 1 || maxLightBatches > 32
    || !Number.isSafeInteger(maxRemBatches) || maxRemBatches < 1 || maxRemBatches > 32) {
    throw new Error('gate_memory_dreaming_limits_invalid');
  }
  try { localParts(now(), timezone); }
  catch { onRun({ event: 'dreaming_timezone_fallback', timezone: DEFAULT_TIMEZONE }); }
  const effectiveTimezone = (() => {
    try { localParts(now(), timezone); return timezone; }
    catch { return DEFAULT_TIMEZONE; }
  })();

  while (!signal.aborted) {
    let scheduledAt: number;
    try { scheduledAt = nextGateMemoryDreamingAt(now(), effectiveTimezone); }
    catch {
      onRun({ event: 'dreaming_schedule_failed', status: 'failed' });
      return;
    }
    try {
      while (!signal.aborted && now() < scheduledAt) await sleepUntil(scheduledAt, signal);
    } catch {
      onRun({ event: 'dreaming_schedule_failed', status: 'failed' });
      return;
    }
    if (signal.aborted) return;

    const identity: GateMemoryDreamingRunIdentity = {
      botAccountId, timezone: effectiveTimezone, localDate: localDateAt(scheduledAt, effectiveTimezone),
      scheduledAt: new Date(scheduledAt),
    };
    let runId: string | null = null;
    try { runId = await store.claim(identity); }
    catch {
      onRun({ event: 'dreaming_run_failed', status: 'failed', errorCode: 'dreaming_claim_failed' });
      continue;
    }
    if (!runId) {
      onRun({ event: 'dreaming_run_skipped', status: 'duplicate', localDate: identity.localDate });
      continue;
    }

    try {
      const result = await runDreamingPass(worker, signal, maxLightBatches, maxRemBatches);
      await store.finish(identity, runId, 'succeeded');
      onRun({ event: 'dreaming_run_completed', status: 'succeeded', localDate: identity.localDate, ...result });
    } catch {
      await store.finish(identity, runId, 'failed').catch(() => undefined);
      onRun({ event: 'dreaming_run_failed', status: 'failed', localDate: identity.localDate,
        errorCode: 'dreaming_run_failed' });
    }
  }
}
