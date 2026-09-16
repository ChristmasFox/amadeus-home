import type { ToolDefinition } from './tools.js';
import type { ToolResponseStatus, TrustedExecutionContext } from './contracts.js';

/** Server-derived policy used by the registry; user/model text never sets it. */
export function authorizeTool(definition: ToolDefinition, context: TrustedExecutionContext): ToolResponseStatus | null {
  if (definition.risk === 'read' && context.authorization.allowedActions.includes('read')) return null;
  if (context.authorization.allowedActions.includes(definition.name)) return null;
  // Let the write coordinator create a server-bound approval challenge. A
  // registry-level `needs_input` result would never reach that handler and
  // could not bind the challenge to the exact arguments.
  if (context.authorization.approvalRequiredActions.includes(definition.risk)) return null;
  return 'denied';
}

export function publicReadAuthorization(): TrustedExecutionContext['authorization'] {
  return {
    role: 'PUBLIC',
    allowedActions: ['read'],
    approvalRequiredActions: [],
  };
}

export function userAuthorization(actions: readonly string[] = ['read']): TrustedExecutionContext['authorization'] {
  return {
    role: 'USER',
    allowedActions: actions,
    approvalRequiredActions: ['write', 'high'],
  };
}

export function adminAuthorization(actions: readonly string[] = ['read', 'write', 'high']): TrustedExecutionContext['authorization'] {
  return {
    role: 'ADMIN',
    allowedActions: actions,
    approvalRequiredActions: ['write', 'high'],
  };
}
