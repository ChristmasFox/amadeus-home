import type { NormalizedBotMessage, PlatformId, PlatformIdentity } from './contracts.js';

export type PermissionRole = 'PUBLIC' | 'TRUSTED' | 'ADMIN';

export interface IdentityMapping {
  internalUserId: string;
  roles: PermissionRole[];
  identities: Partial<Record<PlatformId, string[]>>;
}

export interface ResolvedIdentity {
  platformIdentity: PlatformIdentity;
  internalUserId: string | null;
  roles: PermissionRole[];
}

export class IdentityRegistry {
  private readonly mappings: IdentityMapping[];

  constructor(mappings: IdentityMapping[] = []) {
    this.mappings = mappings.map((mapping) => ({ ...mapping, roles: [...mapping.roles], identities: { ...mapping.identities } }));
  }

  resolve(message: NormalizedBotMessage): ResolvedIdentity {
    const mapping = this.mappings.find((candidate) => candidate.identities[message.platform]?.includes(message.user.platformUserId));
    const internalUserId = mapping?.internalUserId ?? message.user.internalUserId;
    return {
      platformIdentity: { ...message.user, internalUserId },
      internalUserId,
      roles: mapping?.roles ?? ['PUBLIC'],
    };
  }

  hasRole(message: NormalizedBotMessage, role: PermissionRole): boolean {
    const roles = this.resolve(message).roles;
    if (role === 'PUBLIC') return true;
    if (role === 'TRUSTED') return roles.includes('TRUSTED') || roles.includes('ADMIN');
    return roles.includes('ADMIN');
  }
}
