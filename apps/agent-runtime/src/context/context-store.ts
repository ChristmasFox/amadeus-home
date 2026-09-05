import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CanonicalQuery, Selector } from '../schema/query.js';
import type { ResultSetRecord, SessionContextRecord } from '../data/model.js';
import type { NormalizedBotMessage } from '../platform/core/contracts.js';

export interface ContextStore {
  getContext(sessionId: string): Promise<SessionContextRecord | null>;
  setContext(context: SessionContextRecord): Promise<void>;
  getResultSet(sessionId: string, resultSetId: string): Promise<ResultSetRecord | null>;
  setResultSet(resultSet: ResultSetRecord): Promise<void>;
}

function validUntil(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

export interface LegacySessionIdentity {
  platform: string;
  launcherType: string;
  launcherId: string;
  senderId: string;
  domain: string;
}

export interface NormalizedSessionIdentity {
  message: NormalizedBotMessage;
  domain: string;
}

export function sessionId(input: LegacySessionIdentity | NormalizedSessionIdentity): string {
  const parts = 'message' in input
    ? [input.message.platform, input.message.chat.type, input.message.chat.id, input.message.user.platformUserId, input.domain]
    : [input.platform, input.launcherType, input.launcherId, input.senderId, input.domain];
  return parts
    .map((part) => encodeURIComponent(String(part || 'unknown')))
    .join(':');
}

export function sessionIdForMessage(message: NormalizedBotMessage, domain = 'pubg'): string {
  return sessionId({ message, domain });
}

export function emptyContext(id: string): SessionContextRecord {
  const now = new Date();
  return {
    schemaVersion: 3,
    sessionId: id,
    activeDomain: null,
    lastQuery: null,
    lastSelector: null,
    lastResultSetId: null,
    lastSubject: null,
    references: {},
    activeMatchId: null,
    activeMatchOrdinal: null,
    activeReviewResultSetId: null,
    sourceMatchResultSetId: null,
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(),
  };
}

export class InMemoryContextStore implements ContextStore {
  private contexts = new Map<string, SessionContextRecord>();
  private results = new Map<string, ResultSetRecord>();

  async getContext(id: string): Promise<SessionContextRecord | null> {
    const value = this.contexts.get(id);
    if (!value || !validUntil(value.expiresAt)) return null;
    return structuredClone(value);
  }

  async setContext(value: SessionContextRecord): Promise<void> {
    this.contexts.set(value.sessionId, structuredClone(value));
  }

  async getResultSet(session: string, id: string): Promise<ResultSetRecord | null> {
    const value = this.results.get(`${session}:${id}`);
    if (!value || !validUntil(value.expiresAt)) return null;
    return structuredClone(value);
  }

  async setResultSet(value: ResultSetRecord): Promise<void> {
    this.results.set(`${value.sessionId}:${value.id}`, structuredClone(value));
  }
}

interface PersistedState {
  contexts: Record<string, SessionContextRecord>;
  results: Record<string, ResultSetRecord>;
}

export class JsonContextStore implements ContextStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private async read(): Promise<PersistedState> {
    try {
      const value = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<PersistedState>;
      return { contexts: value.contexts ?? {}, results: value.results ?? {} };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
      return { contexts: {}, results: {} };
    }
  }

  private async write(mutator: (state: PersistedState) => void): Promise<void> {
    this.queue = this.queue.catch(() => undefined).then(async () => {
      const state = await this.read();
      mutator(state);
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(state), { mode: 0o600 });
      await fs.rename(tempPath, this.filePath);
    });
    return this.queue;
  }

  async getContext(id: string): Promise<SessionContextRecord | null> {
    const state = await this.read();
    const value = state.contexts[id];
    return value && validUntil(value.expiresAt) ? value : null;
  }

  async setContext(value: SessionContextRecord): Promise<void> {
    await this.write((state) => { state.contexts[value.sessionId] = value; });
  }

  async getResultSet(session: string, id: string): Promise<ResultSetRecord | null> {
    const state = await this.read();
    const value = state.results[`${session}:${id}`];
    return value && validUntil(value.expiresAt) ? value : null;
  }

  async setResultSet(value: ResultSetRecord): Promise<void> {
    await this.write((state) => { state.results[`${value.sessionId}:${value.id}`] = value; });
  }
}

export function applyContextResolution(query: CanonicalQuery, context: SessionContextRecord | null): CanonicalQuery {
  const reference = { ...query.reference };
  if (query.operation === 'compare' && query.segments.length === 0 && query.reference.compareFromContext) {
    const first = context?.lastSelector ?? { type: 'relative_period', value: 'today', label: '今天' };
    return {
      ...query,
      selector: first,
      segments: [
        { label: first.label ?? '上一周期', selector: first },
        { label: query.selector.label ?? '当前比较周期', selector: query.selector },
      ],
      reference: { ...reference, inheritedFromContext: Boolean(context?.lastSelector) },
    };
  }
  if (query.reference.selectorExplicit) return query;
  if (query.reference.useResultSet && context?.lastResultSetId) {
    return {
      ...query,
      selector: { type: 'result_set', resultSetId: context.lastResultSetId, label: '上一组比赛' },
      reference: { ...reference, inheritedFromContext: true, inheritedFromResultSet: context.lastResultSetId },
    };
  }
  if (context?.lastSelector) {
    return { ...query, selector: context.lastSelector, reference: { ...reference, inheritedFromContext: true } };
  }
  return {
    ...query,
    selector: { type: 'relative_period', value: 'today', label: '今天' },
    reference: { ...reference, inheritedFromContext: false },
  };
}

export function contextForQuery(query: CanonicalQuery, resultSetId: string, sessionId = String(query.reference.sessionId ?? ''), ttlMs = 12 * 60 * 60 * 1000): SessionContextRecord {
  const now = new Date();
  return {
    schemaVersion: 3,
    sessionId,
    activeDomain: 'pubg',
    lastQuery: query,
    lastSelector: query.selector,
    lastResultSetId: resultSetId,
    lastSubject: query.subject,
    references: {
      selectorSource: query.reference.selectorExplicit ? 'message' : query.reference.inheritedFromContext ? 'context' : 'default',
    },
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
}

export interface ReviewContextUpdate {
  sourceSelector?: Selector | null;
  activeMatchId?: string | null;
  activeMatchOrdinal?: number | null;
  activeReviewResultSetId?: string | null;
  sourceMatchResultSetId?: string | null;
  pendingMatchSelection?: Record<string, unknown> | null;
}

export function contextForReview(
  query: CanonicalQuery,
  resultSetId: string,
  sessionId: string,
  ttlMs = 12 * 60 * 60 * 1000,
  update: ReviewContextUpdate = {},
): SessionContextRecord {
  const context = contextForQuery(query, resultSetId, sessionId, ttlMs);
  return {
    ...context,
    lastSelector: update.sourceSelector ?? query.selector,
    activeMatchId: update.activeMatchId ?? null,
    activeMatchOrdinal: update.activeMatchOrdinal ?? null,
    activeReviewResultSetId: update.activeReviewResultSetId ?? null,
    sourceMatchResultSetId: update.sourceMatchResultSetId ?? null,
    references: {
      ...context.references,
      ...(update.pendingMatchSelection ? { pendingMatchSelection: update.pendingMatchSelection } : {}),
    },
  };
}

export function withSessionId(query: CanonicalQuery, id: string): CanonicalQuery & { reference: CanonicalQuery['reference'] & { sessionId: string } } {
  return { ...query, reference: { ...query.reference, sessionId: id } };
}
