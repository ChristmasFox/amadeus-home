import type { NormalizedInbound, TrustedExecutionContext } from './contracts.js';

export interface ContextEntity {
  ref: string;
  label: string;
  domain: string;
  observedAt: string;
}

export interface ContextTaskRef {
  taskId: string;
  status: string;
  summary: string;
  updatedAt: string;
}

export interface ContextApprovalRef {
  approvalId: string;
  action: string;
  status: string;
  expiresAt: string;
}

export interface ContextMessage {
  role: 'user' | 'assistant' | 'tool';
  text: string;
  at: string;
  messageId?: string;
}

export interface ContextSnapshot {
  sessionKey: string;
  principalKey: string;
  scope: Pick<TrustedExecutionContext, 'identity' | 'conversation' | 'botId'>;
  messages: ContextMessage[];
  entities: ContextEntity[];
  tasks: ContextTaskRef[];
  approvals: ContextApprovalRef[];
  preferences: Record<string, string>;
  updatedAt: string;
}

export type ContextReference =
  | { kind: 'reply'; value: string }
  | { kind: 'explicit'; value: string }
  | { kind: 'task'; value: string }
  | { kind: 'candidate'; value: string }
  | { kind: 'none'; value: null };

export interface ReferenceInput {
  replyTaskId?: string;
  explicitEntityRef?: string;
  explicitTaskId?: string;
  activeTaskId?: string;
  recentEntityRef?: string;
}

export class InMemoryContextStore {
  private readonly snapshots = new Map<string, ContextSnapshot>();

  get(session: Pick<NormalizedInbound, 'sessionKey'>): ContextSnapshot | null {
    return this.snapshots.get(session.sessionKey) ?? null;
  }

  ensure(inbound: NormalizedInbound): ContextSnapshot {
    const existing = this.snapshots.get(inbound.sessionKey);
    if (existing) return existing;
    const snapshot: ContextSnapshot = {
      sessionKey: inbound.sessionKey,
      principalKey: inbound.principalKey,
      scope: {
        identity: inbound.identity,
        conversation: inbound.conversation,
        botId: inbound.botId,
      },
      messages: [],
      entities: [],
      tasks: [],
      approvals: [],
      preferences: {},
      updatedAt: inbound.receivedAt ?? new Date().toISOString(),
    };
    this.snapshots.set(inbound.sessionKey, snapshot);
    return snapshot;
  }

  appendMessage(session: ContextSnapshot, message: ContextMessage): void {
    session.messages.push({ ...message, text: message.text.slice(0, 8000) });
    if (session.messages.length > 40) session.messages.splice(0, session.messages.length - 40);
    session.updatedAt = message.at;
  }

  rememberEntity(session: ContextSnapshot, entity: ContextEntity): void {
    const index = session.entities.findIndex((item) => item.ref === entity.ref);
    if (index >= 0) session.entities.splice(index, 1);
    session.entities.unshift(entity);
    if (session.entities.length > 32) session.entities.length = 32;
    session.updatedAt = entity.observedAt;
  }

  rememberTask(session: ContextSnapshot, task: ContextTaskRef): void {
    const index = session.tasks.findIndex((item) => item.taskId === task.taskId);
    if (index >= 0) session.tasks.splice(index, 1);
    session.tasks.unshift(task);
    if (session.tasks.length > 16) session.tasks.length = 16;
    session.updatedAt = task.updatedAt;
  }

  rememberApproval(session: ContextSnapshot, approval: ContextApprovalRef): void {
    const index = session.approvals.findIndex((item) => item.approvalId === approval.approvalId);
    if (index >= 0) session.approvals.splice(index, 1);
    session.approvals.unshift(approval);
    if (session.approvals.length > 16) session.approvals.length = 16;
    session.updatedAt = approval.expiresAt;
  }

  setPreference(session: ContextSnapshot, key: string, value: string): void {
    session.preferences[key] = value.slice(0, 512);
    session.updatedAt = new Date().toISOString();
  }

  compact(session: ContextSnapshot, maxChars = 6000): string {
    const lines: string[] = [];
    for (const task of session.tasks.slice(0, 8)) lines.push(`task ${task.taskId} [${task.status}] ${task.summary}`);
    for (const approval of session.approvals.slice(0, 8)) lines.push(`approval ${approval.approvalId} [${approval.status}] ${approval.action}`);
    for (const entity of session.entities.slice(0, 12)) lines.push(`entity ${entity.ref} [${entity.domain}] ${entity.label}`);
    for (const message of session.messages.slice(-12)) lines.push(`${message.role}: ${message.text}`);
    return lines.join('\n').slice(-maxChars);
  }

  clear(sessionKey: string): void {
    this.snapshots.delete(sessionKey);
  }
}

export function resolveReference(input: ReferenceInput): ContextReference {
  if (input.replyTaskId) return { kind: 'reply', value: input.replyTaskId };
  if (input.explicitEntityRef) return { kind: 'explicit', value: input.explicitEntityRef };
  if (input.explicitTaskId) return { kind: 'explicit', value: input.explicitTaskId };
  if (input.activeTaskId) return { kind: 'task', value: input.activeTaskId };
  if (input.recentEntityRef) return { kind: 'candidate', value: input.recentEntityRef };
  return { kind: 'none', value: null };
}
