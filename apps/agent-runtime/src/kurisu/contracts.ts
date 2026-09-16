import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

export const kurisuContractVersion = 'kurisu.v1' as const;
export const callbackNamespaceVersion = 'ku1' as const;

export const platformSchema = z.enum(['telegram', 'kook', 'whatsapp', 'test']);
export type KurisuPlatform = z.infer<typeof platformSchema>;

export const identitySchema = z.object({
  platform: platformSchema,
  platformUserId: z.string().trim().min(1).max(256),
  displayName: z.string().trim().max(256).optional(),
});
export type PlatformIdentity = z.infer<typeof identitySchema>;

export const conversationSchema = z.object({
  kind: z.enum(['private', 'group']),
  chatId: z.string().trim().min(1).max(256),
  threadId: z.string().trim().max(256).optional(),
  topicId: z.string().trim().max(256).optional(),
});
export type ConversationScope = z.infer<typeof conversationSchema>;

export const attachmentSchema = z.object({
  ref: z.string().trim().min(1).max(512),
  mediaType: z.string().trim().min(1).max(128),
  byteLength: z.number().int().nonnegative().max(20 * 1024 * 1024).optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
});
export type AttachmentRef = z.infer<typeof attachmentSchema>;

export const replyContextSchema = z.object({
  messageId: z.string().trim().min(1).max(256),
  sender: identitySchema.optional(),
  taskId: z.string().trim().max(256).optional(),
  excerpt: z.string().trim().max(1000).optional(),
});
export type ReplyContext = z.infer<typeof replyContextSchema>;

export const inboundMessageSchema = z.object({
  updateId: z.string().trim().min(1).max(256),
  messageId: z.string().trim().min(1).max(256),
  botId: z.string().trim().min(1).max(256),
  identity: identitySchema,
  conversation: conversationSchema,
  text: z.string().max(32_000),
  replyTo: replyContextSchema.optional(),
  attachments: z.array(attachmentSchema).max(8).default([]),
  explicitTaskId: z.string().trim().max(256).optional(),
  callbackData: z.string().trim().max(64).optional(),
  receivedAt: z.string().datetime({ offset: true }).optional(),
});
export type InboundMessageInput = z.input<typeof inboundMessageSchema>;
export type NormalizedInbound = z.output<typeof inboundMessageSchema> & {
  idempotencyKey: string;
  sessionKey: string;
  principalKey: string;
};

export type ToolResponseStatus =
  | 'ok'
  | 'accepted'
  | 'needs_input'
  | 'denied'
  | 'unsupported'
  | 'error'
  | 'unknown';

export interface ToolEvidence {
  source: string;
  observedAt: string;
  summary: string;
  ref?: string;
}

export interface ToolResponse<T = unknown> {
  contractVersion: typeof kurisuContractVersion;
  status: ToolResponseStatus;
  data?: T;
  evidence: ToolEvidence[];
  entityRefs: string[];
  jobId?: string;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  toolExecutionId?: string;
  callbackReferences?: CallbackReference[];
}

export type ToolRisk = 'read' | 'write' | 'high';

export interface TrustedAuthorization {
  role: 'PUBLIC' | 'USER' | 'ADMIN';
  allowedActions: readonly string[];
  approvalRequiredActions: readonly string[];
}

export interface TrustedExecutionContext {
  runId: string;
  requestId: string;
  identity: PlatformIdentity;
  conversation: ConversationScope;
  sessionKey: string;
  principalKey: string;
  botId: string;
  authorization: TrustedAuthorization;
  now: string;
  /** Server-generated stable key for a durable external mutation. */
  idempotencyKey?: string;
  source: 'langbot-native-agent' | 'test-harness' | 'runtime';
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ToolExecutionObservation {
  id: string;
  runId: string;
  callId: string;
  toolName: string;
  status: ToolResponseStatus;
  argumentsHash: string;
  startedAt: string;
  finishedAt: string;
  errorCode?: string;
}

export interface CallbackReference {
  namespace: typeof callbackNamespaceVersion;
  kind: 'approval' | 'task' | 'selection' | 'preference';
  action: string;
  id: string;
}

export class ContractValidationError extends Error {
  readonly code = 'CONTRACT_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'ContractValidationError';
  }
}

export function principalKey(identity: Pick<PlatformIdentity, 'platform' | 'platformUserId'>): string {
  return `${identity.platform}:${identity.platformUserId}`;
}

export function sessionKey(
  identity: Pick<PlatformIdentity, 'platform' | 'platformUserId'>,
  botId: string,
  conversation: ConversationScope,
): string {
  return [
    identity.platform,
    identity.platformUserId,
    botId,
    conversation.kind,
    conversation.chatId,
    conversation.threadId ?? '-',
    conversation.topicId ?? '-',
  ].join(':');
}

export function normalizeInbound(input: unknown, now = new Date().toISOString()): NormalizedInbound {
  const parsed = inboundMessageSchema.safeParse(input);
  if (!parsed.success) {
    throw new ContractValidationError(parsed.error.issues.map((issue) => issue.path.join('.')).join(',') || 'invalid inbound');
  }
  const value = parsed.data;
  const normalizedConversation = {
    ...value.conversation,
    ...(value.conversation.threadId ? { threadId: value.conversation.threadId } : {}),
    ...(value.conversation.topicId ? { topicId: value.conversation.topicId } : {}),
  };
  const normalized = {
    ...value,
    conversation: normalizedConversation,
    ...(value.receivedAt ? { receivedAt: value.receivedAt } : { receivedAt: now }),
  };
  return {
    ...normalized,
    idempotencyKey: `${value.identity.platform}:${value.botId}:${value.updateId}`,
    sessionKey: sessionKey(value.identity, value.botId, normalizedConversation),
    principalKey: principalKey(value.identity),
  };
}

export function argumentsHash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
  return `{${entries.join(',')}}`;
}

export function newRunId(prefix = 'run'): string {
  return `${prefix}_${randomUUID()}`;
}

export function makeCallback(reference: Omit<CallbackReference, 'namespace'>): string {
  if (!/^[a-z][a-z0-9_-]{1,15}$/u.test(reference.kind)) throw new ContractValidationError('invalid callback kind');
  if (!/^[a-z][a-z0-9_-]{1,15}$/u.test(reference.action)) throw new ContractValidationError('invalid callback action');
  if (!/^[A-Za-z0-9_-]{1,36}$/u.test(reference.id)) throw new ContractValidationError('invalid callback id');
  const value = `${callbackNamespaceVersion}:${reference.kind}:${reference.action}:${reference.id}`;
  if (Buffer.byteLength(value, 'utf8') > 64) throw new ContractValidationError('callback exceeds platform limit');
  return value;
}

export function parseCallback(value: unknown): CallbackReference | null {
  const match = String(value ?? '').trim().match(/^ku1:(approval|task|selection|preference):([a-z][a-z0-9_-]{1,15}):([A-Za-z0-9_-]{1,36})$/u);
  if (!match) return null;
  return {
    namespace: callbackNamespaceVersion,
    kind: match[1] as CallbackReference['kind'],
    action: match[2]!,
    id: match[3]!,
  };
}

export function trustedContextFromInbound(
  inbound: NormalizedInbound,
  authorization: TrustedAuthorization,
  options: Partial<Pick<TrustedExecutionContext, 'runId' | 'requestId' | 'source'>> = {},
): TrustedExecutionContext {
  return {
    runId: options.runId ?? newRunId(),
    requestId: options.requestId ?? `req_${randomUUID()}`,
    identity: inbound.identity,
    conversation: inbound.conversation,
    sessionKey: inbound.sessionKey,
    principalKey: inbound.principalKey,
    botId: inbound.botId,
    authorization,
    now: inbound.receivedAt ?? new Date().toISOString(),
    idempotencyKey: inbound.idempotencyKey,
    source: options.source ?? 'runtime',
  };
}
