import { RadarError } from '../errors.js';
import { isImplementedWatchType, mergeRules, normalizeRules, type ImplementedWatchType, type Watch, type WatchPatchInput, type WatchRules, type WatchTarget } from './model.js';

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RadarError(`${label} must be an object`, 'INVALID_REQUEST', 400);
  return value as Record<string, unknown>;
}

function sourceValue(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new RadarError('source is required', 'INVALID_REQUEST', 400);
  return value.trim().toLowerCase();
}

function intervalValue(value: unknown): number {
  if (value === undefined) return 900;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 30 || value > 86_400) {
    throw new RadarError('intervalSeconds must be an integer between 30 and 86400', 'INVALID_REQUEST', 400);
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
  const intervalSeconds = intervalValue(input.intervalSeconds);
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
  };
}

export function parseWatchPatch(value: unknown): WatchPatchInput {
  const input = objectValue(value, 'patch');
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new RadarError('enabled must be boolean', 'INVALID_REQUEST', 400);
  const intervalSeconds = input.intervalSeconds === undefined ? undefined : intervalValue(input.intervalSeconds);
  return {
    ...(input.rules === undefined ? {} : { rules: objectValue(input.rules, 'rules') }),
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    ...(intervalSeconds === undefined ? {} : { intervalSeconds }),
  };
}

export function applyWatchPatch(watch: Watch, patch: WatchPatchInput, updatedAt: string): Watch {
  const rules = patch.rules === undefined ? watch.rules : mergeRules(watch.type, watch.rules, patch.rules);
  return {
    ...watch,
    rules,
    ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
    ...(patch.intervalSeconds === undefined ? {} : { intervalSeconds: patch.intervalSeconds }),
    updatedAt,
  };
}
