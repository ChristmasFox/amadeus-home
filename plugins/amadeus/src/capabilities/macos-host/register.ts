import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { Type } from 'typebox';
import { configFor } from '../../config.js';
import { macHostProcesses, macHostStatus } from '../../machost.js';
import { registerTool } from '../../shared/register-tool.js';
import { registerMacosHostToolGuard } from './tool-guard.js';

// OpenClaw models commonly attach a short audit reason to read-only calls.
// Accepting it keeps the host tool strict while avoiding a schema rejection
// after the guest-shell guard redirects the model to the native capability.
const MacosHostParameters = Type.Object({
  reason: Type.Optional(Type.String({ maxLength: 200 })),
}, { additionalProperties: false });

export function registerMacosHost(api: OpenClawPluginApi): void {
  registerMacosHostToolGuard(api);
  registerTool(api, 'amadeus_macos_host_status', 'Read bounded, read-only telemetry from the configured operator macOS host in owner or group query contexts. It has no shell or control operation.', MacosHostParameters, async (_params, context, _notifier, signal) => macHostStatus(configFor(api), context, signal));
  registerTool(api, 'amadeus_macos_host_processes', 'Read bounded top CPU and memory processes from the configured operator macOS host in owner or group query contexts. It has no arbitrary command endpoint.', MacosHostParameters, async (_params, context, _notifier, signal) => macHostProcesses(configFor(api), context, signal));
}
