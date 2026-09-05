import { z } from 'zod';

// Service Registry
export const ServiceIdSchema = z.enum([
  'langbot',
  'telegram-adapter',
  'kook-adapter',
  'mastra-pubg-runtime',
  'n8n',
  'postgres',
  'redis',
  'emby',
  'jellyfin',
  'qbittorrent',
  'aria2',
  'glances',
  'cloudflared',
]);

export type ServiceId = z.infer<typeof ServiceIdSchema>;

export const ExecutionRuntimeSchema = z.enum(['docker', 'ubuntu', 'macos', 'langbot-component']);
export type ExecutionRuntime = z.infer<typeof ExecutionRuntimeSchema>;

export const ExecutorKindSchema = z.enum(['docker', 'ubuntu', 'macos-host', 'langbot-component']);
export type ExecutorKind = z.infer<typeof ExecutorKindSchema>;

export const RoleSchema = z.enum(['PUBLIC', 'TRUSTED', 'ADMIN']);
export type Role = z.infer<typeof RoleSchema>;

export const RiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const ActionSchema = z.enum([
  'start',
  'restart',
  'stop',
  'check',
  'cleanup',
  'rotate_logs',
  'organize_media',
  'organize',
]);

export type Action = z.infer<typeof ActionSchema>;

export const ServiceDefinitionSchema = z.object({
  serviceId: ServiceIdSchema,
  runtime: ExecutionRuntimeSchema,
  executor: ExecutorKindSchema,

  displayName: z.string(),
  description: z.string().optional(),
  healthCheck: z.object({
    type: z.enum(['docker', 'http', 'tcp', 'process']),
    target: z.string(),
    timeout: z.number().default(10000),
    expected: z.enum(['up', 'down', 'response']).default('up'),
  }),
  container: z.object({
    name: z.string(),
    composePath: z.string(),
  }).optional(),
  process: z.object({
    name: z.string(),
    pidFile: z.string().optional(),
  }).optional(),
  component: z.object({
    name: z.string(),
    containerName: z.string(),
  }).optional(),
  dependencies: z.array(ServiceIdSchema).default([]),
  allowedActions: z.array(ActionSchema).default(['check']),
  riskLevel: RiskLevelSchema.default('medium'),
  recovery: z.object({
    restart: z.boolean().default(true),
    containerRecreate: z.boolean().default(false),
    clusterRestart: z.boolean().default(false),
  }).optional(),
});

export type ServiceDefinition = z.infer<typeof ServiceDefinitionSchema>;

// Health Results
export const HealthStatusSchema = z.enum(['healthy', 'degraded', 'unhealthy', 'down', 'unknown']);
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

export const ServiceHealthSchema = z.object({
  serviceId: ServiceIdSchema,
  status: HealthStatusSchema,
  lastCheck: z.string(),
  message: z.string(),
  metrics: z.object({
    cpu: z.number().optional(),
    memory: z.number().optional(),
    disk: z.number().optional(),
  }).optional(),
  runtime: ExecutionRuntimeSchema.optional(),
  executor: ExecutorKindSchema.optional(),
  unknownReason: z.string().optional(),
  checks: z.array(z.object({
    name: z.string(),
    status: HealthStatusSchema,
    message: z.string(),
    timestamp: z.string(),
  })).default([]),
});

export type ServiceHealth = z.infer<typeof ServiceHealthSchema>;

export const HostHealthSchema = z.object({
  hostname: z.string(),
  uptime: z.number().nullable(),
  loadAverage: z.array(z.number().nullable()).length(3),
  cpu: z.object({
    usage: z.number().nullable(),
    cores: z.number().nullable(),
  }),
  memory: z.object({
    total: z.number().nullable(),
    used: z.number().nullable(),
    available: z.number().nullable(),
    percentage: z.number().nullable(),
  }),
  disk: z.array(z.object({
    mount: z.string(),
    total: z.number().nullable(),
    used: z.number().nullable(),
    available: z.number().nullable(),
    percentage: z.number().nullable(),
  })),
  network: z.array(z.object({
    interface: z.string(),
    bytesIn: z.number(),
    bytesOut: z.number(),
  })).optional(),
});

export type HostHealth = z.infer<typeof HostHealthSchema>;

export const HealthResultSchema = z.object({
  host: HostHealthSchema,
  services: z.array(ServiceHealthSchema),
  summary: z.object({
    totalServices: z.number(),
    healthy: z.number(),
    degraded: z.number(),
    unhealthy: z.number(),
    down: z.number(),
    unknown: z.number(),
  }),
  abnormal: z.array(ServiceIdSchema),
  diagnosis: z.string(),
  timestamp: z.string(),
});

export type HealthResult = z.infer<typeof HealthResultSchema>;

// Diagnosis Results
export const DiagnosisStatusSchema = z.enum(['investigating', 'diagnosed', 'resolved', 'uncertain', 'failed']);
export type DiagnosisStatus = z.infer<typeof DiagnosisStatusSchema>;

export const DiagnosisIssueSchema = z.object({
  severity: z.enum(['info', 'warning', 'error', 'critical']),
  category: z.enum(['connectivity', 'resource', 'configuration', 'dependency', 'data', 'process', 'external']),
  component: z.string(),
  message: z.string(),
  suggestion: z.string().optional(),
  actionable: z.boolean().default(true),
});

export type DiagnosisIssue = z.infer<typeof DiagnosisIssueSchema>;

export const DiagnosisResultSchema = z.object({
  serviceId: ServiceIdSchema,
  status: DiagnosisStatusSchema,
  issues: z.array(DiagnosisIssueSchema),
  checks: z.array(z.object({
    name: z.string(),
    status: z.enum(['passed', 'failed', 'skipped']),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    timestamp: z.string(),
  })),
  recommendedActions: z.array(z.object({
    action: ActionSchema,
    reason: z.string(),
    confidence: z.number().min(0).max(1),
    requiresConfirmation: z.boolean().default(true),
  })),
  timestamp: z.string(),
});

export type DiagnosisResult = z.infer<typeof DiagnosisResultSchema>;

// Action Execution
export const ActionStatusSchema = z.enum(['pending', 'authorized', 'executing', 'success', 'failed', 'cancelled']);
export type ActionStatus = z.infer<typeof ActionStatusSchema>;

export const ActionRequestSchema = z.object({
  serviceId: ServiceIdSchema,
  action: ActionSchema,
  /** Backwards-compatible alias; for platform actions this is the platform user ID. */
  userId: z.string().min(1),
  platform: z.string().min(1),
  platformUserId: z.string().min(1).optional(),
  internalUserId: z.string().min(1).nullable().optional(),
  role: RoleSchema.optional(),
  chatId: z.string().min(1).optional(),
  actionId: z.string().min(1).optional(),
  target: z.string().min(1).optional(),
  reason: z.string().optional(),
  /** Deprecated compatibility field. Authorization never treats it as confirmation. */
  skipConfirmation: z.boolean().default(false),
  /** Set only by the verified confirmation path, never from an inbound body. */
  confirmed: z.boolean().default(false),
  dryRun: z.boolean().default(false),
});

export type ActionRequest = z.input<typeof ActionRequestSchema>;

export const ActionResultSchema = z.object({
  requestId: z.string(),
  serviceId: ServiceIdSchema,
  action: ActionSchema,
  status: ActionStatusSchema,
  result: z.object({
    success: z.boolean(),
    message: z.string(),
    output: z.string().optional(),
    error: z.string().optional(),
  }),
  verification: z.object({
    passed: z.boolean(),
    checks: z.array(z.object({
      name: z.string(),
      status: z.enum(['passed', 'failed']),
      message: z.string(),
    })),
    message: z.string(),
  }),
  timestamp: z.string(),
  executedAt: z.string(),
  verifiedAt: z.string(),
  duration: z.number(),
});

export type ActionResult = z.infer<typeof ActionResultSchema>;

// Context
export const HomeHubContextSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  platform: z.string(),
  activeService: ServiceIdSchema.nullable().optional(),
  lastDiagnosis: z.object({
    serviceId: ServiceIdSchema,
    result: DiagnosisResultSchema,
    timestamp: z.string(),
  }).nullable().optional(),
  pendingAction: z.object({
    actionId: z.string().min(1),
    platform: z.string().min(1),
    chatId: z.string().min(1),
    userId: z.string().min(1),
    platformUserId: z.string().min(1),
    internalUserId: z.string().min(1).nullable(),
    role: RoleSchema,
    target: z.string().min(1).nullable(),
    request: ActionRequestSchema,
    status: ActionStatusSchema,
    timestamp: z.string(),
  }).nullable().optional(),
  lastActionResult: z.object({
    result: ActionResultSchema,
    timestamp: z.string(),
  }).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type HomeHubContext = z.infer<typeof HomeHubContextSchema>;

// Audit
export const AuditEntrySchema = z.object({
  id: z.string(),
  userId: z.string(),
  platform: z.string(),
  platformUserId: z.string().min(1),
  internalUser: z.string().min(1).nullable(),
  role: RoleSchema,
  chatId: z.string().min(1),
  target: z.string().min(1).nullable(),
  authorized: z.boolean(),
  denied: z.boolean(),
  serviceId: ServiceIdSchema,
  action: ActionSchema,
  request: ActionRequestSchema,
  result: ActionResultSchema,
  status: ActionStatusSchema,
  timestamp: z.string(),
  duration: z.number(),
  verificationPassed: z.boolean(),
});

export type AuditEntry = z.infer<typeof AuditEntrySchema>;

// Query Types
export const QueryTypeSchema = z.enum(['status', 'diagnosis', 'action', 'history', 'media']);
export type QueryType = z.infer<typeof QueryTypeSchema>;

export const HomeHubQuerySchema = z.object({
  queryId: z.string(),
  queryType: QueryTypeSchema,
  text: z.string(),
  userId: z.string(),
  platform: z.string(),
  serviceId: ServiceIdSchema.optional(),
  parameters: z.record(z.unknown()).optional(),
  timestamp: z.string(),
});

export type HomeHubQuery = z.infer<typeof HomeHubQuerySchema>;
