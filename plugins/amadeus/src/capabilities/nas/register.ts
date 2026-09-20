import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { configFor } from '../../config.js';
import { nas } from '../../nas.js';
import { registerTool } from '../../shared/register-tool.js';
import { Type } from 'typebox';

const NasParameters = Type.Object({
  action: Type.Union([Type.Literal('status'), Type.Literal('disk'), Type.Literal('sleep')]),
}, { additionalProperties: false });

export function registerNas(api: OpenClawPluginApi): void {
  registerTool(api, 'amadeus_nas', 'Read NAS status or disk usage, or put the Mac NAS to sleep. Sleep requires the trusted owner identity.', NasParameters, async (params, context, _notifier, signal) => nas(configFor(api), params.action, context, signal));
}
