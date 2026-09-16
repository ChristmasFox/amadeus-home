import { z } from 'zod';
import type { ToolResponse, TrustedExecutionContext } from './contracts.js';
import { evidence, failure, ok, type ToolDefinition, ToolRegistry } from './tools.js';

const timeRangeSchema = z.object({
  kind: z.enum(['today', 'yesterday', 'date', 'range', 'recent']).optional(),
  start: z.string().max(64).optional(),
  end: z.string().max(64).optional(),
  timezone: z.string().max(64).default('Asia/Shanghai'),
}).strict();

const subjectSchema = z.object({
  type: z.enum(['team', 'player', 'match']),
  ids: z.array(z.string().trim().min(1).max(256)).max(16).default([]),
}).strict();

export const pubgQueryInputSchema = z.object({
  operation: z.enum(['report', 'per_player', 'rank', 'compare', 'trend']),
  subject: subjectSchema,
  timeRange: timeRangeSchema.optional(),
  metrics: z.array(z.enum(['kd', 'kills', 'assists', 'damage', 'dbnos', 'revives', 'rank', 'wins', 'top10', 'survival_time'])).max(16).default([]),
  matchId: z.string().uuid().optional(),
}).strict();

export const pubgListInputSchema = z.object({
  subject: subjectSchema.optional(),
  timeRange: timeRangeSchema.optional(),
  limit: z.number().int().min(1).max(50).default(10),
}).strict();

export const pubgReviewInputSchema = z.object({
  matchId: z.string().uuid(),
  detail: z.enum(['summary', 'full']).default('summary'),
}).strict();

export const homehubServicesInputSchema = z.object({
  serviceIds: z.array(z.string().trim().min(1).max(128)).max(64).default([]),
  includeMetrics: z.boolean().default(false),
}).strict();

export const homehubErrorsInputSchema = z.object({
  serviceId: z.string().trim().min(1).max(128).optional(),
  limit: z.number().int().min(1).max(100).default(20),
}).strict();

export const radarWatchInputSchema = z.object({
  watchId: z.string().trim().min(1).max(256).optional(),
  includeRuns: z.boolean().default(false),
}).strict();

export const notificationDiagnosisInputSchema = z.object({
  eventType: z.string().trim().max(128).optional(),
  channel: z.enum(['telegram', 'kook', 'codex', 'all']).default('all'),
  limit: z.number().int().min(1).max(100).default(20),
}).strict();

export const entityResolveInputSchema = z.object({
  domain: z.enum(['pubg', 'homehub', 'radar', 'media', 'codex']),
  reference: z.string().trim().min(1).max(256),
  candidateRefs: z.array(z.string().trim().min(1).max(256)).max(32).default([]),
}).strict();

export interface DomainBackends {
  pubg?: {
    query(input: z.infer<typeof pubgQueryInputSchema>, context: TrustedExecutionContext): Promise<unknown>;
    list(input: z.infer<typeof pubgListInputSchema>, context: TrustedExecutionContext): Promise<unknown>;
    review(input: z.infer<typeof pubgReviewInputSchema>, context: TrustedExecutionContext): Promise<unknown>;
  };
  homehub?: {
    list(input: z.infer<typeof homehubServicesInputSchema>, context: TrustedExecutionContext): Promise<unknown>;
    status(input: z.infer<typeof homehubServicesInputSchema>, context: TrustedExecutionContext): Promise<unknown>;
    diagnose(input: z.infer<typeof homehubServicesInputSchema>, context: TrustedExecutionContext): Promise<unknown>;
    errors(input: z.infer<typeof homehubErrorsInputSchema>, context: TrustedExecutionContext): Promise<unknown>;
  };
  radar?: {
    list(input: z.infer<typeof radarWatchInputSchema>, context: TrustedExecutionContext): Promise<unknown>;
    status(input: z.infer<typeof radarWatchInputSchema>, context: TrustedExecutionContext): Promise<unknown>;
    stats(input: z.infer<typeof radarWatchInputSchema>, context: TrustedExecutionContext): Promise<unknown>;
  };
  notifications?: {
    diagnosis(input: z.infer<typeof notificationDiagnosisInputSchema>, context: TrustedExecutionContext): Promise<unknown>;
  };
  entities?: {
    resolve(input: z.infer<typeof entityResolveInputSchema>, context: TrustedExecutionContext): Promise<unknown>;
  };
}

export function registerDomainTools(registry: ToolRegistry, backends: DomainBackends = {}): void {
  registry.registerMany([
    definition('kurisu.entity.resolve', 'Resolve a structured entity reference without selecting an action.', 'read', entityResolveInputSchema, backends.entities ? (input, context) => backends.entities!.resolve(input as z.infer<typeof entityResolveInputSchema>, context) : undefined),
    definition('kurisu.pubg.query', 'Query PUBG facts using a structured operation, subject, and time range.', 'read', pubgQueryInputSchema, backends.pubg ? (input, context) => backends.pubg!.query(input as z.infer<typeof pubgQueryInputSchema>, context) : undefined),
    definition('kurisu.pubg.list', 'List PUBG matches or structured result candidates.', 'read', pubgListInputSchema, backends.pubg ? (input, context) => backends.pubg!.list(input as z.infer<typeof pubgListInputSchema>, context) : undefined),
    definition('kurisu.pubg.review', 'Read a deterministic PUBG review for one explicit match.', 'read', pubgReviewInputSchema, backends.pubg ? (input, context) => backends.pubg!.review(input as z.infer<typeof pubgReviewInputSchema>, context) : undefined),
    definition('kurisu.homehub.list', 'List available HomeHub services from the server-side registry.', 'read', homehubServicesInputSchema, backends.homehub ? (input, context) => backends.homehub!.list(input as z.infer<typeof homehubServicesInputSchema>, context) : undefined),
    definition('kurisu.homehub.status', 'Read HomeHub service status and optional metrics.', 'read', homehubServicesInputSchema, backends.homehub ? (input, context) => backends.homehub!.status(input as z.infer<typeof homehubServicesInputSchema>, context) : undefined),
    definition('kurisu.homehub.diagnose', 'Run bounded HomeHub diagnostics for selected services.', 'read', homehubServicesInputSchema, backends.homehub ? (input, context) => backends.homehub!.diagnose(input as z.infer<typeof homehubServicesInputSchema>, context) : undefined),
    definition('kurisu.homehub.errors', 'Read recent HomeHub error records without treating them as current health.', 'read', homehubErrorsInputSchema, backends.homehub ? (input, context) => backends.homehub!.errors(input as z.infer<typeof homehubErrorsInputSchema>, context) : undefined),
    definition('kurisu.radar.list', 'List Product Radar watches in the current authorized scope.', 'read', radarWatchInputSchema, backends.radar ? (input, context) => backends.radar!.list(input as z.infer<typeof radarWatchInputSchema>, context) : undefined),
    definition('kurisu.radar.status', 'Read Product Radar watch/feed status without changing a watch.', 'read', radarWatchInputSchema, backends.radar ? (input, context) => backends.radar!.status(input as z.infer<typeof radarWatchInputSchema>, context) : undefined),
    definition('kurisu.radar.stats', 'Read Product Radar run and match statistics.', 'read', radarWatchInputSchema, backends.radar ? (input, context) => backends.radar!.stats(input as z.infer<typeof radarWatchInputSchema>, context) : undefined),
    definition('kurisu.notifications.diagnose', 'Inspect notification events and delivery states by channel.', 'read', notificationDiagnosisInputSchema, backends.notifications ? (input, context) => backends.notifications!.diagnosis(input as z.infer<typeof notificationDiagnosisInputSchema>, context) : undefined),
  ]);
}

function definition(
  name: string,
  description: string,
  risk: 'read' | 'write' | 'high',
  inputSchema: z.ZodType,
  invoke: ((input: unknown, context: TrustedExecutionContext) => Promise<unknown>) | undefined,
): ToolDefinition {
  return {
    name,
    version: '1.0.0',
    description,
    risk,
    timeoutMs: 30_000,
    idempotency: 'optional',
    reconciliation: 'not_applicable',
    inputSchema,
    // Keep schemas explicit and reviewable at the LangBot boundary. The
    // runtime does not infer a schema from free-form text.
    jsonSchema: z.toJSONSchema(inputSchema),
    handler: async (input, context): Promise<ToolResponse> => {
      if (!invoke) {
        return failure('CAPABILITY_UNAVAILABLE', `${name} backend is not configured`, false);
      }
      const value = await invoke(input, context);
      if (isToolResponse(value)) return value;
      return ok(value, [evidence('kurisu.domain', `${name} returned structured data`)]);
    },
  };
}

function isToolResponse(value: unknown): value is ToolResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate.contractVersion === 'kurisu.v1' && typeof candidate.status === 'string' && Array.isArray(candidate.evidence);
}
