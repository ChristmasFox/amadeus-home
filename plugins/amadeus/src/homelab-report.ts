/**
 * The M204 status card sent to the owner's WhatsApp, rendered from MacHostAgent facts.
 *
 * The text is Markdown: OpenClaw's WhatsApp send path re-renders `**bold**` as WhatsApp bold, so bold is always
 * `**…**`, emoji stay outside the markers, and a bold span is followed by a space, a newline or the end.
 * Units are binary and labelled as such (GiB/TiB, see shared/units): the agent's capacity strings are 1024-based but say "GB".
 */

import { capacityGiB, formatCapacity } from './shared/units.js';

const REPORT_TIMEZONE = 'Asia/Shanghai';

type Row = Record<string, unknown>;

export interface HomelabReportInput {
  host: Row;
  unavailable: boolean;
  conclusion: string;
  /** Local services, OpenWrt excluded. */
  services: Record<string, boolean>;
  routerOk: boolean;
  anomalies: unknown[];
}

function row(value: unknown): Row {
  return value && typeof value === 'object' ? value as Row : {};
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function percent(value: unknown, digits = 0): string {
  const number = finite(value);
  return number === null ? '未知' : `${number.toFixed(digits)}%`;
}

function localStamp(iso: unknown): string | null {
  if (typeof iso !== 'string' || !Number.isFinite(Date.parse(iso))) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: REPORT_TIMEZONE, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function clock(iso: unknown): string | null {
  return localStamp(iso)?.slice(6) ?? null;
}

const PRESSURE: Record<string, string> = { normal: '正常', warn: '偏高', warning: '偏高', critical: '紧张' };

function swapChange(text: unknown, since: unknown): string {
  const gib = capacityGiB(text);
  const from = clock(since);
  const base = from ? `较今日 ${from}` : '较统计起点';
  if (gib === null) return '';
  if (Math.abs(gib) < 0.005) return `，${base} 基本持平`;
  return `，${base} ${gib < 0 ? '减少' : '增加'} ${formatCapacity(Math.abs(gib))}`;
}

function wattText(milliwatts: number): string {
  return milliwatts >= 1000 ? `${(milliwatts / 1000).toFixed(2)} W` : `${Math.round(milliwatts)} mW`;
}

/**
 * powermetrics' SoC figure is only trustworthy when every subsystem reported. On this host the CPU and ANE
 * columns read a constant 0 mW while the CPU is busy, so the sum is the GPU alone (about 0.1 W) and a CPU
 * under load cannot be drawing nothing: that reading is dropped rather than shown as the host's power.
 */
export function socPowerReliable(power: Row, cpuPercent: number | null): boolean {
  if (power.status !== 'ok' || finite(power.socPowerMw) === null) return false;
  const cpuMw = finite(power.cpuPowerMw);
  if (cpuMw === null) return false;
  return cpuMw > 0.5 || (cpuPercent !== null && cpuPercent < 2);
}

function powerLine(power: Row, summary: Row, cpuPercent: number | null): string {
  if (!socPowerReliable(power, cpuPercent)) {
    return '⚡ 功耗：**暂无可靠数据** — SoC 采样只读到 GPU（CPU 项恒为 0），整机功耗需外接电表';
  }
  const watts = (value: unknown): string => { const number = finite(value); return number === null ? '未知' : wattText(number * 1000); };
  return `⚡ 功耗：SoC 约 **${wattText(Number(power.socPowerMw))}** · 今日均值 ${watts(summary.avg)} · 峰值 ${watts(summary.max)}（仅 SoC 估算，非整机）`;
}

function diskLine(name: string, disk: Row): string {
  const used = capacityGiB(disk.used);
  const total = capacityGiB(disk.total);
  const free = capacityGiB(disk.free);
  const usedPercent = finite(disk.usedPercent);
  const full = usedPercent !== null && usedPercent >= 95 ? ' ⚠️ 空间紧张' : '';
  const mounted = disk.mounted === true;
  if (!mounted) return `• ${name}：**未挂载**`;
  const usage = used !== null && total !== null
    ? `已用 ${formatCapacity(used)} / ${formatCapacity(total)}（${percent(usedPercent)}）`
    : '容量未知';
  return `• ${name}：${usage} · 剩余 **${formatCapacity(free)}**${full}`;
}

export function renderHomelabReport(input: HomelabReportInput): string {
  const { host, services } = input;
  const cpu = row(host.cpu);
  const memory = row(host.memory);
  const swap = row(memory.swap);
  const disks = row(host.disks);
  const history = row(host.history);
  const metrics = row(history.metrics);
  const cpuSummary = row(metrics.cpu);
  const swapSummary = row(metrics.swap);
  const powerSummary = row(metrics.powerWatts);
  const cpuNow = finite(cpu.utilizationPercent);

  const cpuPeakAt = localStamp(cpuSummary.maxAt);
  const cpuDetail = [
    `今日均值 ${percent(cpuSummary.avg, 1)}`, `P95 ${percent(cpuSummary.p95, 1)}`,
    `峰值 ${percent(cpuSummary.max, 1)}${cpuPeakAt ? `（${cpuPeakAt}）` : ''}`,
  ].join(' · ');
  const memoryLine = `• 内存：**${formatCapacity(capacityGiB(memory.used))}** / ${formatCapacity(capacityGiB(memory.total))}（${percent(memory.usedPercent)}） · 压力${PRESSURE[String(memory.pressure)] ?? String(memory.pressure ?? '未知')}`;
  const hostLines = input.unavailable
    ? ['• 宿主机遥测暂不可用']
    : [
      `• CPU：**${percent(cpuNow, 1)}** · ${cpuDetail}`,
      memoryLine,
      `• Swap：${formatCapacity(capacityGiB(swap.used))} / ${formatCapacity(capacityGiB(swap.total))}${swapChange(swapSummary.delta, history.windowStart)}`,
      `• ${powerLine(row(host.power), powerSummary, cpuNow)}`,
    ];

  const okServices = Object.entries(services).filter(([, ok]) => ok).map(([name]) => name);
  const badServices = Object.entries(services).filter(([, ok]) => !ok).map(([name]) => name);
  const serviceLines = [
    ...(okServices.length ? [`• ✅ ${okServices.join('、')}`] : []),
    ...(badServices.length ? [`• ⚠️ **${badServices.join('、')}** 无响应`] : []),
    `• ${input.routerOk ? '✅' : '⚠️'} 路由器（OpenWrt 独立入口）${input.routerOk ? '可达' : '**无响应**'}`,
  ];
  const anomalyLines = input.anomalies.length
    ? input.anomalies.map((item) => `• ${String(row(item).summary ?? '未知异常')}`)
    : ['• 无'];

  return [
    `**结论：** ${input.conclusion}`,
    '',
    '💻 **宿主机**', ...hostLines,
    '',
    '💾 **存储**',
    diskLine('Macintosh HD', row(disks.internal)),
    diskLine('Avalon', row(disks.avalon)),
    '',
    '🧩 **服务**', ...serviceLines,
    '',
    '🔍 **异常**', ...anomalyLines,
  ].join('\n');
}
