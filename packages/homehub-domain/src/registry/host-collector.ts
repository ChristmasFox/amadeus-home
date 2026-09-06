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

/** Collects host metrics only through an explicit macOS host executor. */
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
   * measured zero, not for an unavailable executor or unreadable /proc file.
   */
  async collect(): Promise<HostHealth> {
    const result = await this.execution.execute('macos-host', {
      command: 'bash',
      args: ['-lc', this.collectScript()],
      timeoutMs: 10_000,
    });
    if (!result.ok) return this.unknownHost(result.executorAvailable
      ? 'macOS host metric collection failed'
      : 'macOS executor unavailable; HomeHub container metrics are not host metrics');

    try {
      return this.normalize(JSON.parse(result.stdout) as Record<string, unknown>);
    } catch {
      return this.unknownHost('macOS host metric collection returned invalid data');
    }
  }

  private collectScript(): string {
    return `python3 - <<'PY'
import json
import os
import time

result = {
    'status': 'available',
    'hostname': None,
    'uptime': None,
    'loadAverage': [None, None, None],
    'cpu': {'usage': None, 'cores': None},
    'memory': {'total': None, 'used': None, 'available': None, 'percentage': None},
    'disk': [],
}

try:
    result['hostname'] = os.uname().nodename
except OSError:
    pass

try:
    with open('/proc/uptime') as handle:
        result['uptime'] = int(float(handle.read().split()[0]))
except (OSError, IndexError, ValueError):
    pass

try:
    result['loadAverage'] = [float(value) for value in os.getloadavg()[:3]]
except (OSError, ValueError):
    pass

try:
    with open('/proc/stat') as handle:
        first = handle.readline().split()[1:]
    total0 = sum(int(value) for value in first[:8])
    busy0 = sum(int(value) for value in first[:4])
    time.sleep(0.2)
    with open('/proc/stat') as handle:
        second = handle.readline().split()[1:]
    total1 = sum(int(value) for value in second[:8])
    busy1 = sum(int(value) for value in second[:4])
    total_delta = total1 - total0
    busy_delta = busy1 - busy0
    if total_delta > 0:
        result['cpu']['usage'] = round(100.0 * busy_delta / total_delta, 1)
except (OSError, IndexError, ValueError):
    pass

try:
    result['cpu']['cores'] = os.cpu_count()
except (OSError, ValueError):
    pass

try:
    memory = {}
    with open('/proc/meminfo') as handle:
        for line in handle:
            key, value, *_ = line.split()
            memory[key.rstrip(':')] = int(value) * 1024
    total = memory.get('MemTotal')
    available = memory.get('MemAvailable')
    if total is not None and available is not None:
        result['memory'] = {
            'total': total,
            'used': total - available,
            'available': available,
            'percentage': round(100.0 * (total - available) / total, 1) if total else None,
        }
except (OSError, IndexError, ValueError):
    pass

for mount in ('/', '/DATA', '/Volumes/Avalon'):
    try:
        stat = os.statvfs(mount)
        total = stat.f_blocks * stat.f_frsize
        available = stat.f_bavail * stat.f_frsize
        used = total - available
        result['disk'].append({
            'mount': mount,
            'total': total,
            'used': used,
            'available': available,
            'percentage': round(100.0 * used / total, 1) if total else None,
        })
    except OSError:
        pass

print(json.dumps(result))
PY`;
  }

  private normalize(parsed: Record<string, unknown>): HostHealth {
    const cpu = this.record(parsed.cpu);
    const memory = this.record(parsed.memory);
    const disk = Array.isArray(parsed.disk) ? parsed.disk.map((value) => this.record(value)) : [];
    const load = Array.isArray(parsed.loadAverage) ? parsed.loadAverage : [];

    const status = parsed.status === 'available' ? 'available' : 'unknown';
    const unknownReason = status === 'unknown'
      ? this.text(parsed.unknownReason) ?? 'macOS host metrics unavailable'
      : undefined;

    return {
      status,
      ...(unknownReason ? { unknownReason } : {}),
      hostname: this.text(parsed.hostname) ?? 'unknown',
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
      disk: disk.map((entry) => ({
        mount: this.text(entry.mount) ?? 'unknown',
        total: this.numberOrNull(entry.total),
        used: this.numberOrNull(entry.used),
        available: this.numberOrNull(entry.available),
        percentage: this.numberOrNull(entry.percentage),
      })),
    };
  }

  private unknownHost(reason = 'macOS host executor unavailable; HomeHub container metrics are not host metrics'): HostHealth {
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

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private text(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text || null;
  }

  private numberOrNull(value: unknown): number | null {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : null;
  }
}
