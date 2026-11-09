import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { isOwnerDirectSession, onceLogger, ownerDigits } from './dm-digest.js';

/**
 * MEMORY.md is a bootstrap file injected into direct sessions generally. It holds the owner's private
 * memory, so it is dropped from every session except the verified owner's direct one. The check fails
 * closed: an unknown owner, an unknown session or any error removes the file.
 */
export const MEMORY_BOOTSTRAP_NAME = 'MEMORY.md';

interface BootstrapFileLike {
  name?: unknown;
}

export function isMemoryBootstrapFile(file: unknown): boolean {
  const name = (file as BootstrapFileLike | undefined)?.name;
  return typeof name === 'string' && name.trim().toLowerCase() === MEMORY_BOOTSTRAP_NAME.toLowerCase();
}

/** Keeps MEMORY.md only when `keep` is true; every other bootstrap file is untouched. */
export function filterMemoryBootstrap<T>(files: readonly T[], keep: boolean): T[] {
  return keep ? [...files] : files.filter((file) => !isMemoryBootstrapFile(file));
}

export interface MemoryOwnerOnlyDependencies {
  ownerDigits?: () => Promise<string | undefined>;
}

export function registerMemoryOwnerOnly(api: OpenClawPluginApi, dependencies: MemoryOwnerOnlyDependencies = {}): void {
  const resolveOwner = dependencies.ownerDigits ?? (() => ownerDigits(api));
  const logOnce = onceLogger(api);
  api.registerHook('agent:bootstrap', async (event) => {
    const context = event.context as { bootstrapFiles?: unknown[]; sessionKey?: unknown } | undefined;
    if (!context || !Array.isArray(context.bootstrapFiles)) return;
    let keep = false;
    try {
      keep = isOwnerDirectSession(context.sessionKey ?? event.sessionKey, await resolveOwner());
    } catch {
      keep = false;
    }
    const before = context.bootstrapFiles.length;
    context.bootstrapFiles = filterMemoryBootstrap(context.bootstrapFiles, keep);
    if (context.bootstrapFiles.length !== before) logOnce('amadeus memory bootstrap dropped for non-owner-dm session');
    else if (keep) logOnce('amadeus memory bootstrap kept for owner dm session');
  }, { name: 'amadeus-memory-owner-only' });
}
