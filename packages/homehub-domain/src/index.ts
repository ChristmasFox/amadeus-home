// Schema types
export * from './schema/types.js';

// Domain
export { HomeHubDomain } from './domain/homehub-domain.js';

// Service Registry
export { ServiceRegistry } from './registry/service-registry.js';

// Diagnostic Engine
export { DiagnosticEngine } from './diagnostic/diagnostic-engine.js';
export { HostCollector } from './registry/host-collector.js';
export type { HostCollectorOptions } from './registry/host-collector.js';
export type { DiagnosticEngineOptions } from './diagnostic/diagnostic-engine.js';

// Action Engine
export { ActionEngine } from './action/action-engine.js';
export type { ActionEngineOptions } from './action/action-engine.js';

// Context Manager
export { ContextManager } from './context/context-manager.js';
export type { ContextManagerOptions } from './context/context-manager.js';

// Audit Logger
export { AuditLogger } from './audit/audit-logger.js';
export type { AuditLoggerOptions } from './audit/audit-logger.js';

// Authorization and identity core
export {
  AuthorizationCore,
  identityFromParts,
  primaryRoleForIdentity,
} from './authorization/authorization-core.js';
export type {
  PlatformIdentity as AuthorizationPlatformIdentity,
  InternalIdentity,
  ResolvedIdentity as AuthorizationResolvedIdentity,
  IdentityMapping as AuthorizationIdentityMapping,
  AuthorizationIdentityLike,
  AuthorizationService,
  AuthorizationRequest,
  AuthorizationDecision,
} from './authorization/authorization-core.js';

// Runtime execution boundaries
export {
  RuntimeExecutorManager,
  DockerApiCommandExecutor,
  DEFAULT_DOCKER_ALLOWED_CONTAINERS,
  isExecutorUnavailable,
} from './execution/runtime-executor.js';
export type {
  CommandSpec,
  CommandExecution,
  CommandExecutor,
  ExecutorKind,
  RuntimeExecutorManagerOptions,
  DockerApiExecutorOptions,
} from './execution/runtime-executor.js';
