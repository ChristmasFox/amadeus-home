import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';

const HOST_TELEMETRY_BLOCK_REASON =
  'M204 host telemetry must come from amadeus_macos_host_status or amadeus_macos_host_processes; exec/web_fetch guest or raw HTTP output is not host data.';

const HOST_SHELL_PROBE = /(?:\bfree(?:\s|$)|\/proc\/(?:loadavg|meminfo|stat|vmstat)\b|\buptime\b|\b(?:vm_stat|memory_pressure|powermetrics|diskutil|df|iostat)\b|\b(?:ps|top)\s+(?:-?[a-z]|aux|-[^-]))/iu;
const HOST_AGENT_HTTP_PROBE = /(?:host\.docker\.internal|127\.0\.0\.1|localhost)(?::18791)?\/v1\/(?:status|history|processes|anomalies)\b|:18791\/v1\/(?:status|history|processes|anomalies)\b/iu;

function firstString(params: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    if (typeof params[key] === 'string') return params[key] as string;
  }
  return '';
}

export function isMacHostShellProbe(command: string): boolean {
  return HOST_SHELL_PROBE.test(command);
}

export function isMacHostAgentHttpProbe(url: string): boolean {
  return HOST_AGENT_HTTP_PROBE.test(url);
}

export function registerMacosHostToolGuard(api: OpenClawPluginApi): void {
  api.on('before_tool_call', (event) => {
    if (event.toolName === 'exec') {
      const command = firstString(event.params, ['command', 'cmd', 'script', 'input']);
      if (isMacHostShellProbe(command)) {
        api.logger.warn('blocked guest shell host telemetry probe; native MacHostAgent is required');
        return { block: true, blockReason: HOST_TELEMETRY_BLOCK_REASON };
      }
    }
    if (event.toolName === 'web_fetch') {
      const url = firstString(event.params, ['url', 'target']);
      if (isMacHostAgentHttpProbe(url)) {
        api.logger.warn('blocked raw MacHostAgent HTTP probe; native MacHostAgent tool is required');
        return { block: true, blockReason: HOST_TELEMETRY_BLOCK_REASON };
      }
    }
    return undefined;
  });
}
