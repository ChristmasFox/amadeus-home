import type { IdentityMapping } from '../platform/core/identity.js';

export const TELEGRAM_ADMIN_USER_ID_ENV = 'TELEGRAM_ADMIN_USER_ID' as const;
export const KOOK_ADMIN_USER_ID_ENV = 'KOOK_ADMIN_USER_ID' as const;
export const ADMIN_INTERNAL_USER_ID = 'arthur' as const;

const EMPTY_OR_PLACEHOLDER_IDS = new Set(['', 'unknown', 'undefined', 'null']);

function configuredPlatformUserId(value: string | undefined): string | undefined {
  const normalized = value?.trim() ?? '';
  return EMPTY_OR_PLACEHOLDER_IDS.has(normalized.toLowerCase()) ? undefined : normalized;
}

/**
 * Build startup-only identity mappings from external environment configuration.
 * The environment values are platform IDs, not names; no binding or persistence
 * occurs here. Missing values intentionally produce no mapping for that platform.
 */
export function identityMappingsFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): IdentityMapping[] {
  const telegramUserId = configuredPlatformUserId(environment[TELEGRAM_ADMIN_USER_ID_ENV]);
  const kookUserId = configuredPlatformUserId(environment[KOOK_ADMIN_USER_ID_ENV]);
  const identities: IdentityMapping['identities'] = {};
  if (telegramUserId) identities.telegram = [telegramUserId];
  if (kookUserId) identities.kook = [kookUserId];
  if (Object.keys(identities).length === 0) return [];

  return [{
    internalUserId: ADMIN_INTERNAL_USER_ID,
    roles: ['ADMIN'],
    identities,
  }];
}

export const identityMappingsFromEnv = identityMappingsFromEnvironment;
