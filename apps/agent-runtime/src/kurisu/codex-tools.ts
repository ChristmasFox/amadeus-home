import { z } from 'zod';
import {
  codexCancelInputSchema,
  codexJobInputSchema,
  codexStartInputSchema,
  type CodexAppServerExecutor,
} from './codex.js';
import { type ToolDefinition, ToolRegistry } from './tools.js';

const emptyInputSchema = z.object({}).strict();

/** Register the single Codex executor boundary; project paths stay server-owned. */
export function registerCodexTools(registry: ToolRegistry, executor: CodexAppServerExecutor): void {
  const definitions: ToolDefinition[] = [
    {
      name: 'kurisu.codex.start',
      version: '1.0.0',
      description: 'Start a durable Codex engineering task in a server-registered project workspace.',
      risk: 'high',
      timeoutMs: 120_000,
      idempotency: 'required',
      reconciliation: 'required',
      inputSchema: codexStartInputSchema,
      jsonSchema: zodSchema(codexStartInputSchema),
      handler: (input, context) => executor.requestStart(input, context),
    },
    {
      name: 'kurisu.codex.status',
      version: '1.0.0',
      description: 'Read a durable Codex job, thread mapping, progress evidence, and pending request.',
      risk: 'read',
      timeoutMs: 5_000,
      idempotency: 'optional',
      reconciliation: 'not_applicable',
      inputSchema: codexJobInputSchema,
      jsonSchema: zodSchema(codexJobInputSchema),
      handler: (input, context) => executor.status(input, context),
    },
    {
      name: 'kurisu.codex.list',
      version: '1.0.0',
      description: 'List durable Codex jobs owned by the current conversation.',
      risk: 'read',
      timeoutMs: 5_000,
      idempotency: 'optional',
      reconciliation: 'not_applicable',
      inputSchema: emptyInputSchema,
      jsonSchema: zodSchema(emptyInputSchema),
      handler: (_input, context) => executor.list(context),
    },
    {
      name: 'kurisu.codex.resume',
      version: '1.0.0',
      description: 'Reattach a durable Codex job to its original thread without starting a duplicate task.',
      risk: 'write',
      timeoutMs: 120_000,
      idempotency: 'required',
      reconciliation: 'required',
      inputSchema: codexJobInputSchema,
      jsonSchema: zodSchema(codexJobInputSchema),
      handler: (input, context) => executor.requestResume(input, context),
    },
    {
      name: 'kurisu.codex.cancel',
      version: '1.0.0',
      description: 'Cancel a durable Codex job and stop later continuation; completed changes are not rolled back.',
      risk: 'write',
      timeoutMs: 120_000,
      idempotency: 'required',
      reconciliation: 'required',
      inputSchema: codexCancelInputSchema,
      jsonSchema: zodSchema(codexCancelInputSchema),
      handler: (input, context) => executor.requestCancel(input, context),
    },
  ];
  registry.registerMany(definitions);
}

function zodSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema) as Record<string, unknown>;
}
