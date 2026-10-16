export type GatePubgIntelligenceFlagStatus = 'disabled_unconfigured' | 'disabled_by_operator' | 'enabled_canary' | 'misconfigured';

export interface GatePubgIntelligenceCanaryConfig {
  enabled: boolean;
  status: GatePubgIntelligenceFlagStatus;
  /** Opaque tenant IDs are runtime configuration and must never be logged. */
  tenantIds: ReadonlySet<string>;
}

const TENANT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/** Fail-closed canary configuration. A global on switch without a tenant
 * allowlist is misconfigured and enables no queries. */
export function readGatePubgIntelligenceCanary(env: NodeJS.ProcessEnv): GatePubgIntelligenceCanaryConfig {
  const switchValue = env.GATE_PUBG_INTELLIGENCE_ENABLED;
  if (switchValue === undefined || switchValue.trim() === '') {
    return { enabled: false, status: 'disabled_unconfigured', tenantIds: new Set() };
  }
  if (switchValue === '0') return { enabled: false, status: 'disabled_by_operator', tenantIds: new Set() };
  if (switchValue !== '1') return { enabled: false, status: 'misconfigured', tenantIds: new Set() };
  const raw = env.GATE_PUBG_INTELLIGENCE_CANARY_TENANT_IDS;
  if (!raw?.trim()) return { enabled: false, status: 'misconfigured', tenantIds: new Set() };
  const values = raw.split(',').map((value) => value.trim());
  if (values.length > 20 || values.some((value) => !TENANT_ID.test(value)) || new Set(values).size !== values.length) {
    return { enabled: false, status: 'misconfigured', tenantIds: new Set() };
  }
  return { enabled: true, status: 'enabled_canary', tenantIds: new Set(values) };
}

export function gatePubgIntelligenceEnabledForTenant(config: GatePubgIntelligenceCanaryConfig, tenantId: string): boolean {
  return config.enabled && config.status === 'enabled_canary' && config.tenantIds.has(tenantId);
}
