export type GateMemoryFeatureFlagStatus =
  | 'enabled_default' | 'disabled_by_operator' | 'enabled_by_operator' | 'misconfigured';

export interface GateMemoryFeatureFlag {
  enabled: boolean;
  status: GateMemoryFeatureFlagStatus;
}

export interface GateMemoryFeatureFlags {
  read: GateMemoryFeatureFlag;
  write: GateMemoryFeatureFlag;
  autoLearn: GateMemoryFeatureFlag;
}

function featureFlag(value: string | undefined, enabledByDefault: boolean): GateMemoryFeatureFlag {
  if (value === undefined || value.trim() === '') {
    return { enabled: enabledByDefault, status: enabledByDefault ? 'enabled_default' : 'disabled_by_operator' };
  }
  if (value === '0') return { enabled: false, status: 'disabled_by_operator' };
  if (value === '1') return { enabled: true, status: 'enabled_by_operator' };
  return { enabled: false, status: 'misconfigured' };
}

/** Memory is part of Gate by default. Flags are explicit kill switches. */
export function readGateMemoryFeatureFlags(env: NodeJS.ProcessEnv): GateMemoryFeatureFlags {
  return {
    read: featureFlag(env.GATE_MEMORY_READ_ENABLED, MEMORY_FEATURE_DEFAULTS.read),
    write: featureFlag(env.GATE_MEMORY_WRITE_ENABLED, MEMORY_FEATURE_DEFAULTS.write),
    autoLearn: featureFlag(env.GATE_MEMORY_AUTO_LEARN_ENABLED, MEMORY_FEATURE_DEFAULTS.autoLearn),
  };
}

export type GateMemoryEmbeddingStatus =
  | 'disabled_unconfigured' | 'disabled_by_operator' | 'enabled_configured' | 'misconfigured';

/** A complete embedding configuration is used automatically; =0 is the kill switch. */
export function gateMemoryEmbeddingStatus(
  env: NodeJS.ProcessEnv,
  validate: (env: NodeJS.ProcessEnv) => unknown,
): GateMemoryEmbeddingStatus {
  if (env.GATE_MEMORY_EMBEDDING_ENABLED === '0') return 'disabled_by_operator';
  try {
    return validate(env) === null ? 'disabled_unconfigured' : 'enabled_configured';
  } catch {
    return 'misconfigured';
  }
}
import { MEMORY_FEATURE_DEFAULTS } from '@agent/memory';
