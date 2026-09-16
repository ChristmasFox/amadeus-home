import { argumentsHash, type ToolCall, type ToolEvidence, type ToolExecutionObservation, type ToolResponse, type ToolResponseStatus, type ToolRisk, type TrustedExecutionContext } from './contracts.js';
import type { z } from 'zod';

const forbiddenModelFields = new Set([
  'admin',
  'approval',
  'approvalId',
  'confirmed',
  'isAdmin',
  'recipient',
  'recipientId',
  'role',
  'authorization',
  'trustedContext',
]);

export interface ToolDefinition {
  name: string;
  version: string;
  description: string;
  risk: ToolRisk;
  timeoutMs: number;
  idempotency: 'required' | 'optional' | 'none';
  reconciliation: 'supported' | 'not_applicable' | 'required';
  inputSchema: z.ZodType;
  jsonSchema: Record<string, unknown>;
  handler: (input: unknown, context: TrustedExecutionContext) => Promise<ToolResponse>;
}

export interface ToolCatalogEntry {
  name: string;
  version: string;
  description: string;
  risk: ToolRisk;
  timeoutMs: number;
  idempotency: ToolDefinition['idempotency'];
  reconciliation: ToolDefinition['reconciliation'];
  inputSchema: Record<string, unknown>;
}

export interface ToolRegistryOptions {
  authorize?: (definition: ToolDefinition, context: TrustedExecutionContext) => ToolResponseStatus | null;
  observer?: (observation: ToolExecutionObservation, response: ToolResponse) => void | Promise<void>;
  now?: () => string;
}

export class ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>();
  private readonly authorize: NonNullable<ToolRegistryOptions['authorize']>;
  private readonly observer: NonNullable<ToolRegistryOptions['observer']>;
  private readonly now: NonNullable<ToolRegistryOptions['now']>;

  constructor(options: ToolRegistryOptions = {}) {
    this.authorize = options.authorize ?? (() => null);
    this.observer = options.observer ?? (() => undefined);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  register(definition: ToolDefinition): void {
    if (this.definitions.has(definition.name)) throw new Error(`duplicate Kurisu tool: ${definition.name}`);
    if (!/^[a-z][a-z0-9_.-]{2,96}$/u.test(definition.name)) throw new Error(`invalid Kurisu tool name: ${definition.name}`);
    if (!Number.isInteger(definition.timeoutMs) || definition.timeoutMs <= 0 || definition.timeoutMs > 300_000) {
      throw new Error(`invalid timeout for ${definition.name}`);
    }
    this.definitions.set(definition.name, definition);
  }

  registerMany(definitions: readonly ToolDefinition[]): void {
    for (const definition of definitions) this.register(definition);
  }

  has(name: string): boolean {
    return this.definitions.has(name);
  }

  get(name: string): ToolDefinition | null {
    return this.definitions.get(name) ?? null;
  }

  catalog(): ToolCatalogEntry[] {
    return [...this.definitions.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((definition) => ({
        name: definition.name,
        version: definition.version,
        description: definition.description,
        risk: definition.risk,
        timeoutMs: definition.timeoutMs,
        idempotency: definition.idempotency,
        reconciliation: definition.reconciliation,
        inputSchema: definition.jsonSchema,
      }));
  }

  async execute(call: ToolCall, context: TrustedExecutionContext): Promise<ToolResponse> {
    const startedAt = this.now();
    const definition = this.definitions.get(call.name);
    const inputError = rejectModelOwnedFields(call.arguments);
    const hash = argumentsHash(call.arguments);
    let response: ToolResponse;
    if (!definition) {
      response = failure('TOOL_NOT_FOUND', `tool ${call.name} is not registered`, false);
    } else if (inputError) {
      response = failure('MODEL_CONTEXT_FORBIDDEN', inputError, false);
    } else {
      const authorizationResult = this.authorize(definition, context);
      if (authorizationResult && authorizationResult !== 'ok') {
        response = {
          ...failure('TOOL_POLICY_DENIED', `tool ${definition.name} is not allowed in this context`, false),
          status: authorizationResult,
        };
      } else {
        const parsed = definition.inputSchema.safeParse(call.arguments);
        if (!parsed.success) {
          response = failure('TOOL_INPUT_INVALID', 'tool arguments do not match the declared schema', false);
        } else {
          try {
            response = await withTimeout(definition.handler(parsed.data, context), definition.timeoutMs);
          } catch (error) {
            response = error instanceof ToolTimeoutError
              ? unknownResult('TOOL_TIMEOUT', 'tool execution timed out; external state is not assumed', true)
              : failure(
                'TOOL_EXECUTION_ERROR',
                error instanceof Error ? error.message.slice(0, 500) : 'tool execution failed',
                true,
              );
          }
        }
      }
    }
    const finishedAt = this.now();
    const observation: ToolExecutionObservation = {
      id: response.toolExecutionId ?? `${context.runId}:${call.id}`,
      runId: context.runId,
      callId: call.id,
      toolName: call.name,
      status: response.status,
      argumentsHash: hash,
      startedAt,
      finishedAt,
      ...(response.error ? { errorCode: response.error.code } : {}),
    };
    await this.observer(observation, response);
    return { ...response, toolExecutionId: observation.id };
  }
}

export function evidence(source: string, summary: string, ref?: string): ToolEvidence {
  return {
    source,
    summary: summary.slice(0, 1000),
    observedAt: new Date().toISOString(),
    ...(ref ? { ref } : {}),
  };
}

export function ok<T>(data: T, evidenceItems: ToolEvidence[] = [], entityRefs: string[] = []): ToolResponse<T> {
  return {
    contractVersion: 'kurisu.v1',
    status: 'ok',
    data,
    evidence: evidenceItems,
    entityRefs,
  };
}

export function accepted(jobId: string, evidenceItems: ToolEvidence[] = []): ToolResponse {
  return {
    contractVersion: 'kurisu.v1',
    status: 'accepted',
    jobId,
    evidence: evidenceItems,
    entityRefs: [],
  };
}

export function failure(code: string, message: string, retryable: boolean): ToolResponse {
  return {
    contractVersion: 'kurisu.v1',
    status: 'error',
    evidence: [],
    entityRefs: [],
    error: { code, message: message.slice(0, 500), retryable },
  };
}

export function unknownResult(code: string, message: string, retryable = true): ToolResponse {
  return {
    contractVersion: 'kurisu.v1',
    status: 'unknown',
    evidence: [],
    entityRefs: [],
    error: { code, message: message.slice(0, 500), retryable },
  };
}

function rejectModelOwnedFields(value: unknown, path = '', seen = new Set<object>()): string | null {
  if (!value || typeof value !== 'object') return null;
  if (seen.has(value)) return 'model arguments contain a cyclic object';
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const violation = rejectModelOwnedFields(value[index], `${path}[${index}]`, seen);
      if (violation) return violation;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value)) {
    const fieldPath = path ? `${path}.${key}` : key;
    if (forbiddenModelFields.has(key)) return `model cannot provide trusted field: ${fieldPath}`;
    const violation = rejectModelOwnedFields(child, fieldPath, seen);
    if (violation) return violation;
  }
  return null;
}

class ToolTimeoutError extends Error {
  constructor() {
    super('tool timeout');
    this.name = 'ToolTimeoutError';
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new ToolTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
