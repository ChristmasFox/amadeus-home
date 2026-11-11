import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';

/**
 * The group tool set is the same for every sender, so the tool definitions never change with who is talking and the
 * cached prompt prefix stays valid. These tools used to exist only for the owner (a per-sender tool list); they are now
 * defined for everyone and refused here, when they run, for any sender the host did not resolve as the owner.
 * Must equal GROUP_OWNER_EXTRA_TOOL_ALLOWLIST in scripts/openclaw_prepare.py (a test keeps them in sync).
 */
export const GROUP_OWNER_ONLY_TOOLS: readonly string[] = [
  'identity_resolve',
  'identity_add_alias',
  'amadeus_remember',
  'view_image',
  'amadeus_image_upscale',
  'amadeus_web_image',
  'memory_search',
  'memory_get',
];

export const GROUP_OWNER_ONLY_REASON = 'This tool is only available to the owner. Do not retry it; answer the user without it and, if it matters, say it is owner-only.';

const OWNER_ONLY = new Set(GROUP_OWNER_ONLY_TOOLS);

/** Group or channel conversations only; direct and cron sessions are governed by the global sender policy. */
export function isGroupSession(sessionKey: string | undefined): boolean {
  const key = (sessionKey ?? '').toLowerCase();
  return key.includes(':group:') || key.includes(':channel:');
}

/** Fails closed: in a group, only a sender the host resolved as owner may run an owner-only tool. */
export function groupOwnerGateVerdict(toolName: string, sessionKey: string | undefined, senderIsOwner: boolean | undefined): { block: true; blockReason: string } | undefined {
  if (!OWNER_ONLY.has(toolName) || !isGroupSession(sessionKey)) return undefined;
  if (senderIsOwner === true) return undefined;
  return { block: true, blockReason: GROUP_OWNER_ONLY_REASON };
}

export function registerGroupOwnerGate(api: OpenClawPluginApi): void {
  api.on('before_tool_call', (event, context) => {
    const verdict = groupOwnerGateVerdict(event.toolName, context.sessionKey, context.requester?.senderIsOwner);
    if (verdict) api.logger.info(`group owner gate refused ${event.toolName} for a non-owner sender`);
    return verdict;
  });
}
