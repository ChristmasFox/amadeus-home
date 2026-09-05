import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { HostHealth } from '../schema/types.js';

const execAsync = promisify(exec);

export interface HostCollectorOptions {
  orbHost?: string;
  orbUser?: string;
}

export class HostCollector {
  private options: Required<HostCollectorOptions>;

  constructor(options: HostCollectorOptions = {}) {
    this.options = {
      orbHost: options.orbHost ?? 'ubuntu',
      orbUser: options.orbUser ?? 'root',
    };
  }

  /**
   * Collect host health metrics.
   *
   * When running inside the ubuntu container directly this reads /proc.
   * Otherwise it shells out through orb to the ubuntu machine. Both paths
   * fail safe to an "unknown" structure rather than throwing.
   */
  async collect(): Promise<HostHealth> {
    try {
      const cmd = this.buildCollectCommand();
      const { stdout } = await execAsync(cmd, { timeout: 10_000, shell: '/bin/bash' });
      const parsed = JSON.parse(stdout) as Record<string, unknown>;
      return this.normalize(parsed);
    } catch {
      return this.unknownHost();
    }
  }

  private buildCollectCommand(): string {
    const script = `
set -e
CORES=$(nproc 2>/dev/null || echo 1)
LOAD=$(cat /proc/loadavg 2>/dev/null || echo '0 0 0')
read -r L1 L2 L3 _rest <<< "$LOAD"
MEM_TOTAL=$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null || echo 0)
MEM_AVAIL=$(awk '/MemAvailable/{print $2}' /proc/meminfo 2>/dev/null || echo 0)
MEM_TOTAL_KB=$((MEM_TOTAL))
MEM_AVAIL_KB=$((MEM_AVAIL))
DISKS=$(python3 - <<'PY'
import json, os
out=[]
for m in ('/', '/DATA', '/Volumes/Avalon'):
    try:
        s=os.statvfs(m)
        total=s.f_blocks*s.f_frsize
        free=s.f_bavail*s.f_frsize
        used=total-free
        out.append({'mount': m, 'total': total, 'used': used, 'available': free, 'percentage': round(used/total*100,1) if total else 0})
    except OSError:
        pass
print(json.dumps(out))
PY
)
CPU_USAGE=$(python3 - <<'PY'
import time, os
def read():
    with open('/proc/stat') as f:
        parts=f.readline().split()[1:]
    return sum(map(int, parts[:8])), sum(map(int, parts[:4]))
t0,c0=read(); time.sleep(0.2); t1,c1=read()
dt=t1-t0; dc=c1-c0
print(round(100.0*dc/dt,1) if dt else 0)
PY
)
HOSTNAME=$(hostname 2>/dev/null || echo ubuntu)
UPTIME=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0)
python3 -c "
import json
mem_total_kb=$MEM_TOTAL_KB; mem_avail_kb=$MEM_AVAIL_KB
mem_total=mem_total_kb*1024; mem_avail=mem_avail_kb*1024
print(json.dumps({
  'hostname': '$HOSTNAME',
  'uptime': $UPTIME,
  'loadAverage': [$L1,$L2,$L3],
  'cpu': {'usage': $CPU_USAGE, 'cores': $CORES},
  'memory': {'total': mem_total, 'used': mem_total-mem_avail, 'available': mem_avail, 'percentage': round(100.0*(mem_total-mem_avail)/mem_total,1) if mem_total else 0},
  'disk': $DISKS
}))
"
`;
    return `orb -m ${this.options.orbHost} -u ${this.options.orbUser} bash -lc ${JSON.stringify(script)}`;
  }

  private normalize(parsed: Record<string, unknown>): HostHealth {
    const cpu = parsed.cpu as Record<string, unknown> | undefined;
    const memory = parsed.memory as Record<string, unknown> | undefined;
    const disk = Array.isArray(parsed.disk) ? parsed.disk as Array<Record<string, unknown>> : [];
    const load = Array.isArray(parsed.loadAverage) ? parsed.loadAverage as unknown[] : [];

    return {
      hostname: String(parsed.hostname ?? 'ubuntu'),
      uptime: this.num(parsed.uptime, 0),
      loadAverage: [this.num(load[0], 0), this.num(load[1], 0), this.num(load[2], 0)],
      cpu: {
        usage: this.num(cpu?.usage, 0),
        cores: this.num(cpu?.cores, 1),
      },
      memory: {
        total: this.num(memory?.total, 0),
        used: this.num(memory?.used, 0),
        available: this.num(memory?.available, 0),
        percentage: this.num(memory?.percentage, 0),
      },
      disk: disk.map((d) => ({
        mount: String(d.mount ?? '/'),
        total: this.num(d.total, 0),
        used: this.num(d.used, 0),
        available: this.num(d.available, 0),
        percentage: this.num(d.percentage, 0),
      })),
    };
  }

  private unknownHost(): HostHealth {
    return {
      hostname: 'unknown',
      uptime: 0,
      loadAverage: [0, 0, 0],
      cpu: { usage: 0, cores: 0 },
      memory: { total: 0, used: 0, available: 0, percentage: 0 },
      disk: [],
    };
  }

  private num(value: unknown, fallback: number): number {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
}
