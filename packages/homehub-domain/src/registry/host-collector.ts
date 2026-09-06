import type { HostHealth } from '../schema/types.js';
import {
  RuntimeExecutorManager,
  type CommandExecutor,
  type RuntimeExecutorManagerOptions,
} from '../execution/runtime-executor.js';

export interface HostCollectorOptions extends RuntimeExecutorManagerOptions {
  /** Deprecated compatibility fields; host collection no longer uses them. */
  orbHost?: string;
  orbUser?: string;
  executor?: CommandExecutor;
  execution?: RuntimeExecutorManager;
}

/** Collects real macOS host metrics only through MacHostAgent. */
export class HostCollector {
  private readonly execution: RuntimeExecutorManager;

  constructor(options: HostCollectorOptions = {}) {
    this.execution = options.execution ?? new RuntimeExecutorManager({
      ...options,
      ...(options.executor ? { executors: { ...(options.executors ?? {}), 'macos-host': options.executor } } : {}),
    });
  }

  /**
   * A failed observation returns null-valued metrics. Zero is reserved for a
   * measured zero, not for an unavailable executor or unreadable host field.
   */
  async collect(): Promise<HostHealth> {
    const result = await this.execution.execute('macos-host', {
      command: 'macos-agent',
      args: ['/v1/host/status'],
      timeoutMs: 10_000,
    });
    if (!result.ok) {
      return this.unknownHost(result.executorAvailable
        ? 'macOS host agent request failed'
        : 'macOS host agent unavailable; HomeHub container metrics are not host metrics');
    }

    try {
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
      const payload = this.record(parsed.host) ?? parsed;
      return this.normalize(payload);
    } catch {
      return this.unknownHost('macOS host agent returned invalid data');
    }
  }

  private normalize(parsed: Record<string, unknown>): HostHealth {
    const cpu = this.record(parsed.cpu) ?? {};
    const memory = this.record(parsed.memory) ?? {};
    const os = this.record(parsed.os);
    const power = this.record(parsed.power);
    const cloudflared = this.record(parsed.cloudflared);
    const disk = Array.isArray(parsed.disks)
      ? parsed.disks
      : Array.isArray(parsed.disk) ? parsed.disk : [];
    const network = Array.isArray(parsed.network) ? parsed.network : [];
    const processes = Array.isArray(parsed.highCpuProcesses)
      ? parsed.highCpuProcesses
      : Array.isArray(parsed.processes) ? parsed.processes : [];
    const load = Array.isArray(parsed.loadAverage) ? parsed.loadAverage : [];

    const status = parsed.status === 'available' || parsed.status === 'ok' ? 'available' : 'unknown';
    const unknownReason = status === 'unknown'
      ? this.text(parsed.unknownReason) ?? 'macOS host metrics unavailable'
      : undefined;

    return {
      status,
      ...(unknownReason ? { unknownReason } : {}),
      hostname: this.text(parsed.hostname) ?? 'unknown',
      ...(os ? {
        os: {
          name: this.text(os.name),
          version: this.text(os.version),
          build: this.text(os.build),
        },
      } : {}),
      ...(Object.prototype.hasOwnProperty.call(parsed, 'model') ? { model: this.text(parsed.model) } : {}),
      uptime: this.numberOrNull(parsed.uptime),
      loadAverage: [this.numberOrNull(load[0]), this.numberOrNull(load[1]), this.numberOrNull(load[2])],
      cpu: {
        usage: this.numberOrNull(cpu.usage),
        cores: this.numberOrNull(cpu.cores),
      },
      memory: {
        total: this.numberOrNull(memory.total),
        used: this.numberOrNull(memory.used),
        available: this.numberOrNull(memory.available),
        percentage: this.numberOrNull(memory.percentage),
      },
      disk: disk.map((entry) => {
        const value = this.record(entry) ?? {};
        return {
          mount: this.text(value.mount) ?? 'unknown',
          total: this.numberOrNull(value.total),
          used: this.numberOrNull(value.used),
          available: this.numberOrNull(value.available),
          percentage: this.numberOrNull(value.percentage),
        };
      }),
      ...(network.length ? {
        network: network.map((entry) => {
          const value = this.record(entry) ?? {};
          return {
            interface: this.text(value.interface) ?? 'unknown',
            bytesIn: this.numberOrNull(value.bytesIn),
            bytesOut: this.numberOrNull(value.bytesOut),
            ...(Object.prototype.hasOwnProperty.call(value, 'ip') ? { ip: this.text(value.ip) } : {}),
          };
        }),
      } : {}),
      ...(power ? {
        power: {
          source: this.text(power.source),
          percentage: this.numberOrNull(power.percentage),
          charging: typeof power.charging === 'boolean' ? power.charging : null,
          state: this.text(power.state),
        },
      } : {}),
      ...(cloudflared ? {
        cloudflared: {
          status: cloudflared.status === 'running' || cloudflared.status === 'stopped' ? cloudflared.status : 'unknown',
          pid: this.integerOrNull(cloudflared.pid),
          ...(Object.prototype.hasOwnProperty.call(cloudflared, 'version') ? { version: this.text(cloudflared.version) } : {}),
          ...(this.text(cloudflared.message) ? { message: this.text(cloudflared.message)! } : {}),
        },
      } : {}),
      ...(processes.length ? {
        highCpuProcesses: processes.map((entry) => {
          const value = this.record(entry) ?? {};
          return {
            pid: this.integerOrNull(value.pid),
            name: this.text(value.name) ?? 'unknown',
            cpu: this.numberOrNull(value.cpu),
            memory: this.numberOrNull(value.memory),
            ...(this.text(value.command) ? { command: this.text(value.command)! } : {}),
          };
        }),
      } : {}),
    };
  }

  private unknownHost(reason = 'macOS host agent unavailable; HomeHub container metrics are not host metrics'): HostHealth {
    return {
      status: 'unknown',
      unknownReason: reason,
      hostname: 'unknown',
      uptime: null,
      loadAverage: [null, null, null],
      cpu: { usage: null, cores: null },
      memory: { total: null, used: null, available: null, percentage: null },
      disk: [],
    };
  }

  private record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  }

  private text(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text || null;
  }

  private numberOrNull(value: unknown): number | null {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : null;
  }

  private integerOrNull(value: unknown): number | null {
    const number = this.numberOrNull(value);
    return number === null ? null : Math.trunc(number);
  }
}
