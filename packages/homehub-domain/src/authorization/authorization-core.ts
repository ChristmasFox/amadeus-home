import type { Action, RiskLevel, Role } from '../schema/types.js';

export interface PlatformIdentity {
  platform: string;
  platformUserId: string;
}

export interface InternalIdentity {
  internalUserId: string;
}

export interface ResolvedIdentity {
  platformIdentity: PlatformIdentity;
  internalIdentity: InternalIdentity | null;
  /** Convenience field retained for the existing runtime identity contract. */
  internalUserId: string | null;
  roles: Role[];
  role: Role;
}

export interface IdentityMapping {
  internalUserId: string;
  roles: Role[];
  /** The key is a platform name and values are stable platform user IDs. */
  identities: Readonly<Record<string, readonly string[] | undefined>>;
}

export interface AuthorizationIdentityLike {
  platformIdentity: PlatformIdentity;
  internalIdentity?: InternalIdentity | null;
  internalUserId?: string | null;
  roles: readonly Role[];
  role?: Role;
}

export interface AuthorizationService {
  serviceId: string;
  riskLevel: RiskLevel;
  allowedActions: readonly string[];
}

export interface AuthorizationRequest {
  identity: AuthorizationIdentityLike;
  action: string;
  service?: AuthorizationService;
  confirmed?: boolean;
}

export interface AuthorizationDecision {
  authorized: boolean;
  requiresConfirmation: boolean;
  role: Role;
  action: string;
  reason?: string;
}

const READ_ONLY_ACTIONS = new Set(['status', 'query', 'check']);
const SIDE_EFFECT_ACTIONS = new Set<Action | 'organize_media'>([
  'start',
  'restart',
  'stop',
  'cleanup',
  'rotate_logs',
  'organize_media',
]);

function canonicalAction(action: string): string {
  return action === 'organize' ? 'organize_media' : action;
}

function primaryRole(roles: readonly Role[]): Role {
  if (roles.includes('ADMIN')) return 'ADMIN';
  if (roles.includes('TRUSTED')) return 'TRUSTED';
  return 'PUBLIC';
}

function normalizedPlatformIdentity(identity: PlatformIdentity): PlatformIdentity {
  const platform = String(identity.platform ?? '').trim();
  const platformUserId = String(identity.platformUserId ?? '').trim();
  if (!platform || !platformUserId || ['unknown', 'undefined', 'null'].includes(platformUserId.toLowerCase())) {
    throw new Error('authorization requires a real platform and platform user ID');
  }
  return { platform, platformUserId };
}

/**
 * Platform-neutral identity resolution and policy evaluation shared by every
 * adapter. Names and chat labels are intentionally absent from this API.
 */
export class AuthorizationCore {
  private readonly mappings: IdentityMapping[];

  constructor(mappings: readonly IdentityMapping[] = []) {
    this.mappings = mappings.map((mapping) => ({
      internalUserId: mapping.internalUserId,
      roles: [...mapping.roles],
      identities: Object.fromEntries(
        Object.entries(mapping.identities).map(([platform, ids]) => [platform, ids ? [...ids] : undefined]),
      ),
    }));
  }

  resolve(identity: PlatformIdentity): ResolvedIdentity {
    const platformIdentity = normalizedPlatformIdentity(identity);
    const mapping = this.findMapping(platformIdentity);
    const internalUserId = mapping?.internalUserId ?? null;
    const roles = mapping ? [...mapping.roles] : ['PUBLIC' as const];
    const role = primaryRole(roles);
    return {
      platformIdentity,
      internalIdentity: internalUserId ? { internalUserId } : null,
      internalUserId,
      roles,
      role,
    };
  }

  isMapped(identity: PlatformIdentity): boolean {
    return this.findMapping(normalizedPlatformIdentity(identity)) !== undefined;
  }

  hasRole(identity: PlatformIdentity | AuthorizationIdentityLike, role: Role): boolean {
    const resolved = 'platformIdentity' in identity
      ? identity
      : this.resolve(identity);
    const roles = resolved.roles;
    if (role === 'PUBLIC') return true;
    if (role === 'TRUSTED') return roles.includes('TRUSTED') || roles.includes('ADMIN');
    return roles.includes('ADMIN');
  }

  authorize(input: AuthorizationRequest): AuthorizationDecision {
    const action = canonicalAction(String(input.action ?? '').trim());
    const role = primaryRole(input.identity.roles);
    const service = input.service;

    if (!action) {
      return { authorized: false, requiresConfirmation: false, role, action, reason: 'Action is not explicitly allowed' };
    }

    if (READ_ONLY_ACTIONS.has(action)) {
      if (action === 'status' || action === 'query') return { authorized: true, requiresConfirmation: false, role, action };
      if (!service || !service.allowedActions.includes(action)) {
        return {
          authorized: false,
          requiresConfirmation: false,
          role,
          action,
          reason: `Action ${action} is not explicitly allowlisted for this service`,
        };
      }
      return { authorized: true, requiresConfirmation: false, role, action };
    }

    if (!SIDE_EFFECT_ACTIONS.has(action as Action | 'organize_media')) {
      return { authorized: false, requiresConfirmation: false, role, action, reason: 'Action is not explicitly allowed' };
    }

    if (!service || !service.allowedActions.includes(action)) {
      return {
        authorized: false,
        requiresConfirmation: false,
        role,
        action,
        reason: `Action ${action} is not explicitly allowlisted for this service`,
      };
    }

    let roleAllowed = false;
    if (role === 'ADMIN') {
      roleAllowed = true;
    } else if (role === 'TRUSTED') {
      roleAllowed = action === 'organize_media'
        || ((action === 'start' || action === 'restart') && service.riskLevel === 'low');
    }

    if (!roleAllowed) {
      return {
        authorized: false,
        requiresConfirmation: false,
        role,
        action,
        reason: `${role} is not allowed to execute ${action} on ${service.serviceId}`,
      };
    }

    // Every side-effecting action is confirmed, including low-risk actions.
    if (input.confirmed !== true) {
      return {
        authorized: false,
        requiresConfirmation: true,
        role,
        action,
        reason: 'Explicit confirmation is required before executing a side-effecting action',
      };
    }

    return { authorized: true, requiresConfirmation: false, role, action };
  }

  private findMapping(identity: PlatformIdentity): IdentityMapping | undefined {
    return this.mappings.find((mapping) => mapping.identities[identity.platform]?.includes(identity.platformUserId));
  }
}

export function identityFromParts(
  platform: string,
  platformUserId: string,
  internalUserId: string | null,
  roles: readonly Role[],
): ResolvedIdentity {
  const platformIdentity = normalizedPlatformIdentity({ platform, platformUserId });
  const normalizedRoles = roles.length ? [...roles] : ['PUBLIC' as const];
  return {
    platformIdentity,
    internalIdentity: internalUserId ? { internalUserId } : null,
    internalUserId,
    roles: normalizedRoles,
    role: primaryRole(normalizedRoles),
  };
}

export function primaryRoleForIdentity(roles: readonly Role[]): Role {
  return primaryRole(roles);
}
