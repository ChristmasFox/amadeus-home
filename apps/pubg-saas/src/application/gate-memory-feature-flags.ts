export type GateMemoryFeatureFlagStatus =
  | 'enabled_default' | 'disabled_by_operator' | 'enabled_by_operator' | 'misconfigured';

export interface GateMemoryFeatureFlag {
  enabled: boolean;
  status: GateMemoryFeatureFlagStatus;
}

export interface GateMemoryFeatureFlags {
  read: GateMemoryFeatureFlag;
  write: GateMemoryFeatureFlag;
  autoLearn: GateMemoryFeatureFlag & { secondGate: 'per_user_consent' };
}

/** Memory is part of Gate by default. Environment variables are kill switches, not activation rituals. */
function featureFlag(value: string | undefined): GateMemoryFeatureFlag {
  if (value === undefined || value.trim() === '') return { enabled: true, status: 'enabled_default' };
  if (value === '0') return { enabled: false, status: 'disabled_by_operator' };
  if (value === '1') return { enabled: true, status: 'enabled_by_operator' };
  return { enabled: false, status: 'misconfigured' };
}

/**
 * Read and explicit write are on by default. Auto-learning capability is also
 * available by default, but it still cannot admit a user's messages until that
 * user explicitly opts in to Light/REM.
 */
export function readGateMemoryFeatureFlags(env: NodeJS.ProcessEnv): GateMemoryFeatureFlags {
  return {
    read: featureFlag(env.GATE_MEMORY_READ_ENABLED),
    write: featureFlag(env.GATE_MEMORY_WRITE_ENABLED),
    autoLearn: { ...featureFlag(env.GATE_MEMORY_AUTO_LEARN_ENABLED), secondGate: 'per_user_consent' },
  };
}

export type GateMemoryEmbeddingStatus =
  | 'disabled_unconfigured' | 'disabled_by_operator' | 'enabled_configured' | 'misconfigured';

/**
 * Embedding is capability-detected: a complete Gate embedding configuration is
 * used automatically. GATE_MEMORY_EMBEDDING_ENABLED=0 is an emergency kill
 * switch; =1 remains accepted for compatibility but is not required.
 */
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
