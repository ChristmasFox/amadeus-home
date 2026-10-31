import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { cachedOwnerDigits, DIGEST_DIR, isOwnerDirectSession, ownerDigits, resolveWorkspaceDir } from './dm-digest.js';

/**
 * Owner DM preferences: free text the owner keeps in a runtime file and that is loaded only into his own direct chat.
 * SOUL.md is injected into every session (groups included), so the content never lives in git or the seeds.
 */
export const OWNER_DM_PREFERENCES_FILE = 'owner-dm-preferences.md';
export const OWNER_DM_PREFERENCES_MAX_CHARS = 2000;

export function ownerDmPreferencesPath(workspaceDir: string): string {
  return join(workspaceDir, DIGEST_DIR, OWNER_DM_PREFERENCES_FILE);
}

/** Trimmed text capped at a line boundary so a bad file cannot blow up the prompt. */
export function capPreferences(text: string, maxChars = OWNER_DM_PREFERENCES_MAX_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const kept: string[] = [];
  let size = 0;
  for (const line of trimmed.split('\n')) {
    if (size + line.length + 1 > maxChars) break;
    kept.push(line);
    size += line.length + 1;
  }
  return (kept.length ? kept.join('\n') : trimmed.slice(0, maxChars)).trim();
}

export function readOwnerDmPreferences(workspaceDir: string): string | undefined {
  try {
    return capPreferences(readFileSync(ownerDmPreferencesPath(workspaceDir), 'utf8')) || undefined;
  } catch {
    return undefined;
  }
}

export interface OwnerDmPreferenceDependencies {
  ownerDigits?: () => Promise<string | undefined>;
}

export function registerOwnerDmPreferences(api: OpenClawPluginApi, dependencies: OwnerDmPreferenceDependencies = {}): void {
  const owner = cachedOwnerDigits(dependencies.ownerDigits ?? (() => ownerDigits(api)));
  api.on('before_prompt_build', (_event, context) => {
    try {
      const workspaceDir = resolveWorkspaceDir(api, context.workspaceDir);
      if (!workspaceDir || !isOwnerDirectSession(context.sessionKey, owner())) return;
      const text = readOwnerDmPreferences(workspaceDir);
      return text ? { appendSystemContext: text } : undefined;
    } catch {
      return undefined;
    }
  });
}
