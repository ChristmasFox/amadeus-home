import { z } from 'zod';
import {
  ChatTypeSchema,
  PlatformIdSchema,
  PresentationModelSchema,
  type NormalizedBotMessage,
  type PresentationModel,
} from './contracts.js';
import { IdentityRegistry, type PermissionRole } from './identity.js';

export const WhoAmIRoleSchema = z.enum(['PUBLIC', 'TRUSTED', 'ADMIN', 'unbound']);
export type WhoAmIRole = z.infer<typeof WhoAmIRoleSchema>;

export const WhoAmIInfoSchema = z.object({
  platform: PlatformIdSchema,
  platformUserId: z.string().min(1),
  chatId: z.string().min(1),
  chatType: ChatTypeSchema,
  displayName: z.string().nullable(),
  internalUser: z.string().min(1),
  role: WhoAmIRoleSchema,
});
export type WhoAmIInfo = z.infer<typeof WhoAmIInfoSchema>;

const WHOAMI_COMMAND_PATTERN = /^\/whoami(?:@[A-Za-z0-9_]+)?\s*$/iu;
const UNKNOWN_PLATFORM_USER_IDS = new Set(['', 'unknown', 'undefined', 'null']);

export function isWhoAmICommand(value: unknown): boolean {
  return WHOAMI_COMMAND_PATTERN.test(String(value ?? '').trim());
}

function requiredPlatformUserId(message: NormalizedBotMessage): string {
  const platformUserId = message.user.platformUserId.trim();
  if (UNKNOWN_PLATFORM_USER_IDS.has(platformUserId.toLowerCase())) {
    throw new Error('whoami requires the platform event to provide a real platform user ID');
  }
  return platformUserId;
}

function primaryRole(roles: PermissionRole[]): PermissionRole {
  if (roles.includes('ADMIN')) return 'ADMIN';
  if (roles.includes('TRUSTED')) return 'TRUSTED';
  return 'PUBLIC';
}

export function resolveWhoAmI(
  message: NormalizedBotMessage,
  identityRegistry: IdentityRegistry = new IdentityRegistry(),
): WhoAmIInfo {
  const platformUserId = requiredPlatformUserId(message);
  const resolved = identityRegistry.resolve(message);
  const isBound = identityRegistry.isBound(message);
  return WhoAmIInfoSchema.parse({
    platform: message.platform,
    platformUserId,
    chatId: message.chat.id,
    chatType: message.chat.type,
    displayName: message.user.displayName?.trim() || null,
    internalUser: resolved.internalUserId ?? 'unbound',
    role: isBound ? primaryRole(resolved.roles) : 'unbound',
  });
}

export function formatWhoAmI(info: WhoAmIInfo): string {
  return [
    '/whoami',
    '',
    `platform: ${info.platform}`,
    `platformUserId: ${info.platformUserId}`,
    `chatId: ${info.chatId}`,
    `chatType: ${info.chatType}`,
    `displayName: ${info.displayName ?? 'unknown'}`,
    `internalUser: ${info.internalUser}`,
    `role: ${info.role}`,
  ].join('\n');
}

export function buildWhoAmIPresentation(
  message: NormalizedBotMessage,
  identityRegistry: IdentityRegistry = new IdentityRegistry(),
): PresentationModel {
  const info = resolveWhoAmI(message, identityRegistry);
  const fallbackText = formatWhoAmI(info);
  return PresentationModelSchema.parse({
    version: 1,
    type: 'whoami',
    title: '/whoami',
    sections: [{
      type: 'identity',
      title: 'platform identity',
      lines: fallbackText.split('\n').slice(2),
      data: info,
    }],
    fallbackText,
    metadata: {
      readOnly: true,
      mutatesState: false,
      executesAction: false,
      callsDangerousTool: false,
    },
  });
}
