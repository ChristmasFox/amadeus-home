import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { Type } from 'typebox';
import { configFor } from '../../config.js';
import { macHostProcesses, macHostStatus } from '../../machost.js';
import { registerTool } from '../../shared/register-tool.js';

const EmptyParameters = Type.Object({}, { additionalProperties: false });

export function registerMacosHost(api: OpenClawPluginApi): void {
  registerTool(api, 'amadeus_macos_host_status', 'Read bounded, owner-authorized read-only telemetry from the real Amadeus-M204 macOS host. It has no shell or control operation.', EmptyParameters, async (_params, context, _notifier, signal) => macHostStatus(configFor(api), context, signal));
  registerTool(api, 'amadeus_macos_host_processes', 'Read the bounded top CPU and memory processes from the real Amadeus-M204 macOS host. It has no arbitrary command endpoint.', EmptyParameters, async (_params, context, _notifier, signal) => macHostProcesses(configFor(api), context, signal));
}
