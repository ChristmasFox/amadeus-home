import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { configFor } from '../../config.js';
import { homelabStatus } from '../../homelab.js';
import { registerTool } from '../../shared/register-tool.js';
import { Type } from 'typebox';

const HomeLabParameters = Type.Object({
  notifyOwner: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export function registerHomeLab(api: OpenClawPluginApi): void {
  registerTool(api, 'amadeus_homelab_status', 'Read current HomeLab host and service status. It never restarts or modifies services; notifyOwner is an explicit owner-only delivery request.', HomeLabParameters, async (params, context, notifier, signal) => homelabStatus(configFor(api), context, notifier, params.notifyOwner === true, signal));
}
