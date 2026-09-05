import {
  AuthorizationCore,
  type AuthorizationIdentityMapping,
  type InternalIdentity,
  type Role,
} from '@agent/homehub-domain';
import type { NormalizedBotMessage, PlatformIdentity } from './contracts.js';

export type PermissionRole = Role;
export type IdentityMapping = AuthorizationIdentityMapping;

export interface ResolvedIdentity {
  platformIdentity: PlatformIdentity;
  internalIdentity: InternalIdentity | null;
  internalUserId: string | null;
  roles: PermissionRole[];
  role: PermissionRole;
}

/**
 * Adapter-facing facade over the shared platform-neutral AuthorizationCore.
 * It accepts the normalized message, but only forwards platform + stable user
 * ID; display names and any inbound internalUserId are never authorization
 * inputs.
 */
export class IdentityRegistry {
  private readonly core: AuthorizationCore;

  constructor(mappings: IdentityMapping[] = []) {
    this.core = new AuthorizationCore(mappings);
  }

  get authorizationCore(): AuthorizationCore {
    return this.core;
  }

  resolve(message: NormalizedBotMessage): ResolvedIdentity {
    const resolved = this.core.resolve({
      platform: message.platform,
      platformUserId: message.user.platformUserId,
    });
    return {
      platformIdentity: {
        ...message.user,
        // Never carry an inbound internal identity across the trust boundary.
        internalUserId: resolved.internalUserId,
      },
      internalIdentity: resolved.internalIdentity,
      internalUserId: resolved.internalUserId,
      roles: [...resolved.roles],
      role: resolved.role,
    };
  }

  /**
   * Read-only mapping existence check. It deliberately uses only the stable
   * platform identity, never display names or a supplied internal user ID.
   */
  isBound(message: NormalizedBotMessage): boolean {
    return this.core.isMapped({
      platform: message.platform,
      platformUserId: message.user.platformUserId,
    });
  }

  hasRole(message: NormalizedBotMessage, role: PermissionRole): boolean {
    return this.core.hasRole({
      platformIdentity: {
        platform: message.platform,
        platformUserId: message.user.platformUserId,
      },
      roles: this.resolve(message).roles,
    }, role);
  }
}
