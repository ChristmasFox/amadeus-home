import type { OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import { adaptWorldlineNotification } from '@agent/presentation';
import type { AmadeusConfig } from './config.js';
import { assertMacHostQueryContext, isGroupContext, macHostStatus } from './machost.js';
import { requestJson } from './http.js';
import { isTrustedOwnerContext, ownerEventForContext, type OwnerNotifier } from './owner.js';

function healthy(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return item.statusCode === undefined ? true : Number(item.statusCode) >= 200 && Number(item.statusCode) < 300;
}

function metric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function hostRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : { status: 'unavailable', error: 'host telemetry unavailable' };
}

function bytes(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return '未知';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let index = 0;
  while (Math.abs(amount) >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${index === 0 ? amount.toFixed(0) : amount.toFixed(2)} ${units[index]}`;
}

function compactNumber(value: unknown, digits = 1): string {
  const current = metric(value);
  return current === null ? '未知' : current.toFixed(digits);
}

function summaryLine(summary: Record<string, unknown>, suffix: string): string {
  const maxAt = typeof summary.maxAt === 'string' ? summary.maxAt.replace('T', ' ').replace('Z', '') : null;
  const peak = `${compactNumber(summary.max)}${suffix}${maxAt ? ` @ ${maxAt.slice(5, 16)}` : ''}`;
  return `avg/p95/峰值 ${compactNumber(summary.avg)}${suffix}/${compactNumber(summary.p95)}${suffix}/${peak}`;
}

function powerLine(power: Record<string, unknown>, summary: Record<string, unknown>): string {
  const currentWatts = metric(power.powerWatts);
  const current = currentWatts === null ? '未知（SoC 估算不可用）' : `${(currentWatts * 1000).toFixed(0)} mW（SoC 估算）`;
  const values = ['avg', 'p95', 'max'].map((key) => {
    const watts = metric(summary[key]);
    return watts === null ? '未知' : `${(watts * 1000).toFixed(0)} mW`;
  });
  return `SoC 功耗估算：${current}；今日 avg/p95/峰值 ${values.join('/')}`;
}

async function probe(url: string, signal?: AbortSignal): Promise<{ ok: boolean; data?: unknown }> {
  try {
    const data = await requestJson(url, { ...(signal ? { signal } : {}), timeoutMs: 8_000 });
    return { ok: healthy(data), data };
  } catch { return { ok: false }; }
}

export async function homelabStatus(
  config: AmadeusConfig,
  context: OpenClawPluginToolContext,
  notifier: OwnerNotifier,
  notifyOwner: boolean,
  reportPeriod?: 'morning' | 'evening',
  signal?: AbortSignal,
): Promise<unknown> {
  assertMacHostQueryContext(context);
  if ((notifyOwner || reportPeriod) && (isGroupContext(context) || !isTrustedOwnerContext(context))) {
    throw new Error('HomeLab owner notification requires direct owner authorization');
  }
  const host = hostRecord(await macHostStatus(config, context, signal));
  const serviceUrls: Record<string, string> = {
    OpenClaw: 'http://openclaw:18789/healthz',
    ProductRadar: `${config.homeLabServiceBaseUrl}:5315/health`,
    Changedetection: `${config.homeLabServiceBaseUrl}:5000/`,
    Immich: `${config.homeLabServiceBaseUrl}:2283/api/server/ping`,
    Emby: `${config.homeLabServiceBaseUrl}:8096/emby/system/info/public`,
    qBittorrent: `${config.homeLabServiceBaseUrl}:8080/`,
  };
  const services: Record<string, boolean> = {};
  await Promise.all(Object.entries(serviceUrls).map(async ([name, url]) => { services[name] = (await probe(url, signal)).ok; }));
  const openWrt = await probe(`${config.openWrtBaseUrl}/`, signal);
  services.OpenWrt = openWrt.ok;
  const unavailable = host.status !== 'ok';
  const cpu = host.cpu && typeof host.cpu === 'object' ? host.cpu as Record<string, unknown> : {};
  const memory = host.memory && typeof host.memory === 'object' ? host.memory as Record<string, unknown> : {};
  const swap = memory.swap && typeof memory.swap === 'object' ? memory.swap as Record<string, unknown> : {};
  const disks = host.disks && typeof host.disks === 'object' ? host.disks as Record<string, unknown> : {};
  const internal = disks.internal && typeof disks.internal === 'object' ? disks.internal as Record<string, unknown> : {};
  const avalon = disks.avalon && typeof disks.avalon === 'object' ? disks.avalon as Record<string, unknown> : {};
  const history = host.history && typeof host.history === 'object' ? host.history as Record<string, unknown> : {};
  const metrics = history.metrics && typeof history.metrics === 'object' ? history.metrics as Record<string, unknown> : {};
  const cpuSummary = metrics.cpu && typeof metrics.cpu === 'object' ? metrics.cpu as Record<string, unknown> : {};
  const swapSummary = metrics.swap && typeof metrics.swap === 'object' ? metrics.swap as Record<string, unknown> : {};
  const powerSummary = metrics.powerWatts && typeof metrics.powerWatts === 'object' ? metrics.powerWatts as Record<string, unknown> : {};
  const power = host.power && typeof host.power === 'object' ? host.power as Record<string, unknown> : {};
  const anomalies = Array.isArray(host.anomalies) ? host.anomalies : [];
  const serviceEntries = Object.entries(services).filter(([name]) => name !== 'OpenWrt');
  const unhealthyServices = serviceEntries.filter(([, ok]) => !ok).map(([name]) => name);
  const unhealthyText = unhealthyServices.join('、');
  const conclusion = unavailable ? '❌ 宿主机遥测不可用' : anomalies.length || unhealthyServices.length || !openWrt.ok ? '⚠️ 需要关注' : '✅ 正常';
  const serviceText = serviceEntries.filter(([, ok]) => ok).map(([name]) => name).join('、') || '无';
  const lines = [
    '🖥 M204 状态', `结论：${conclusion}`, '', '宿主机',
    unavailable ? '• 遥测不可用（host telemetry unavailable）' : `• Amadeus-M204｜CPU ${compactNumber(cpu.utilizationPercent)}%｜${summaryLine(cpuSummary, '%')}`,
    `• 内存 ${bytes(memory.used)} / ${bytes(memory.total)}｜Pressure ${String(memory.pressure ?? 'unknown')}`,
    `• Swap ${bytes(swap.used)}｜趋势 ${String(swapSummary.delta ?? '未知')}`,
    `• ${powerLine(power, powerSummary)}`,
    '• 整机输入功耗：未知（需外部墙上电表）', '', '存储',
    `• Macintosh HD ${bytes(internal.used)} / ${bytes(internal.total)}｜剩余 ${bytes(internal.free)}｜${internal.mounted === false ? '未挂载' : '已挂载'}`,
    `• Avalon ${bytes(avalon.used)} / ${bytes(avalon.total)}｜剩余 ${bytes(avalon.free)}｜${avalon.mounted === true ? '已挂载' : '不可用'}`,
    '', '服务', `• ✅ ${serviceText}`, `• ${openWrt.ok ? '✅' : '⚠️'} OpenWrt（独立 endpoint）`, ...(unhealthyText ? [`• ⚠️ ${unhealthyText}`] : []),
    '', '异常', `• ${anomalies.length ? anomalies.map((item) => (item as Record<string, unknown>).summary ?? 'unknown').join('；') : '无'}`,
  ];
  const text = lines.join('\n');
  let notification: unknown;
  if (notifyOwner) {
    const occurredAt = new Date().toISOString();
    const date = occurredAt.slice(0, 10);
    const period = reportPeriod ?? 'manual';
    const eventKey = reportPeriod ? `mac-host-report:${date}:${reportPeriod}` : `mac-host-report:manual:${occurredAt}`;
    const allHealthy = !unavailable && Object.values(services).every(Boolean) && !anomalies.length;
    notification = await notifier.notify(ownerEventForContext(adaptWorldlineNotification({
      type: 'worldline_notification_intent',
      eventType: reportPeriod ? `mac_host_report_${reportPeriod}` : 'mac_host_report',
      kind: allHealthy ? 'scheduled_report' : 'network_degraded',
      severity: allHealthy ? 'success' : unavailable ? 'error' : 'warning',
      significance: allHealthy ? 'notable' : unavailable ? 'critical' : 'major',
      eventKey,
      source: 'mac-host-report',
      headline: reportPeriod === 'morning' ? '🖥 M204 晨间状态' : reportPeriod === 'evening' ? '🖥 M204 晚间状态' : '🖥 M204 状态',
      facts: [
        { label: 'CPU 当前', value: metric(cpu.utilizationPercent), evidenceRefs: ['mac-host:/v1/status'] },
        { label: 'CPU 今日 avg/p95/max', value: `${cpuSummary.avg ?? '未知'}/${cpuSummary.p95 ?? '未知'}/${cpuSummary.max ?? '未知'}%`, evidenceRefs: ['mac-host:/v1/status'] },
        { label: 'Memory Pressure', value: memory.pressure === undefined ? null : String(memory.pressure), evidenceRefs: ['mac-host:/v1/status'] },
        { label: 'Avalon', value: avalon.mounted === true ? `${bytes(avalon.free)} free` : 'unavailable', evidenceRefs: ['mac-host:/v1/status'] },
        { label: 'OpenWrt', value: openWrt.ok, evidenceRefs: ['openwrt:/'] },
      ],
      summary: text,
      occurredAt,
    }), context));
  }
  return { text, host, services, openWrt: { ok: openWrt.ok, data: openWrt.data }, anomalies, ...(notification === undefined ? {} : { notification }) };
}
