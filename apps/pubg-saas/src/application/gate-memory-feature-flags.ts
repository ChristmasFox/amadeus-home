export type GateMemoryFeatureFlagStatus =
  | 'disabled_missing' | 'disabled_by_operator' | 'enabled_by_operator' | 'misconfigured';

export interface GateMemoryFeatureFlag {
  enabled: boolean;
  status: GateMemoryFeatureFlagStatus;
}

export interface GateMemoryFeatureFlags {
  read: GateMemoryFeatureFlag;
  write: GateMemoryFeatureFlag;
  autoLearn: GateMemoryFeatureFlag & { secondGate: 'per_user_consent' };
}

function featureFlag(value: string | undefined): GateMemoryFeatureFlag {
  if (value === undefined || value.trim() === '') return { enabled: false, status: 'disabled_missing' };
  if (value === '0') return { enabled: false, status: 'disabled_by_operator' };
  if (value === '1') return { enabled: true, status: 'enabled_by_operator' };
  return { enabled: false, status: 'misconfigured' };
}

/** Operator flags are independent; auto-learning still needs each user's consent. */
export function readGateMemoryFeatureFlags(env: NodeJS.ProcessEnv): GateMemoryFeatureFlags {
  return {
    read: featureFlag(env.GATE_MEMORY_READ_ENABLED),
    write: featureFlag(env.GATE_MEMORY_WRITE_ENABLED),
    autoLearn: { ...featureFlag(env.GATE_MEMORY_AUTO_LEARN_ENABLED), secondGate: 'per_user_consent' },
  };
}

export type GateMemoryEmbeddingStatus =
  | 'disabled_missing' | 'disabled_by_operator' | 'enabled_configured' | 'misconfigured';

/** Reports readiness without returning or logging any embedding configuration values. */
export function gateMemoryEmbeddingStatus(
  env: NodeJS.ProcessEnv,
  validate: (env: NodeJS.ProcessEnv) => unknown,
): GateMemoryEmbeddingStatus {
  const value = env.GATE_MEMORY_EMBEDDING_ENABLED;
  if (value === undefined || value.trim() === '') return 'disabled_missing';
  if (value === '0') return 'disabled_by_operator';
  if (value !== '1') return 'misconfigured';
  try {
    validate(env);
    return 'enabled_configured';
  } catch {
    return 'misconfigured';
  }
}
