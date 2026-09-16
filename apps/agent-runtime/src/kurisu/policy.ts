import type { ToolDefinition } from './tools.js';
import type { ToolResponseStatus, TrustedExecutionContext } from './contracts.js';

/** Server-derived policy used by the registry; user/model text never sets it. */
export function authorizeTool(definition: ToolDefinition, context: TrustedExecutionContext): ToolResponseStatus | null {
  if (definition.risk === 'read' && context.authorization.allowedActions.includes('read')) return null;
  if (context.authorization.allowedActions.includes(definition.name)) return null;
  if (context.authorization.approvalRequiredActions.includes(definition.risk)) return 'needs_input';
  return 'denied';
}

export function publicReadAuthorization(): TrustedExecutionContext['authorization'] {
  return {
    role: 'PUBLIC',
    allowedActions: ['read'],
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
