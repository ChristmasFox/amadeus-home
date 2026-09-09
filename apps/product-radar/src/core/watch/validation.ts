import { RadarError } from '../errors.js';
import { isImplementedWatchType, mergeRules, normalizeRules, type ImplementedWatchType, type Watch, type WatchPatchInput, type WatchRules, type WatchTarget } from './model.js';
import { defaultIntervalSeconds } from '../search/scheduling.js';
import type { SearchPlan } from '../search/model.js';
import type { TargetProfile } from '../target-profile/model.js';

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RadarError(`${label} must be an object`, 'INVALID_REQUEST', 400);
  return value as Record<string, unknown>;
}

function sourceValue(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new RadarError('source is required', 'INVALID_REQUEST', 400);
  return value.trim().toLowerCase();
}

function intervalValue(value: unknown, fallback = 900): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 30 || value > 86_400) {
    throw new RadarError('intervalSeconds must be an integer between 30 and 86400', 'INVALID_REQUEST', 400);
  }
  return value;
}

function heartbeatIntervalValue(value: unknown, fallback = 86_400): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 300 || value > 31_536_000) {
    throw new RadarError('heartbeatIntervalSeconds must be an integer between 300 and 31536000', 'INVALID_REQUEST', 400);
  }
  return value;
}

export interface ParsedWatchCreateInput {
  id?: string;
  source: string;
  type: ImplementedWatchType;
  target: WatchTarget;
  rules: WatchRules;
  enabled?: boolean;
  intervalSeconds: number;
  intervalSecondsExplicit: boolean;
  heartbeatEnabled: boolean;
  heartbeatIntervalSeconds: number;
  targetProfile?: TargetProfile;
  searchPlan?: SearchPlan;
}

export function parseWatchCreateInput(value: unknown): ParsedWatchCreateInput {
  const input = objectValue(value, 'watch');
  const source = sourceValue(input.source);
  const type = input.type;
  if (typeof type !== 'string' || !isImplementedWatchType(type)) {
    throw new RadarError('only seller, product, and similarity watch types are implemented in V0.2', 'UNSUPPORTED_CAPABILITY', 422, { type });
  }
  const target = objectValue(input.target, 'target') as WatchTarget;
  const rules = normalizeRules(type, input.rules);
  const intervalSeconds = intervalValue(input.intervalSeconds, defaultIntervalSeconds(type));
  const heartbeatEnabled = input.heartbeatEnabled === undefined ? type === 'similarity' : input.heartbeatEnabled;
  if (typeof heartbeatEnabled !== 'boolean') throw new RadarError('heartbeatEnabled must be boolean', 'INVALID_REQUEST', 400);
  const heartbeatIntervalSeconds = heartbeatIntervalValue(input.heartbeatIntervalSeconds);
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new RadarError('enabled must be boolean', 'INVALID_REQUEST', 400);
  const id = input.id === undefined ? undefined : String(input.id).trim();
  if (id !== undefined && !id) throw new RadarError('id cannot be empty', 'INVALID_REQUEST', 400);
  return {
    ...(id === undefined ? {} : { id }),
    source,
    type,
    target,
    rules,
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    intervalSeconds,
    intervalSecondsExplicit: input.intervalSeconds !== undefined,
    heartbeatEnabled,
    heartbeatIntervalSeconds,
    ...(input.targetProfile && typeof input.targetProfile === 'object' ? { targetProfile: input.targetProfile as TargetProfile } : {}),
    ...(input.searchPlan && typeof input.searchPlan === 'object' ? { searchPlan: input.searchPlan as SearchPlan } : {}),
  };
}

export function parseWatchPatch(value: unknown): WatchPatchInput {
  const input = objectValue(value, 'patch');
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new RadarError('enabled must be boolean', 'INVALID_REQUEST', 400);
  const intervalSeconds = input.intervalSeconds === undefined ? undefined : intervalValue(input.intervalSeconds);
  const heartbeatEnabled = input.heartbeatEnabled === undefined ? undefined : input.heartbeatEnabled;
  if (heartbeatEnabled !== undefined && typeof heartbeatEnabled !== 'boolean') throw new RadarError('heartbeatEnabled must be boolean', 'INVALID_REQUEST', 400);
  const heartbeatIntervalSeconds = input.heartbeatIntervalSeconds === undefined ? undefined : heartbeatIntervalValue(input.heartbeatIntervalSeconds);
  if (input.reanalyze !== undefined && typeof input.reanalyze !== 'boolean') throw new RadarError('reanalyze must be boolean', 'INVALID_REQUEST', 400);
  const target = input.target === undefined ? undefined : objectValue(input.target, 'target') as Partial<WatchTarget>;
  const targetProfile = input.targetProfile && typeof input.targetProfile === 'object' ? input.targetProfile as TargetProfile : undefined;
  return {
    ...(input.rules === undefined ? {} : { rules: objectValue(input.rules, 'rules') }),
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    ...(intervalSeconds === undefined ? {} : { intervalSeconds }),
    ...(heartbeatEnabled === undefined ? {} : { heartbeatEnabled }),
    ...(heartbeatIntervalSeconds === undefined ? {} : { heartbeatIntervalSeconds }),
    ...(target === undefined ? {} : { target }),
    ...(targetProfile === undefined ? {} : { targetProfile }),
    ...(input.reanalyze === undefined ? {} : { reanalyze: input.reanalyze }),
  };
}

export function applyWatchPatch(watch: Watch, patch: WatchPatchInput, updatedAt: string): Watch {
  const rules = patch.rules === undefined ? watch.rules : mergeRules(watch.type, watch.rules, patch.rules);
  return {
    ...watch,
    target: patch.target === undefined ? watch.target : { ...watch.target, ...patch.target },
    ...(patch.targetProfile === undefined ? {} : { targetProfile: patch.targetProfile }),
    rules,
    ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
    ...(patch.intervalSeconds === undefined ? {} : { intervalSeconds: patch.intervalSeconds }),
    ...(patch.heartbeatEnabled === undefined ? {} : { heartbeatEnabled: patch.heartbeatEnabled }),
    ...(patch.heartbeatIntervalSeconds === undefined ? {} : { heartbeatIntervalSeconds: patch.heartbeatIntervalSeconds }),
    updatedAt,
  };
}
