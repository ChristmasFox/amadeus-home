import { chmodSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { redactSensitiveText } from './intent.js';

interface Statement {
  run(...values: unknown[]): unknown;
}

interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => Database };

export interface StoredResearchRun {
  question: string;
  intent: unknown;
  source: string;
  report: unknown;
}

/** Persistent experiment output lives outside the production PUBG database. */
export class ExperimentRunStore {
  private readonly db: Database;

  constructor(readonly filename: string) {
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    chmodSync(dirname(filename), 0o700);
    this.db = new DatabaseSync(filename);
    chmodSync(filename, 0o600);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS research_runs (
        run_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        question TEXT NOT NULL,
        intent_json TEXT NOT NULL,
        planner_source TEXT NOT NULL,
        report_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_research_runs_created ON research_runs(created_at DESC);
    `);
  }

  save(run: StoredResearchRun): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO research_runs(run_id, created_at, question, intent_json, planner_source, report_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, new Date().toISOString(), redactSensitiveText(run.question), JSON.stringify(run.intent), run.source, JSON.stringify(run.report));
    return id;
  }

  close(): void { this.db.close(); }
}
