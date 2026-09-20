import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { configFor } from '../../config.js';
import { kookGroupMembers } from '../../kook.js';
import { registerTool } from '../../shared/register-tool.js';
import { Type } from 'typebox';

const KookParameters = Type.Object({
  maxMembers: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
}, { additionalProperties: false });

export function registerKook(api: OpenClawPluginApi): void {
  registerTool(api, 'amadeus_kook_group_members', 'Read members of the active KOOK group/channel only. This is an interactive lookup and never a proactive notification path.', KookParameters, async (params, context, _notifier, signal) => kookGroupMembers(configFor(api), context, params.maxMembers ?? 200, signal));
}
